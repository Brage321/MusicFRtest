# Groove Music for Yapin

This is a separate Yapin bot entry point; it does not replace the Discord bot.

## Setup

1. Create a bot in Yapin under **Settings → Developer** and add it to a server you manage.
2. Install dependencies with `npm install --prefix Yapin`.
3. Set `YAPPER_BOT_TOKEN` in the root `.env` file.
4. Start with `npm run start:yapin`.

The official [Yapin JavaScript SDK](https://yapin.gg/sdk/yapper.js) is included in this folder. If your environment blocks the `ffmpeg-static` install script, install FFmpeg separately and set `FFMPEG_PATH` to its executable.

For Bot-Hosting.net, set the startup command to `npm run start:yapin` and add `YAPPER_BOT_TOKEN` as a masked secret environment variable. The root script installs this folder's production dependencies before launch.

### Music lookup and playback sources

The bot uses Spotify and YouTube for metadata only. It never streams or downloads audio from either service. Spotify tracks, albums, and playlists, and YouTube videos and playlists, are matched against streamable Audius tracks before being queued. A playlist is limited to 50 entries; items without a sufficiently close title and artist match are skipped. Audius links and searches remain supported.

Set the following as secret environment variables when using each service:

- `YAPPER_BOT_TOKEN` — required Yapin bot token.
- `AUDIUS_API_KEY` — optional Audius API key; recommended for API access.
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` — optional Spotify app credentials for Spotify search and links.
- `YOUTUBE_API_KEY` — optional Google API key with YouTube Data API v3 enabled for YouTube search and links.

The bot needs permission to view voice channels and connect. Each Yapin server has an independent in-memory queue and one voice connection, and queues are not persisted across restarts. Multiple users can add tracks to the same server queue, but users must be in the same voice channel as the active session.

Available commands: `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/queue`, `/nowplaying`, `/volume 0-100`, `/clearqueue`, `/remove position`, `/loop off|song|queue`, and `/shuffle`. You can search Spotify by default when its credentials are configured, or use `spotify: song name` and `youtube: song name` to select a metadata search explicitly. YouTube full-audio playback is not supported by its documented APIs; a YouTube result is queued only if a verified playable Audius match exists. This does not grant additional rights to redistribute a track, so ensure the relevant track and service terms permit your use.

Yapin's voice-join API is documented as in testing and limited to 10 joins/leaves per minute. The bot uses `ffmpeg-static` to decode the permitted audio stream and Yapin's LiveKit voice API to publish it.
