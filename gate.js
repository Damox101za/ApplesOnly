'use strict';
// The one place that decides who may see what. The Node server (index.js) and
// Vercel's Routing Middleware (middleware.js) both ask it, so they can't drift.
//
// decide(pathname, cookieHeader) returns one of:
//   { action: 'next' }                          let the request through
//   { action: 'redirect', location }            send the browser elsewhere
//   { action: 'deny', status: 401, json }       refuse (json: true for /api/*)
//
// `pathname` is the decoded URL path. When sign-in is off everything passes.

const path = require('path');
const auth = require('./auth');

// What a signed-out visitor may load while sign-in is on. The sign-in page and
// everything it needs, nothing else.
const PUBLIC_FILES = new Set(['/login.html', '/login.js', '/style.css', '/background.js', '/favicon.ico']);

const NEXT = { action: 'next' };

function redirect(location) {
  return { action: 'redirect', location };
}

function deny(json) {
  return { action: 'deny', status: 401, json };
}

function decide(pathname, cookieHeader) {
  // The auth routes decide for themselves, and Vercel's own paths are not ours.
  if (pathname.startsWith('/api/auth/') || pathname.startsWith('/_vercel/')) return NEXT;

  const page = pathname === '/' ? '/index.html' : pathname;

  if (!auth.isEnabled()) {
    // Sign-in isn't set up, so there is nothing to sign in to.
    return page === '/login.html' ? redirect('/') : NEXT;
  }

  const signedIn = Boolean(auth.sessionFromCookieHeader(cookieHeader));
  if (!signedIn && !PUBLIC_FILES.has(page)) {
    if (pathname.startsWith('/api/')) return deny(true);
    // Pages bounce to the sign-in page; stray asset requests just get a 401.
    if (page.endsWith('.html') || path.extname(page) === '') return redirect('/login.html');
    return deny(false);
  }
  if (signedIn && page === '/login.html') return redirect('/');
  return NEXT;
}

module.exports = { decide, PUBLIC_FILES };
