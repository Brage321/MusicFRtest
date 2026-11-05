const API_BASE = 'https://itunes.apple.com/search';

function toTrack(item) {
    if (!item
        || typeof item.trackName !== 'string'
        || typeof item.artistName !== 'string'
        || typeof item.trackViewUrl !== 'string') {
        return null;
    }

    return {
        title: item.trackName,
        artist: item.artistName,
        album: item.collectionName || '',
        artwork: item.artworkUrl100 || '',
        duration: Math.floor((Number(item.trackTimeMillis) || 0) / 1000),
        url: item.trackViewUrl,
        source: 'Apple Music'
    };
}

export async function searchAppleMusic(query) {
    const url = new URL(API_BASE);
    url.search = new URLSearchParams({
        term: query,
        entity: 'song',
        limit: '10'
    }).toString();

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
        throw new Error(`Apple Music catalog search failed (${response.status}).`);
    }

    const result = await response.json();
    if (!Array.isArray(result.results)) {
        throw new Error('Apple Music returned an invalid catalog response.');
    }

    return result.results.map(toTrack).filter(Boolean);
}
