import test from 'node:test';
import assert from 'node:assert/strict';
import { getTrackStream } from '../audius.js';
import { getFreeToUseTrackStream } from '../freetouse.js';
import { getJamendoTrackStream } from '../jamendo.js';
import { getEmbedArtwork } from '../embed-artwork.js';
import { resolveMusicInput } from '../music-resolver.js';

const originalFetch = globalThis.fetch;
const originalEnvironment = {
    SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
    JAMENDO_CLIENT_ID: process.env.JAMENDO_CLIENT_ID,
    FREETOUSE_PLAYBACK_AUTHORIZED: process.env.FREETOUSE_PLAYBACK_AUTHORIZED
};

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' }
    });
}

function setAudiusResults(items) {
    return {
        data: items.map((item, index) => ({
            id: `audius-${index}`,
            title: item.title,
            duration: item.duration || 200,
            is_streamable: true,
            license: Object.hasOwn(item, 'license') ? item.license : 'Attribution CC BY',
            permalink: `/test/track-${index}`,
            user: { name: item.artist },
            artwork: { '480x480': 'https://images.example.test/cover.jpg' }
        }))
    };
}

test.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

test.afterEach(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

test('uses YouTube metadata to resolve title-only searches without Spotify credentials', async () => {
    process.env.YOUTUBE_API_KEY = 'test-youtube-key';
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
    delete process.env.JAMENDO_CLIENT_ID;
    delete process.env.FREETOUSE_PLAYBACK_AUTHORIZED;
    const calls = [];
    globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        calls.push(url);
        if (url.hostname === 'www.googleapis.com' && url.pathname.endsWith('/search')) {
            return jsonResponse({
                items: [{ id: { videoId: 'official-video' } }]
            });
        }
        if (url.hostname === 'www.googleapis.com' && url.pathname.endsWith('/videos')) {
            return jsonResponse({
                items: [{
                    id: 'official-video',
                    snippet: {
                        title: 'Blinding Lights',
                        channelTitle: 'The Weeknd',
                        thumbnails: {}
                    },
                    contentDetails: { duration: 'PT3M20S' },
                    status: { privacyStatus: 'public', embeddable: true }
                }]
            });
        }
        if (url.hostname === 'api.audius.co') {
            return jsonResponse({ data: [] });
        }
        throw new Error(`Unexpected request: ${url}`);
    };

    const result = await resolveMusicInput('Blinding Lights');

    assert.equal(result.tracks.length, 0);
    assert.equal(result.needsArtist, false);
    assert.equal(result.youtubeMatches[0].artist, 'The Weeknd');
    assert.equal(result.youtubeMatches[0].url, 'https://www.youtube.com/watch?v=official-video');
    assert.ok(calls.some((url) => url.pathname.endsWith('/search')));
    assert.ok(calls.some((url) => url.pathname.endsWith('/tracks/search')));
});

test('only uses image hosts accepted by Yapin embeds', () => {
    assert.equal(getEmbedArtwork('https://media.tenor.com/cover.jpg'), 'https://media.tenor.com/cover.jpg');
    assert.equal(getEmbedArtwork('https://cdn.audius.co/cover.jpg'), null);
    assert.equal(getEmbedArtwork('https://i.scdn.co/image/cover'), null);
    assert.equal(getEmbedArtwork('http://i.imgur.com/cover.jpg'), null);
    assert.equal(getEmbedArtwork('not a URL'), null);
});

test('searches and resolves a directly playable Jamendo track', async () => {
    process.env.JAMENDO_CLIENT_ID = 'test-jamendo-id';
    globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.hostname === 'api.audius.co') {
            return jsonResponse({ data: [] });
        }
        assert.equal(url.hostname, 'api.jamendo.com');
        assert.equal(url.searchParams.get('search'), 'Song - Artist');
        assert.equal(url.searchParams.get('ccnc'), 'false');
        assert.equal(url.searchParams.get('ccnd'), 'false');
        return jsonResponse({
            headers: { status: 'success', error_message: '' },
            results: [{
                id: '123',
                name: 'Song',
                artist_name: 'Artist',
                album_name: 'Album',
                duration: 180,
                audio: 'https://api.jamendo.com/audio/123.mp3',
                shareurl: 'https://www.jamendo.com/track/123',
                license_ccurl: 'https://creativecommons.org/licenses/by/4.0/'
            }]
        });
    };

    const result = await resolveMusicInput('Song - Artist');
    assert.equal(result.source, 'Jamendo');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].provider, 'jamendo');
    assert.equal(result.tracks[0].streamUrl, 'https://api.jamendo.com/audio/123.mp3');
});

test('does not queue Jamendo tracks with licenses that do not allow redistribution', async () => {
    process.env.JAMENDO_CLIENT_ID = 'test-jamendo-id';
    globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.hostname === 'api.audius.co') return jsonResponse({ data: [] });
        return jsonResponse({
            headers: { status: 'success', error_message: '' },
            results: [{
                id: '123',
                name: 'Song',
                artist_name: 'Artist',
                audio: 'https://api.jamendo.com/audio/123.mp3',
                license_ccurl: 'https://creativecommons.org/licenses/by-nc-nd/4.0/'
            }]
        });
    };

    const result = await resolveMusicInput('Song - Artist');
    assert.equal(result.tracks.length, 0);
});

test('preserves the declared CC BY-SA license when resolving an Audius track', async () => {
    globalThis.fetch = async () => jsonResponse(setAudiusResults([
        { title: 'Song', artist: 'Artist', license: 'Attribution-ShareAlike CC BY-SA' }
    ]));

    const result = await resolveMusicInput('Song - Artist');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].provider, 'audius');
    assert.equal(result.tracks[0].licenseName, 'CC BY-SA');
});

test('streams Jamendo audio as a Node stream for the existing LiveKit pipeline', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
        assert.equal(String(input), 'https://api.jamendo.com/audio/123.mp3');
        assert.equal(options.redirect, 'manual');
        return new Response(new Uint8Array([1, 2, 3]));
    };

    try {
        const stream = await getJamendoTrackStream({
            provider: 'jamendo',
            streamUrl: 'https://api.jamendo.com/audio/123.mp3',
            license: 'https://creativecommons.org/licenses/by/4.0/'
        });
        assert.equal(typeof stream.pipe, 'function');
        const chunk = await stream[Symbol.asyncIterator]().next();
        assert.deepEqual([...chunk.value], [1, 2, 3]);
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test('searches and resolves a directly playable Free To Use track when authorized', async () => {
    process.env.FREETOUSE_PLAYBACK_AUTHORIZED = 'true';
    delete process.env.JAMENDO_CLIENT_ID;
    globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.hostname === 'api.audius.co') return jsonResponse({ data: [] });
        assert.equal(url.hostname, 'api.freetouse.com');
        assert.equal(url.pathname, '/v3/music/tracks/search');
        assert.equal(url.searchParams.get('query'), 'Aura Power - Walen');
        return jsonResponse({
            ok: true,
            data: [
                {
                    id: 'premium-track',
                    title: 'Aura Power',
                    is_premium: true,
                    files: { mp3: 'https://eu.data.freetouse.com/premium.mp3' }
                },
                {
                    id: '0682f6e1-da4d-42bf-910f-6e70e2b8b375',
                    title: 'Aura Power',
                    duration: 113,
                    is_premium: false,
                    artists: [[0, { name: 'Walen' }]],
                    thumbnails: { md: 'https://eu.data.freetouse.com/cover.webp' },
                    files: { mp3: 'https://eu.data.freetouse.com/file.mp3' }
                }
            ]
        });
    };

    const result = await resolveMusicInput('freetouse: Aura Power - Walen');
    assert.equal(result.source, 'Free To Use');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].provider, 'freetouse');
    assert.equal(result.tracks[0].streamUrl, 'https://eu.data.freetouse.com/file.mp3');
});

test('uses Free To Use as a fallback after Audius has no close match', async () => {
    process.env.FREETOUSE_PLAYBACK_AUTHORIZED = 'true';
    delete process.env.JAMENDO_CLIENT_ID;
    globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.hostname === 'api.audius.co') return jsonResponse({ data: [] });
        assert.equal(url.hostname, 'api.freetouse.com');
        return jsonResponse({
            ok: true,
            data: [{
                id: '0682f6e1-da4d-42bf-910f-6e70e2b8b375',
                title: 'Aura Power',
                duration: 113,
                is_premium: false,
                artists: [[0, { name: 'Walen' }]],
                files: { mp3: 'https://eu.data.freetouse.com/file.mp3' }
            }]
        });
    };

    const result = await resolveMusicInput('Aura Power - Walen');
    assert.equal(result.source, 'Free To Use');
    assert.equal(result.tracks[0].provider, 'freetouse');
});

test('does not use Free To Use tracks unless playback authorization is enabled', async () => {
    delete process.env.FREETOUSE_PLAYBACK_AUTHORIZED;
    globalThis.fetch = async () => {
        throw new Error('Free To Use must not be queried without authorization.');
    };

    await assert.rejects(resolveMusicInput('freetouse: Aura Power - Walen'), /FREETOUSE_PLAYBACK_AUTHORIZED=true/);
});

test('streams Free To Use MP3 audio as a Node stream for the existing LiveKit pipeline', async () => {
    const previousFetch = globalThis.fetch;
    const previousAuthorization = process.env.FREETOUSE_PLAYBACK_AUTHORIZED;
    process.env.FREETOUSE_PLAYBACK_AUTHORIZED = 'true';
    globalThis.fetch = async (input, options) => {
        assert.equal(String(input), 'https://eu.data.freetouse.com/file.mp3');
        assert.equal(options.redirect, 'manual');
        return new Response(new Uint8Array([1, 2, 3]));
    };

    try {
        const stream = await getFreeToUseTrackStream({
            provider: 'freetouse',
            streamUrl: 'https://eu.data.freetouse.com/file.mp3',
            license: 'Free To Use License'
        });
        assert.equal(typeof stream.pipe, 'function');
        const chunk = await stream[Symbol.asyncIterator]().next();
        assert.deepEqual([...chunk.value], [1, 2, 3]);
    } finally {
        globalThis.fetch = previousFetch;
        if (previousAuthorization === undefined) delete process.env.FREETOUSE_PLAYBACK_AUTHORIZED;
        else process.env.FREETOUSE_PLAYBACK_AUTHORIZED = previousAuthorization;
    }
});

test('stream response timeout is cleared after headers so full-length audio stays connected', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const previousFetch = globalThis.fetch;
    const timeoutHandle = { unref() {} };
    let timeoutScheduled = false;
    let timeoutCleared = false;
    let streamSignal;

    globalThis.setTimeout = (callback, delay, ...args) => {
        if (delay === 30_000) {
            timeoutScheduled = true;
            return timeoutHandle;
        }
        return originalSetTimeout(callback, delay, ...args);
    };
    globalThis.clearTimeout = (handle) => {
        if (handle === timeoutHandle) timeoutCleared = true;
        else originalClearTimeout(handle);
    };
    globalThis.fetch = async (input, options = {}) => {
        if (String(input).includes('/stream')) {
            return new Response(null, {
                status: 302,
                headers: { location: 'https://cdn.audius.test/audio' }
            });
        }
        streamSignal = options.signal;
        return new Response(new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array([1, 2, 3]));
            }
        }));
    };

    try {
        const stream = await getTrackStream({
            id: 'test-track',
            provider: 'audius',
            license: 'Attribution CC BY'
        });
        const chunk = await stream[Symbol.asyncIterator]().next();
        assert.deepEqual([...chunk.value], [1, 2, 3]);
        assert.equal(timeoutScheduled, true);
        assert.equal(timeoutCleared, true);
        assert.equal(streamSignal.aborted, false);
        stream.destroy();
    } finally {
        globalThis.fetch = previousFetch;
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
    }
});

test('does not resolve Audius tracks without an approved explicit redistribution license', async () => {
    delete process.env.JAMENDO_CLIENT_ID;
    delete process.env.FREETOUSE_PLAYBACK_AUTHORIZED;
    globalThis.fetch = async () => jsonResponse(setAudiusResults([
        { title: 'Song', artist: 'Artist', license: 'All rights reserved' },
        { title: 'Other Song', artist: 'Artist', license: null },
        { title: 'No Derivatives', artist: 'Artist', license: 'Attribution-NoDerivs CC BY-ND' }
    ]));

    const result = await resolveMusicInput('Song - Artist');
    assert.equal(result.tracks.length, 0);
});

test('requires explicit CC BY or CC BY-SA licensing before Audius streaming', async () => {
    await assert.rejects(
        getTrackStream({ id: 'test-track', provider: 'audius', license: 'All rights reserved' }),
        /explicit CC BY or CC BY-SA license/
    );
});

test('resolves Spotify track URLs to verified Audius playback metadata', async () => {
    process.env.SPOTIFY_CLIENT_ID = 'test-client';
    process.env.SPOTIFY_CLIENT_SECRET = 'test-secret';
    const calls = [];
    globalThis.fetch = async (input, options = {}) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('accounts.spotify.com')) return jsonResponse({ access_token: 'test-token', expires_in: 3600 });
        if (url.includes('api.spotify.com/v1/tracks/')) {
            return jsonResponse({
                name: 'Blinding Lights',
                artists: [{ name: 'The Weeknd' }],
                album: { name: 'After Hours', images: [{ url: 'https://images.example.test/spotify.jpg' }] },
                duration_ms: 200000,
                external_urls: { spotify: 'https://open.spotify.com/track/1234567890' }
            });
        }
        if (url.includes('api.audius.co')) {
            return jsonResponse(setAudiusResults([{ title: 'Blinding Lights', artist: 'The Weeknd' }]));
        }
        throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
    };

    const result = await resolveMusicInput('https://open.spotify.com/track/1234567890');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].title, 'Blinding Lights');
    assert.equal(result.tracks[0].artist, 'The Weeknd');
    assert.equal(result.tracks[0].album, 'After Hours');
    assert.equal(result.tracks[0].id, 'audius-0');
    assert.ok(calls.some((url) => url.includes('/v1/tracks/1234567890')));
});

test('tries YouTube metadata after Spotify before resolving audio from Jamendo', async () => {
    process.env.SPOTIFY_CLIENT_ID = 'test-client';
    process.env.SPOTIFY_CLIENT_SECRET = 'test-secret';
    process.env.JAMENDO_CLIENT_ID = 'test-jamendo-id';
    process.env.YOUTUBE_API_KEY = 'test-youtube-key';
    const calls = [];
    globalThis.fetch = async (input, options = {}) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('accounts.spotify.com')) {
            return jsonResponse({ access_token: 'test-token', expires_in: 3600 });
        }
        if (url.includes('api.spotify.com/v1/tracks/')) {
            return jsonResponse({
                name: 'Blinding Lights',
                artists: [{ name: 'The Weeknd' }],
                album: { name: 'After Hours', images: [] },
                duration_ms: 200000,
                external_urls: { spotify: 'https://open.spotify.com/track/1234567890' }
            });
        }
        if (url.includes('api.audius.co')) {
            return jsonResponse({ data: [] });
        }
        if (url.includes('api.jamendo.com/v3.0/tracks/')) {
            const search = new URL(url).searchParams;
            if (search.get('search') === 'The Weeknd Blinding Lights') {
                return jsonResponse({ headers: { status: 'success' }, results: [] });
            }
            return jsonResponse({
                headers: { status: 'success', error_message: '' },
                results: [{
                    id: 'jamendo-123',
                    name: 'Blinding Lights',
                    artist_name: 'The Weeknd',
                    album_name: 'Album',
                    duration: 200,
                    audio: 'https://api.jamendo.com/audio/jamendo-123.mp3',
                    shareurl: 'https://www.jamendo.com/track/jamendo-123',
                    license_ccurl: 'https://creativecommons.org/licenses/by/4.0/'
                }]
            });
        }
        if (url.includes('www.googleapis.com/youtube/v3/search')) {
            return jsonResponse({ items: [{ id: { videoId: 'youtube-video-1' } }] });
        }
        if (url.includes('www.googleapis.com/youtube/v3/videos')) {
            return jsonResponse({
                items: [{
                    id: 'youtube-video-1',
                    snippet: {
                        title: 'Blinding Lights (Official Audio)',
                        channelTitle: 'The Weeknd',
                        thumbnails: {}
                    },
                    contentDetails: { duration: 'PT3M20S' },
                    status: { privacyStatus: 'public', embeddable: true }
                }]
            });
        }
        throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
    };

    const result = await resolveMusicInput('https://open.spotify.com/track/1234567890');
    assert.equal(result.source, 'YouTube');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].provider, 'jamendo');
    assert.equal(result.tracks[0].title, 'Blinding Lights');
    assert.equal(result.tracks[0].artist, 'The Weeknd');
    assert.equal(result.tracks[0].streamUrl, 'https://api.jamendo.com/audio/jamendo-123.mp3');
    assert.equal(calls.some((url) => url.includes('spotify') && url.includes('audio')), false);
    const spotifyIndex = calls.findIndex((url) => url.includes('api.spotify.com/v1/tracks/1234567890'));
    const youtubeIndex = calls.findIndex((url) => url.includes('youtube/v3/search'));
    const resolvedJamendoIndex = calls.findIndex((url) => url.includes('api.jamendo.com/v3.0/tracks/')
        && new URL(url).searchParams.get('search') !== 'The Weeknd Blinding Lights');
    assert.ok(spotifyIndex >= 0);
    assert.ok(youtubeIndex > spotifyIndex);
    assert.ok(resolvedJamendoIndex > youtubeIndex);
});

test('resolves Spotify track URIs without treating the URI as audio', async () => {
    process.env.SPOTIFY_CLIENT_ID = 'test-client';
    process.env.SPOTIFY_CLIENT_SECRET = 'test-secret';
    globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.includes('accounts.spotify.com')) return jsonResponse({ access_token: 'test-token', expires_in: 3600 });
        if (url.includes('api.spotify.com/v1/tracks/1234567890')) {
            return jsonResponse({
                name: 'Blinding Lights',
                artists: [{ name: 'The Weeknd' }],
                album: { name: 'After Hours', images: [] },
                duration_ms: 200000
            });
        }
        if (url.includes('api.audius.co')) {
            return jsonResponse(setAudiusResults([{ title: 'Blinding Lights', artist: 'The Weeknd' }]));
        }
        throw new Error(`Unexpected request: ${url}`);
    };

    const result = await resolveMusicInput('spotify:track:1234567890');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].title, 'Blinding Lights');
});

test('maps Spotify playlist entries and reports tracks without a close match', async () => {
    const calls = [];
    globalThis.fetch = async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('api.spotify.com/v1/playlists/')) {
            if (url.includes('/tracks?')) {
                return jsonResponse({
                    items: [
                        { track: { name: 'Blinding Lights', artists: [{ name: 'The Weeknd' }], album: { name: 'After Hours', images: [] }, duration_ms: 200000 } },
                        { track: { name: 'Unmatched Song', artists: [{ name: 'Unknown Artist' }], album: { name: 'Unknown', images: [] }, duration_ms: 180000 } }
                    ],
                    next: null
                });
            }
            return jsonResponse({
                name: 'Test playlist',
                tracks: { href: 'https://api.spotify.com/v1/playlists/playlist12345/tracks?limit=50' }
            });
        }
        if (url.includes('api.audius.co')) {
            return jsonResponse(setAudiusResults(url.includes('Blinding')
                ? [{ title: 'Blinding Lights', artist: 'The Weeknd' }]
                : []));
        }
        throw new Error(`Unexpected request: ${url}`);
    };

    const result = await resolveMusicInput('https://open.spotify.com/playlist/playlist12345');
    assert.equal(result.collectionName, 'Test playlist');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.unavailable, 1);
    assert.ok(calls.some((url) => url.includes('/playlists/playlist12345/tracks')));
});

test('searches Spotify and resolves an album to its Audius matches', async () => {
    process.env.SPOTIFY_CLIENT_ID = 'test-client';
    process.env.SPOTIFY_CLIENT_SECRET = 'test-secret';
    globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.includes('accounts.spotify.com')) {
            return jsonResponse({ access_token: 'test-token', expires_in: 3600 });
        }
        if (url.includes('api.spotify.com/v1/search')) {
            return jsonResponse({
                tracks: {
                    items: [{
                        name: 'Blinding Lights',
                        artists: [{ name: 'The Weeknd' }],
                        album: { name: 'After Hours', images: [{ url: 'https://images.example.test/cover.jpg' }] },
                        duration_ms: 200000
                    }]
                }
            });
        }
        if (url.includes('api.spotify.com/v1/albums/album123456/tracks')) {
            return jsonResponse({
                items: [{
                    name: 'Blinding Lights',
                    artists: [{ name: 'The Weeknd' }],
                    duration_ms: 200000
                }],
                next: null
            });
        }
        if (url.includes('api.spotify.com/v1/albums/album123456')) {
            return jsonResponse({
                name: 'After Hours',
                images: [{ url: 'https://images.example.test/cover.jpg' }]
            });
        }
        if (url.includes('api.audius.co')) {
            return jsonResponse(setAudiusResults([{ title: 'Blinding Lights', artist: 'The Weeknd' }]));
        }
        throw new Error(`Unexpected request: ${url}`);
    };

    const search = await resolveMusicInput('Blinding Lights');
    assert.equal(search.tracks[0].title, 'Blinding Lights');

    const album = await resolveMusicInput('https://open.spotify.com/album/album123456');
    assert.equal(album.collectionName, 'After Hours');
    assert.equal(album.tracks.length, 1);
    assert.equal(album.tracks[0].artwork, 'https://images.example.test/cover.jpg');
});

test('does not treat a same-title Audius upload as the requested artist', async () => {
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
    delete process.env.JAMENDO_CLIENT_ID;
    delete process.env.FREETOUSE_PLAYBACK_AUTHORIZED;
    globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.hostname === 'api.audius.co') {
            return jsonResponse(setAudiusResults([{ title: 'Blinding Lights', artist: 'XX PHATZ' }]));
        }
        throw new Error(`Unexpected request: ${url}`);
    };

    const titleOnly = await resolveMusicInput('Blinding Lights');
    assert.equal(titleOnly.tracks.length, 0);
    assert.equal(titleOnly.needsArtist, true);

    const requestedArtist = await resolveMusicInput('Blinding Lights - The Weeknd');
    assert.equal(requestedArtist.tracks.length, 0);
    assert.equal(requestedArtist.needsArtist, false);
});

test('plays the requested artist when the title and artist both match', async () => {
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
    delete process.env.JAMENDO_CLIENT_ID;
    delete process.env.FREETOUSE_PLAYBACK_AUTHORIZED;
    globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.hostname === 'api.audius.co') {
            return jsonResponse(setAudiusResults([{ title: 'Blinding Lights', artist: 'The Weeknd' }]));
        }
        throw new Error(`Unexpected request: ${url}`);
    };

    const result = await resolveMusicInput('Blinding Lights - The Weeknd');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].artist, 'The Weeknd');
});

test('searches deeper in Audius results to find a verified original match', async () => {
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
    delete process.env.JAMENDO_CLIENT_ID;
    delete process.env.FREETOUSE_PLAYBACK_AUTHORIZED;
    globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.hostname !== 'api.audius.co') throw new Error(`Unexpected request: ${url}`);
        assert.equal(url.searchParams.get('limit'), '100');
        return jsonResponse(setAudiusResults([
            ...Array.from({ length: 10 }, (_, index) => ({
                title: 'Blinding Lights',
                artist: `Different Artist ${index}`
            })),
            { title: 'Blinding Lights', artist: 'The Weeknd' }
        ]));
    };

    const result = await resolveMusicInput('Blinding Lights - The Weeknd');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].artist, 'The Weeknd');
    assert.equal(result.tracks[0].id, 'audius-10');
});

test('uses YouTube metadata but only queues an exact artist/title Audius match', async () => {
    process.env.YOUTUBE_API_KEY = 'test-youtube-key';
    globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.includes('youtube/v3/videos')) {
            return jsonResponse({
                items: [{
                    id: 'abcdefghijk',
                    snippet: {
                        title: 'Blinding Lights (Official Audio)',
                        channelTitle: 'The Weeknd',
                        thumbnails: { high: { url: 'https://images.example.test/youtube.jpg' } }
                    },
                    contentDetails: { duration: 'PT3M20S' },
                    status: { privacyStatus: 'public', embeddable: true }
                }]
            });
        }
        if (url.includes('api.audius.co')) {
            return jsonResponse(setAudiusResults([{ title: 'Blinding Lights', artist: 'The Weeknd' }]));
        }
        throw new Error(`Unexpected request: ${url}`);
    };

    const result = await resolveMusicInput('https://youtu.be/abcdefghijk');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].duration, 200);
    assert.equal(result.tracks[0].id, 'audius-0');
    assert.equal(result.tracks[0].artwork, 'https://images.example.test/youtube.jpg');
});

test('searches multiple YouTube results but adds only the verified match', async () => {
    process.env.YOUTUBE_API_KEY = 'test-youtube-key';
    globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.hostname === 'www.googleapis.com' && url.pathname.endsWith('/search')) {
            assert.equal(url.searchParams.get('maxResults'), '5');
            return jsonResponse({
                items: [
                    { id: { videoId: 'abcdefghijk' } },
                    { id: { videoId: 'lmnopqrstuv' } }
                ]
            });
        }
        if (url.pathname.endsWith('/videos')) {
            return jsonResponse({
                items: [
                    {
                        id: 'abcdefghijk',
                        snippet: { title: 'Wrong Song', channelTitle: 'Wrong Artist', thumbnails: {} },
                        contentDetails: { duration: 'PT3M' },
                        status: { privacyStatus: 'public', embeddable: true }
                    },
                    {
                        id: 'lmnopqrstuv',
                        snippet: { title: 'Blinding Lights', channelTitle: 'The Weeknd', thumbnails: {} },
                        contentDetails: { duration: 'PT3M20S' },
                        status: { privacyStatus: 'public', embeddable: true }
                    }
                ]
            });
        }
        if (url.hostname === 'api.audius.co') {
            return jsonResponse(setAudiusResults(url.searchParams.get('query').includes('Wrong')
                ? [{ title: 'Wrong Song', artist: 'Wrong Artist' }]
                : [{ title: 'Blinding Lights', artist: 'The Weeknd' }]));
        }
        throw new Error(`Unexpected request: ${url}`);
    };

    const result = await resolveMusicInput('youtube: Blinding Lights');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].title, 'Blinding Lights');
    assert.equal(result.unavailable, 0);
});

test('reads YouTube playlist metadata and queues only matching audio', async () => {
    process.env.YOUTUBE_API_KEY = 'test-youtube-key';
    globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/playlists')) {
            return jsonResponse({ items: [{ snippet: { title: 'Test videos' } }] });
        }
        if (url.pathname.endsWith('/playlistItems')) {
            return jsonResponse({ items: [{ contentDetails: { videoId: 'abcdefghijk' } }] });
        }
        if (url.pathname.endsWith('/videos')) {
            return jsonResponse({
                items: [{
                    id: 'abcdefghijk',
                    snippet: {
                        title: 'Blinding Lights',
                        channelTitle: 'The Weeknd',
                        thumbnails: {}
                    },
                    contentDetails: { duration: 'PT3M20S' },
                    status: { privacyStatus: 'public', embeddable: true }
                }]
            });
        }
        if (url.hostname === 'api.audius.co') {
            return jsonResponse(setAudiusResults([{ title: 'Blinding Lights', artist: 'The Weeknd' }]));
        }
        throw new Error(`Unexpected request: ${url}`);
    };

    const result = await resolveMusicInput('https://music.youtube.com/playlist?list=PL123456789');
    assert.equal(result.collectionName, 'Test videos');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].artist, 'The Weeknd');
});

test('does not queue a different version of the requested song', async () => {
    globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.includes('api.spotify.com/v1/tracks/')) {
            return jsonResponse({
                name: 'Blinding Lights',
                artists: [{ name: 'The Weeknd' }],
                album: { name: 'After Hours', images: [] },
                duration_ms: 200000
            });
        }
        if (url.includes('api.audius.co')) {
            return jsonResponse(setAudiusResults([{ title: 'Blinding Lights Instrumental', artist: 'The Weeknd' }]));
        }
        throw new Error(`Unexpected request: ${url}`);
    };

    const result = await resolveMusicInput('https://open.spotify.com/track/1234567890');
    assert.equal(result.tracks.length, 0);
    assert.equal(result.unavailable, 1);
});

test('does not play a remix returned first for a plain song search', async () => {
    process.env.SPOTIFY_CLIENT_ID = '';
    process.env.SPOTIFY_CLIENT_SECRET = '';
    globalThis.fetch = async (input) => {
        assert.ok(String(input).includes('/tracks/search'));
        return jsonResponse(setAudiusResults([{
            title: "Kanye West x KRANE - Can't Tell Me To Feel Nothing (Stevo Edit)",
            artist: 'Stevo'
        }]));
    };

    const result = await resolveMusicInput("Can't Tell Me Nothin - kanye west");
    assert.equal(result.tracks.length, 0);
    assert.equal(result.unavailable, 1);
});

test('skips a remix and selects the matching artist and original title', async () => {
    process.env.SPOTIFY_CLIENT_ID = '';
    process.env.SPOTIFY_CLIENT_SECRET = '';
    globalThis.fetch = async (input) => {
        assert.ok(String(input).includes('/tracks/search'));
        return jsonResponse(setAudiusResults([
            {
                title: "Kanye West x KRANE - Can't Tell Me To Feel Nothing (Stevo Edit)",
                artist: 'Stevo'
            },
            {
                title: "Can't Tell Me Nothing",
                artist: 'Kanye West'
            }
        ]));
    };

    const result = await resolveMusicInput("Can't Tell Me Nothin - kanye west");
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].artist, 'Kanye West');
    assert.equal(result.tracks[0].title, "Can't Tell Me Nothing");
});
