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

The bot uses Spotify and YouTube for metadata only. It never streams or downloads audio from either service. Spotify is searched first for ordinary text queries; if Spotify metadata has no playable match, YouTube metadata search is tried next when `YOUTUBE_API_KEY` is configured. YouTube search results are still matched against playable audio in Audius, Jamendo, or (when explicitly authorized) Free To Use; the bot does not stream YouTube audio. Spotify tracks, albums, and playlists, and YouTube videos and playlists, are matched against streamable catalog tracks before being queued. Plain-text searches also require a close title and artist match; titles marked as remixes, edits, instrumentals, covers, bootlegs, or similar versions are skipped.

Audius links and searches remain supported. Audius is user-uploaded, so metadata matching cannot guarantee that an upload is an official master recording. Jamendo and Free To Use provide independent/royalty-free music catalogs, not mainstream commercial song catalogs. Jamendo searches use the catalog's own audio stream URLs and only accept CC BY/CC BY-SA tracks; the Now Playing embed links to the track and its license. Use `/play jamendo: search terms` to search Jamendo directly. Free To Use offers full-track MP3s through its public API; use `/play freetouse: search terms` for a direct search or let it act as a fallback after Audius/Jamendo. Its API being public does not itself grant permission to relay music to Yapin voice listeners: the Free To Use license restricts use, and its free license excludes digital products. Only set `FREETOUSE_PLAYBACK_AUTHORIZED=true` after confirming with Free To Use that your license or written permission specifically covers your bot's voice playback and its listeners. The bot filters out premium-only tracks and attributes tracks in Now Playing. Exact mainstream originals that are not available in the supported playable catalogs will not play.

Set the following as secret environment variables when using each service:

- `YAPPER_BOT_TOKEN` — required Yapin bot token.
- `AUDIUS_API_KEY` — optional Audius API key; recommended for API access.
- `JAMENDO_CLIENT_ID` — optional Jamendo developer application ID for direct catalog search and playback.
- `FREETOUSE_PLAYBACK_AUTHORIZED` — set to `true` only after confirming Free To Use authorization specifically covers Yapin voice playback and its listeners; defaults to disabled.
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` — optional Spotify app credentials for Spotify search and links.
- `YOUTUBE_API_KEY` — optional Google API key with YouTube Data API v3 enabled for YouTube search and links.
- `MONGODB_URI` — optional MongoDB connection string for saved queues; without it, queues remain in memory only.
- `MONGODB_DATABASE` — optional MongoDB database name (defaults to `musicfr`).

Get your own `JAMENDO_CLIENT_ID` by registering an application in the [Jamendo developer portal](https://devportal.jamendo.com). The shared documentation test ID is not a production credential.

The bot needs permission to view voice channels and connect. Each Yapin server has an independent queue and one voice connection. When `MONGODB_URI` is configured, the current track, upcoming tracks, loop mode, volume, and channel IDs are saved in MongoDB. After a restart, playback resumes from the interrupted track and continues with the saved queue. Without MongoDB configured, queue state is held in memory and is lost on restart. Use a single running bot instance for a given Yapin app to avoid two processes restoring and playing the same saved queues. Multiple users can add tracks to the same server queue, but users must be in the same voice channel as the active session.

Available commands: `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/queue`, `/nowplaying`, `/volume 0-100`, `/clearqueue`, `/remove position`, `/loop off|song|queue`, and `/shuffle`. You can search Spotify by default when its credentials are configured, or use `spotify: song name` and `youtube: song name` to select a metadata search explicitly. YouTube full-audio playback is not supported by its documented APIs; a YouTube result is queued only if a verified playable Audius or Jamendo match exists. This does not grant additional rights to redistribute a track, so ensure the relevant track and service terms permit your use.

Yapin's voice-join API is documented as in testing and limited to 10 joins/leaves per minute. The bot uses `ffmpeg-static` to decode the permitted audio stream and Yapin's LiveKit voice API to publish it.
