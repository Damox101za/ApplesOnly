'use strict';
// Builds public/defs/<letter>.json: short definitions and example sentences
// for every word in public/sound-data.json.
//
// Usage:
//   node scripts/build-definitions.js <english-wordnet-2024.xml>
//
// Source: Open English WordNet 2024 (CC BY 4.0)
//   https://github.com/globalwordnet/english-wordnet/releases/download/2024-edition/english-wordnet-2024.xml.gz
//   (gunzip it first)
//
// Output per word: { m: [[part of speech, definition, example?], ...],
//                    s: "a practice sentence with ___ for the word",
//                    f: "lemma" when the word is a form of another (ran → run) }

const fs = require('fs');
const path = require('path');

const xmlPath = process.argv[2];
if (!xmlPath) {
  console.error('Usage: node scripts/build-definitions.js <english-wordnet-2024.xml>');
  process.exit(1);
}

const MAX_MEANINGS = 3;
const MAX_DEF_LENGTH = 140;
const POS_NAMES = { n: 'noun', v: 'verb', a: 'adjective', s: 'adjective', r: 'adverb' };

const unescape = (s) =>
  s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

console.log('Reading WordNet…');
const xml = fs.readFileSync(xmlPath, 'utf8');

// ---------- Synsets: id -> definition and examples ----------
const synsets = new Map();
const synsetRe = /<Synset id="([^"]+)"[^>]*partOfSpeech="(\w)"[^>]*>([\s\S]*?)<\/Synset>/g;
let m;
while ((m = synsetRe.exec(xml))) {
  const body = m[3];
  const def = (body.match(/<Definition>([\s\S]*?)<\/Definition>/) || [])[1];
  const examples = [...body.matchAll(/<Example>([\s\S]*?)<\/Example>/g)].map((x) => unescape(x[1]).replace(/^"|"$/g, ''));
  if (def) synsets.set(m[1], { pos: m[2], def: unescape(def), examples });
}
console.log(`Synsets: ${synsets.size}`);

// ---------- Lexical entries: lemma -> senses (most common first) ----------
const lemmas = new Map(); // lowercase lemma -> [{ pos, synsets: [] }]
const formOf = new Map(); // irregular form -> lemma ("ran" -> "run")
const entryRe = /<LexicalEntry id="[^"]+">([\s\S]*?)<\/LexicalEntry>/g;
while ((m = entryRe.exec(xml))) {
  const body = m[1];
  const lemma = body.match(/<Lemma writtenForm="([^"]+)" partOfSpeech="(\w)"/);
  if (!lemma) continue;
  const word = unescape(lemma[1]);
  // Names are capitalised in WordNet ("Paris"); keep lowercase words only.
  if (!/^[a-z]+$/.test(word)) continue;
  const senses = [...body.matchAll(/<Sense id="[^"]+"[^>]*synset="([^"]+)"/g)].map((x) => x[1]);
  if (!lemmas.has(word)) lemmas.set(word, []);
  lemmas.get(word).push({ pos: lemma[2], synsets: senses });
  [...body.matchAll(/<Form writtenForm="([^"]+)"/g)].forEach((x) => {
    const f = unescape(x[1]);
    if (/^[a-z]+$/.test(f) && !formOf.has(f)) formOf.set(f, word);
  });
}
console.log(`Lemmas: ${lemmas.size}, irregular forms: ${formOf.size}`);

// ---------- Regular forms: "stopped" -> "stop", "tries" -> "try" ----------
// Based on WordNet's own "morphy" rules, plus undoubling (stopped, running).
const RULES = [
  ['ies', 'y'], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['es', 'e'], ['es', ''], ['s', ''],
  ['ied', 'y'], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', ''], ['ier', 'y'], ['iest', 'y'], ['er', 'e'], ['er', ''], ['est', 'e'], ['est', ''],
];

function baseForms(word) {
  const out = [];
  if (lemmas.has(word)) out.push(word);
  if (formOf.has(word)) out.push(formOf.get(word));
  for (const [end, to] of RULES) {
    if (!word.endsWith(end) || word.length - end.length < 2) continue;
    const stem = word.slice(0, -end.length);
    if (lemmas.has(stem + to)) out.push(stem + to);
    // Undo a doubled last letter: stopp(ed) -> stop
    if (!to && /([bdfgklmnprtz])\1$/.test(stem) && lemmas.has(stem.slice(0, -1))) out.push(stem.slice(0, -1));
  }
  return [...new Set(out)];
}

// ---------- Build output for our word list ----------
const soundData = require(path.join(__dirname, '..', 'public', 'sound-data.json'));
const ourWords = soundData.words.split('\n').map((l) => l.split(' ')[0]);

function cleanDef(def) {
  let d = def.replace(/\s+/g, ' ').trim();
  if (d.length > MAX_DEF_LENGTH) d = d.slice(0, MAX_DEF_LENGTH).replace(/[ ,;:][^ ,;:]*$/, '') + '…';
  return d;
}

// An example that uses this exact word once becomes a practice sentence.
function sentenceFrom(word, examples) {
  const re = new RegExp(`\\b${word}\\b`, 'gi');
  for (const ex of examples) {
    const hits = ex.match(re);
    if (!hits || hits.length !== 1) continue;
    if (ex.length < 15 || ex.length > 110 || /[<>]/.test(ex) || ex.split(/\s+/).length < 5) continue;
    let s = ex.replace(re, '___');
    s = s[0].toUpperCase() + s.slice(1);
    if (!/[.!?]$/.test(s)) s += '.';
    return s;
  }
  return '';
}

// Small everyday words WordNet leaves out. Many sound alike, so the meaning
// is how you tell them apart.
const FUNCTION_WORDS = {
  their: ['belonging to them', 'They left their bags here.'],
  theirs: ['the one belonging to them', 'The red car is theirs.'],
  they: ['the people or things already mentioned', 'They are coming later.'],
  them: ['the people or things already mentioned (after a verb)', 'I saw them yesterday.'],
  your: ['belonging to you', 'Is this your phone?'],
  yours: ['the one belonging to you', 'This coat is yours.'],
  its: ['belonging to it (no apostrophe)', 'The dog wagged its tail.'],
  our: ['belonging to us', 'This is our house.'],
  ours: ['the one belonging to us', 'The blue car is ours.'],
  my: ['belonging to me', 'This is my bag.'],
  mine: ['the one belonging to me', 'That pen is mine.'],
  his: ['belonging to him', 'He lost his keys.'],
  her: ['belonging to her; or that woman or girl', 'I gave her the book.'],
  hers: ['the one belonging to her', 'The idea was hers.'],
  whose: ['belonging to which person', 'Whose jacket is this?'],
  who: ['which person', 'Who is at the door?'],
  whom: ['which person (after a verb or preposition)', 'To whom did you send it?'],
  which: ['what one, out of a group', 'Which one do you want?'],
  what: ['asks for information about something', 'What time is it?'],
  where: ['in or to what place', 'Where do you live?'],
  were: ['past of "are"', 'We were late.'],
  when: ['at what time', 'When does it start?'],
  while: ['during the time that', 'I read while I wait.'],
  whether: ['if (used when there are choices)', 'I don\'t know whether to go.'],
  the: ['points to a particular thing', 'The sun is hot.'],
  and: ['joins words or ideas together', 'Bread and butter.'],
  but: ['shows a contrast', 'It is small but strong.'],
  because: ['for the reason that', 'I stayed home because it rained.'],
  than: ['used to compare things', 'She is taller than me.'],
  then: ['at that time; next', 'We ate, then we left.'],
  to: ['towards; or before a verb', 'I want to go to the shop.'],
  too: ['also; or more than enough', 'It is too hot. Me too!'],
  of: ['belonging to or part of', 'A cup of tea.'],
  off: ['away from; not on', 'Turn the light off.'],
  from: ['shows where something starts', 'A letter from my mum.'],
  with: ['together with; using', 'Come with me.'],
  would: ['used for wishes or imagined events', 'I would like some tea.'],
  could: ['was able to; might', 'Could you help me?'],
  should: ['ought to', 'You should rest.'],
  there: null, // WordNet has this one
  are: ['form of "be" for you, we and they', 'We are friends.'],
  a: ['one; any', 'A cat sat down.'],
  an: ['one; any (before a vowel sound)', 'An apple a day.'],
  for: ['meant to be given to; because of', 'This gift is for you.'],
  into: ['to the inside of', 'Get into the car.'],
  about: ['on the subject of; around', 'A book about birds.'],
  though: ['even if; however', 'It was cold, though sunny.'],
  through: ['in one side and out the other', 'We drove through the tunnel.'],
  thought: ['past of "think"; an idea', 'I thought so.'],
  threw: ['past of "throw"', 'She threw the ball.'],
};

const shards = {};
let withDefs = 0;
let withSentence = 0;
for (const word of ourWords) {
  const extra = FUNCTION_WORDS[word];
  const bases = baseForms(word);
  if (extra && !bases.length) {
    (shards[word[0]] = shards[word[0]] || {})[word] = { m: [['', extra[0], extra[1]]], s: extra[1].replace(new RegExp(`\\b${word}\\b`, 'i'), '___') };
    withDefs++;
    continue;
  }
  if (!bases.length) continue;
  // Entries with more senses tend to be the more common use of the word.
  const entries = bases
    .flatMap((b) => lemmas.get(b).map((e) => Object.assign({ base: b }, e)))
    // A form only keeps meanings that fit it: "stopped" is a verb, not the
    // noun "stop". Otherwise more senses = more common.
    .filter((e) => {
      if (e.base === word) return true;
      if (/(ed|ing)$/.test(word)) return e.pos === 'v';
      if (/(er|est)$/.test(word)) return e.pos === 'a' || e.pos === 's';
      return e.pos === 'n' || e.pos === 'v';
    })
    .sort((a, b) => b.synsets.length - a.synsets.length);
  const meanings = [];
  const allExamples = [];
  const seenDefs = new Set();
  // Take the top sense of each part of speech first, then second senses.
  for (let round = 0; round < 3 && meanings.length < MAX_MEANINGS; round++) {
    for (const e of entries) {
      const id = e.synsets[round];
      const ss = id && synsets.get(id);
      if (!ss || seenDefs.has(ss.def) || meanings.length >= MAX_MEANINGS) continue;
      seenDefs.add(ss.def);
      // Only examples that use this word (or its base form) help.
      const uses = new RegExp(`\\b(${word}|${e.base})`, 'i');
      const ex = ss.examples.find((x) => x.length <= 110 && uses.test(x)) || '';
      meanings.push(ex ? [POS_NAMES[ss.pos], cleanDef(ss.def), ex] : [POS_NAMES[ss.pos], cleanDef(ss.def)]);
    }
  }
  entries.forEach((e) => e.synsets.slice(0, 4).forEach((id) => synsets.get(id) && allExamples.push(...synsets.get(id).examples)));
  if (!meanings.length) continue;
  const out = { m: meanings };
  const s = sentenceFrom(word, allExamples);
  if (s) {
    out.s = s;
    withSentence++;
  }
  if (bases[0] !== word) out.f = bases[0];
  const shard = word[0];
  (shards[shard] = shards[shard] || {})[word] = out;
  withDefs++;
}

// Practice words must have a meaning: this drops slang like "wanna" and
// odd entries from practice (they can still be found with Sound it out).
// It updates the flags in public/sound-data.json, so run this script after
// build-sound-data.js.
const hasMeaning = new Set(Object.values(shards).flatMap((o) => Object.keys(o)));
let dropped = 0;
soundData.words = soundData.words
  .split('\n')
  .map((line) => {
    const parts = line.split(' ');
    if (parts[2] && parts[2].includes('p') && !hasMeaning.has(parts[0])) {
      parts[2] = parts[2].replace('p', '').replace(/[1-5]/, '');
      dropped++;
      return parts[2] ? parts.join(' ') : parts.slice(0, 2).join(' ');
    }
    return line;
  })
  .join('\n');
fs.writeFileSync(path.join(__dirname, '..', 'public', 'sound-data.json'), JSON.stringify(soundData));
console.log(`Removed ${dropped} words without a meaning from practice`);

const outDir = path.join(__dirname, '..', 'public', 'defs');
fs.mkdirSync(outDir, { recursive: true });
let total = 0;
for (const [letter, entries] of Object.entries(shards)) {
  const file = path.join(outDir, `${letter}.json`);
  fs.writeFileSync(file, JSON.stringify(entries));
  total += fs.statSync(file).size;
}
fs.writeFileSync(
  path.join(outDir, 'ABOUT.txt'),
  'Definitions and examples from Open English WordNet 2024 (https://github.com/globalwordnet/english-wordnet),\n' +
    'licensed CC BY 4.0. Generated by scripts/build-definitions.js.\n'
);
console.log(`Words with meanings: ${withDefs} of ${ourWords.length}; with practice sentences: ${withSentence}`);
console.log(`Wrote ${Object.keys(shards).length} files, ${(total / 1024).toFixed(0)} KB total`);

['necessary', 'running', 'stopped', 'ran', 'their', 'there', 'definitely', 'separate', 'knowledge', 'colour', 'tries', 'its', 'too', 'whether', 'weather'].forEach((w) => {
  const e = shards[w[0]] && shards[w[0]][w];
  console.log(w.padEnd(11), e ? JSON.stringify(e) : '(none)');
});
