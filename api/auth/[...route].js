'use strict';
// Vercel Function for /api/auth/*: the same handler the Node server uses.
require('../../env'); // loads .env for `vercel dev`; a no-op in production
const auth = require('../../auth');

module.exports = (req, res) => auth.handle(req, res, new URL(req.url, 'http://localhost').pathname);
