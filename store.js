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
//
// History: before a save replaces the stored copy, that copy is kept as an
// earlier version, at most once every SNAPSHOT_GAP_MS (or always, when the
// caller asks, e.g. just before a restore or import). The newest KEEP_VERSIONS
// are kept. Versions are stored exactly as the data was (so encrypted ones
// stay encrypted).

const fs = require('fs');
const path = require('path');

const REDIS_TIMEOUT_MS = 8000;
const SNAPSHOT_GAP_MS = 6 * 60 * 60 * 1000;
const KEEP_VERSIONS = 30;

// Compare-and-set (plus keeping the old copy as a version) in one atomic step
// on the Redis side. ARGV: baseRev, data, now, snapshot gap (0 = always), keep.
// A version is stored as "savedAt|rev|data".
const SAVE_SCRIPT = `
local cur = tonumber(redis.call('HGET', KEYS[1], 'rev') or '0')
if cur ~= tonumber(ARGV[1]) then return {0, cur} end
if cur > 0 then
  local old = redis.call('HMGET', KEYS[1], 'data', 'updatedAt', 'snapAt')
  local snapAt = tonumber(old[3] or '0') or 0
  if old[1] and (tonumber(ARGV[3]) - snapAt) >= tonumber(ARGV[4]) then
    redis.call('LPUSH', KEYS[2], (old[2] or ARGV[3]) .. '|' .. cur .. '|' .. old[1])
    redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[5]) - 1)
    redis.call('HSET', KEYS[1], 'snapAt', ARGV[3])
  end
end
local nxt = cur + 1
redis.call('HSET', KEYS[1], 'rev', nxt, 'updatedAt', ARGV[3], 'data', ARGV[2])
return {1, nxt}`;

const recordKey = (userId) => `lt:v1:user:${userId}`;
const historyKey = (userId) => `lt:v1:history:${userId}`;

function parseVersion(entry) {
  const a = entry.indexOf('|');
  const b = entry.indexOf('|', a + 1);
  if (a < 0 || b < 0) return null;
  return { at: Number(entry.slice(0, a)) || 0, rev: Number(entry.slice(a + 1, b)) || 0, data: entry.slice(b + 1) };
}

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
    async save(userId, baseRev, data, { forceSnapshot = false } = {}) {
      const [ok, rev] = await command([
        'EVAL', SAVE_SCRIPT, '2', recordKey(userId), historyKey(userId),
        String(baseRev), data, String(Date.now()), String(forceSnapshot ? 0 : SNAPSHOT_GAP_MS), String(KEEP_VERSIONS),
      ]);
      return { ok: ok === 1, rev: Number(rev) };
    },
    async history(userId) {
      const entries = (await command(['LRANGE', historyKey(userId), '0', String(KEEP_VERSIONS - 1)])) || [];
      return entries.map(parseVersion).filter(Boolean);
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
    save: (userId, baseRev, data, { forceSnapshot = false } = {}) =>
      run(() => {
        const all = read();
        const old = all[recordKey(userId)] || { rev: 0 };
        if (old.rev !== baseRev) return { ok: false, rev: old.rev };
        const now = Date.now();
        let snapAt = old.snapAt || 0;
        if (old.rev > 0 && old.data && (forceSnapshot || now - snapAt >= SNAPSHOT_GAP_MS)) {
          const versions = Array.isArray(all[historyKey(userId)]) ? all[historyKey(userId)] : [];
          all[historyKey(userId)] = [{ at: old.updatedAt || now, rev: old.rev, data: old.data }, ...versions].slice(0, KEEP_VERSIONS);
          snapAt = now;
        }
        all[recordKey(userId)] = { rev: old.rev + 1, updatedAt: now, data, snapAt };
        write(all);
        return { ok: true, rev: old.rev + 1 };
      }),
    history: (userId) =>
      run(() => {
        const versions = read()[historyKey(userId)];
        return Array.isArray(versions) ? versions : [];
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
const save = (userId, baseRev, data, options) => backend().save(userId, baseRev, data, options);
const history = (userId) => backend().history(userId);

module.exports = { isConfigured, load, save, history, KEEP_VERSIONS, SNAPSHOT_GAP_MS };
