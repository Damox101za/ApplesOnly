'use strict';
require('./env'); // load .env first: the modules below read process.env when they load
const http = require('http');
const fs = require('fs');
const path = require('path');
const ai = require('./ai');
const auth = require('./auth');

const port = process.env.PORT || 1337;

const publicDir = path.join(__dirname, 'public');
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
};

// What a signed-out visitor may load when login is on. Everything else (the
// app itself and /api/ai) needs a session.
const PUBLIC_FILES = new Set(['/login.html', '/login.js', '/style.css', '/background.js']);

function redirect(res, location) {
    res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
    res.end();
}

const server = http.createServer((req, res) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (e) {
        res.writeHead(400);
        return res.end('400 Bad Request');
    }
    if (pathname.startsWith('/api/auth/')) return auth.handle(req, res, pathname);

    const page = pathname === '/' ? '/index.html' : pathname;
    if (auth.isEnabled()) {
        const signedIn = Boolean(auth.getSession(req));
        if (!signedIn && !PUBLIC_FILES.has(page)) {
            if (pathname.startsWith('/api/')) {
                res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                return res.end(JSON.stringify({ error: 'Sign in required.' }));
            }
            if (page.endsWith('.html')) return redirect(res, '/login.html');
            res.writeHead(401, { 'Cache-Control': 'no-store' });
            return res.end('401 Sign in required');
        }
        if (signedIn && page === '/login.html') return redirect(res, '/');
    } else if (page === '/login.html') {
        return redirect(res, '/'); // login isn't set up, so there is nothing to sign in to
    }

    if (pathname.startsWith('/api/ai/')) return ai.handle(req, res, pathname);
    pathname = page;

    // Resolve inside public/ and refuse anything that escapes it.
    const filePath = path.join(publicDir, pathname);
    if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
        res.writeHead(403);
        return res.end('403 Forbidden');
    }

    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404);
            res.end('404 Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
