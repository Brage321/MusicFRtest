import { getTrackStream } from './audius.js';
import { getFreeToUseTrackStream } from './freetouse.js';
import { getJamendoTrackStream } from './jamendo.js';

export async function getAudioSourceStream(track) {
    switch (track?.provider) {
        case 'audius':
            return getTrackStream(track);
        case 'jamendo':
            return getJamendoTrackStream(track);
        case 'freetouse':
            return getFreeToUseTrackStream(track);
        default:
            throw new Error(`Unsupported audio provider: ${track?.provider || 'unknown'}.`);
    }
}
