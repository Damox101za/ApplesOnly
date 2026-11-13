'use strict';
// Shared helpers for the test suite: start the real server, make a signed-in
// session cookie, and stand in for Upstash's REST API in front of a real Redis.

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Settings that switch sign-in on. Values are for tests only.
const SIGN_IN_ENV = {
  FIREBASE_PROJECT_ID: 'demo-lifetracker',
  FIREBASE_API_KEY: 'test-api-key',
  SESSION_SECRET: 'test-session-secret-0123456789abcdef',
};
const TEST_DATA_KEY = 'test-data-key-0123456789abcdef0123456789';

function tempFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifetracker-test-'));
  return path.join(dir, name);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// A session cookie exactly like auth.js makes after a real Google sign-in.
function sessionCookie(user, secret = SIGN_IN_ENV.SESSION_SECRET) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + 3600e3 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `lt_session=${payload}.${sig}`;
}

// Starts index.js in its own process with only the given settings (nothing
// from a local .env leaks in). Resolves to { base, stop }.
async function startServer(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['index.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, PORT: String(port), SKIP_DOTENV: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 10000);
    child.stdout.on('data', () => {
      if (output.includes('Server running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => reject(new Error(`server exited (${code}):\n${output}`)));
  });
  return {
    base: `http://127.0.0.1:${port}`,
    output: () => output,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', resolve);
        child.kill();
      }),
  };
}

// ---------- Upstash REST stand-in (for store tests against a real Redis) ----------
function encodeCommand(args) {
  return `*${args.length}\r\n` + args.map((a) => {
    const b = Buffer.from(String(a));
    return `$${b.length}\r\n${b}\r\n`;
  }).join('');
}

function parseReply(buf, i = 0) {
  const end = buf.indexOf('\r\n', i);
  if (end < 0) throw new Error('incomplete');
  const type = String.fromCharCode(buf[i]);
  const line = buf.toString('utf8', i + 1, end);
  if (type === '+') return [line, end + 2];
  if (type === '-') return [{ error: line }, end + 2];
  if (type === ':') return [Number(line), end + 2];
  if (type === '$') {
    const n = Number(line);
    if (n < 0) return [null, end + 2];
    if (buf.length < end + 4 + n) throw new Error('incomplete');
    return [buf.toString('utf8', end + 2, end + 2 + n), end + 4 + n];
  }
  if (type === '*') {
    const n = Number(line);
    if (n < 0) return [null, end + 2];
    let pos = end + 2;
    const out = [];
    for (let k = 0; k < n; k++) {
      const [v, p] = parseReply(buf, pos);
      out.push(v);
      pos = p;
    }
    return [out, pos];
  }
  throw new Error(`unknown reply type ${type}`);
}

function redisCommand(redisPort, args) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(redisPort, '127.0.0.1');
    let buf = Buffer.alloc(0);
    sock.on('error', reject);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      try {
        const [value] = parseReply(buf);
        sock.end();
        resolve(value);
      } catch {
        /* wait for the rest */
      }
    });
    sock.write(encodeCommand(args));
  });
}

async function redisAvailable(redisPort) {
  try {
    return (await redisCommand(redisPort, ['PING'])) === 'PONG';
  } catch {
    return false;
  }
}

// Speaks Upstash's REST protocol (POST [cmd, ...args] -> { result }).
async function startUpstashShim(redisPort) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const value = await redisCommand(redisPort, JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value && value.error ? { error: value.error } : { result: value }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise((r) => server.close(r)) };
}

module.exports = {
  ROOT,
  SIGN_IN_ENV,
  TEST_DATA_KEY,
  tempFile,
  sessionCookie,
  startServer,
  redisCommand,
  redisAvailable,
  startUpstashShim,
};
