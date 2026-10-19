'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

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
