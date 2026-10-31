'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'public', 'defs');
const load = (w) => JSON.parse(fs.readFileSync(path.join(dir, `${w[0]}.json`), 'utf8'))[w];

test('has meanings for common words, most common sense first', () => {
  assert.strictEqual(load('necessary').m[0][1], 'absolutely essential');
  assert.match(load('stopped').m[0][1], /halt/);
  assert.strictEqual(load('ran').f, 'run');
});

test('covers the small words that sound alike', () => {
  assert.match(load('their').m[0][1], /belonging to them/);
  assert.match(load('there').m[0][1], /place/);
  assert.match(load('its').m[0][1], /belonging to it/);
});

test('practice sentences have one blank for the word', () => {
  for (const w of ['necessary', 'stopped', 'their']) {
    const s = load(w).s;
    assert.strictEqual(s.split('___').length, 2, w);
  }
});

test('every practice word has a meaning', () => {
  const data = require('../public/sound-data.json');
  const practice = data.words.split('\n').map((l) => l.split(' ')).filter((p) => (p[2] || '').includes('p')).map((p) => p[0]);
  const missing = practice.filter((w) => !load(w));
  assert.deepStrictEqual(missing.slice(0, 5), []);
});
