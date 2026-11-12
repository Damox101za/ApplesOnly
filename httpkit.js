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

function tooLarge() {
  return Object.assign(new Error('Request too large.'), { status: 413 });
}

// Some hosts (Vercel Functions) read and parse a JSON body before the handler
// runs, leaving nothing on the stream. Accept that form too.
function takeParsedBody(body, maxBytes) {
  return new Promise((resolve, reject) => {
    let value = body;
    if (Buffer.isBuffer(value)) value = value.toString('utf8');
    if (typeof value === 'string') {
      if (Buffer.byteLength(value) > maxBytes) return reject(tooLarge());
      try {
        return resolve(JSON.parse(value || '{}'));
      } catch {
        return reject(Object.assign(new Error('Invalid JSON.'), { status: 400 }));
      }
    }
    if (value && typeof value === 'object') {
      if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) return reject(tooLarge());
      return resolve(value);
    }
    return reject(Object.assign(new Error('Invalid JSON.'), { status: 400 }));
  });
}

function readJsonBody(req, maxBytes) {
  if (req.body !== undefined && req.body !== null) return takeParsedBody(req.body, maxBytes);
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
        reject(tooLarge());
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

// The address of whoever is calling. Behind Vercel's proxy the socket is the
// proxy, so use the headers Vercel sets itself; everywhere else use the socket.
function clientIp(req) {
  if (process.env.VERCEL) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = req.headers['x-real-ip'] || forwarded;
    if (ip) return String(ip);
  }
  return req.socket.remoteAddress || 'unknown';
}

// For a 413, answer first and only then drop the connection.
function closeAfterResponse(req, res) {
  res.setHeader('Connection', 'close');
  res.on('finish', () => req.destroy());
}

module.exports = { sendJson, sameOrigin, readJsonBody, closeAfterResponse, clientIp };
