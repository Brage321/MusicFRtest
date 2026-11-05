import { Readable } from 'node:stream';

const API_BASE = 'https://api.audius.co/v1';
const STREAM_RESPONSE_TIMEOUT_MS = 30_000;
const SEARCH_RESULT_LIMIT = 100;
const AUDIO_LICENSES = new Map([
    ['Attribution CC BY', { name: 'CC BY' }],
    ['Attribution ShareAlike CC BY-SA', { name: 'CC BY-SA' }],
    ['Attribution-ShareAlike CC BY-SA', { name: 'CC BY-SA' }]
]);

async function fetchStreamResponse(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort(new DOMException('The audio source timed out before responding.', 'TimeoutError'));
    }, STREAM_RESPONSE_TIMEOUT_MS);
    timeout.unref?.();

    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error('Audius audio source timed out before playback could start.');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function headers() {
    const result = {};
    if (process.env.AUDIUS_API_KEY) {
        result['x-api-key'] = process.env.AUDIUS_API_KEY;
    }
    return result;
}

async function apiRequest(path) {
    const response = await fetch(`${API_BASE}${path}`, {
        headers: headers(),
        signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
        throw new Error(`Audius API request failed (${response.status}).`);
    }

    return response.json();
}

function toTrack(item) {
    if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || !item.title.trim()) {
        return null;
    }
    const artist = item.user?.name || item.artist;
    const audioLicense = AUDIO_LICENSES.get(item.license);
    if (!audioLicense
        || item.is_streamable === false
        || typeof artist !== 'string'
        || !artist.trim()
        || typeof item.permalink !== 'string'
        || !item.permalink.startsWith('/')) {
        return null;
    }

    return {
        id: item.id,
        provider: 'audius',
        title: item.title,
        artist,
        album: '',
        artwork: item.artwork?.['480x480'] || item.artwork?.['150x150'] || item.artwork?.['1000x1000'] || '',
        duration: Number(item.duration) || 0,
        url: item.permalink ? `https://audius.co${item.permalink}` : '',
        license: item.license,
        licenseName: audioLicense.name,
        streamable: true
    };
}

export async function searchTracks(query) {
    const params = new URLSearchParams({ query, limit: String(SEARCH_RESULT_LIMIT) });
    const response = await apiRequest(`/tracks/search?${params}`);
    const items = Array.isArray(response.data) ? response.data : [];
    return items.map(toTrack).filter((track) => track?.streamable);
}

export async function resolveTrackUrl(url) {
    const parsedUrl = new URL(url);
    if (!['audius.co', 'www.audius.co'].includes(parsedUrl.hostname)) {
        throw new Error('Unsupported track link.');
    }

    const params = new URLSearchParams({ url: parsedUrl.toString() });
    const response = await apiRequest(`/resolve?${params}`);
    const track = toTrack(response.data);
    return track?.streamable ? track : null;
}

export async function getTrackStream(track) {
    if (track?.provider !== 'audius' || !AUDIO_LICENSES.has(track.license) || !track.id) {
        throw new Error('Audius playback requires a track with an explicit CC BY or CC BY-SA license.');
    }

    const response = await fetchStreamResponse(`${API_BASE}/tracks/${encodeURIComponent(track.id)}/stream`, {
        headers: headers(),
        redirect: 'manual'
    });

    let streamResponse = response;
    if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) {
            throw new Error('Audius did not return an audio stream.');
        }

        const streamUrl = new URL(location);
        if (streamUrl.protocol !== 'https:') {
            throw new Error('Audius returned an unsupported audio stream URL.');
        }

        streamResponse = await fetchStreamResponse(streamUrl);
    }

    if (!streamResponse.ok || !streamResponse.body) {
        await streamResponse.body?.cancel();
        throw new Error(`Audius could not stream this track (${streamResponse.status}).`);
    }

    return Readable.fromWeb(streamResponse.body);
}
