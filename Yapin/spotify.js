const API_BASE = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const MAX_PLAYLIST_TRACKS = 50;

let cachedToken = null;
let tokenExpiresAt = 0;

export function isSpotifyUrl(value) {
    return /^(?:https?:\/\/open\.spotify\.com\/|spotify:)/i.test(value);
}

function parseSpotifyUrl(value) {
    if (/^spotify:/i.test(value)) {
        const [, type, id] = value.split(':');
        if (['track', 'album', 'playlist'].includes(type) && /^[a-zA-Z0-9]{10,64}$/.test(id || '')) {
            return { type, id };
        }
        throw new Error('That Spotify URI is not a supported track, album, or playlist.');
    }

    const url = new URL(value);
    if (url.hostname !== 'open.spotify.com' && url.hostname !== 'www.spotify.com') {
        throw new Error('Unsupported Spotify link.');
    }

    const parts = url.pathname.split('/').filter(Boolean);
    const typeIndex = parts.findIndex((part) => ['track', 'album', 'playlist'].includes(part));
    const type = parts[typeIndex];
    const id = parts[typeIndex + 1];
    if (!type || !/^[a-zA-Z0-9]{10,64}$/.test(id || '')) {
        throw new Error('That Spotify link is not a supported track, album, or playlist URL.');
    }

    return { type, id };
}

function requireCredentials() {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error('Spotify lookup is not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.');
    }
    return { clientId, clientSecret };
}

async function getAccessToken(forceRefresh = false) {
    if (!forceRefresh && cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

    const { clientId, clientSecret } = requireCredentials();
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
            authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
        throw new Error(`Spotify authentication failed (${response.status}). Check the Spotify app credentials.`);
    }

    const data = await response.json();
    if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in)) {
        throw new Error('Spotify returned an invalid access token response.');
    }

    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
    return cachedToken;
}

async function spotifyRequest(url, retry = true) {
    const token = await getAccessToken();
    const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000)
    });

    if (response.status === 401 && retry) {
        cachedToken = null;
        tokenExpiresAt = 0;
        await response.body?.cancel();
        await getAccessToken(true);
        return spotifyRequest(url, false);
    }

    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Spotify request failed (${response.status}).`);
    }

    return response.json();
}

function toTrack(item) {
    if (!item || typeof item.name !== 'string' || !Array.isArray(item.artists)) return null;
    const artists = item.artists.map((artist) => artist?.name).filter(Boolean);
    return {
        title: item.name,
        artist: artists.join(', '),
        album: item.album?.name || '',
        artwork: item.album?.images?.[0]?.url || '',
        duration: Number.isFinite(item.duration_ms) ? item.duration_ms / 1000 : 0,
        url: item.external_urls?.spotify || '',
        source: 'Spotify'
    };
}

async function getTrack(id) {
    const track = toTrack(await spotifyRequest(`${API_BASE}/tracks/${encodeURIComponent(id)}`));
    if (!track) throw new Error('Spotify did not return valid track information.');
    return track;
}

async function getCollection(type, id) {
    const endpoint = type === 'album' ? 'albums' : 'playlists';
    const item = await spotifyRequest(`${API_BASE}/${endpoint}/${encodeURIComponent(id)}`);
    const tracks = [];
    let truncated = false;

    if (type === 'album') {
        let next = `${API_BASE}/albums/${encodeURIComponent(id)}/tracks?limit=50`;
        while (next && tracks.length < MAX_PLAYLIST_TRACKS) {
            const page = await spotifyRequest(next);
            tracks.push(...(page.items || []).map((track) => ({
                ...track,
                album: item,
                album_name: item.name,
                album_images: item.images
            })));
            next = page.next;
        }
        truncated = Boolean(next);
    } else {
        let next = item.tracks?.href || `${API_BASE}/playlists/${encodeURIComponent(id)}/tracks?limit=50`;
        while (next && tracks.length < MAX_PLAYLIST_TRACKS) {
            const page = await spotifyRequest(next);
            tracks.push(...(page.items || []).map((entry) => entry.track).filter(Boolean));
            next = page.next;
        }
        truncated = Boolean(next);
    }

    return {
        name: item.name || (type === 'album' ? 'Spotify album' : 'Spotify playlist'),
        type,
        truncated,
        tracks: tracks.slice(0, MAX_PLAYLIST_TRACKS).map((track) => {
            if (type === 'album' && !track.album?.images?.length) {
                track.album = { ...track.album, images: track.album_images };
                track.album.name = track.album_name;
            }
            return toTrack(track);
        }).filter(Boolean)
    };
}

export async function resolveSpotify(query) {
    if (isSpotifyUrl(query)) {
        const { type, id } = parseSpotifyUrl(query);
        if (type === 'track') return { type, tracks: [await getTrack(id)] };
        return getCollection(type, id);
    }

    const params = new URLSearchParams({ q: query, type: 'track', limit: '1' });
    const result = await spotifyRequest(`${API_BASE}/search?${params}`);
    const track = toTrack(result.tracks?.items?.[0]);
    return { type: 'search', tracks: track ? [track] : [] };
}
