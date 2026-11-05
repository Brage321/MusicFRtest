const API_BASE = 'https://www.googleapis.com/youtube/v3';
const MAX_PLAYLIST_TRACKS = 50;

export function isYouTubeUrl(value) {
    return /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//i.test(value);
}

function requireApiKey() {
    if (!process.env.YOUTUBE_API_KEY) {
        throw new Error('YouTube metadata lookup is not configured. Set YOUTUBE_API_KEY.');
    }
    return process.env.YOUTUBE_API_KEY;
}

function parseYouTubeUrl(value) {
    let url;
    try {
        url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
        throw new Error('That YouTube link is invalid.');
    }

    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'].includes(url.hostname)) {
        throw new Error('Unsupported YouTube link.');
    }

    const videoId = url.hostname.endsWith('youtu.be')
        ? url.pathname.split('/').filter(Boolean)[0]
        : url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];
    const playlistId = url.searchParams.get('list');
    if (playlistId) return { type: 'playlist', id: playlistId };
    if (videoId && /^[\w-]{11}$/.test(videoId)) return { type: 'video', id: videoId };
    throw new Error('That YouTube link is not a supported video or playlist.');
}

async function youtubeRequest(endpoint, params) {
    const apiKey = requireApiKey();
    const url = new URL(`${API_BASE}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    url.searchParams.set('key', apiKey);

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
        await response.body?.cancel();
        const message = response.status === 403
            ? 'YouTube API access was denied. Check the API key, enabled API, and quota.'
            : `YouTube metadata request failed (${response.status}).`;
        throw new Error(message);
    }
    return response.json();
}

function durationSeconds(value) {
    const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value || '');
    if (!match) return 0;
    return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function toTrack(item) {
    const snippet = item?.snippet;
    if (!item?.id || !snippet?.title || !snippet?.channelTitle) return null;
    return {
        title: snippet.title,
        artist: snippet.channelTitle,
        album: '',
        artwork: snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '',
        duration: durationSeconds(item.contentDetails?.duration),
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}`,
        source: 'YouTube'
    };
}

async function getVideos(ids) {
    if (!ids.length) return [];
    const result = await youtubeRequest('videos', {
        part: 'snippet,contentDetails,status',
        id: ids.join(',')
    });
    return (result.items || [])
        .filter((item) => item.status?.privacyStatus === 'public' && item.status?.embeddable !== false)
        .map(toTrack)
        .filter((track) => track?.duration > 0);
}

async function getPlaylist(id) {
    const playlist = await youtubeRequest('playlists', { part: 'snippet', id });
    const playlistInfo = playlist.items?.[0];
    if (!playlistInfo) throw new Error('The YouTube playlist was not found or is unavailable.');

    const ids = [];
    let pageToken;
    while (ids.length < MAX_PLAYLIST_TRACKS) {
        const page = await youtubeRequest('playlistItems', {
            part: 'contentDetails',
            playlistId: id,
            maxResults: Math.min(50, MAX_PLAYLIST_TRACKS - ids.length),
            pageToken
        });
        ids.push(...(page.items || []).map((item) => item.contentDetails?.videoId).filter(Boolean));
        pageToken = page.nextPageToken;
        if (!pageToken || !page.items?.length) break;
    }

    return {
        name: playlistInfo.snippet?.title || 'YouTube playlist',
        type: 'playlist',
        tracks: await getVideos(ids.slice(0, MAX_PLAYLIST_TRACKS)),
        truncated: Boolean(pageToken)
    };
}

export async function resolveYouTube(query) {
    if (isYouTubeUrl(query)) {
        const { type, id } = parseYouTubeUrl(query);
        if (type === 'playlist') return getPlaylist(id);
        const [track] = await getVideos([id]);
        if (!track) throw new Error('That YouTube video is private, unavailable, a live stream, or has no playable duration.');
        return { type, tracks: [track] };
    }

    const result = await youtubeRequest('search', {
        part: 'snippet',
        type: 'video',
        maxResults: 5,
        q: query
    });
    const ids = (result.items || []).map((item) => item.id?.videoId).filter(Boolean);
    return { type: 'search', tracks: await getVideos(ids) };
}
