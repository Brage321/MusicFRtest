import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFfmpegAvailable, FRAME_BYTES, FRAME_SAMPLES, SAMPLE_RATE } from '../audio-processing.js';
import { getAudioSourceStream } from '../audio-sources.js';
import { getFreeToUseTrackStream } from '../freetouse.js';
import { getJamendoTrackStream } from '../jamendo.js';
import { createVoiceFramePublisher } from '../yapin-voice.js';

test('rejects unknown audio providers instead of treating them as Audius', async () => {
    await assert.rejects(
        getAudioSourceStream({ id: 'track-without-provider' }),
        /Unsupported audio provider/
    );
});

test('reports an actionable error when FFmpeg cannot be launched', () => {
    const previousPath = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = 'missing-ffmpeg-binary-for-test';
    try {
        assert.throws(assertFfmpegAvailable, /FFmpeg is unavailable.*FFMPEG_PATH/);
    } finally {
        if (previousPath === undefined) delete process.env.FFMPEG_PATH;
        else process.env.FFMPEG_PATH = previousPath;
    }
});

test('requires a redistribution license before Jamendo stream retrieval', async () => {
    await assert.rejects(
        getJamendoTrackStream({
            provider: 'jamendo',
            streamUrl: 'https://api.jamendo.com/audio/track.mp3',
            license: 'All rights reserved'
        }),
        /unsupported audio stream URL/
    );
});

test('keeps Free To Use stream retrieval disabled without explicit authorization', async () => {
    const previousAuthorization = process.env.FREETOUSE_PLAYBACK_AUTHORIZED;
    delete process.env.FREETOUSE_PLAYBACK_AUTHORIZED;
    try {
        await assert.rejects(
            getFreeToUseTrackStream({
                provider: 'freetouse',
                streamUrl: 'https://eu.data.freetouse.com/file.mp3',
                license: 'Free To Use License'
            }),
            /disabled until authorization/
        );
    } finally {
        if (previousAuthorization === undefined) delete process.env.FREETOUSE_PLAYBACK_AUTHORIZED;
        else process.env.FREETOUSE_PLAYBACK_AUTHORIZED = previousAuthorization;
    }
});

test('publishes complete PCM frames and applies the current volume', async () => {
    const frames = [];
    class AudioFrame {
        constructor(data, sampleRate, channels, samplesPerChannel) {
            Object.assign(this, { data, sampleRate, channels, samplesPerChannel });
        }
    }

    const publisher = createVoiceFramePublisher({
        source: { async captureFrame(frame) { frames.push(frame); } }
    }, { AudioFrame }, {
        getVolume: () => 50,
        shouldStop: () => false
    });

    const pcm = Buffer.alloc(FRAME_BYTES);
    for (let offset = 0; offset < FRAME_BYTES; offset += 2) {
        pcm.writeInt16LE(1000, offset);
    }

    await publisher.write(pcm.subarray(0, FRAME_BYTES / 2));
    await publisher.write(pcm.subarray(FRAME_BYTES / 2));
    await publisher.flush();

    assert.equal(frames.length, 1);
    assert.equal(frames[0].sampleRate, SAMPLE_RATE);
    assert.equal(frames[0].channels, 2);
    assert.equal(frames[0].samplesPerChannel, FRAME_SAMPLES);
    assert.ok([...frames[0].data].every((sample) => sample === 500));
});
