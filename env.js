'use strict';
// Loads KEY=VALUE pairs from a .env file next to this one into process.env, so
// local setup doesn't need exported variables. Real environment variables
// always win, so hosted settings (e.g. Azure app settings) are never
// overridden. .env is git-ignored and lives outside public/, so it is never
// served to the browser.

const fs = require('fs');
const path = require('path');

function parse(text) {
  const out = {};
  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) return;
    let value = m[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, ''); // a trailing "  # comment" on an unquoted value
    }
    out[m[1]] = value;
  });
  return out;
}

function loadEnv(file = path.join(__dirname, '.env')) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return; // no .env is fine
  }
  Object.entries(parse(text)).forEach(([key, value]) => {
    if (process.env[key] === undefined) process.env[key] = value;
  });
}

loadEnv();

module.exports = { parse, loadEnv };
