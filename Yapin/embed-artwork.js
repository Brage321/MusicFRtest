const ALLOWED_IMAGE_HOSTS = new Set([
    'i.imgur.com',
    'media.tenor.com',
    'media.giphy.com',
    'i.giphy.com',
    'raw.githubusercontent.com',
    'upload.wikimedia.org',
    'cdn.myanimelist.net',
    's4.anilist.co'
]);

export function getEmbedArtwork(url) {
    if (typeof url !== 'string' || !url) return null;

    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || !ALLOWED_IMAGE_HOSTS.has(parsed.hostname.toLowerCase())) {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}
