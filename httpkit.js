'use strict';
// Small helpers shared by the API modules (ai.js, auth.js).

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

// Browsers send Origin on cross-origin and most same-origin POSTs; reject any
// that doesn't match this host.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        req.pause(); // stop reading; the handler answers 413 and then drops the socket
        reject(Object.assign(new Error('Request too large.'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('Invalid JSON.'), { status: 400 }));
      }
    });
    req.on('error', (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    });
  });
}

// For a 413, answer first and only then drop the connection.
function closeAfterResponse(req, res) {
  res.setHeader('Connection', 'close');
  res.on('finish', () => req.destroy());
}

module.exports = { sendJson, sameOrigin, readJsonBody, closeAfterResponse };
