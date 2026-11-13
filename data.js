'use strict';
// /api/data: the signed-in person's synced data. GET returns their copy (and
// its revision); PUT saves a new copy, but only if it was based on the current
// revision (otherwise 409 with the current copy, so the browser can merge).
// Everything is keyed by the verified account, never by anything the client says.

const store = require('./store');
const auth = require('./auth');
const { sendJson, sameOrigin, readJsonBody, closeAfterResponse } = require('./httpkit');

// What gets synced. Device-only settings (theme, background, view mode, backup
// and Calendar timestamps) deliberately stay out.
const ARRAY_KEYS = ['habits', 'journal', 'goals', 'tasks', 'projects'];
const OBJECT_KEYS = ['money', 'wheelRatings'];
const KEYS = [...ARRAY_KEYS, ...OBJECT_KEYS, 'schemaVersion'];

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_DATA_CHARS = 900 * 1024;
const MAX_ITEMS = 50000;

const WRITE_LIMIT = 200;
const READ_LIMIT = 600;
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map();

function underLimit(bucket, userId, limit) {
  const now = Date.now();
  const k = `${bucket}:${userId}`;
  const recent = (hits.get(k) || []).filter((t) => now - t < WINDOW_MS);
  const ok = recent.length < limit;
  if (ok) recent.push(now);
  hits.set(k, recent);
  return ok;
}

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// Only known keys, each with the right shape; returns the JSON to store.
function validate(data) {
  if (!isPlainObject(data)) throw badRequest('Send the data as an object.');
  const clean = {};
  for (const key of Object.keys(data)) {
    if (!KEYS.includes(key)) throw badRequest(`Unknown field: ${key.slice(0, 40)}`);
    const value = data[key];
    if (ARRAY_KEYS.includes(key)) {
      if (!Array.isArray(value) || value.length > MAX_ITEMS) throw badRequest(`${key} must be a list.`);
    } else if (OBJECT_KEYS.includes(key)) {
      if (!isPlainObject(value)) throw badRequest(`${key} must be an object.`);
    } else if (!Number.isInteger(value) || value < 0 || value > 1000) {
      throw badRequest('schemaVersion must be a small whole number.');
    }
    clean[key] = value;
  }
  const json = JSON.stringify(clean);
  if (json.length > MAX_DATA_CHARS) throw Object.assign(new Error('Your data is too large to sync.'), { status: 413 });
  return json;
}

function parseStored(json) {
  try {
    const parsed = JSON.parse(json || '{}');
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function handle(req, res) {
  res.setHeader('Vary', 'Cookie');
  if (!store.isConfigured()) {
    return sendJson(res, 503, { enabled: false, error: 'Cloud storage is not set up.' });
  }
  const session = auth.getSession(req);
  if (!session || !session.sub) return sendJson(res, 401, { error: 'Sign in required.' });

  const url = new URL(req.url, 'http://localhost');

  try {
    if (req.method === 'GET') {
      if (!underLimit('r', session.sub, READ_LIMIT)) return sendJson(res, 429, { error: 'Too many requests.' });
      const rec = await store.load(session.sub);
      const known = url.searchParams.get('rev');
      if (known !== null && Number(known) === rec.rev) {
        return sendJson(res, 200, { enabled: true, keys: KEYS, rev: rec.rev, unchanged: true });
      }
      return sendJson(res, 200, {
        enabled: true,
        keys: KEYS,
        user: { email: session.email },
        rev: rec.rev,
        updatedAt: rec.updatedAt,
        data: parseStored(rec.data),
      });
    }

    if (req.method === 'PUT') {
      if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Cross-origin requests are not allowed.' });
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
        return sendJson(res, 415, { error: 'Send JSON.' });
      }
      if (!underLimit('w', session.sub, WRITE_LIMIT)) return sendJson(res, 429, { error: 'Too many saves. Try again in a few minutes.' });

      const body = await readJsonBody(req, MAX_BODY_BYTES);
      if (!Number.isInteger(body.baseRev) || body.baseRev < 0) throw badRequest('baseRev must be a whole number.');
      const json = validate(body.data);
      const result = await store.save(session.sub, body.baseRev, json);
      if (result.ok) return sendJson(res, 200, { rev: result.rev });
      const current = await store.load(session.sub);
      return sendJson(res, 409, { error: 'Out of date.', rev: current.rev, data: parseStored(current.data) });
    }

    res.setHeader('Allow', 'GET, PUT');
    return sendJson(res, 405, { error: 'Use GET or PUT.' });
  } catch (err) {
    if (err.status === 413) closeAfterResponse(req, res);
    if (err.status) return sendJson(res, err.status, { error: err.message });
    console.error('Data sync failed:', err.message);
    return sendJson(res, 502, { error: 'Storage had a problem. Please try again.' });
  }
}

module.exports = { handle, KEYS };
