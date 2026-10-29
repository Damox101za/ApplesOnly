'use strict';
// Builds public/sound-data.json: the word list and the learned
// "how is each sound spelled" table used by public/sound-engine.js.
//
// Usage:
//   node scripts/build-sound-data.js <cmudict.dict> <en_50k.txt>
//
// Sources (download them first):
//   CMU Pronouncing Dictionary (BSD-style licence)
//     https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict
//   FrequencyWords by Hermit Dave (content CC BY-SA 4.0)
//     https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt
//
// How it learns: every word is a row of sounds (phonemes) and a row of
// letters. We split the letters into chunks, one chunk per sound, so that
// "phone" = ph·o·ne for F·OW·N. Which split is right? We start with a rough
// guess (single letters, vowels with vowel sounds) and repeat:
//   1. split every word in the most likely way under the current odds
//   2. count how often each sound got each chunk, and turn counts into odds
// After a few rounds the odds settle. This is "hard EM" (Viterbi training).

const fs = require('fs');
const path = require('path');

const [cmuPath, freqPath] = process.argv.slice(2);
if (!cmuPath || !freqPath) {
  console.error('Usage: node scripts/build-sound-data.js <cmudict.dict> <en_50k.txt>');
  process.exit(1);
}

const MAX_WORDS = 30000;
const MAX_CHUNK = 4;
const ITERATIONS = 6;
const MIN_COUNT = 2;
const VOWEL_LETTERS = /[aeiouy]/;

// Two sounds that are often written with one letter, like x = K S.
const PAIR_UNITS = new Set(['K S', 'G Z', 'K SH', 'Y UW1', 'Y UW0', 'Y UH1', 'Y UH0', 'Y AH0', 'Y ER0', 'Y ER1']);

// Vowels keep only "stressed" (1) or "unstressed" (0): unstressed vowels are
// the vague "uh" sounds that cause so many spelling mistakes.
function unitOf(ph) {
  const m = ph.match(/^([A-Z]+)([0-2])?$/);
  if (!m) return null;
  return m[2] === undefined ? m[1] : m[1] + (m[2] === '0' ? '0' : '1');
}

const isVowelUnit = (u) => /[01]$/.test(u);

// ---------- Load ----------
const freq = new Map();
fs.readFileSync(freqPath, 'utf8')
  .split('\n')
  .forEach((line) => {
    const [w, c] = line.trim().split(/\s+/);
    if (w && /^[a-z]+$/.test(w) && !freq.has(w)) freq.set(w, Number(c));
  });

const prons = new Map();
fs.readFileSync(cmuPath, 'utf8')
  .split('\n')
  .forEach((line) => {
    line = line.replace(/#.*/, '').trim();
    if (!line) return;
    const [head, ...phs] = line.split(/\s+/);
    const word = head.replace(/\(\d+\)$/, '');
    if (!/^[a-z]+$/.test(word)) return;
    const units = phs.map(unitOf);
    if (units.some((u) => !u)) return;
    if (!prons.has(word)) prons.set(word, []);
    const list = prons.get(word);
    if (list.length < 2) list.push(units);
  });

let words = [...freq.entries()]
  // Skip letter-only abbreviations like "tv" and "dr".
  .filter(([w]) => prons.has(w) && /[aeiouy]/.test(w) && (w.length > 1 || w === 'a' || w === 'i'))
  .sort((a, b) => b[1] - a[1])
  .slice(0, MAX_WORDS)
  .map(([w, c]) => ({ word: w, count: c, prons: prons.get(w) }));

console.log(`Words kept: ${words.length}`);

// ---------- Alignment ----------
// Letters a sound is normally written with. A chunk must contain one of them
// (so "kn" can be N, but "k" alone can't). Vowel sounds take vowel letters.
const SOUND_LETTERS = {
  B: 'b', CH: 'ct', D: 'd', DH: 't', F: 'fpg', G: 'gx', HH: 'hwj', JH: 'jgd', K: 'ckqxg', L: 'l',
  M: 'm', N: 'n', NG: 'n', P: 'p', R: 'rw', S: 'sczx', SH: 'scth', T: 'td', TH: 't', V: 'vf',
  W: 'wuo', Y: 'yiju', Z: 'zsx', ZH: 'szgjt',
};

function fits(unit, chunk) {
  const parts = unit.split(' ');
  const last = parts[parts.length - 1];
  if (parts.length === 2) return /[aeiouyx]/.test(chunk);
  if (isVowelUnit(last)) {
    if (chunk === '') return /^(AH0|ER0|IH0)$/.test(last); // "people": no letter for the uh
    // Vowel sounds: start with a vowel letter; only w, y, h, gh may follow
    // (aw, ay, oh, igh); r only for the "er" sound.
    const extra = /^ER/.test(last) ? /^[aeiouy][aeiouywhr]*$|^r[e]?$/ : /^[aeiouy]([aeiouywh]|gh)*$/;
    return extra.test(chunk);
  }
  if (chunk === '') return false;
  const letters = SOUND_LETTERS[last] || '';
  if (![...chunk].some((c) => letters.includes(c))) return false;
  // Consonant sounds: no vowel letters, except a silent e at the end (te),
  // u after g or q (guess), and vowels for the w and y sounds (one, use).
  if (/^(W|Y|HH)$/.test(last)) return true;
  return /^[^aeiouy]*(e|ue)?$/.test(chunk.replace(/^([gq])u/, '$1'));
}

// Rules that hold in every round, on top of the learned odds.
function structure(unit, chunk, next) {
  let s = Math.log([0.05, 1, 0.3, 0.1, 0.03][chunk.length]);
  if (!fits(unit, chunk)) s -= 8;
  // A silent e before another vowel is rare: "ce|i" should be "c|ei".
  if (chunk.length > 1 && chunk.endsWith('e') && next && VOWEL_LETTERS.test(next)) s -= 3;
  return s;
}

let table = null; // unit -> Map(chunk -> logp)

function score(unit, chunk, next) {
  const base = structure(unit, chunk, next);
  if (!table) return base;
  const m = table.get(unit);
  const v = m && m.get(chunk);
  return (v === undefined ? -12 : v) + base;
}

// Best split of letters into one chunk per unit (Viterbi).
function align(units, letters) {
  const n = units.length;
  const L = letters.length;
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(L + 1).fill(-Infinity));
  const back = Array.from({ length: n + 1 }, () => new Array(L + 1).fill(null));
  dp[0][0] = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= L; j++) {
      if (dp[i][j] === -Infinity) continue;
      const steps = [[units[i], 1]];
      if (i + 1 < n && PAIR_UNITS.has(units[i] + ' ' + units[i + 1])) steps.push([units[i] + ' ' + units[i + 1], 2]);
      for (const [unit, used] of steps) {
        for (let k = 0; k <= MAX_CHUNK && j + k <= L; k++) {
          const s = dp[i][j] + score(unit, letters.slice(j, j + k), letters[j + k]);
          if (s > dp[i + used][j + k]) {
            dp[i + used][j + k] = s;
            back[i + used][j + k] = [i, j, unit];
          }
        }
      }
    }
  }
  if (dp[n][L] === -Infinity) return null;
  const pairs = [];
  let i = n;
  let j = L;
  while (i > 0) {
    const [pi, pj, unit] = back[i][j];
    pairs.unshift([unit, letters.slice(pj, j)]);
    i = pi;
    j = pj;
  }
  return { score: dp[n][L], pairs };
}

let counts;
for (let it = 0; it < ITERATIONS; it++) {
  counts = new Map();
  let failed = 0;
  let irregular = 0;
  for (const w of words) {
    // Use the most likely pronunciation for this spelling.
    let best = null;
    for (const units of w.prons) {
      const a = align(units, w.word);
      if (a && (!best || a.score > best.score)) best = a;
    }
    if (!best) {
      failed++;
      continue;
    }
    w.alignment = best.pairs;
    // Words that break the letter rules (abbreviations, "one") are still
    // searchable, but they don't teach the odds.
    if (best.pairs.some(([unit, chunk]) => !fits(unit, chunk))) {
      irregular++;
      continue;
    }
    for (const [unit, chunk] of best.pairs) {
      if (!counts.has(unit)) counts.set(unit, new Map());
      const m = counts.get(unit);
      m.set(chunk, (m.get(chunk) || 0) + 1);
    }
  }
  table = new Map();
  for (const [unit, m] of counts) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const lm = new Map();
    for (const [chunk, c] of m) lm.set(chunk, Math.log((c + 0.1) / (total + 1)));
    table.set(unit, lm);
  }
  console.log(`Round ${it + 1}: ${failed} words could not be split, ${irregular} irregular`);
}

// ---------- Output ----------
// Phonemes get one-character codes so the word list stays small.
const allUnits = new Set();
words.forEach((w) => w.prons.forEach((p) => p.forEach((u) => allUnits.add(u))));
const unitList = [...allUnits].sort();
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
if (unitList.length > CODE_CHARS.length) throw new Error('Too many sounds to encode');
const codeOf = new Map(unitList.map((u, i) => [u, CODE_CHARS[i]]));

const outTable = {};
for (const [unit, m] of counts) {
  const entries = [...m.entries()].filter(([, c]) => c >= MIN_COUNT).sort((a, b) => b[1] - a[1]);
  if (entries.length) outTable[unit] = Object.fromEntries(entries);
}

const lines = words
  .filter((w) => w.alignment)
  .map((w) => `${w.word} ${w.prons.map((p) => p.map((u) => codeOf.get(u)).join('')).join(',')}`);

const out = {
  about: 'Generated by scripts/build-sound-data.js from the CMU Pronouncing Dictionary (CMU, BSD-style licence) and FrequencyWords by Hermit Dave (CC BY-SA 4.0). Words are sorted from most to least common.',
  units: unitList,
  pairs: [...PAIR_UNITS],
  table: outTable,
  words: lines.join('\n'),
};

const outPath = path.join(__dirname, '..', 'public', 'sound-data.json');
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);

// A few sample splits, to eyeball that learning worked.
['phone', 'necessary', 'knight', 'thought', 'box', 'music', 'definitely', 'receive', 'separate', 'write', 'because', 'beautiful', 'question', 'nation', 'enough', 'business', 'people', 'friend', 'island', 'tomorrow'].forEach((s) => {
  const w = words.find((x) => x.word === s);
  if (w && w.alignment) console.log(s.padEnd(12), w.alignment.map(([u, c]) => `${c}=${u}`).join(' · '));
});
['S', 'F', 'K', 'N', 'AH0', 'IY1', 'SH', 'EY1', 'AY1'].forEach((u) => {
  const m = outTable[u];
  const total = Object.values(m).reduce((a, b) => a + b, 0);
  console.log(u.padEnd(4), Object.entries(m).slice(0, 6).map(([c, n]) => `${c} ${Math.round((n / total) * 100)}%`).join(', '));
});
