'use strict';
// Keeps this browser's data in step with the signed-in account's copy on the
// server, so it follows you to any device. localStorage stays the working copy
// (the app reads and writes it exactly as before); this file copies changes up
// shortly after they happen, and pulls changes made elsewhere.
//
// It also starts the app: app.js is loaded only after the first sync finishes,
// so the page opens on up-to-date data. Without a cloud store (or offline) the
// app just starts on what is on this device.
//
// Conflicts: if two devices changed things, nothing is thrown away. Lists are
// merged item by item (matched on id), so the newer device's edits win on the
// items it touched and everything else from both sides is kept. The one thing
// a merge cannot know is a deletion, so an item deleted on one device can come
// back if the other device still had it.

(function () {
  const PREFIX = 'lifeTracker.';
  const META_KEY = `${PREFIX}sync`; // { owner, rev, dirty, keys } for this browser
  const PUSH_DELAY_MS = 1500;
  const POLL_MS = 90 * 1000;
  const BOOT_WAIT_MS = 4000;
  const REQUEST_TIMEOUT_MS = 8000;
  const KEEPALIVE_MAX_CHARS = 60000; // browsers cap keepalive request bodies near 64 KB

  const STATUS_TEXT = {
    off: 'Your data stays on this device.',
    synced: 'Saved to your account.',
    saving: 'Saving…',
    offline: "Offline. Changes will sync when you're back.",
    error: "Couldn't sync. Will retry.",
  };

  let enabled = false;
  let keys = [];
  let meta = { owner: null, rev: null, dirty: false, keys: null };
  let version = 0; // bumps on every local change, so a push knows whether it caught them all
  let pushTimer = 0;
  let pushing = false;
  let pushAgain = false;
  let appLoaded = false;
  let reloadApp = null;

  // ---------- local storage ----------
  const getItem = (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const setItem = (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage full or blocked; the app warns about that itself */
    }
  };
  const removeItem = (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* nothing to do */
    }
  };

  function loadMeta() {
    try {
      const parsed = JSON.parse(getItem(META_KEY) || 'null');
      if (parsed && typeof parsed === 'object') meta = { owner: null, rev: null, dirty: false, keys: null, ...parsed };
    } catch {
      /* start fresh */
    }
  }
  const saveMeta = () => setItem(META_KEY, JSON.stringify(meta));

  function readLocal() {
    const out = {};
    for (const key of keys) {
      const raw = getItem(PREFIX + key);
      if (raw === null) continue;
      try {
        const value = JSON.parse(raw);
        if (value !== null && value !== undefined) out[key] = value;
      } catch {
        /* skip unreadable values */
      }
    }
    return out;
  }

  function writeLocal(data) {
    for (const key of keys) {
      if (data[key] === undefined) removeItem(PREFIX + key);
      else setItem(PREFIX + key, JSON.stringify(data[key]));
    }
  }

  function wipeLocal() {
    keys.forEach((key) => removeItem(PREFIX + key));
  }

  const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

  // Nothing worth keeping (a fresh browser, or a brand-new empty account).
  function isEmptyData(data) {
    return Object.entries(data).every(([key, v]) => {
      if (key === 'schemaVersion') return true;
      if (Array.isArray(v)) return v.length === 0;
      if (isPlain(v)) return Object.keys(v).length === 0;
      return v === undefined || v === null;
    });
  }

  // ---------- merging ----------
  const itemId = (item) => (item && typeof item === 'object' && item.id != null ? `id:${item.id}` : `json:${JSON.stringify(item)}`);

  function mergeValue(key, local, remote, preferLocal) {
    if (local === undefined) return remote;
    if (remote === undefined) return local;
    if (key === 'schemaVersion') return Math.min(Number(local) || 0, Number(remote) || 0); // re-run migrations over merged items
    if (Array.isArray(local) && Array.isArray(remote)) {
      const first = preferLocal ? local : remote;
      const second = preferLocal ? remote : local;
      const seen = new Set(first.map(itemId));
      return first.concat(second.filter((item) => !seen.has(itemId(item))));
    }
    if (isPlain(local) && isPlain(remote)) return preferLocal ? { ...remote, ...local } : { ...local, ...remote };
    return preferLocal ? local : remote;
  }

  function mergeData(local, remote, preferLocal) {
    const out = {};
    for (const key of keys) {
      const v = mergeValue(key, local[key], remote[key], preferLocal);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }

  // ---------- talking to the server ----------
  async function api(method, { query = '', body, keepalive = false } = {}) {
    const res = await fetch(`/api/data${query}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  function setStatus(state) {
    const el = document.getElementById('syncStatus');
    if (el) el.textContent = STATUS_TEXT[state] || STATUS_TEXT.off;
  }

  // ---------- pushing ----------
  function schedulePush(delay = PUSH_DELAY_MS) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, delay);
  }

  async function pushNow() {
    if (!enabled) return false;
    if (pushing) {
      pushAgain = true;
      return false;
    }
    pushing = true;
    let appliedRemote = false;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const snapshot = readLocal();
        const startedAt = version;
        setStatus('saving');
        const res = await api('PUT', { body: { baseRev: meta.rev || 0, data: snapshot } });
        if (res.status === 200) {
          meta.rev = res.json.rev;
          if (version === startedAt) meta.dirty = false;
          saveMeta();
          setStatus(meta.dirty ? 'saving' : 'synced');
          break;
        }
        if (res.status === 409) {
          // Another device saved first: fold its copy into ours, then try again.
          writeLocal(mergeData(readLocal(), res.json.data || {}, true));
          meta.rev = res.json.rev;
          meta.dirty = true;
          saveMeta();
          appliedRemote = true;
          continue;
        }
        if (res.status === 401) {
          location.replace('/login.html');
          return appliedRemote;
        }
        setStatus('error');
        schedulePush(30 * 1000);
        break;
      }
    } catch {
      setStatus(navigator.onLine === false ? 'offline' : 'error');
      schedulePush(30 * 1000);
    } finally {
      pushing = false;
    }
    if (appliedRemote && appLoaded && reloadApp) reloadApp();
    if (pushAgain) {
      pushAgain = false;
      schedulePush(200);
    }
    return appliedRemote;
  }

  // ---------- reconciling with the server's copy ----------
  // Returns true when this browser's data was changed (so the app should redraw).
  async function reconcile(remote) {
    const local = readLocal();
    const hasLocal = !isEmptyData(local);

    if (remote.rev === 0) {
      // Nothing in the cloud yet: this device's data becomes the first copy.
      meta.rev = 0;
      meta.dirty = hasLocal;
      saveMeta();
      if (hasLocal) await pushNow();
      else setStatus('synced');
      return false;
    }

    if (meta.rev === remote.rev) {
      if (meta.dirty) await pushNow();
      else setStatus('synced');
      return false;
    }

    // The cloud copy has moved on from what this browser last saw.
    if (!meta.dirty && (meta.rev !== null || !hasLocal)) {
      writeLocal(remote.data); // nothing unsaved here, so just take it
      meta.rev = remote.rev;
      saveMeta();
      setStatus('synced');
      return true;
    }

    // Unsaved edits here (or first sign-in on a browser that already has data): merge both.
    writeLocal(mergeData(local, remote.data, meta.dirty));
    meta.rev = remote.rev;
    meta.dirty = true;
    saveMeta();
    await pushNow();
    return true;
  }

  // ---------- starting up ----------
  async function startup() {
    loadMeta();
    let res;
    try {
      res = await api('GET');
    } catch {
      // Offline (or the server is down). If this browser has synced before, keep going and retry later.
      if (meta.owner && Array.isArray(meta.keys)) {
        enabled = true;
        keys = meta.keys;
        setStatus('offline');
        schedulePush(15 * 1000);
      } else {
        setStatus('off');
      }
      return false;
    }
    if (res.status !== 200 || !res.json.enabled) {
      enabled = false;
      setStatus('off');
      return false;
    }

    enabled = true;
    keys = res.json.keys;
    const email = res.json.user && res.json.user.email;

    if (meta.owner && email && meta.owner !== email) {
      // This browser holds someone else's synced data; it is safe in their account.
      wipeLocal();
      meta = { owner: null, rev: null, dirty: false, keys: null };
    }
    meta.owner = email || meta.owner;
    meta.keys = keys;
    saveMeta();

    return reconcile(res.json);
  }

  async function check() {
    if (!enabled || pushing || document.hidden || !appLoaded) return;
    if (meta.dirty) {
      pushNow();
      return;
    }
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) && active.value) return; // don't redraw under someone mid-edit
    try {
      const res = await api('GET', { query: `?rev=${meta.rev || 0}` });
      if (res.status === 401) return location.replace('/login.html');
      if (res.status !== 200 || res.json.unchanged || res.json.rev === meta.rev) {
        if (res.status === 200) setStatus('synced');
        return;
      }
      if (await reconcile(res.json)) reloadApp && reloadApp();
    } catch {
      setStatus(navigator.onLine === false ? 'offline' : 'error');
    }
  }

  // ---------- what the app calls ----------
  function changed(key) {
    if (!enabled || !String(key).startsWith(PREFIX) || !keys.includes(key.slice(PREFIX.length))) return;
    meta.dirty = true;
    version++;
    saveMeta();
    setStatus('saving');
    schedulePush();
  }

  window.CloudSync = {
    changed,
    onRemoteChange(fn) {
      reloadApp = fn;
    },
    // exposed for tests
    _mergeData: (local, remote, preferLocal, withKeys) => {
      keys = withKeys;
      return mergeData(local, remote, preferLocal);
    },
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Leaving the page: flush anything unsaved if it fits in a keepalive request.
      if (enabled && meta.dirty && !pushing) {
        const body = { baseRev: meta.rev || 0, data: readLocal() };
        if (JSON.stringify(body).length < KEEPALIVE_MAX_CHARS) api('PUT', { body, keepalive: true }).catch(() => {});
      }
    } else {
      check();
    }
  });
  window.addEventListener('online', () => check());
  setInterval(check, POLL_MS);

  // ---------- boot: sync once, then start the app ----------
  function startApp() {
    appLoaded = true;
    const script = document.createElement('script');
    script.src = 'app.js';
    document.body.appendChild(script);
  }

  let settled = false;
  const bootTimer = setTimeout(() => {
    if (!settled) {
      settled = true;
      startApp();
    }
  }, BOOT_WAIT_MS);

  startup()
    .catch((err) => {
      console.error('Sync startup failed:', err);
      return false;
    })
    .then((changedLocal) => {
      clearTimeout(bootTimer);
      if (settled) {
        // The app started while we were still syncing; redraw it with what arrived.
        if (changedLocal && reloadApp) reloadApp();
        return;
      }
      settled = true;
      startApp();
    });
})();
