'use strict';
// Vercel Function for /api/ai/*: the same handler the Node server uses, behind
// the same session check (the middleware checks too; this is a second lock).
require('../../env');
const ai = require('../../ai');
const gate = require('../../gate');

module.exports = (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const verdict = gate.decide(pathname, req.headers.cookie || '');
  if (verdict.action !== 'next') {
    res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: 'Sign in required.' }));
  }
  return ai.handle(req, res, pathname);
};
