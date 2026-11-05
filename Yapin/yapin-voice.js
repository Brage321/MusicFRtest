import { CHANNELS, FRAME_BYTES, FRAME_SAMPLES, SAMPLE_RATE } from './audio-processing.js';

export function createVoiceFramePublisher(call, rtc, { getVolume, shouldStop }) {
    let remaining = Buffer.alloc(0);
    let frameWrites = Promise.resolve();

    function write(chunk) {
        remaining = Buffer.concat([remaining, chunk]);
        const frames = [];
        while (remaining.length >= FRAME_BYTES) {
            frames.push(remaining.subarray(0, FRAME_BYTES));
            remaining = remaining.subarray(FRAME_BYTES);
        }

        frameWrites = frameWrites.then(async () => {
            for (const frame of frames) {
                if (shouldStop()) break;
                const pcm = new Int16Array(
                    frame.buffer.slice(frame.byteOffset, frame.byteOffset + FRAME_BYTES)
                );
                const volume = getVolume();
                if (volume !== 100) {
                    const gain = volume / 100;
                    for (let index = 0; index < pcm.length; index += 1) {
                        pcm[index] = Math.max(-32768, Math.min(32767, Math.round(pcm[index] * gain)));
                    }
                }
                await call.source.captureFrame(
                    new rtc.AudioFrame(pcm, SAMPLE_RATE, CHANNELS, FRAME_SAMPLES)
                );
            }
        });
        return frameWrites;
    }

    return {
        write,
        flush: () => frameWrites
    };
}
