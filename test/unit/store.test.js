'use strict';
// The synced-data store (store.js): compare-and-set saves and earlier versions.
// Every test runs against the JSON-file backend, and again against a real Redis
// (through a stand-in for Upstash's REST API) when one is reachable on
// REDIS_PORT (default 6379). CI starts a Redis service; locally it's skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempFile, redisAvailable, redisCommand, startUpstashShim } = require('../helpers');

const store = require('../../store');

const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
let userCounter = 0;
const newUser = () => `user-${process.pid}-${++userCounter}`;

// Points store.js at one backend for the duration of fn.
const STORE_ENV = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'VERCEL', 'DATA_FILE'];

async function onBackend(kind, fn) {
  const saved = Object.fromEntries(STORE_ENV.map((k) => [k, process.env[k]]));
  STORE_ENV.forEach((k) => delete process.env[k]);
  let shim = null;
  try {
    if (kind === 'redis') {
      shim = await startUpstashShim(REDIS_PORT);
      process.env.KV_REST_API_URL = shim.url;
      process.env.KV_REST_API_TOKEN = 'test';
    } else {
      process.env.DATA_FILE = tempFile('store.json');
    }
    await fn();
  } finally {
    if (shim) await shim.stop();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// Runs fn with Date.now() returning `t`, for testing the 6-hour gap.
async function at(t, fn) {
  const real = Date.now;
  Date.now = () => t;
  try {
    return await fn();
  } finally {
    Date.now = real;
  }
}

const HOUR = 3600e3;

// The same cases for each backend; `define` is test() or a parent's t.test().
function suite(kind, define) {

  define(`${kind}: saves need the current revision`, async () => {
    await onBackend(kind, async () => {
      const u = newUser();
      assert.deepEqual(await store.load(u), { rev: 0, updatedAt: 0, data: null });
      assert.deepEqual(await store.save(u, 0, 'v1'), { ok: true, rev: 1 });
      assert.deepEqual(await store.save(u, 0, 'stale'), { ok: false, rev: 1 });
      assert.deepEqual(await store.save(u, 1, 'v2'), { ok: true, rev: 2 });
      const rec = await store.load(u);
      assert.equal(rec.rev, 2);
      assert.equal(rec.data, 'v2');
    });
  });

  define(`${kind}: keeps the previous copy at most once per gap`, async () => {
    await onBackend(kind, async () => {
      const u = newUser();
      const t0 = 1_800_000_000_000;
      await at(t0, () => store.save(u, 0, 'v1'));
      await at(t0 + 1000, () => store.save(u, 1, 'v2')); // first change: keeps v1
      await at(t0 + 2000, () => store.save(u, 2, 'v3')); // inside the gap: nothing kept
      await at(t0 + 7 * HOUR, () => store.save(u, 3, 'v4')); // gap passed: keeps v3
      const versions = await store.history(u);
      assert.deepEqual(versions.map((v) => [v.rev, v.data]), [[3, 'v3'], [1, 'v1']]);
      assert.equal(versions[1].at, t0, "a version is dated when it was saved, not when it was replaced");
    });
  });

  define(`${kind}: a forced snapshot always keeps the current copy`, async () => {
    await onBackend(kind, async () => {
      const u = newUser();
      await store.save(u, 0, 'v1');
      await store.save(u, 1, 'v2');
      await store.save(u, 2, 'v3', { forceSnapshot: true });
      assert.deepEqual((await store.history(u)).map((v) => v.data), ['v2', 'v1']);
    });
  });

  define(`${kind}: only the newest ${store.KEEP_VERSIONS} versions are kept`, async () => {
    await onBackend(kind, async () => {
      const u = newUser();
      for (let rev = 0; rev < store.KEEP_VERSIONS + 5; rev++) {
        assert.equal((await store.save(u, rev, `v${rev + 1}`, { forceSnapshot: true })).ok, true);
      }
      const versions = await store.history(u);
      assert.equal(versions.length, store.KEEP_VERSIONS);
      assert.equal(versions[0].data, `v${store.KEEP_VERSIONS + 4}`, 'newest first');
    });
  });

  define(`${kind}: data with "|" and unicode survives the version format`, async () => {
    await onBackend(kind, async () => {
      const u = newUser();
      const tricky = JSON.stringify({ tasks: [{ title: 'a|b|c 🍎 ünïcødé' }] });
      await store.save(u, 0, tricky);
      await store.save(u, 1, 'next');
      assert.equal((await store.history(u))[0].data, tricky);
    });
  });

  define(`${kind}: each account only sees its own versions`, async () => {
    await onBackend(kind, async () => {
      const a = newUser();
      const b = newUser();
      await store.save(a, 0, 'a1');
      await store.save(a, 1, 'a2');
      assert.deepEqual(await store.history(b), []);
    });
  });
}

suite('file', test);

test('redis backend', async (t) => {
  if (!(await redisAvailable(REDIS_PORT))) {
    t.skip(`no Redis on port ${REDIS_PORT}`);
    return;
  }
  await redisCommand(REDIS_PORT, ['FLUSHDB']);
  const cases = [];
  suite('redis', (name, fn) => cases.push([name, fn]));
  for (const [name, fn] of cases) await t.test(name, fn);
});
