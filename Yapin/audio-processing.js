import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import ffmpegPath from 'ffmpeg-static';

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
export const FRAME_SAMPLES = 480;
export const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2;

function getFfmpegExecutable() {
    return process.env.FFMPEG_PATH
        || (ffmpegPath && existsSync(ffmpegPath) ? ffmpegPath : 'ffmpeg');
}

export function assertFfmpegAvailable() {
    const executable = getFfmpegExecutable();
    const result = spawnSync(executable, ['-version'], {
        encoding: 'utf8',
        windowsHide: true
    });
    if (result.error || result.status !== 0) {
        const detail = result.error?.message || result.stderr?.trim() || `exited with status ${result.status}`;
        throw new Error(
            `FFmpeg is unavailable (${detail}). Allow the pinned ffmpeg-static install script, install FFmpeg in the hosting image, or set FFMPEG_PATH.`
        );
    }
}

export function createPcmDecoder() {
    return spawn(getFfmpegExecutable(), [
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
}
