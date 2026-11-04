import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Bot } from './yapper.js';
import * as rtc from '@livekit/rtc-node';
import ffmpegPath from 'ffmpeg-static';
import play from 'play-dl';

const token = process.env.YAPPER_BOT_TOKEN;
if (!token) {
    throw new Error('Set YAPPER_BOT_TOKEN in your environment or .env file.');
}

if (process.env.YOUTUBE_COOKIE) {
    await play.setToken({ youtube: { cookie: process.env.YOUTUBE_COOKIE } });
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

async function resolveTrack(query) {
    if (play.yt_validate(query) === 'video') {
        const info = await play.video_basic_info(query);
        const video = info.video_details;
        if (video?.url && video.title) return { title: video.title, url: video.url, source: 'youtube' };
        return null;
    }

    const results = await play.search(query, { limit: 1, source: { youtube: 'video' } });
    const video = results[0];
    if (!video?.url || !video.title) return null;

    return { title: video.title, url: video.url, source: 'youtube' };
}

function playbackErrorMessage(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/header overflow/i.test(message)) {
        return 'The audio service returned a response that was too large. Please try again later.';
    }
    if (/sign in to confirm.*not a bot|confirm you.re not a bot/i.test(message)) {
        return 'This track could not be streamed from this server. Please try another track.';
    }
    if (/blocked this server|could not be initialized|no matching playable track/i.test(message)) {
        return 'No playable version of this track was found. Please try another track.';
    }

    return 'An audio playback error occurred. Please try another track.';
}

function isYouTubeBotBlock(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /sign in to confirm.*not a bot|confirm you.re not a bot/i.test(message);
}

async function initializeSoundCloud() {
    const clientId = process.env.SOUNDCLOUD_CLIENT_ID || await play.getFreeClientID();
    if (!clientId) {
        throw new Error('No SoundCloud client ID is available.');
    }

    await play.setToken({ soundcloud: { client_id: clientId } });
}

function soundCloudQueries(title) {
    const cleaned = title
        .replace(/\s*[\[(][^\])]*(?:official|offisiell|lyrics?|lyrikk|music video)[^\])]*[\])]/gi, '')
        .replace(/\b(?:official|offisiell|lyrics?|lyrikkvideo|music video|lyric video)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    const parts = cleaned.split(/\s[-–—]\s/);
    const variants = [cleaned];

    if (parts.length > 1) {
        variants.push(parts.join(' '), [...parts].reverse().join(' '));
    }

    return [...new Set(variants.map((query) => query.trim()).filter(Boolean))];
}

async function getTrackStream(track) {
    try {
        return { audio: await play.stream(track.url), track };
    } catch (error) {
        if (track.source !== 'youtube' || !isYouTubeBotBlock(error)) throw error;

        try {
            await initializeSoundCloud();
        } catch (fallbackError) {
            throw new Error(`YouTube blocked this server and SoundCloud could not be initialized: ${fallbackError.message}`, {
                cause: fallbackError
            });
        }

        const triedUrls = new Set();
        for (const query of soundCloudQueries(track.title)) {
            let results;
            try {
                results = await play.search(query, {
                    limit: 5,
                    source: { soundcloud: 'tracks' }
                });
            } catch (searchError) {
                console.warn(`SoundCloud search failed for "${query}": ${searchError.message}`);
                continue;
            }

            for (const result of results) {
                if (!result.permalink || triedUrls.has(result.permalink)) continue;
                triedUrls.add(result.permalink);

                try {
                    return {
                        audio: await play.stream(result.permalink),
                        track: { ...track, title: result.name || track.title, source: 'fallback' }
                    };
                } catch (fallbackError) {
                    console.warn(`SoundCloud fallback failed for "${result.name}": ${fallbackError.message}`);
                }
            }
        }

        throw new Error('YouTube blocked this server and SoundCloud had no matching playable track.');
    }
}

async function streamTrack(state, track) {
    if (state.stopping || state.skipRequested) {
        state.skipRequested = false;
        return;
    }

    const playback = await getTrackStream(track);
    const audio = playback.audio;
    track.title = playback.track.title;
    if (state.stopping || state.skipRequested) {
        state.skipRequested = false;
        audio.stream.destroy();
        return;
    }

    try {
        await bot.send(state.textChannelId, `🎵 Now playing: **${track.title}**`);
    } catch (error) {
        console.error('Could not announce playback:', error);
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
    let remaining = Buffer.alloc(0);
    let frameWrites = Promise.resolve();
    let settled = false;

    const result = new Promise((resolve, reject) => {
        const finish = (error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve();
        };

        ffmpeg.on('error', finish);
        audio.stream.on('error', (error) => {
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
                    finish();
                } else {
                    finish(new Error(`FFmpeg exited with code ${code}.`));
                }
            }, finish);
        });
    });

    audio.stream.pipe(ffmpeg.stdin);

    try {
        await result;
    } finally {
        state.currentProcess = null;
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

            try {
                if (!state.call) {
                    state.call = await bot.connectVoice(rtc, serverId, state.voiceChannelId);
                }

                await streamTrack(state, track);
            } catch (error) {
                console.error(`Playback failed in server ${serverId}:`, error);
                try {
                    await bot.send(state.textChannelId, `⚠️ Could not play **${track.title}**: ${playbackErrorMessage(error)}`);
                } catch (sendError) {
                    console.error(`Could not report playback failure in server ${serverId}:`, sendError);
                }
            } finally {
                state.current = null;
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

bot.command('play', 'Play a YouTube song or add it to the server queue', async (message) => {
    const query = message.args?.trim();
    if (!query) return message.reply('Usage: `/play song name or YouTube URL`');
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

            const track = await resolveTrack(query);
            if (!track) return message.reply('I could not find a matching YouTube track.');

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
                    skipRequested: false
                };
                servers.set(message.server_id, state);
            }

            state.queue.push(track);
            startQueue(message.server_id, state);
            await message.reply(`✅ Added **${track.title}** to the queue (position ${state.queue.length + (state.current ? 1 : 0)}).`);
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
        .map((track, index) => `${index + 1}. ${track.title}`)
        .join('\n');
    const current = state.current ? `Now playing: **${state.current.title}**` : 'Connecting to voice…';
    await message.reply(`${current}${upcoming ? `\n\nUp next:\n${upcoming}` : '\n\nNo songs queued.'}`);
});

bot.command('skip', 'Skip the current song', async (message) => {
    const state = servers.get(message.server_id);
    if (!state?.current) return message.reply('There is no song to skip.');

    state.skipRequested = true;
    state.currentProcess?.kill();
    await message.reply('⏭️ Skipped the current song.');
});

bot.command('stop', 'Stop playback and clear the server queue', async (message) => {
    const state = servers.get(message.server_id);
    if (!state) return message.reply('There is no music playing.');

    state.stopping = true;
    state.queue.length = 0;
    state.currentProcess?.kill();
    await message.reply('⏹️ Playback stopped and the queue was cleared.');
});

bot.on('ready', (me) => console.log(`Yapin music bot online as ${me.username}.`));
bot.on('error', (error) => console.error('Yapin bot error:', error));

bot.start().catch((error) => {
    console.error('Could not start the Yapin bot:', error);
    process.exitCode = 1;
});
