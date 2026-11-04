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

YouTube may reject requests from hosting-provider IP addresses. The bot accepts an optional `YOUTUBE_COOKIE` value (the YouTube cookies in request-header format) and passes it to `play-dl`. Add it only as a **secret environment variable** in the hosting panel; never commit or share it. A cookie may not resolve IP-based blocking, and YouTube can invalidate it. If playback is still blocked, this host/IP cannot reliably play that YouTube video; try another supported audio source instead. Avoid using your primary Google account session cookies.

The bot needs permission to view voice channels and connect. It supports `/play`, `/queue`, `/skip`, and `/stop`. `/play` searches YouTube and joins the voice channel of the person who invoked it. Each server has one queue and one voice connection; tracks play sequentially.

Yapin's voice-join API is currently documented as in testing and limited to 10 joins/leaves per minute. This MVP uses `play-dl` for YouTube search/streaming, `ffmpeg-static` to decode audio, and Yapin's LiveKit voice API to publish it. Spotify and saved-playlist features from the Discord bot are not included in this initial port.
