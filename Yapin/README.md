# Groove Music for Yapin

This is a separate Yapin bot entry point; it does not replace the Discord bot.

## Setup

1. Create a bot in Yapin under **Settings → Developer** and add it to a server you manage.
2. Install dependencies with `npm install --prefix Yapin`.
3. Set `YAPPER_BOT_TOKEN` in the root `.env` file.
4. Start with `npm run start:yapin`.

The official [Yapin JavaScript SDK](https://yapin.gg/sdk/yapper.js) is included in this folder. FFmpeg is an external decoder invoked by the bot; `FFMPEG_PATH` can point to an installed executable. `Yapin/package.json` approves the install script only for pinned `ffmpeg-static@5.3.0`, which downloads its binary; the bot checks that FFmpeg can launch before connecting. The [`ffmpeg-static` npm package](https://github.com/eugeneware/ffmpeg-static) declares GPL-3.0-or-later, so review its license and the exact binary build obligations before redistributing this application or its dependencies; see [FFmpeg licensing](https://ffmpeg.org/legal.html).

For Bot-Hosting.net, set the startup command to `npm run start:yapin` and add `YAPPER_BOT_TOKEN` as a masked secret environment variable. The root script installs this folder's production dependencies before launch.

### Music lookup and playback sources

The bot uses Spotify and YouTube for metadata only. It never streams or downloads audio from either service. Spotify is searched first when credentials are configured; with `YOUTUBE_API_KEY`, title-only text searches also look up YouTube metadata even when Spotify credentials are not configured. YouTube search results are still matched against playable audio in Audius, Jamendo, or (when explicitly authorized) Free To Use; the bot does not stream YouTube audio. Spotify tracks, albums, and playlists, and YouTube videos and playlists, are matched against streamable catalog tracks before being queued. If matching video metadata is found but no authorized audio source has that track, `/play` now returns those video links rather than incorrectly saying the song itself could not be found. Plain-text searches require a close title and artist match; include both, such as `Blinding Lights - The Weeknd`, if metadata lookup is unavailable. The bot will not play an arbitrary same-title upload when it cannot verify the artist. Titles marked as remixes, edits, instrumentals, covers, bootlegs, or similar versions are also skipped.

Audius links and searches remain supported, but playback is limited to tracks whose API metadata declares CC BY or CC BY-SA; "All rights reserved", missing licenses, and other licenses are rejected. The Now Playing embed links to the track and displays that declaration. Audius metadata does not include the license version or verify uploader ownership, so this is not proof of rights; only use a track if you can independently confirm the uploader can license it. Jamendo and Free To Use provide independent/royalty-free music catalogs, not mainstream commercial song catalogs. Jamendo searches use the catalog's own audio stream URLs and only accept CC BY/CC BY-SA tracks; the Now Playing embed links to the track and its license. Use `/play jamendo: search terms` to search Jamendo directly. Free To Use offers full-track MP3s through its public API; use `/play freetouse: search terms` for a direct search or let it act as a fallback after Audius/Jamendo. Its API being public does not itself grant permission to relay music to Yapin voice listeners: the Free To Use license restricts use, and its free license excludes digital products. Only set `FREETOUSE_PLAYBACK_AUTHORIZED=true` after confirming with Free To Use that your license or written permission specifically covers your bot's voice playback and its listeners. The bot filters out premium-only tracks and attributes tracks in Now Playing. Exact mainstream originals that are not available in the supported playable catalogs will not play.

Set the following as secret environment variables when using each service:

- `YAPPER_BOT_TOKEN` — required Yapin bot token.
- `FFMPEG_PATH` — optional path to an installed FFmpeg executable; otherwise the bundled `ffmpeg-static` binary or `ffmpeg` on `PATH` is used.
- `AUDIUS_API_KEY` — optional Audius API key; recommended for API access.
- `JAMENDO_CLIENT_ID` — optional Jamendo developer application ID for direct catalog search and playback.
- `FREETOUSE_PLAYBACK_AUTHORIZED` — set to `true` only after confirming Free To Use authorization specifically covers Yapin voice playback and its listeners; defaults to disabled.
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` — optional Spotify app credentials for Spotify search and links.
- `YOUTUBE_API_KEY` — optional Google API key with YouTube Data API v3 enabled for YouTube search and links.
- `MONGODB_URI` — optional MongoDB connection string for saved queues; without it, queues remain in memory only.
- `MONGODB_DATABASE` — optional MongoDB database name (defaults to `musicfr`).

Get your own `JAMENDO_CLIENT_ID` by registering an application in the [Jamendo developer portal](https://devportal.jamendo.com). The shared documentation test ID is not a production credential.

The bot needs permission to view voice channels and connect. Each Yapin server has an independent queue and one voice connection. When `MONGODB_URI` is configured, the current track, upcoming tracks, loop mode, volume, and channel IDs are saved in MongoDB. After a restart, playback resumes from the interrupted track and continues with the saved queue. Without MongoDB configured, queue state is held in memory and is lost on restart. Use a single running bot instance for a given Yapin app to avoid two processes restoring and playing the same saved queues. Multiple users can add tracks to the same server queue, but users must be in the same voice channel as the active session.

Available commands: `/play`, `/watch`, `/pause`, `/resume`, `/skip`, `/stop`, `/queue`, `/nowplaying`, `/volume 0-100`, `/clearqueue`, `/remove position`, `/loop off|song|queue`, and `/shuffle`. You can search Spotify by default when its credentials are configured, or use `spotify: song name` and `youtube: song name` to select a metadata search explicitly. If no supported voice-audio match is available, `/watch song - artist` searches YouTube and returns video links to open there. YouTube full-audio playback is not supported by its documented APIs; a YouTube result is queued only if it matches an available Audius, Jamendo, or specifically authorized Free To Use track. This does not grant additional rights to redistribute a track, so ensure the relevant track and service terms permit your use.

Audio-source retrieval (`audio-sources.js` and provider adapters), FFmpeg decoding (`audio-processing.js`), and Yapin LiveKit frame publishing (`yapin-voice.js`) are separate modules. The bot does not use yt-dlp: it can extract media technically, but it does not grant rights to download or relay YouTube audio. YouTube's terms restrict downloading and automated access without permission, and the YouTube Data API provides metadata rather than a licensed audio stream. See the [YouTube Terms](https://www.youtube.com/t/terms), [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies), and [yt-dlp license](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE); a software license is not a content license.

Yapin's voice-join API is documented as in testing and limited to 10 joins/leaves per minute.
