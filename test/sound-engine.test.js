'use strict';
const test = require('node:test');
const assert = require('node:assert');
const SoundEngine = require('../public/sound-engine.js');

const engine = SoundEngine.create(require('../public/sound-data.json'));
const top = (q, user, style) => engine.find(q, { limit: 3, user, style })[0].word;

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

test('splits words into spoken parts with the stress marked', () => {
  const show = (w) => {
    const s = engine.syllables(w);
    return s.parts.map((p) => (p.stressed ? p.letters.toUpperCase() : p.letters)).join('·') + ' ' + s.say;
  };
  assert.strictEqual(show('necessary'), 'NEC·es·sar·y NESS-uh-sair-ee');
  assert.strictEqual(show('because'), 'be·CAUSE bih-KAWZ');
  assert.strictEqual(show('hospital'), 'HOS·pit·al HOSS-pit-uhl');
  assert.strictEqual(show('create'), 'cre·ATE kree-AYT');
});

test('gives every practice word one of five levels', () => {
  for (let l = 1; l <= 5; l++) assert.ok(engine.levelWords(l).length > 1000, `level ${l}`);
  assert.ok(engine.levelOf('cat') < engine.levelOf('necessary'));
  assert.strictEqual(engine.levelOf('david'), 0); // names are left out
});

test('prefers your spelling style (colour vs color)', () => {
  assert.strictEqual(engine.variantOf('colour'), 'gb');
  assert.strictEqual(engine.variantOf('color'), 'us');
  assert.strictEqual(top('kolor', null, 'gb'), 'colour');
  assert.strictEqual(top('kolor', null, 'us'), 'color');
  assert.strictEqual(top('fayvorit', null, 'gb'), 'favourite');
  assert.strictEqual(top('senter', null, 'us'), 'center');
});
