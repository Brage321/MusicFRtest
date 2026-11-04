# Groove Music for Yapin

This is a separate Yapin bot entry point; it does not replace the Discord bot.

## Setup

1. Create a bot in Yapin under **Settings → Developer** and add it to a server you manage.
2. Install dependencies with `npm install --prefix Yapin`.
3. Set `YAPPER_BOT_TOKEN` in the root `.env` file.
4. Start with `npm run start:yapin`.

The official [Yapin JavaScript SDK](https://yapin.gg/sdk/yapper.js) is included in this folder. If your environment blocks the `ffmpeg-static` install script, install FFmpeg separately and set `FFMPEG_PATH` to its executable.

For Bot-Hosting.net, set the startup command to `npm run start:yapin` and add `YAPPER_BOT_TOKEN` as a masked secret environment variable. The root script installs this folder's production dependencies before launch. The Yapin start script sets Node's HTTP header limit to 64 KB to accommodate large headers returned by YouTube.

### YouTube "Sign in to confirm you're not a bot"

YouTube may reject requests from hosting-provider IP addresses. When YouTube playback is blocked, the bot tries several cleaned-up versions of the title against SoundCloud, then plays the first matching stream it can open. It obtains and configures a SoundCloud client ID automatically before searching; if your host blocks that lookup, you can optionally set `SOUNDCLOUD_CLIENT_ID` as an environment variable. The bot also accepts optional `YOUTUBE_COOKIE` (YouTube cookies in request-header format); add it only as a **secret environment variable**, never commit or share it. Cookies may not resolve IP-based blocking and can be invalidated. Avoid using your primary Google account session cookies. If both services block or lack the track, playback cannot continue for that song.

The bot needs permission to view voice channels and connect. It supports `/play`, `/queue`, `/skip`, and `/stop`. `/play` searches YouTube and joins the voice channel of the person who invoked it. Each server has one queue and one voice connection; tracks play sequentially.

Yapin's voice-join API is currently documented as in testing and limited to 10 joins/leaves per minute. This MVP uses `play-dl` for YouTube search/streaming, `ffmpeg-static` to decode audio, and Yapin's LiveKit voice API to publish it. Spotify and saved-playlist features from the Discord bot are not included in this initial port.
