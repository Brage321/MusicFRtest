import 'dotenv/config';
import { Bot, Embed } from './yapper.js';
import * as rtc from '@livekit/rtc-node';
import { getAudioSourceStream } from './audio-sources.js';
import { assertFfmpegAvailable, createPcmDecoder } from './audio-processing.js';
import { createVoiceFramePublisher } from './yapin-voice.js';
import { getEmbedArtwork } from './embed-artwork.js';
import { resolveMusicInput } from './music-resolver.js';
import { connectQueueStore } from './queue-store.js';

const token = process.env.YAPPER_BOT_TOKEN;
if (!token) {
    throw new Error('Set YAPPER_BOT_TOKEN in your environment or .env file.');
}

assertFfmpegAvailable();

const bot = new Bot(token);
const servers = new Map();
const playLocks = new Map();
const queueStore = await connectQueueStore();

function createServerState({ voiceChannelId, textChannelId, queue = [] }) {
    return {
        voiceChannelId,
        textChannelId,
        queue,
        current: null,
        currentProcess: null,
        call: null,
        worker: null,
        stopping: false,
        skipRequested: false,
        loopMode: 'off',
        volume: 100,
        paused: false,
        startedAt: 0,
        pausedAt: null,
        pausedDuration: 0,
        persistenceWarningSent: false
    };
}

async function persistState(serverId, state) {
    if (!queueStore) return true;

    try {
        await queueStore.save(serverId, state);
        state.persistenceWarningSent = false;
        return true;
    } catch (error) {
        console.error(`Could not persist the music queue for server ${serverId}:`, error);
        if (!state.persistenceWarningSent) {
            state.persistenceWarningSent = true;
            try {
                await bot.send(state.textChannelId, '⚠️ The queue is still running, but MongoDB could not save it. It may be lost if the bot restarts.');
            } catch (sendError) {
                console.error(`Could not report MongoDB persistence failure for server ${serverId}:`, sendError);
            }
        }
        return false;
    }
}

async function restoreQueues() {
    if (!queueStore) return;

    const restored = await queueStore.loadAll();
    for (const { serverId, state } of restored) {
        if (servers.has(serverId)) {
            console.error(`Skipped a saved queue for server ${serverId}; an active queue already exists.`);
            continue;
        }
        servers.set(serverId, state);
        startQueue(serverId, state);
    }
    console.log(`Restored ${restored.length} saved Yapin music queue(s).`);
}

async function findCallerVoiceChannel(message) {
    if (!message.server_id) return null;

    const userId = message.author_id || message.author?.id;
    if (!userId) return null;

    const channels = await bot.voice(message.server_id);
    const voiceChannels = Array.isArray(channels) ? channels : channels?.voice;
    if (!Array.isArray(voiceChannels)) {
        throw new Error('Yapin returned an invalid voice-channel list.');
    }

    return voiceChannels.find((channel) => channel.user_ids?.includes(userId))?.channel_id || null;
}

function displayTitle(track) {
    return track.artist ? `${track.artist} - ${track.title}` : track.title;
}

function sourceAttribution(track) {
    if (track.provider === 'audius' && track.url && track.licenseName) {
        return `\n**Track:** [${track.artist || 'Audius'} - ${track.title}](${track.url}) · ${track.licenseName} (as declared on Audius)`;
    }
    if (track.provider === 'jamendo' && track.url && track.license) {
        return `\n**Track:** [Jamendo](${track.url}) · [CC license](${track.license})`;
    }
    if (track.provider === 'freetouse' && track.url) {
        return `\n**Music:** [${track.artist ? `${track.title} by ${track.artist}` : track.title}](${track.url}) · Free To Use`;
    }
    return '';
}

function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function playbackProgress(state) {
    if (!state.startedAt) return 0;
    const pausedFor = state.pausedDuration + (state.pausedAt ? Date.now() - state.pausedAt : 0);
    return Math.max(0, Math.floor((Date.now() - state.startedAt - pausedFor) / 1000));
}

function playbackErrorMessage(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/[\r\n]+/g, ' ').slice(0, 240) || 'An audio playback error occurred.';
}

async function streamTrack(state, track) {
    if (state.stopping || state.skipRequested) {
        state.skipRequested = false;
        return false;
    }

    const audioStream = await getAudioSourceStream(track);
    if (state.stopping || state.skipRequested) {
        state.skipRequested = false;
        audioStream.destroy();
        return false;
    }

    const ffmpeg = createPcmDecoder();

    state.currentProcess = ffmpeg;
    state.startedAt = Date.now();
    state.pausedDuration = 0;
    state.pausedAt = state.paused ? Date.now() : null;
    ffmpeg.once('spawn', () => {
        if (state.stopping || state.skipRequested) return;
        const embed = new Embed()
            .title(track.title)
            .description(`**Artist:** ${track.artist || 'Unknown'}\n**Album:** ${track.album || 'Unknown'}\n**Progress:** 0:00 / ${formatDuration(track.duration)}\n**Requested by:** ${track.requestedBy || 'Unknown'}\n**Volume:** ${state.volume}%${sourceAttribution(track)}`)
            .color('#5865f2');
        const artwork = getEmbedArtwork(track.artwork);
        if (artwork) embed.thumbnail(artwork);
        bot.send(state.textChannelId, `🎵 Now playing: **${displayTitle(track)}**`, { embeds: [embed] })
            .catch((error) => console.error('Could not announce playback:', error));
    });
    const voicePublisher = createVoiceFramePublisher(state.call, rtc, {
        getVolume: () => state.volume,
        shouldStop: () => state.stopping || state.skipRequested
    });
    let settled = false;
    let completedNaturally = false;

    const result = new Promise((resolve, reject) => {
        const finish = (error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve();
        };

        ffmpeg.on('error', finish);
        audioStream.on('error', (error) => {
            ffmpeg.kill();
            finish(state.stopping || state.skipRequested ? null : error);
        });
        ffmpeg.stdin.on('error', (error) => {
            if (!['EPIPE', 'ERR_STREAM_DESTROYED'].includes(error.code)) finish(error);
        });

        ffmpeg.stdout.on('data', (chunk) => {
            voicePublisher.write(chunk).catch((error) => {
                ffmpeg.kill();
                finish(state.stopping || state.skipRequested ? null : error);
            });
        });

        ffmpeg.on('close', (code) => {
            voicePublisher.flush().then(() => {
                if (state.stopping || state.skipRequested) {
                    state.skipRequested = false;
                    finish();
                } else if (code === 0) {
                    completedNaturally = true;
                    finish();
                } else {
                    finish(new Error(`FFmpeg exited with code ${code}.`));
                }
            }, finish);
        });
    });
    if (state.paused) ffmpeg.stdout.pause();
    audioStream.pipe(ffmpeg.stdin);

    try {
        await result;
        return completedNaturally;
    } finally {
        state.currentProcess = null;
        state.startedAt = 0;
        state.pausedAt = null;
        state.pausedDuration = 0;
    }
}

async function leaveVoice(serverId, state) {
    let leaveError = null;
    if (state.call) {
        try {
            await state.call.leave();
        } catch (error) {
            leaveError = error;
        } finally {
            state.call = null;
        }
    }

    await bot.leaveVoice(serverId);
    if (leaveError) throw leaveError;
}

async function withPlayLock(serverId, callback) {
    const previous = playLocks.get(serverId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    playLocks.set(serverId, current);
    await previous;

    try {
        return await callback();
    } finally {
        release();
        if (playLocks.get(serverId) === current) playLocks.delete(serverId);
    }
}

async function runQueue(serverId, state) {
    try {
        while (state.queue.length && !state.stopping) {
            const track = state.queue.shift();
            state.current = track;
            let completedNaturally = false;
            await persistState(serverId, state);

            try {
                if (!state.call) {
                    state.call = await bot.connectVoice(rtc, serverId, state.voiceChannelId);
                }

                completedNaturally = await streamTrack(state, track);
            } catch (error) {
                console.error(`Playback failed in server ${serverId}:`, error);
                try {
                    await bot.send(state.textChannelId, `⚠️ Could not play **${displayTitle(track)}**: ${playbackErrorMessage(error)}`);
                } catch (sendError) {
                    console.error(`Could not report playback failure in server ${serverId}:`, sendError);
                }
            } finally {
                if (completedNaturally && !state.stopping) {
                    if (state.loopMode === 'song') state.queue.unshift(track);
                    else if (state.loopMode === 'queue') state.queue.push(track);
                }
                state.current = null;
                state.paused = false;
                state.pausedAt = null;
                state.pausedDuration = 0;
                await persistState(serverId, state);
            }
        }
    } finally {
        try {
            await leaveVoice(serverId, state);
        } catch (error) {
            console.error(`Could not leave voice in server ${serverId}:`, error);
        }

        state.worker = null;
        if (state.queue.length && !state.stopping) {
            startQueue(serverId, state);
        } else if (servers.get(serverId) === state) {
            servers.delete(serverId);
            await persistState(serverId, state);
        }
    }
}

function startQueue(serverId, state) {
    if (!state.worker) {
        state.worker = runQueue(serverId, state);
    }
}

bot.command('play', 'Play a song or add it to the server queue', async (message) => {
    const query = message.args?.trim();
    if (!query) return message.reply('Usage: `/play song name, Spotify link, YouTube link, Audius link, jamendo: search terms, or freetouse: search terms`');
    if (!message.server_id) return message.reply('Music playback is only available in a server.');

    try {
        await withPlayLock(message.server_id, async () => {
            const voiceChannelId = await findCallerVoiceChannel(message);
            if (!voiceChannelId) return message.reply('Join a voice channel before using `/play`.');

            let state = servers.get(message.server_id);
            if (state?.stopping) {
                return message.reply('Playback is stopping; try again in a moment.');
            }
            if (state && state.voiceChannelId !== voiceChannelId) {
                return message.reply('This server already has music playing in another voice channel.');
            }

            const result = await resolveMusicInput(query);
            if (!result.tracks.length) {
                const reason = result.needsArtist
                    ? 'I could not verify the artist for that title-only search. Try `/play Blinding Lights - The Weeknd` or provide a Spotify/YouTube link.'
                    : result.unavailable
                    ? `${result.unavailable} item(s) had no verified playable match in the supported audio catalog.`
                    : 'No matching playable track was found.';
                const watchHint = process.env.YOUTUBE_API_KEY
                    ? ` Try \`/watch ${query}\` to find the YouTube music video and open it there.`
                    : '';
                return message.reply(`I could not add that request. ${reason} Linked audio is not relayed directly.${watchHint}`);
            }

            if (!state) {
                state = createServerState({
                    voiceChannelId,
                    textChannelId: message.channel_id,
                });
                servers.set(message.server_id, state);
            }

            const requestedBy = message.author?.display_name || message.author?.username
                || (typeof message.author === 'string' ? message.author : '')
                || message.username || message.author_id || 'Unknown';
            const tracks = result.tracks.map((track) => ({ ...track, requestedBy }));
            state.queue.push(...tracks);
            await persistState(message.server_id, state);
            startQueue(message.server_id, state);
            const position = state.queue.length - tracks.length + (state.current ? 1 : 0);
            const added = tracks.length === 1
                ? `Added **${displayTitle(tracks[0])}** to the queue (position ${position}).`
                : `Added **${tracks.length}** playable tracks from **${result.collectionName || 'the collection'}**.`;
            const skipped = result.unavailable
                ? ` ${result.unavailable} item(s) were skipped because no verified playable match was found.`
                : '';
            const truncated = result.truncated ? ' Only the first 50 items are supported per collection.' : '';
            await message.reply(`✅ ${added}${skipped}${truncated}`);
        });
    } catch (error) {
        console.error('Yapin play command failed:', error);
        await message.reply(`Could not add that song: ${playbackErrorMessage(error)}`);
    }
});

bot.command('watch', 'Find YouTube videos to open and watch', async (message) => {
    const query = message.args?.trim();
    if (!query) return message.reply('Usage: `/watch song name - artist`');
    if (!process.env.YOUTUBE_API_KEY) {
        return message.reply('YouTube search is not configured. Set `YOUTUBE_API_KEY` to enable `/watch`.');
    }

    try {
        const result = await resolveYouTube(query);
        const videos = result.tracks.slice(0, 5);
        if (!videos.length) return message.reply('No public YouTube videos were found for that search.');

        const choices = videos
            .map((video, index) => `${index + 1}. [${video.title} — ${video.artist}](${video.url})`)
            .join('\n');
        await message.reply(`🎬 **YouTube results** (open a link to watch; this does not play in voice):\n${choices}`);
    } catch (error) {
        console.error('Yapin YouTube video search failed:', error);
        await message.reply(`Could not search YouTube: ${playbackErrorMessage(error)}`);
    }
});

bot.command('queue', 'Show the current song and upcoming queue', async (message) => {
    const state = servers.get(message.server_id);
    if (!state || (!state.current && state.queue.length === 0)) {
        return message.reply('The music queue is empty.');
    }

    const upcoming = state.queue.slice(0, 10)
        .map((track, index) => `${index + 1}. ${displayTitle(track)}`)
        .join('\n');
    const current = state.current ? `Now playing: **${displayTitle(state.current)}**` : 'Connecting to voice…';
    await message.reply(`${current}${upcoming ? `\n\nUp next:\n${upcoming}` : '\n\nNo songs queued.'}`);
});

bot.command('nowplaying', 'Show the current track and playback progress', async (message) => {
    const state = servers.get(message.server_id);
    if (!state?.current) return message.reply('There is no song playing.');

    const track = state.current;
    const elapsed = playbackProgress(state);
    const progress = track.duration
        ? `${formatDuration(elapsed)} / ${formatDuration(track.duration)}`
        : formatDuration(elapsed);
    const embed = new Embed()
        .title(track.title)
        .description(`**Artist:** ${track.artist || 'Unknown'}\n**Album:** ${track.album || 'Unknown'}\n**Progress:** ${progress}${state.paused ? ' (paused)' : ''}\n**Requested by:** ${track.requestedBy || 'Unknown'}\n**Volume:** ${state.volume}%${sourceAttribution(track)}`)
        .color('#5865f2');
    const artwork = getEmbedArtwork(track.artwork);
    if (artwork) embed.thumbnail(artwork);
    await message.reply('', { embeds: [embed] });
});

bot.command('skip', 'Skip the current song', async (message) => {
    const state = servers.get(message.server_id);
    if (!state?.current) return message.reply('There is no song to skip.');

    state.skipRequested = true;
    state.paused = false;
    state.pausedAt = null;
    state.currentProcess?.kill();
    await persistState(message.server_id, state);
    await message.reply('⏭️ Skipped the current song.');
});

bot.command('stop', 'Stop playback and clear the server queue', async (message) => {
    const state = servers.get(message.server_id);
    if (!state) return message.reply('There is no music playing.');

    state.stopping = true;
    state.queue.length = 0;
    state.paused = false;
    state.currentProcess?.kill();
    await persistState(message.server_id, state);
    await message.reply('⏹️ Playback stopped and the queue was cleared.');
});

bot.command('pause', 'Pause the current song', async (message) => {
    const state = servers.get(message.server_id);
    if (!state?.current || state.paused) return message.reply('There is no playing song to pause.');
    state.paused = true;
    state.pausedAt = Date.now();
    state.currentProcess?.stdout.pause();
    await persistState(message.server_id, state);
    await message.reply('⏸️ Playback paused.');
});

bot.command('resume', 'Resume the current song', async (message) => {
    const state = servers.get(message.server_id);
    if (!state?.current || !state.paused) return message.reply('There is no paused song to resume.');
    if (state.pausedAt) state.pausedDuration += Date.now() - state.pausedAt;
    state.pausedAt = null;
    state.paused = false;
    state.currentProcess?.stdout.resume();
    await persistState(message.server_id, state);
    await message.reply('▶️ Playback resumed.');
});

bot.command('volume', 'Set playback volume from 0 to 100', async (message) => {
    const state = servers.get(message.server_id);
    if (!state) return message.reply('There is no music session in this server.');
    const volume = Number(message.args?.trim());
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
        return message.reply('Usage: `/volume 0-100`');
    }
    state.volume = volume;
    await persistState(message.server_id, state);
    await message.reply(`🔊 Volume set to ${volume}%.`);
});

bot.command('clearqueue', 'Remove upcoming songs from the queue', async (message) => {
    const state = servers.get(message.server_id);
    if (!state || !state.queue.length) return message.reply('There are no upcoming songs to clear.');
    const removed = state.queue.length;
    state.queue.length = 0;
    await persistState(message.server_id, state);
    await message.reply(`🧹 Cleared ${removed} queued song(s).`);
});

bot.command('remove', 'Remove a song from the queue by position', async (message) => {
    const state = servers.get(message.server_id);
    const position = Number(message.args?.trim());
    if (!Number.isInteger(position) || position < 1) return message.reply('Usage: `/remove position`');
    if (!state?.queue.length) return message.reply('There are no upcoming songs to remove.');
    if (position > state.queue.length) return message.reply(`Choose a position from 1 to ${state.queue.length}.`);
    const [removed] = state.queue.splice(position - 1, 1);
    await persistState(message.server_id, state);
    await message.reply(`Removed **${displayTitle(removed)}** from the queue.`);
});

bot.command('loop', 'Set repeat mode: off, song, or queue', async (message) => {
    const state = servers.get(message.server_id);
    if (!state) return message.reply('There is no music session in this server.');
    const mode = message.args?.trim().toLowerCase();
    if (!['off', 'song', 'queue'].includes(mode)) return message.reply('Usage: `/loop off|song|queue`');
    state.loopMode = mode;
    await persistState(message.server_id, state);
    await message.reply(`🔁 Loop mode set to **${mode}**.`);
});

bot.command('shuffle', 'Shuffle the upcoming queue', async (message) => {
    const state = servers.get(message.server_id);
    if (!state || state.queue.length < 2) return message.reply('Add at least two upcoming songs to shuffle.');
    for (let index = state.queue.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [state.queue[index], state.queue[swapIndex]] = [state.queue[swapIndex], state.queue[index]];
    }
    await persistState(message.server_id, state);
    await message.reply(`🔀 Shuffled ${state.queue.length} upcoming song(s).`);
});

bot.on('ready', async (me) => {
    console.log(`Yapin music bot online as ${me.username}.`);
    if (!queueStore) {
        console.warn('MongoDB is not configured; Yapin queues will not survive a restart.');
        return;
    }

    try {
        await restoreQueues();
    } catch (error) {
        console.error('Could not restore Yapin music queues from MongoDB:', error);
    }
});
bot.on('error', (error) => console.error('Yapin bot error:', error));

bot.start().catch((error) => {
    console.error('Could not start the Yapin bot:', error);
    process.exitCode = 1;
});
