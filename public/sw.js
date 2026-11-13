'use strict';
// Service worker: lets the app open with no connection. Everything is
// network-first, so you always get the newest version when online; the cache
// is only the fallback. Your data lives in localStorage, not here, and
// /api/* (sign-in, sync, AI) is never cached.

const CACHE = 'lifetracker-v1';
const SHELL = [
  '/',
  '/style.css',
  '/app.js',
  '/background.js',
  '/firebase-client.js',
  '/sync.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon.svg',
];
// A slow connection falls back to the cached copy instead of hanging.
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // One by one, so a single missing file can't stop the rest from caching.
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Every page in the app is the same document, so pages share one cache entry.
  const key = req.mode === 'navigate' ? '/' : req;
  event.respondWith(networkFirst(req, key));
});

async function networkFirst(req, key) {
  const cache = await caches.open(CACHE);
  const network = fetch(req).then((res) => {
    // Only keep real copies: no errors, and no sign-in redirects.
    if (res.ok && res.type === 'basic' && !res.redirected) cache.put(key, res.clone());
    return res;
  });

  const cached = await cache.match(key);
  if (!cached) return network;

  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS));
  return Promise.race([network.catch(() => cached), timeout]);
}
