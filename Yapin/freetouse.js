import { Readable } from 'node:stream';

const API_BASE = 'https://api.freetouse.com/v3';

function isFreeToUseUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }

    return url.protocol === 'https:'
        && (url.hostname === 'data.freetouse.com' || url.hostname.endsWith('.data.freetouse.com'));
}

function firstArtist(artists) {
    if (!Array.isArray(artists)) return '';
    const entry = artists.find((item) => Array.isArray(item) && typeof item[1]?.name === 'string');
    return entry?.[1].name || '';
}

function toTrack(item) {
    if (!item || typeof item.id !== 'string' || typeof item.title !== 'string') return null;
    if (item.is_premium !== false || !isFreeToUseUrl(item.files?.mp3)) return null;

    return {
        id: `freetouse:${item.id}`,
        provider: 'freetouse',
        streamUrl: item.files.mp3,
        title: item.title,
        artist: firstArtist(item.artists),
        album: '',
        artwork: item.thumbnails?.md || '',
        duration: Number(item.duration) || 0,
        url: 'https://freetouse.com/music',
        license: 'Free To Use License'
    };
}

async function fetchStreamResponse(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort(new DOMException('The audio source timed out before responding.', 'TimeoutError'));
    }, 30_000);
    timeout.unref?.();

    try {
        return await fetch(url, { redirect: 'manual', signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

export async function searchFreeToUseTracks(query) {
    if (process.env.FREETOUSE_PLAYBACK_AUTHORIZED !== 'true') {
        throw new Error('Set FREETOUSE_PLAYBACK_AUTHORIZED=true only after confirming your license covers Yapin voice playback.');
    }

    const params = new URLSearchParams({
        query,
        limit: '10',
        order: 'views',
        sort: 'desc'
    });
    const response = await fetch(`${API_BASE}/music/tracks/search?${params}`, {
        signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) {
        throw new Error(`Free To Use search failed (${response.status}).`);
    }

    const result = await response.json();
    if (result.ok !== true || !Array.isArray(result.data)) {
        throw new Error('Free To Use returned an invalid track search response.');
    }

    return result.data.map(toTrack).filter(Boolean);
}

export async function getFreeToUseTrackStream(track) {
    if (process.env.FREETOUSE_PLAYBACK_AUTHORIZED !== 'true') {
        throw new Error('Free To Use playback is disabled until authorization for Yapin voice playback is confirmed.');
    }
    if (track?.provider !== 'freetouse'
        || track.license !== 'Free To Use License'
        || !isFreeToUseUrl(track.streamUrl)) {
        throw new Error('Free To Use returned an unsupported audio stream URL.');
    }

    const response = await fetchStreamResponse(track.streamUrl);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('Free To Use did not provide an audio stream.');

        const streamUrl = new URL(location, track.streamUrl);
        if (!isFreeToUseUrl(streamUrl.href)) {
            throw new Error('Free To Use returned an unsupported audio stream URL.');
        }

        const redirected = await fetchStreamResponse(streamUrl.href);
        if (!redirected.ok || !redirected.body) {
            await redirected.body?.cancel();
            throw new Error(`Free To Use could not stream this track (${redirected.status}).`);
        }
        return Readable.fromWeb(redirected.body);
    }

    if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error(`Free To Use could not stream this track (${response.status}).`);
    }
    return Readable.fromWeb(response.body);
}
