# Browser radio player

This is a separate, browser-based radio player using Feed.fm's official JavaScript SDK. It does **not** stream into Yapin voice, and it provides Feed.fm stations rather than an arbitrary `/play song` search queue.

## Requirements

Feed.fm's demo credentials are for testing only. Real playback requires production credentials from Feed.fm and is subject to account and regional availability. Contact Feed.fm to obtain credentials and confirm your intended use is covered.

## Run locally

From the repository root:

```sh
npm run start:feed
```

Open `http://localhost:3000` (or the port shown in the server log) and enter the Feed.fm player token and secret. The page keeps them in memory only, clears the form after initialization, and does not send them to this project's server or save them in browser storage. The Feed.fm SDK uses the credentials directly in the browser as documented by its provider.

For hosting, create a Node.js deployment with startup command `npm run start:feed`; the host should provide its listening port in `PORT`. Do not add credentials to source code or commit them. This standalone page is independent of the Yapin bot.
