'use strict';
const test = require('node:test');
const assert = require('node:assert');
const SoundEngine = require('../public/sound-engine.js');

const engine = SoundEngine.create(require('../public/sound-data.json'));
const top = (q, user) => engine.find(q, { limit: 3, user })[0].word;

test('finds the word from a spelling that sounds right', () => {
  const cases = {
    nesesery: 'necessary',
    nolij: 'knowledge',
    choklit: 'chocolate',
    enuf: 'enough',
    bizness: 'business',
    skool: 'school',
    sertificate: 'certificate',
    teh: 'the', // plain typo
  };
  for (const [typed, word] of Object.entries(cases)) assert.strictEqual(top(typed), word, typed);
});

test('chances add up to at most 100%', () => {
  const total = engine.find('fone', { limit: 5 }).reduce((s, r) => s + r.chance, 0);
  assert.ok(total <= 1.0001 && total > 0.5);
});

test('explains which sounds were spelled differently', () => {
  const info = engine.explain('nesesery', 'necessary');
  const wrong = info.sounds.filter((r) => !r.ok).map((r) => `${r.yours}>${r.right}`);
  assert.ok(wrong.includes('s>c'));
  assert.ok(wrong.includes('s>ss'));
  const c = info.sounds.find((r) => r.right === 'c');
  assert.match(c.tip, /before e, i or y/);
});

test('splits words into parts with spelling rules', () => {
  const parts = (w) => engine.wordParts(w).map((p) => p.text);
  assert.deepStrictEqual(parts('unfortunately'), ['un', 'fortunate', 'ly']);
  assert.deepStrictEqual(parts('really'), ['real', 'ly']);
  assert.deepStrictEqual(parts('making'), ['make', 'ing']);
  assert.deepStrictEqual(parts('happiness'), ['happy', 'ness']);
  assert.match(engine.wordParts('beginning')[1].note, /double/);
});

test('learns your habits and finds practice words for them', () => {
  const user = SoundEngine.emptyUserModel();
  engine.learn('sircle', 'circle', user);
  engine.learn('nesesery', 'necessary', user);
  const [first] = engine.topPatterns(user);
  assert.strictEqual(first.right, 'c');
  assert.strictEqual(first.yours, 's');
  assert.strictEqual(first.n, 2);
  const words = engine.practiceWords('S', 'c', 5);
  assert.strictEqual(words.length, 5);
  words.forEach((w) => assert.ok(w.includes('c'), w));

  // Your habits make the matching word more likely.
  const before = engine.find('sity', { limit: 3 })[0];
  const after = engine.find('sity', { limit: 3, user })[0];
  assert.strictEqual(after.word, 'city');
  assert.ok(after.chance >= before.chance);
});
