import { searchTracks, resolveTrackUrl } from './audius.js';
import { searchJamendoTracks } from './jamendo.js';
import { isSpotifyUrl, resolveSpotify } from './spotify.js';
import { isYouTubeUrl, resolveYouTube } from './youtube.js';

const MAX_MATCHES = 50;

function normalize(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\((?:official\s+(?:audio|video)|lyrics?|lyric\s+video|visuali[sz]er)\)/g, ' ')
        .replace(/\b(official|audio|video|lyrics?|visuali[sz]er|vevo|topic|hd|4k)\b/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function tokenSimilarity(left, right) {
    const a = new Set(left.split(/\s+/).filter(Boolean));
    const b = new Set(right.split(/\s+/).filter(Boolean));
    if (!a.size || !b.size) return 0;
    const remaining = new Set(b);
    let shared = 0;
    for (const token of a) {
        const match = [...remaining]
            .filter((candidate) => candidate === token || (Math.min(token.length, candidate.length) >= 5
                && editDistanceAtMostOne(token, candidate)))
            .sort((left, right) => left.length - right.length)[0];
        if (match) {
            shared += 1;
            remaining.delete(match);
        }
    }
    return (2 * shared) / (a.size + b.size);
}

function editDistanceAtMostOne(left, right) {
    if (Math.abs(left.length - right.length) > 1) return false;
    let leftIndex = 0;
    let rightIndex = 0;
    let edits = 0;
    while (leftIndex < left.length && rightIndex < right.length) {
        if (left[leftIndex] === right[rightIndex]) {
            leftIndex += 1;
            rightIndex += 1;
            continue;
        }
        edits += 1;
        if (edits > 1) return false;
        if (left.length > right.length) leftIndex += 1;
        else if (right.length > left.length) rightIndex += 1;
        else {
            leftIndex += 1;
            rightIndex += 1;
        }
    }
    return edits + Number(leftIndex < left.length || rightIndex < right.length) <= 1;
}

function isAlternateVersion(candidate) {
    const title = normalize(candidate.title);
    return /\b(remix|edit|bootleg|instrumental|cover|karaoke|nightcore|mashup|rework|tribute|sped up|slowed|speed up|slowed down)\b/.test(title);
}

function queryMatches(metadata, query) {
    const queryTerms = new Set(normalize(query).split(/\s+/).filter(Boolean));
    const resultTerms = new Set(normalize(`${metadata.title} ${metadata.artist}`).split(/\s+/).filter(Boolean));
    if (!queryTerms.size || !resultTerms.size) return false;
    let shared = 0;
    for (const term of queryTerms) if (resultTerms.has(term)) shared += 1;
    return shared / queryTerms.size >= 0.65;
}

function matches(candidate, metadata) {
    if (isAlternateVersion(candidate)) return false;

    const expectedTitle = normalize(metadata.title);
    const candidateArtist = normalize(candidate.artist);
    let candidateTitle = normalize(candidate.title);
    if (candidateArtist && candidateTitle.startsWith(`${candidateArtist} `)) {
        candidateTitle = candidateTitle.slice(candidateArtist.length).trim();
    }
    const titleScore = tokenSimilarity(expectedTitle, candidateTitle);
    if (!expectedTitle || titleScore < 0.9) return false;

    const expectedArtist = normalize(metadata.artist);
    if (!expectedArtist) return titleScore >= 0.95;
    return tokenSimilarity(expectedArtist, candidateArtist) >= 0.5;
}

async function findPlayableTrack(metadata) {
    const query = [metadata.artist, metadata.title].filter(Boolean).join(' ');
    const candidates = await searchTracks(query);
    const match = candidates.find((candidate) => matches(candidate, metadata));
    if (!match) {
        if (!process.env.JAMENDO_CLIENT_ID) return null;
        const jamendoCandidates = await searchJamendoTracks(query);
        return jamendoCandidates.find((candidate) => matches(candidate, metadata)) || null;
    }

    return {
        id: match.id,
        title: metadata.title,
        artist: metadata.artist || match.artist,
        album: metadata.album || '',
        artwork: metadata.artwork || '',
        duration: metadata.duration || match.duration || 0,
        sourceUrl: metadata.url || ''
    };
}

async function mapToPlayable(tracks) {
    const results = [];
    let unavailable = 0;
    const list = tracks.slice(0, MAX_MATCHES);
    for (let index = 0; index < list.length; index += 5) {
        const batch = await Promise.all(list.slice(index, index + 5).map(findPlayableTrack));
        for (const playable of batch) {
            if (playable) results.push(playable);
            else unavailable += 1;
        }
    }
    return { tracks: results, unavailable };
}

async function mapFirstPlayable(tracks, query) {
    for (const metadata of tracks.slice(0, 5)) {
        if (!queryMatches(metadata, query)) continue;
        const track = await findPlayableTrack(metadata);
        if (track) return { tracks: [track], unavailable: 0 };
    }
    return { tracks: [], unavailable: tracks.length ? 1 : 0 };
}

async function mapSpotifyWithYouTubeFallback(tracks, query) {
    const fallbackQuery = query === undefined
        ? [tracks[0]?.artist, tracks[0]?.title].filter(Boolean).join(' ')
        : query;
    if (process.env.YOUTUBE_API_KEY && fallbackQuery) {
        const youtube = await resolveYouTube(fallbackQuery);
        const fallback = youtube.type === 'search'
            ? await mapFirstPlayable(youtube.tracks, fallbackQuery)
            : await mapToPlayable(youtube.tracks);
        if (fallback.tracks.length) return { ...fallback, source: 'YouTube' };
    }

    return { ...(await mapToPlayable(tracks)), source: 'Spotify' };
}

function splitTitleAndArtist(query) {
    const parts = query.split(/\s+-\s+/);
    if (parts.length < 2) return { title: query, artist: '' };
    return {
        title: parts.slice(0, -1).join(' - ').trim(),
        artist: parts.at(-1).trim()
    };
}

function mapDirectAudiusTrack(track) {
    return {
        ...track,
        title: track.title,
        artist: track.artist,
        album: track.album || '',
        artwork: track.artwork || '',
        duration: track.duration || 0
    };
}

export async function resolveMusicInput(query) {
    const trimmed = query.trim();
    const jamendoSearch = trimmed.match(/^jamendo:\s*(.+)$/i);
    const spotifySearch = trimmed.match(/^(?:spotify|sp):\s+(.+)$/i);
    const youtubeSearch = trimmed.match(/^(?:youtube|yt):\s+(.+)$/i);

    if (jamendoSearch) {
        const requested = splitTitleAndArtist(jamendoSearch[1]);
        const tracks = await searchJamendoTracks(jamendoSearch[1]);
        const match = tracks.find((candidate) => matches(candidate, requested));
        return {
            tracks: match ? [match] : [],
            unavailable: tracks.length && !match ? 1 : 0,
            collectionName: '',
            source: 'Jamendo',
            truncated: false
        };
    }

    if (isSpotifyUrl(trimmed) || spotifySearch) {
        const result = await resolveSpotify(spotifySearch?.[1] || trimmed);
        const query = result.type === 'track' || result.type === 'search'
            ? spotifySearch?.[1] || [result.tracks[0]?.artist, result.tracks[0]?.title].filter(Boolean).join(' ')
            : '';
        const mapped = await mapSpotifyWithYouTubeFallback(result.tracks, query);
        return { ...mapped, collectionName: result.name || '', truncated: result.truncated || false };
    }

    if (isYouTubeUrl(trimmed) || youtubeSearch) {
        const searchQuery = youtubeSearch?.[1];
        const result = await resolveYouTube(searchQuery || trimmed);
        const mapped = result.type === 'search'
            ? await mapFirstPlayable(result.tracks, searchQuery)
            : await mapToPlayable(result.tracks);
        return { ...mapped, collectionName: result.name || '', source: 'YouTube', truncated: result.truncated || false };
    }

    if (process.env.SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_SECRET) {
        const result = await resolveSpotify(trimmed);
        const mapped = await mapSpotifyWithYouTubeFallback(result.tracks, trimmed);
        if (mapped.tracks.length) {
            return { ...mapped, collectionName: '', truncated: false };
        }
    }

    if (/^https?:\/\//i.test(trimmed)) {
        const track = await resolveTrackUrl(trimmed);
        return { tracks: track ? [track] : [], unavailable: 0, collectionName: '', source: 'Audius', truncated: false };
    }

    const search = splitTitleAndArtist(trimmed);
    const results = await searchTracks(trimmed);
    const track = results.find((candidate) => matches(candidate, search));
    if (!track) {
        if (process.env.JAMENDO_CLIENT_ID) {
            const jamendoTracks = await searchJamendoTracks(trimmed);
            const jamendoTrack = jamendoTracks.find((candidate) => matches(candidate, search));
            if (jamendoTrack) {
                return {
                    tracks: [jamendoTrack],
                    unavailable: 0,
                    collectionName: '',
                    source: 'Jamendo',
                    truncated: false
                };
            }
        }
        return { tracks: [], unavailable: results.length ? 1 : 0, collectionName: '', source: 'Audius', truncated: false };
    }
    return {
        tracks: [mapDirectAudiusTrack(track)],
        unavailable: 0,
        collectionName: '',
        source: 'Audius',
        truncated: false
    };
}
