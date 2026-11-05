const http = require('node:http');
const path = require('node:path');
const { readFile } = require('node:fs/promises');

const root = __dirname;
const port = Number(process.env.PORT) || 3000;
const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']]
]);

const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = files.get(pathname);

    if (!file || request.method !== 'GET') {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
    }

    try {
        const content = await readFile(path.join(root, file[0]));
        response.writeHead(200, {
            'content-type': file[1],
            'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; connect-src 'self' https://feed.fm https://*.feed.fm; media-src 'self' blob: https://feed.fm https://*.feed.fm; img-src 'self' data: https:"
        });
        response.end(content);
    } catch (error) {
        console.error(`Failed to serve ${pathname}:`, error);
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Could not load the player.');
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`Music player listening on port ${port}.`);
});

server.on('error', (error) => {
    console.error('Music player server failed:', error);
    process.exitCode = 1;
});
