import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Bot, Embed } from './yapper.js';
import * as rtc from '@livekit/rtc-node';
import ffmpegPath from 'ffmpeg-static';
import { getTrackStream } from './audius.js';
import { resolveMusicInput } from './music-resolver.js';

const token = process.env.YAPPER_BOT_TOKEN;
if (!token) {
    throw new Error('Set YAPPER_BOT_TOKEN in your environment or .env file.');
}

const bot = new Bot(token);
const servers = new Map();
const playLocks = new Map();
const ffmpegExecutable = process.env.FFMPEG_PATH
    || (ffmpegPath && existsSync(ffmpegPath) ? ffmpegPath : 'ffmpeg');
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const FRAME_SAMPLES = 480;
const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2;

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

    const audioStream = await getTrackStream(track.id);
    if (state.stopping || state.skipRequested) {
        state.skipRequested = false;
        audioStream.destroy();
        return false;
    }

    const ffmpeg = spawn(ffmpegExecutable, [
        '-hide_banner',
        '-loglevel', 'error',
        '-nostdin',
        '-re',
        '-i', 'pipe:0',
        '-vn',
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        '-ar', String(SAMPLE_RATE),
        '-ac', String(CHANNELS),
        'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    state.currentProcess = ffmpeg;
    state.startedAt = Date.now();
    state.pausedDuration = 0;
    state.pausedAt = state.paused ? Date.now() : null;
    ffmpeg.once('spawn', () => {
        if (state.stopping || state.skipRequested) return;
        const embed = new Embed()
            .title(track.title)
            .description(`**Artist:** ${track.artist || 'Unknown'}\n**Album:** ${track.album || 'Unknown'}\n**Progress:** 0:00 / ${formatDuration(track.duration)}\n**Requested by:** ${track.requestedBy || 'Unknown'}\n**Volume:** ${state.volume}%`)
            .color('#5865f2');
        if (track.artwork) embed.thumbnail(track.artwork);
        bot.send(state.textChannelId, `🎵 Now playing: **${displayTitle(track)}**`, { embeds: [embed] })
            .catch((error) => console.error('Could not announce playback:', error));
    });
    let remaining = Buffer.alloc(0);
    let frameWrites = Promise.resolve();
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
            remaining = Buffer.concat([remaining, chunk]);
            const frames = [];
            while (remaining.length >= FRAME_BYTES) {
                frames.push(remaining.subarray(0, FRAME_BYTES));
                remaining = remaining.subarray(FRAME_BYTES);
            }

            frameWrites = frameWrites.then(async () => {
                for (const frame of frames) {
                    if (state.stopping || state.skipRequested) break;
                    const pcm = new Int16Array(
                        frame.buffer.slice(frame.byteOffset, frame.byteOffset + FRAME_BYTES)
                    );
                    if (state.volume !== 100) {
                        const gain = state.volume / 100;
                        for (let index = 0; index < pcm.length; index += 1) {
                            pcm[index] = Math.max(-32768, Math.min(32767, Math.round(pcm[index] * gain)));
                        }
                    }
                    await state.call.source.captureFrame(
                        new rtc.AudioFrame(pcm, SAMPLE_RATE, CHANNELS, FRAME_SAMPLES)
                    );
                }
            }).catch((error) => {
                ffmpeg.kill();
                finish(state.stopping || state.skipRequested ? null : error);
            });
        });

        ffmpeg.on('close', (code) => {
            frameWrites.then(() => {
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
    if (!query) return message.reply('Usage: `/play song name, Spotify link, YouTube link, or Audius link`');
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
                const reason = result.unavailable
                    ? `${result.unavailable} item(s) had no verified playable match in the supported audio catalog.`
                    : 'No matching playable track was found.';
                return message.reply(`I could not add that request. ${reason} Linked audio is not relayed directly.`);
            }

            if (!state) {
                state = {
                    voiceChannelId,
                    textChannelId: message.channel_id,
                    queue: [],
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
                    pausedDuration: 0
                };
                servers.set(message.server_id, state);
            }

            const requestedBy = message.author?.display_name || message.author?.username
                || (typeof message.author === 'string' ? message.author : '')
                || message.username || message.author_id || 'Unknown';
            const tracks = result.tracks.map((track) => ({ ...track, requestedBy }));
            state.queue.push(...tracks);
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
        .description(`**Artist:** ${track.artist || 'Unknown'}\n**Album:** ${track.album || 'Unknown'}\n**Progress:** ${progress}${state.paused ? ' (paused)' : ''}\n**Requested by:** ${track.requestedBy || 'Unknown'}\n**Volume:** ${state.volume}%`)
        .color('#5865f2');
    if (track.artwork) embed.thumbnail(track.artwork);
    await message.reply('', { embeds: [embed] });
});

bot.command('skip', 'Skip the current song', async (message) => {
    const state = servers.get(message.server_id);
    if (!state?.current) return message.reply('There is no song to skip.');

    state.skipRequested = true;
    state.paused = false;
    state.pausedAt = null;
    state.currentProcess?.kill();
    await message.reply('⏭️ Skipped the current song.');
});

bot.command('stop', 'Stop playback and clear the server queue', async (message) => {
    const state = servers.get(message.server_id);
    if (!state) return message.reply('There is no music playing.');

    state.stopping = true;
    state.queue.length = 0;
    state.paused = false;
    state.currentProcess?.kill();
    await message.reply('⏹️ Playback stopped and the queue was cleared.');
});

bot.command('pause', 'Pause the current song', async (message) => {
    const state = servers.get(message.server_id);
    if (!state?.current || state.paused) return message.reply('There is no playing song to pause.');
    state.paused = true;
    state.pausedAt = Date.now();
    state.currentProcess?.stdout.pause();
    await message.reply('⏸️ Playback paused.');
});

bot.command('resume', 'Resume the current song', async (message) => {
    const state = servers.get(message.server_id);
    if (!state?.current || !state.paused) return message.reply('There is no paused song to resume.');
    if (state.pausedAt) state.pausedDuration += Date.now() - state.pausedAt;
    state.pausedAt = null;
    state.paused = false;
    state.currentProcess?.stdout.resume();
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
    await message.reply(`🔊 Volume set to ${volume}%.`);
});

bot.command('clearqueue', 'Remove upcoming songs from the queue', async (message) => {
    const state = servers.get(message.server_id);
    if (!state || !state.queue.length) return message.reply('There are no upcoming songs to clear.');
    const removed = state.queue.length;
    state.queue.length = 0;
    await message.reply(`🧹 Cleared ${removed} queued song(s).`);
});

bot.command('remove', 'Remove a song from the queue by position', async (message) => {
    const state = servers.get(message.server_id);
    const position = Number(message.args?.trim());
    if (!Number.isInteger(position) || position < 1) return message.reply('Usage: `/remove position`');
    if (!state?.queue.length) return message.reply('There are no upcoming songs to remove.');
    if (position > state.queue.length) return message.reply(`Choose a position from 1 to ${state.queue.length}.`);
    const [removed] = state.queue.splice(position - 1, 1);
    await message.reply(`Removed **${displayTitle(removed)}** from the queue.`);
});

bot.command('loop', 'Set repeat mode: off, song, or queue', async (message) => {
    const state = servers.get(message.server_id);
    if (!state) return message.reply('There is no music session in this server.');
    const mode = message.args?.trim().toLowerCase();
    if (!['off', 'song', 'queue'].includes(mode)) return message.reply('Usage: `/loop off|song|queue`');
    state.loopMode = mode;
    await message.reply(`🔁 Loop mode set to **${mode}**.`);
});

bot.command('shuffle', 'Shuffle the upcoming queue', async (message) => {
    const state = servers.get(message.server_id);
    if (!state || state.queue.length < 2) return message.reply('Add at least two upcoming songs to shuffle.');
    for (let index = state.queue.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [state.queue[index], state.queue[swapIndex]] = [state.queue[swapIndex], state.queue[index]];
    }
    await message.reply(`🔀 Shuffled ${state.queue.length} upcoming song(s).`);
});

bot.on('ready', (me) => console.log(`Yapin music bot online as ${me.username}.`));
bot.on('error', (error) => console.error('Yapin bot error:', error));

bot.start().catch((error) => {
    console.error('Could not start the Yapin bot:', error);
    process.exitCode = 1;
});
