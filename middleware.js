// Vercel Routing Middleware: runs before static files and before the CDN cache,
// so it can guard the whole site even though the app is plain static files on
// Vercel. The rules live in gate.js, shared with the Node server (index.js).
// It does nothing unless GOOGLE_CLIENT_ID and SESSION_SECRET are both set.
//
// This file uses ES module syntax because Vercel bundles it; the rest of the
// project is CommonJS, and the Node server never loads this file.

import { next } from '@vercel/functions';
import gate from './gate.js';

export const config = { runtime: 'nodejs' };

function noStore(init) {
  return { ...init, headers: { 'Cache-Control': 'no-store', ...(init.headers || {}) } };
}

export default function middleware(request) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response('400 Bad Request', noStore({ status: 400 }));
  }

  let verdict;
  try {
    verdict = gate.decide(pathname, request.headers.get('cookie') || '');
  } catch (err) {
    // A bug here must not take the whole site down; the app itself holds no
    // server-side secrets, and the API routes check the session on their own.
    console.error('Sign-in gate failed, letting the request through:', err && err.message);
    return next();
  }

  if (verdict.action === 'redirect') {
    // A relative Location, exactly as the Node server sends: no host or protocol to get wrong behind a proxy.
    return new Response(null, noStore({ status: 302, headers: { Location: verdict.location } }));
  }
  if (verdict.action === 'deny') {
    if (verdict.json) {
      return new Response(JSON.stringify({ error: 'Sign in required.' }), noStore({ status: 401, headers: { 'Content-Type': 'application/json' } }));
    }
    return new Response('401 Sign in required', noStore({ status: 401 }));
  }
  return next();
}
