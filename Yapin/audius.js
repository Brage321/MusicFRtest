import { Readable } from 'node:stream';

const API_BASE = 'https://api.audius.co/v1';

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
    if (!item || typeof item.id !== 'string' || typeof item.title !== 'string') {
        return null;
    }

    return {
        id: item.id,
        title: item.title,
        artist: item.user?.name || item.artist || '',
        album: '',
        artwork: item.artwork?.['480x480'] || item.artwork?.['150x150'] || item.artwork?.['1000x1000'] || '',
        duration: Number(item.duration) || 0,
        url: item.permalink ? `https://audius.co${item.permalink}` : '',
        streamable: item.is_streamable !== false
    };
}

export async function searchTracks(query) {
    const params = new URLSearchParams({ query, limit: '10' });
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

export async function getTrackStream(trackId) {
    const response = await fetch(`${API_BASE}/tracks/${encodeURIComponent(trackId)}/stream`, {
        headers: headers(),
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000)
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

        streamResponse = await fetch(streamUrl, {
            signal: AbortSignal.timeout(30_000)
        });
    }

    if (!streamResponse.ok || !streamResponse.body) {
        await streamResponse.body?.cancel();
        throw new Error(`Audius could not stream this track (${streamResponse.status}).`);
    }

    return Readable.fromWeb(streamResponse.body);
}
