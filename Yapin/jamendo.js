import { Readable } from 'node:stream';

const API_BASE = 'https://api.jamendo.com/v3.0';

function isJamendoUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }

    return url.protocol === 'https:'
        && (url.hostname === 'jamendo.com' || url.hostname.endsWith('.jamendo.com'));
}

function isRedistributableLicense(value) {
    return /^https:\/\/creativecommons\.org\/licenses\/by(?:-sa)?\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)\/?$/i.test(value || '');
}

async function fetchStreamResponse(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort(new DOMException('The audio source timed out before responding.', 'TimeoutError'));
    }, 30_000);
    timeout.unref?.();

    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

function toTrack(item) {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') return null;
    if (!isJamendoUrl(item.audio) || !isRedistributableLicense(item.license_ccurl)) {
        return null;
    }
    if (!isJamendoUrl(item.shareurl)) return null;

    return {
        id: `jamendo:${item.id}`,
        provider: 'jamendo',
        streamUrl: item.audio,
        title: item.name,
        artist: item.artist_name || '',
        album: item.album_name || '',
        artwork: item.album_image || item.image || '',
        duration: Number(item.duration) || 0,
        url: item.shareurl || '',
        license: item.license_ccurl
    };
}

export async function searchJamendoTracks(query) {
    const clientId = process.env.JAMENDO_CLIENT_ID;
    if (!clientId) {
        throw new Error('Set JAMENDO_CLIENT_ID to enable Jamendo music search.');
    }

    const params = new URLSearchParams({
        client_id: clientId,
        format: 'json',
        search: query,
        limit: '10',
        audioformat: 'mp32',
        include: 'licenses',
        ccnc: 'false',
        ccnd: 'false'
    });
    const response = await fetch(`${API_BASE}/tracks/?${params}`, {
        signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) {
        throw new Error(`Jamendo search failed (${response.status}).`);
    }

    const result = await response.json();
    if (!['success', 'succeed'].includes(result.headers?.status)) {
        throw new Error(result.headers?.error_message || 'Jamendo search failed.');
    }

    return (Array.isArray(result.results) ? result.results : [])
        .map(toTrack)
        .filter(Boolean);
}

export async function getJamendoTrackStream(track) {
    if (track?.provider !== 'jamendo'
        || !isJamendoUrl(track.streamUrl)
        || !isRedistributableLicense(track.license)) {
        throw new Error('Jamendo returned an unsupported audio stream URL.');
    }

    const response = await fetchStreamResponse(track.streamUrl, { redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('Jamendo did not provide an audio stream.');

        const streamUrl = new URL(location, track.streamUrl);
        if (streamUrl.protocol !== 'https:' || !streamUrl.hostname.endsWith('.jamendo.com')) {
            throw new Error('Jamendo returned an unsupported audio stream URL.');
        }

        const redirected = await fetchStreamResponse(streamUrl);
        if (!redirected.ok || !redirected.body) {
            await redirected.body?.cancel();
            throw new Error(`Jamendo could not stream this track (${redirected.status}).`);
        }
        return Readable.fromWeb(redirected.body);
    }

    if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error(`Jamendo could not stream this track (${response.status}).`);
    }
    return Readable.fromWeb(response.body);
}
