import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from '../yapper.js';

test('falls back to Yapin website API when configured host returns Cloudflare 520', async () => {
    const originalFetch = globalThis.fetch;
    const originalApiUrl = process.env.YAPPER_API_URL;
    const urls = [];
    process.env.YAPPER_API_URL = 'https://api.yapper.website/api/bot/v1';
    globalThis.fetch = async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.startsWith('https://api.yapper.website/')) {
            return new Response('<html>Cloudflare 520</html>', {
                status: 520,
                headers: { 'content-type': 'text/html' }
            });
        }
        return Response.json({ voice: [] });
    };

    try {
        const bot = new Bot('yb_test', { gateway: false, log: false });
        const result = await bot.api('GET', '/servers/server-id/voice');
        assert.deepEqual(result, { voice: [] });
        assert.deepEqual(urls, [
            'https://api.yapper.website/api/bot/v1/servers/server-id/voice',
            'https://www.yapin.gg/api/bot/v1/servers/server-id/voice'
        ]);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalApiUrl === undefined) delete process.env.YAPPER_API_URL;
        else process.env.YAPPER_API_URL = originalApiUrl;
    }
});
