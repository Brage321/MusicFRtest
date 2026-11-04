# Groove Music for Yapin

This is a separate Yapin bot entry point; it does not replace the Discord bot.

## Setup

1. Create a bot in Yapin under **Settings → Developer** and add it to a server you manage.
2. Install dependencies with `npm install --prefix Yapin`.
3. Set `YAPPER_BOT_TOKEN` in the root `.env` file.
4. Start with `npm run start:yapin`.

The official [Yapin JavaScript SDK](https://yapin.gg/sdk/yapper.js) is included in this folder. If your environment blocks the `ffmpeg-static` install script, install FFmpeg separately and set `FFMPEG_PATH` to its executable.

For Bot-Hosting.net, set the startup command to `npm run start:yapin` and add `YAPPER_BOT_TOKEN` as a masked secret environment variable. The root script installs this folder's production dependencies before launch.

### Audius catalog and API key

Playback searches and streams from the Audius catalog only. Tracks that are not available there cannot be played, and availability may differ from other music services. For API access, create a read-only API key in [Audius app settings](https://audius.co/settings) and add it as the `AUDIUS_API_KEY` secret environment variable in Bot-Hosting.net.

The bot needs permission to view voice channels and connect. It supports `/play`, `/queue`, `/skip`, and `/stop`. `/play` searches the music catalog and joins the voice channel of the person who invoked it. Each server has one queue and one voice connection; tracks play sequentially.

Yapin's voice-join API is currently documented as in testing and limited to 10 joins/leaves per minute. The bot uses `ffmpeg-static` to decode audio and Yapin's LiveKit voice API to publish it. Spotify and saved-playlist features from the Discord bot are not included in this initial port.
