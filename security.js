'use strict';
// Security headers for every response. The Node server (index.js) and Vercel's
// Routing Middleware (middleware.js) both send these, so the two can't drift.
//
// The Content Security Policy is the main one: the browser refuses any script
// that isn't one of our own files or Google's sign-in code, so injected code
// can't run and read your data. Every outside host below is there for a reason:
//
//   www.gstatic.com            Firebase sign-in SDK (firebase-client.js)
//   apis.google.com            loaded by Firebase for the Google sign-in popup
//   <project>.firebaseapp.com  Firebase's sign-in frame and popup page
//   accounts.google.com        Google's own sign-in pages
//   identitytoolkit / securetoken.googleapis.com   Firebase sign-in calls
//   www.googleapis.com         Google Calendar API
//   oauth2.googleapis.com      revoking Calendar access on disconnect
//   *.googleusercontent.com    Google profile pictures
//
// Styles allow 'unsafe-inline' because the app sets a few style attributes
// (progress bars and the like); styles can't read data, scripts can.

function authDomain() {
  const custom = (process.env.FIREBASE_AUTH_DOMAIN || '').trim();
  if (custom) return custom;
  const project = (process.env.FIREBASE_PROJECT_ID || '').trim();
  return project ? `${project}.firebaseapp.com` : '*.firebaseapp.com';
}

function contentSecurityPolicy() {
  return [
    "default-src 'self'",
    "script-src 'self' https://www.gstatic.com https://apis.google.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "font-src 'self'",
    [
      "connect-src 'self'",
      'https://www.gstatic.com',
      'https://apis.google.com',
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com',
      'https://www.googleapis.com',
      'https://oauth2.googleapis.com',
    ].join(' '),
    `frame-src https://${authDomain()} https://accounts.google.com https://apis.google.com`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function securityHeaders() {
  return {
    'Content-Security-Policy': contentSecurityPolicy(),
    // Never guess a file's type: a text file can't be run as a script.
    'X-Content-Type-Options': 'nosniff',
    // No other site may show this app inside a frame (clickjacking).
    'X-Frame-Options': 'DENY',
    // Other sites learn at most which site a link came from, never the page.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Keeps other windows from reaching into this one, while still letting the
    // Google sign-in popup report back (plain 'same-origin' would break it).
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    // Features the app never uses stay switched off.
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    // Always use https from now on (ignored by browsers on plain http).
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
}

module.exports = { securityHeaders, contentSecurityPolicy };
