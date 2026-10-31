'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const port = process.env.PORT || 1337;

const publicDir = path.join(__dirname, 'public');
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json',
    '.txt': 'text/plain',
};
// Text files are sent gzip-compressed when the browser accepts it, so the
// word and definition data load quickly on phones.
const compressible = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);
const gzipCache = new Map(); // filePath -> { mtimeMs, body }

const server = http.createServer((req, res) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (e) {
        res.writeHead(400);
        return res.end('400 Bad Request');
    }
    if (pathname === '/') pathname = '/index.html';

    // Resolve inside public/ and refuse anything that escapes it.
    const filePath = path.join(publicDir, pathname);
    if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
        res.writeHead(403);
        return res.end('403 Forbidden');
    }

    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

    const ext = path.extname(filePath).toLowerCase();
    const wantsGzip = compressible.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');

    fs.stat(filePath, (statErr, stat) => {
        if (statErr || !stat.isFile()) {
            res.writeHead(404);
            return res.end('404 Not Found');
        }
        const cached = gzipCache.get(filePath);
        if (wantsGzip && cached && cached.mtimeMs === stat.mtimeMs) {
            res.writeHead(200, { 'Content-Type': contentType, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
            return res.end(cached.body);
        }
        fs.readFile(filePath, (error, content) => {
            if (error) {
                res.writeHead(404);
                return res.end('404 Not Found');
            }
            if (!wantsGzip) {
                res.writeHead(200, { 'Content-Type': contentType });
                return res.end(content);
            }
            zlib.gzip(content, (zipErr, body) => {
                if (zipErr) {
                    res.writeHead(200, { 'Content-Type': contentType });
                    return res.end(content);
                }
                gzipCache.set(filePath, { mtimeMs: stat.mtimeMs, body });
                res.writeHead(200, { 'Content-Type': contentType, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
                res.end(body);
            });
        });
    });
});

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
