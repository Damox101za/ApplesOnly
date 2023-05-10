'use strict';
const http = require('http');
const port = process.env.PORT || 1337;

http.createServer(function (req, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write(`Request path: ${req.url}\n`);
    res.end('Hello World\n');
}).listen(port);
