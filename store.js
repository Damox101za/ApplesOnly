'use strict';
// Where each signed-in person's synced data lives: one record per account,
// holding a revision number and the data as a JSON string.
//
//  - On Vercel: Upstash Redis, over its REST API (no SDK). Connect the Upstash
//    integration to the project and it sets the two variables below.
//  - Anywhere else (your own machine, Azure): a JSON file, data/store.json.
//
// save() only succeeds if the caller's base revision is still the current one,
// so two devices can never silently overwrite each other.

const fs = require('fs');
const path = require('path');

const REDIS_TIMEOUT_MS = 8000;

// Compare-and-set in one atomic step on the Redis side.
const SAVE_SCRIPT = `
local cur = tonumber(redis.call('HGET', KEYS[1], 'rev') or '0')
if cur ~= tonumber(ARGV[1]) then return {0, cur} end
local nxt = cur + 1
redis.call('HSET', KEYS[1], 'rev', nxt, 'updatedAt', ARGV[3], 'data', ARGV[2])
return {1, nxt}`;

const recordKey = (userId) => `lt:v1:user:${userId}`;

function redisSettings() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

// ---------- Upstash Redis ----------
function redisBackend({ url, token }) {
  async function command(args) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(`redis ${res.status} ${body.error || ''}`.trim());
    return body.result;
  }

  return {
    async load(userId) {
      const [rev, updatedAt, data] = await command(['HMGET', recordKey(userId), 'rev', 'updatedAt', 'data']);
      return { rev: Number(rev) || 0, updatedAt: Number(updatedAt) || 0, data: data || null };
    },
    async save(userId, baseRev, data) {
      const [ok, rev] = await command(['EVAL', SAVE_SCRIPT, '1', recordKey(userId), String(baseRev), data, String(Date.now())]);
      return { ok: ok === 1, rev: Number(rev) };
    },
  };
}

// ---------- JSON file ----------
function fileBackend(file) {
  let queue = Promise.resolve(); // one operation at a time within this process

  const read = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };
  const write = (all) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  const run = (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };

  return {
    load: (userId) =>
      run(() => {
        const rec = read()[recordKey(userId)];
        return rec ? { rev: rec.rev, updatedAt: rec.updatedAt, data: rec.data } : { rev: 0, updatedAt: 0, data: null };
      }),
    save: (userId, baseRev, data) =>
      run(() => {
        const all = read();
        const cur = (all[recordKey(userId)] || { rev: 0 }).rev;
        if (cur !== baseRev) return { ok: false, rev: cur };
        all[recordKey(userId)] = { rev: cur + 1, updatedAt: Date.now(), data };
        write(all);
        return { ok: true, rev: cur + 1 };
      }),
  };
}

let cached = null;
let cachedFor = '';

// null when nothing is configured (on Vercel without Upstash, sync is simply off).
function backend() {
  const redis = redisSettings();
  const file = process.env.VERCEL ? '' : process.env.DATA_FILE || path.join(__dirname, 'data', 'store.json');
  const signature = redis ? `redis:${redis.url}` : `file:${file}`;
  if (cached !== null && cachedFor === signature) return cached;
  cachedFor = signature;
  cached = redis ? redisBackend(redis) : file ? fileBackend(file) : false;
  return cached;
}

const isConfigured = () => Boolean(backend());
const load = (userId) => backend().load(userId);
const save = (userId, baseRev, data) => backend().save(userId, baseRev, data);

module.exports = { isConfigured, load, save };
