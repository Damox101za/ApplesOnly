'use strict';
// The real server (index.js) over HTTP: the sign-in gate, security headers,
// static files, and /api/data with encryption and earlier versions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { SIGN_IN_ENV, TEST_DATA_KEY, tempFile, sessionCookie, startServer } = require('../helpers');

const alice = sessionCookie({ sub: 'alice', email: 'alice@example.com', name: 'Alice' });
const bob = sessionCookie({ sub: 'bob', email: 'bob@example.com', name: 'Bob' });

function api(base, cookie, { method = 'GET', query = '', body, headers = {} } = {}) {
  return fetch(`${base}/api/data${query}`, {
    method,
    redirect: 'manual',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (res) => ({ status: res.status, json: await res.json().catch(() => null) }));
}

// ---------- sign-in off (how it runs locally with no settings) ----------
test('open server: pages load, security headers on everything', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  const page = await fetch(`${srv.base}/`);
  assert.equal(page.status, 200);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp.split(';').find((d) => d.trim().startsWith('script-src')), /unsafe-inline|unsafe-eval/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(page.headers.get('strict-transport-security'));
  assert.equal(page.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');

  const html = await page.text();
  assert.doesNotMatch(html, /<script>(?!<\/script>)/, 'no inline scripts, or the CSP would block them');

  const missing = await fetch(`${srv.base}/nope.js`);
  assert.equal(missing.status, 404);
  assert.ok(missing.headers.get('content-security-policy'), 'errors carry the headers too');

  const sw = await fetch(`${srv.base}/sw.js`);
  assert.equal(sw.headers.get('cache-control'), 'no-cache');
  const manifest = await fetch(`${srv.base}/manifest.webmanifest`);
  assert.equal(manifest.headers.get('content-type'), 'application/manifest+json');
});

test('open server: no reading files outside public/', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  for (const path of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/vault.js', '/../.env']) {
    const res = await fetch(srv.base + path);
    assert.ok([400, 403, 404].includes(res.status), `${path} -> ${res.status}`);
    assert.doesNotMatch(await res.text(), /"name": "applesonly"|DATA_ENCRYPTION_KEY|createCipheriv/);
  }
});

// ---------- sign-in on ----------
test('gate: signed-out visitors only get the sign-in page and its files', async (t) => {
  const srv = await startServer({ ...SIGN_IN_ENV });
  t.after(srv.stop);

  const home = await fetch(`${srv.base}/`, { redirect: 'manual' });
  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), '/login.html');
  assert.ok(home.headers.get('content-security-policy'), 'redirects carry the headers too');

  for (const file of ['/login.html', '/theme-init.js', '/style.css', '/manifest.webmanifest', '/icons/icon-192.png']) {
    assert.equal((await fetch(srv.base + file, { redirect: 'manual' })).status, 200, file);
  }
  for (const file of ['/app.js', '/sync.js']) {
    assert.equal((await fetch(srv.base + file, { redirect: 'manual' })).status, 401, file);
  }
  assert.equal((await api(srv.base, null)).status, 401);

  const forged = sessionCookie({ sub: 'alice', email: 'alice@example.com' }, 'wrong-secret-0123456789abcdef');
  assert.equal((await api(srv.base, forged)).status, 401, 'a cookie signed with another secret is refused');

  const signedIn = await fetch(`${srv.base}/`, { headers: { Cookie: alice }, redirect: 'manual' });
  assert.equal(signedIn.status, 200);
});

test('data api: saves, conflicts and validation', async (t) => {
  const srv = await startServer({ ...SIGN_IN_ENV, DATA_FILE: tempFile('store.json'), DATA_ENCRYPTION_KEY: TEST_DATA_KEY });
  t.after(srv.stop);

  const first = await api(srv.base, alice);
  assert.equal(first.status, 200);
  assert.equal(first.json.rev, 0);
  assert.ok(first.json.keys.includes('tasks'));
  assert.ok(first.json.keys.includes('expenses'), 'spending syncs too');

  const saved = await api(srv.base, alice, { method: 'PUT', body: { baseRev: 0, data: { tasks: [{ id: 't1', title: 'Pay rent' }] } } });
  assert.deepEqual(saved, { status: 200, json: { rev: 1 } });

  const stale = await api(srv.base, alice, { method: 'PUT', body: { baseRev: 0, data: { tasks: [] } } });
  assert.equal(stale.status, 409, 'a save based on an old revision is refused');
  assert.equal(stale.json.data.tasks[0].title, 'Pay rent', 'and gets the current copy back to merge');

  const unchanged = await api(srv.base, alice, { query: '?rev=1' });
  assert.equal(unchanged.json.unchanged, true);

  assert.equal((await api(srv.base, alice, { method: 'PUT', body: { baseRev: 1, data: { password: 'x' } } })).status, 400);
  assert.equal((await api(srv.base, alice, { method: 'PUT', body: { baseRev: 1, data: { tasks: 'nope' } } })).status, 400);
  assert.equal(
    (await api(srv.base, alice, { method: 'PUT', body: { baseRev: 1, data: {} }, headers: { Origin: 'https://evil.example' } })).status,
    403,
    'cross-site saves are refused'
  );

  assert.equal((await api(srv.base, bob)).json.rev, 0, "one account never sees another's data");
});

test('data api: stored encrypted, with earlier versions to restore', async (t) => {
  const file = tempFile('store.json');
  const srv = await startServer({ ...SIGN_IN_ENV, DATA_FILE: file, DATA_ENCRYPTION_KEY: TEST_DATA_KEY });
  t.after(srv.stop);

  const put = (baseRev, tasks, extra = {}) => api(srv.base, alice, { method: 'PUT', body: { baseRev, data: { tasks }, ...extra } });
  await put(0, [{ id: 'a', title: 'Secret plan' }]);
  await put(1, [{ id: 'a', title: 'Secret plan' }, { id: 'b', title: 'Second' }]);
  await put(2, [], { snapshot: true }); // e.g. a restore: keep what was there first

  const onDisk = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(onDisk, /Secret plan/, 'nothing readable on disk');
  assert.match(onDisk, /enc:v1:/);

  const list = await api(srv.base, alice, { query: '?versions' });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.versions.map((v) => [v.rev, v.counts.tasks]), [[2, 2], [1, 1]]);
  assert.ok(list.json.keep >= 1 && list.json.gapHours > 0);

  const one = await api(srv.base, alice, { query: `?version=${list.json.versions[0].at}` });
  assert.equal(one.status, 200);
  assert.deepEqual(one.json.data.tasks.map((x) => x.title), ['Secret plan', 'Second']);

  assert.equal((await api(srv.base, alice, { query: '?version=12345' })).status, 404);
  assert.deepEqual((await api(srv.base, bob, { query: '?versions' })).json.versions, [], "versions are per account");
});

test('data api: a missing key never overwrites encrypted data', async (t) => {
  const file = tempFile('store.json');
  const withKey = await startServer({ ...SIGN_IN_ENV, DATA_FILE: file, DATA_ENCRYPTION_KEY: TEST_DATA_KEY });
  await api(withKey.base, alice, { method: 'PUT', body: { baseRev: 0, data: { tasks: [{ id: 'a' }] } } });
  await withKey.stop();
  const before = fs.readFileSync(file, 'utf8');

  const noKey = await startServer({ ...SIGN_IN_ENV, DATA_FILE: file });
  t.after(noKey.stop);
  assert.equal((await api(noKey.base, alice)).status, 503);
  assert.equal((await api(noKey.base, alice, { method: 'PUT', body: { baseRev: 1, data: { tasks: [] } } })).status, 503);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the stored copy is untouched');
});

test('data api: plain data from before encryption still loads, then gets encrypted', async (t) => {
  const file = tempFile('store.json');
  const plain = await startServer({ ...SIGN_IN_ENV, DATA_FILE: file });
  await api(plain.base, alice, { method: 'PUT', body: { baseRev: 0, data: { tasks: [{ id: 'a', title: 'Old plain' }] } } });
  await plain.stop();
  assert.match(fs.readFileSync(file, 'utf8'), /Old plain/);

  const srv = await startServer({ ...SIGN_IN_ENV, DATA_FILE: file, DATA_ENCRYPTION_KEY: TEST_DATA_KEY });
  t.after(srv.stop);
  const loaded = await api(srv.base, alice);
  assert.equal(loaded.json.data.tasks[0].title, 'Old plain');
  await api(srv.base, alice, { method: 'PUT', body: { baseRev: 1, data: { tasks: [{ id: 'a', title: 'Old plain' }] } } });
  const record = JSON.parse(fs.readFileSync(file, 'utf8'))['lt:v1:user:alice'];
  assert.match(record.data, /^enc:v1:/, 'the next save encrypts it');
});
