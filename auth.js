'use strict';
// "Sign in with Google" for the server, through Firebase Authentication. The
// browser signs in with Firebase (which handles the Google OAuth client itself)
// and posts the Firebase ID token here; we verify it and hand back our own
// signed, HttpOnly session cookie. Nothing is stored server-side.
//
// Turned on by setting FIREBASE_PROJECT_ID, FIREBASE_API_KEY and SESSION_SECRET
// (a long random string, at least 16 characters). With any of them missing the
// app stays open, as it was before login existed, so a half-finished setup can
// never lock anyone out. Sessions are stateless cookies signed with SESSION_SECRET, so they work
// across restarts and across serverless instances.

const crypto = require('crypto');
const { sendJson, sameOrigin, readJsonBody, closeAfterResponse, clientIp } = require('./httpkit');
const store = require('./store');

// Firebase signs its ID tokens with these keys (RS256).
const JWKS_URL =
  process.env.FIREBASE_JWKS_URL || 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const COOKIE_NAME = 'lt_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_TOKEN_CHARS = 4096;
const CLOCK_SKEW_MS = 60 * 1000;
const SECRET_MIN_CHARS = 16;

const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_MIN_REFRESH_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

// Sign-in attempts per client; keeps junk tokens from costing much.
const LOGIN_LIMIT = 30;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const loginHits = new Map();

function projectId() {
  return (process.env.FIREBASE_PROJECT_ID || '').trim();
}

function apiKey() {
  return (process.env.FIREBASE_API_KEY || '').trim();
}

// Safe to share with the browser; Firebase web config is not a secret.
function firebaseConfig() {
  return {
    apiKey: apiKey(),
    projectId: projectId(),
    authDomain: (process.env.FIREBASE_AUTH_DOMAIN || '').trim() || `${projectId()}.firebaseapp.com`,
  };
}

function sessionSecret() {
  return process.env.SESSION_SECRET || '';
}

function isEnabled() {
  return Boolean(projectId()) && Boolean(apiKey()) && sessionSecret().length >= SECRET_MIN_CHARS;
}

if (projectId() && !isEnabled()) {
  console.warn(
    `Sign-in is OFF: it needs FIREBASE_PROJECT_ID, FIREBASE_API_KEY and a SESSION_SECRET of at least ${SECRET_MIN_CHARS} characters.`
  );
}

// ---------- small helpers ----------
const b64u = (input) => Buffer.from(input).toString('base64url');

function hmac(data) {
  return crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function authError(message, status = 401) {
  return Object.assign(new Error(message), { status });
}

function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    });
  return out;
}

function isHttps(req) {
  return Boolean(req.socket.encrypted) || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function cookieHeader(req, value, maxAgeSeconds) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${isHttps(req) ? '; Secure' : ''}`;
}

// ---------- our session cookie ----------
function makeSession(user) {
  const payload = b64u(JSON.stringify({ ...user, exp: Date.now() + SESSION_MS }));
  return `${payload}.${hmac(payload)}`;
}

function readSession(token) {
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  if (!safeEqual(token.slice(dot + 1), hmac(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || typeof data.exp !== 'number' || data.exp <= Date.now()) return null;
    return { sub: data.sub, email: data.email, name: data.name, picture: data.picture };
  } catch {
    return null;
  }
}

// The signed-in user for a Cookie header, or null (always null when login is off).
function sessionFromCookieHeader(header) {
  if (!isEnabled()) return null;
  const raw = parseCookies(header)[COOKIE_NAME];
  return raw ? readSession(raw) : null;
}

function getSession(req) {
  return sessionFromCookieHeader(req.headers.cookie);
}

// ---------- verifying Firebase's ID token ----------
let jwks = { keys: null, fetchedAt: 0 };

async function loadKeys() {
  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const body = await res.json();
  if (!body || !Array.isArray(body.keys)) throw new Error('jwks malformed');
  jwks = { keys: body.keys, fetchedAt: Date.now() };
}

async function findKey(kid) {
  const age = Date.now() - jwks.fetchedAt;
  if (!jwks.keys || age > JWKS_TTL_MS) await loadKeys();
  let jwk = jwks.keys.find((k) => k.kid === kid && k.kty === 'RSA');
  // Keys rotate; if one is unknown, refresh once (but not on every request).
  if (!jwk && Date.now() - jwks.fetchedAt > JWKS_MIN_REFRESH_MS) {
    await loadKeys();
    jwk = jwks.keys.find((k) => k.kid === kid && k.kty === 'RSA');
  }
  return jwk ? crypto.createPublicKey({ key: jwk, format: 'jwk' }) : null;
}

function decodePart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

async function verifyIdToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw authError('That sign-in could not be verified.');

  let header;
  let claims;
  try {
    header = decodePart(parts[0]);
    claims = decodePart(parts[1]);
  } catch {
    throw authError('That sign-in could not be verified.');
  }
  // Only RS256 — never trust the token to pick its own algorithm.
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw authError('That sign-in could not be verified.');
  }

  let key;
  try {
    key = await findKey(header.kid);
  } catch (err) {
    console.error('Could not load Google signing keys:', err.message);
    throw authError('Sign-in is unavailable right now. Please try again.', 503);
  }
  if (!key) throw authError('That sign-in could not be verified.');

  const signatureOk = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  if (!signatureOk) throw authError('That sign-in could not be verified.');

  const now = Date.now();
  const verifiedEmail = claims.email_verified === true || claims.email_verified === 'true';
  const provider = claims.firebase && claims.firebase.sign_in_provider;
  if (
    claims.iss !== `https://securetoken.google.com/${projectId()}` ||
    claims.aud !== projectId() ||
    typeof claims.exp !== 'number' ||
    claims.exp * 1000 < now - CLOCK_SKEW_MS ||
    (typeof claims.iat === 'number' && claims.iat * 1000 > now + CLOCK_SKEW_MS) ||
    typeof claims.sub !== 'string' ||
    !claims.sub ||
    claims.sub.length > 128 ||
    provider !== 'google.com' || // only Google accounts, even if the project allows other methods
    typeof claims.email !== 'string' ||
    !verifiedEmail
  ) {
    throw authError('That sign-in could not be verified.');
  }

  const picture = typeof claims.picture === 'string' && /^https:\/\//.test(claims.picture) && claims.picture.length < 500 ? claims.picture : '';
  return {
    sub: claims.sub,
    email: claims.email.slice(0, 254),
    name: String(claims.name || claims.email).slice(0, 100),
    picture,
  };
}

// ---------- routes ----------
function underLoginLimit(req) {
  const now = Date.now();
  const ip = clientIp(req);
  const recent = (loginHits.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  if (recent.length >= LOGIN_LIMIT) {
    loginHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  loginHits.set(ip, recent);
  return true;
}

function publicUser(user) {
  return { email: user.email, name: user.name, picture: user.picture };
}

async function handle(req, res, pathname) {
  const route = pathname.replace(/^\/api\/auth\//, '');

  if (route === 'config' && req.method === 'GET') {
    return sendJson(res, 200, { enabled: isEnabled(), firebase: isEnabled() ? firebaseConfig() : null, cloudSync: isEnabled() && store.isConfigured() });
  }

  if (route === 'me' && req.method === 'GET') {
    if (!isEnabled()) return sendJson(res, 200, { user: null });
    const session = getSession(req);
    return session ? sendJson(res, 200, { user: publicUser(session) }) : sendJson(res, 401, { error: 'Not signed in.' });
  }

  if (route === 'google' || route === 'logout') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Use POST.' });
    }
    if (!isEnabled()) return sendJson(res, 503, { error: 'Sign-in is not set up on this server.' });
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Cross-origin requests are not allowed.' });

    if (route === 'logout') {
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
    }

    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      return sendJson(res, 415, { error: 'Send JSON.' });
    }
    if (!underLoginLimit(req)) return sendJson(res, 429, { error: 'Too many sign-in attempts. Try again in a few minutes.' });

    try {
      const body = await readJsonBody(req, MAX_BODY_BYTES);
      const credential = typeof body.credential === 'string' ? body.credential : '';
      if (!credential || credential.length > MAX_TOKEN_CHARS) throw authError('That sign-in could not be verified.');
      const user = await verifyIdToken(credential);
      return sendJson(res, 200, { user: publicUser(user) }, { 'Set-Cookie': cookieHeader(req, makeSession(user), SESSION_MS / 1000) });
    } catch (err) {
      if (err.status === 413) closeAfterResponse(req, res);
      if (err.status) return sendJson(res, err.status, { error: err.message });
      console.error('Sign-in failed:', err.message);
      return sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
    }
  }

  return sendJson(res, 404, { error: 'Not found.' });
}

module.exports = { handle, getSession, sessionFromCookieHeader, isEnabled };
