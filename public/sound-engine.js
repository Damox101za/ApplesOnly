'use strict';

// Sound-it-out engine: finds the word you meant from a spelling that
// "sounds right", and explains how each sound in it is spelled.
//
// The maths is Bayes' rule (the "noisy channel" model):
//
//   best word = the word w with the highest  P(w) × P(typed | w)
//
//   P(w)          how common the word is (from its frequency rank)
//   P(typed | w)  how likely you'd type these letters for w's sounds:
//                 the product, over w's sounds, of P(your chunk | sound),
//                 found with dynamic programming over every way of
//                 splitting your letters into one chunk per sound.
//
// P(chunk | sound) is learned from a pronunciation dictionary by
// scripts/build-sound-data.js, then blended with your own habits:
//
//   P_you(chunk | sound) = (your count + α · P_english) / (your total + α)
//
// Works in the browser (window.SoundEngine) and in Node (require).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SoundEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_CHUNK = 4;
  const USER_ALPHA = 30; // how many of your answers it takes to outweigh "average English"
  const VOWELS = /[aeiouy]/;
  const SOFT_VOWELS = new Set(['AH0', 'IH0', 'ER0']);

  // Costs (log probabilities) for things the learned table doesn't cover.
  const COST_UNKNOWN_LETTER = -9; // one letter that isn't a known spelling of the sound
  const COST_EXTRA_LETTER = -8; // a letter that belongs to no sound
  const COST_DROPPED_SOUND = -8; // a sound with no letters
  const COST_TYPO_EDIT = -3.5; // per letter edit, for plain typos ("teh")
  const STYLE_COST = Math.log(0.05); // US spelling when you use UK spelling (or the other way)

  const SOUND_NAMES = {
    AA: 'o as in "hot"', AE: 'a as in "cat"', AH: 'u as in "cup"', AO: 'aw as in "saw"',
    AW: 'ow as in "cow"', AY: 'i as in "bike"', EH: 'e as in "bed"', ER: 'er as in "her"',
    EY: 'a as in "cake"', IH: 'i as in "sit"', IY: 'ee as in "see"', OW: 'o as in "go"',
    OY: 'oy as in "boy"', UH: 'oo as in "book"', UW: 'oo as in "moon"',
    B: 'b', CH: 'ch as in "chip"', D: 'd', DH: 'th as in "this"', F: 'f', G: 'g as in "go"',
    HH: 'h', JH: 'j as in "jam"', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ng as in "sing"',
    P: 'p', R: 'r', S: 's', SH: 'sh', T: 't', TH: 'th as in "thin"', V: 'v', W: 'w',
    Y: 'y as in "yes"', Z: 'z', ZH: 's as in "vision"',
  };
  const PAIR_NAMES = { 'K S': 'ks', 'G Z': 'gz', 'K SH': 'ksh' };

  function soundName(unit) {
    if (PAIR_NAMES[unit]) return PAIR_NAMES[unit];
    const parts = unit.split(' ');
    if (parts.length === 2 && parts[0] === 'Y') return 'yoo as in "use"';
    if (unit === 'AH0') return 'soft "uh" (the a in "about")';
    if (unit === 'IH0') return 'soft "i" (the e in "begin")';
    if (unit === 'ER0') return 'soft "er" (the er in "water")';
    return SOUND_NAMES[unit.replace(/[01]$/, '')] || unit;
  }

  const isSoft = (unit) => SOFT_VOWELS.has(unit) || unit.endsWith(' AH0') || unit.endsWith(' ER0');

  function logaddexp(a, b) {
    if (a === -Infinity) return b;
    if (b === -Infinity) return a;
    const m = Math.max(a, b);
    return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
  }

  function cleanLetters(text) {
    return String(text || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  // Damerau-Levenshtein distance with an early exit above `max`.
  function editDistance(a, b, max = 4) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      let rowMin = Infinity;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
        rowMin = Math.min(rowMin, d[i][j]);
      }
      if (rowMin > max) return max + 1;
    }
    return d[a.length][b.length];
  }

  function emptyUserModel() {
    return { counts: {}, totals: {}, patterns: {} };
  }

  function create(raw) {
    const pairs = new Set(raw.pairs);
    const codeToUnit = new Map(raw.units.map((u, i) => [
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[i], u,
    ]));

    // P(chunk | sound) from the learned counts.
    const prob = new Map(); // unit -> Map(chunk -> p)
    const topChunk = new Map(); // unit -> [chunk, p]
    const firstLetters = new Map(); // unit -> Set of letters a spelling can start with
    Object.entries(raw.table).forEach(([unit, chunks]) => {
      const total = Object.values(chunks).reduce((a, b) => a + b, 0);
      const m = new Map();
      const starts = new Set();
      Object.entries(chunks).forEach(([chunk, c]) => {
        m.set(chunk, c / total);
        if (chunk) starts.add(chunk[0]);
      });
      prob.set(unit, m);
      firstLetters.set(unit, starts);
      const best = Object.entries(chunks).sort((a, b) => b[1] - a[1])[0];
      topChunk.set(unit, [best[0], best[1] / total]);
    });

    // Line format: word sounds[:stress][,sounds[:stress]] [flags]
    // flags: p = fine for practice, u = US-only, g = UK-only, 1-5 = level.
    const words = raw.words.split('\n').map((line, rank) => {
      const [word, codes, flags = ''] = line.split(' ');
      const prons = codes.split(',').map((c) => {
        const [sounds, stress] = c.split(':');
        const units = [...sounds].map((ch) => codeToUnit.get(ch));
        units.primary = stress === undefined ? -1 : Number(stress);
        return units;
      });
      const level = Number((flags.match(/[1-5]/) || [0])[0]);
      const variant = flags.includes('u') ? 'us' : flags.includes('g') ? 'gb' : '';
      return { word, rank, prons, logPrior: -Math.log(rank + 20), practice: flags.includes('p'), level, variant };
    });
    const byWord = new Map(words.map((w) => [w.word, w]));

    // UK and US spellings of the same word: colour/color, realise/realize,
    // centre/center, catalogue/catalog, defence/defense, travelled/traveled.
    const TWIN_RULES = [
      [/or(s|ed|ing|ful|ite)?$/, 'our$1'], [/our(s|ed|ing|ful|ite)?$/, 'or$1'],
      [/iz(e|es|ed|ing|ation|ations)$/, 'is$1'], [/is(e|es|ed|ing|ation|ations)$/, 'iz$1'],
      [/yz(e|es|ed|ing)$/, 'ys$1'], [/ys(e|es|ed|ing)$/, 'yz$1'],
      [/er(s)?$/, 're$1'], [/re(s)?$/, 'er$1'], [/og(s)?$/, 'ogue$1'], [/ogue(s)?$/, 'og$1'],
      [/ense(s)?$/, 'ence$1'], [/ence(s)?$/, 'ense$1'], [/l(ed|ing|er|ers)$/, 'll$1'], [/ll(ed|ing|er|ers)$/, 'l$1'],
    ];
    function twinOf(word, style) {
      for (const [re, to] of TWIN_RULES) {
        if (!re.test(word)) continue;
        const t = byWord.get(word.replace(re, to));
        if (t && t.variant === style) return t;
      }
      return null;
    }

    function pGeneral(unit, chunk) {
      const m = prob.get(unit);
      return (m && m.get(chunk)) || 0;
    }

    function chunkLogP(unit, chunk, user) {
      const pg = pGeneral(unit, chunk);
      let p = pg;
      if (user && user.totals[unit]) {
        const n = (user.counts[unit] && user.counts[unit][chunk]) || 0;
        p = (n + USER_ALPHA * pg) / (user.totals[unit] + USER_ALPHA);
      }
      if (p > 0) return Math.log(p);
      if (chunk === '') return COST_DROPPED_SOUND;
      if (chunk.length === 1) return COST_UNKNOWN_LETTER;
      return null; // unknown multi-letter chunk: build it from smaller steps
    }

    // Viterbi: best way to split `letters` into one chunk per sound.
    // Returns { score, rows: [{ unit, chunk, start }] }.
    function alignLetters(units, letters, user) {
      const n = units.length;
      const L = letters.length;
      const dp = Array.from({ length: n + 1 }, () => new Float64Array(L + 1).fill(-Infinity));
      const back = Array.from({ length: n + 1 }, () => new Array(L + 1));
      dp[0][0] = 0;
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= L; j++) {
          const cur = dp[i][j];
          if (cur === -Infinity) continue;
          // A letter that belongs to no sound (an extra letter).
          if (j < L && cur + COST_EXTRA_LETTER > dp[i][j + 1]) {
            dp[i][j + 1] = cur + COST_EXTRA_LETTER;
            back[i][j + 1] = [i, j, null];
          }
          if (i === n) continue;
          const steps = [[units[i], 1]];
          if (i + 1 < n && pairs.has(units[i] + ' ' + units[i + 1])) steps.push([units[i] + ' ' + units[i + 1], 2]);
          for (const [unit, used] of steps) {
            for (let k = 0; k <= MAX_CHUNK && j + k <= L; k++) {
              const lp = chunkLogP(unit, letters.slice(j, j + k), user);
              if (lp === null) continue;
              const s = cur + lp;
              if (s > dp[i + used][j + k]) {
                dp[i + used][j + k] = s;
                back[i + used][j + k] = [i, j, unit];
              }
            }
          }
        }
      }
      const score = dp[n][L];
      if (score === -Infinity) return null;
      const rows = [];
      let i = n;
      let j = L;
      while (i > 0 || j > 0) {
        const [pi, pj, unit] = back[i][j];
        if (unit === null) {
          // Extra letter: glue it onto the next sound's chunk for display.
          if (rows.length) {
            rows[0].chunk = letters[pj] + rows[0].chunk;
            rows[0].extra = (rows[0].extra || '') + letters[pj];
          } else {
            rows.unshift({ unit: '', chunk: letters[pj], start: pi, extra: letters[pj] });
          }
        } else {
          rows.unshift({ unit, chunk: letters.slice(pj, j), start: pi });
        }
        i = pi;
        j = pj;
      }
      return { score, rows };
    }

    // log P(typed | w): sound channel and plain-typo channel, added together.
    function channel(typed, entry, user) {
      let bestPhon = -Infinity;
      let bestPron = entry.prons[0];
      for (const units of entry.prons) {
        const a = alignLetters(units, typed, user);
        if (a && a.score > bestPhon) {
          bestPhon = a.score;
          bestPron = units;
        }
      }
      const d = editDistance(typed, entry.word, 3);
      const typo = d <= 3 ? COST_TYPO_EDIT * d : -Infinity;
      return { score: logaddexp(bestPhon, typo), units: bestPron, phon: bestPhon, typo };
    }

    // Quick checks so we only run the full maths on plausible words.
    function plausible(typed, entry) {
      const w = entry.word;
      if (w.length < typed.length * 0.5 - 1 || w.length > typed.length * 1.7 + 2) return false;
      if (w[0] === typed[0]) return true;
      return entry.prons.some((units) => {
        const starts = firstLetters.get(units[0]);
        return starts && starts.has(typed[0]);
      });
    }

    function find(text, opts = {}) {
      const typed = cleanLetters(text);
      if (!typed) return [];
      const limit = opts.limit || 6;
      const user = opts.user || null;
      const style = opts.style || ''; // 'gb' or 'us': the other spelling ranks lower
      const scored = [];
      for (const entry of words) {
        if (!plausible(typed, entry)) continue;
        const c = channel(typed, entry, user);
        if (c.score === -Infinity) continue;
        const raw = entry.logPrior + c.score;
        const other = style && entry.variant && entry.variant !== style;
        const twin = other ? twinOf(entry.word, style) : null;
        // A US word with a UK twin (or the other way) hands its match to
        // the twin: "kolor" means colour for UK users, color for US users.
        if (twin) scored.push({ word: twin.word, score: raw, variant: twin.variant });
        else scored.push({ word: entry.word, score: raw + (other ? STYLE_COST : 0), variant: entry.variant });
      }
      // Merge duplicates (a twin found both ways) by adding their chances.
      const merged = new Map();
      scored.forEach((r) => {
        const prev = merged.get(r.word);
        merged.set(r.word, prev ? Object.assign(prev, { score: logaddexp(prev.score, r.score) }) : r);
      });
      scored.length = 0;
      scored.push(...merged.values());
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, Math.max(limit, 10));
      // Turn scores into "how sure" percentages over the top matches (the
      // posterior from Bayes' rule, normalised over the shortlist).
      const max = top.length ? top[0].score : 0;
      const z = top.reduce((sum, r) => sum + Math.exp(r.score - max), 0);
      return top.slice(0, limit).map((r) => ({
        word: r.word,
        chance: Math.exp(r.score - max) / z,
        exact: r.word === typed,
        variant: r.variant,
      }));
    }

    function bestPronFor(entry) {
      let best = null;
      for (const units of entry.prons) {
        const a = alignLetters(units, entry.word, null);
        if (a && (!best || a.score > best.a.score)) best = { units, a };
      }
      return best;
    }

    // Sound-by-sound comparison of what you typed and the real spelling.
    function explain(text, word, user) {
      const entry = byWord.get(word);
      if (!entry) return null;
      const typed = cleanLetters(text);
      const right = bestPronFor(entry);
      if (!right) return null;
      const units = right.units;
      const yours = typed ? alignLetters(units, typed, user) : null;

      // Group sound positions so pair units (x = k+s) line up on both sides.
      const groups = [];
      const groupOf = new Array(units.length);
      const addRows = (rows) => rows.forEach((r) => {
        if (!r.unit) return;
        const span = r.unit.split(' ').length;
        let g = groupOf[r.start];
        for (let k = 1; k < span; k++) {
          const other = groupOf[r.start + k];
          if (other !== undefined && other !== g) {
            if (g === undefined) g = other;
            else {
              groups[g].from = Math.min(groups[g].from, groups[other].from);
              groups[g].to = Math.max(groups[g].to, groups[other].to);
              groups[other].merged = g;
            }
          }
        }
        if (g === undefined) {
          g = groups.length;
          groups.push({ from: r.start, to: r.start + span - 1 });
        }
        for (let k = 0; k < span; k++) groupOf[r.start + k] = g;
        groups[g].from = Math.min(groups[g].from, r.start);
        groups[g].to = Math.max(groups[g].to, r.start + span - 1);
      });
      addRows(right.a.rows);
      if (yours) addRows(yours.rows);
      const resolve = (g) => (groups[g].merged !== undefined ? resolve(groups[g].merged) : g);

      const rowsByGroup = new Map();
      const put = (rows, key) => rows.forEach((r) => {
        if (!r.unit) return;
        const g = resolve(groupOf[r.start]);
        if (!rowsByGroup.has(g)) rowsByGroup.set(g, { right: [], yours: [], units: [] });
        const slot = rowsByGroup.get(g);
        slot[key].push(r.chunk);
        if (key === 'right') slot.units.push(r.unit);
      });
      put(right.a.rows, 'right');
      if (yours) put(yours.rows, 'yours');

      const out = [...rowsByGroup.entries()]
        .sort((a, b) => groups[a[0]].from - groups[b[0]].from)
        .map(([, slot]) => {
          const unit = slot.units.join(' ');
          const rightChunk = slot.right.join('');
          const yourChunk = yours ? slot.yours.join('') : null;
          const single = slot.units.length === 1 ? slot.units[0] : null;
          const [top, topP] = single ? topChunk.get(single) || ['', 0] : ['', 0];
          return {
            unit,
            sound: slot.units.map(soundName).join(' + '),
            right: rightChunk,
            yours: yourChunk,
            ok: yourChunk === null || yourChunk === rightChunk,
            share: single ? pGeneral(single, rightChunk) : null,
            usual: top,
            usualShare: topP,
            soft: slot.units.some(isSoft),
          };
        });

      out.forEach((row, idx) => {
        row.tip = row.ok ? '' : tipFor(row, out[idx + 1], word);
      });
      return { word, sounds: out, parts: wordParts(word) };
    }

    function pct(p) {
      if (p >= 0.995) return 'nearly all';
      const v = Math.round(p * 100);
      return v < 1 ? 'under 1%' : `${v}%`;
    }

    // Plain-English advice for one sound you spelled differently.
    function tipFor(row, next, word) {
      const r = row.right;
      const y = row.yours || '';
      const nextLetter = next ? next.right[0] : '';
      const tips = [];
      if (/^c/.test(r) && row.unit === 'S' && /[eiy]/.test(nextLetter || r[1] || '')) {
        tips.push('c makes an "s" sound before e, i or y (city, cent, cycle).');
      }
      if (r === 'ck') tips.push('"ck" comes straight after a short vowel (back, sick, lock).');
      if (/^(.)\1$/.test(r) && y.length === 1) tips.push(`This sound is written with a double "${r[0]}" here.`);
      if (/^(.)\1$/.test(y) && r.length === 1) tips.push(`Only one "${r}" here, not two.`);
      if ((r === 'ie' || r === 'ei') && (y === 'ie' || y === 'ei')) {
        tips.push(r === 'ei' && /c$/.test(word.slice(0, word.indexOf('ei')))
          ? '"i before e, except after c": after c it\'s "ei".'
          : r === 'ie' ? '"i before e" (except after c): here it\'s "ie".' : 'This word breaks the "i before e" rule.');
      }
      if (row.unit === 'SH' && r === 't' && /ion/.test(word)) tips.push('The "shun" ending is usually spelled -tion.');
      if (r === 'ph') tips.push('"ph" makes an "f" sound, mostly in words from Greek (phone, photo).');
      if (/^(kn|wr|gn|mb)$/.test(r)) tips.push(`"${r}" has a silent letter: you only hear the ${r === 'mb' ? 'm' : r[1]}.`);
      if (row.soft) {
        tips.push('This vowel is a soft "uh" when spoken, so it can be any vowel. Say the word slowly and stretch it out, or think of a related word where you hear it clearly.');
      }
      if (!tips.length && row.share !== null) {
        tips.push(row.usual === r
          ? `"${r}" is the most common spelling of this sound (${pct(row.share)} of words).`
          : `This sound is usually "${row.usual}" (${pct(row.usualShare)} of words), but here it's "${r}" (${pct(row.share)}).`);
      }
      return tips.join(' ');
    }

    // ---------- Word parts (morphology) ----------
    const PREFIXES = ['un', 'dis', 'mis', 're', 'pre', 'in', 'im', 'il', 'ir', 'over', 'under', 'inter', 'non'];
    const SUFFIXES = ['ness', 'ment', 'ful', 'less', 'able', 'ible', 'ing', 'ed', 'ly', 'er', 'est', 'ous', 'ation', 'ion', 'ity', 'ist', 'al', 'es', 's'];
    const isWord = (w) => w.length >= 3 && byWord.has(w);

    function splitSuffix(word) {
      for (const suf of SUFFIXES) {
        if (!word.endsWith(suf) || word.length - suf.length < 3) continue;
        const stem = word.slice(0, -suf.length);
        const vowelSuffix = /^[aeiouy]/.test(suf);
        // "making" could be mak+ing or make+ing: take the more common base.
        const withE = vowelSuffix && isWord(stem + 'e');
        if (isWord(stem) && !(withE && byWord.get(stem + 'e').rank < byWord.get(stem).rank)) {
          return { base: stem, suffix: suf, note: '' };
        }
        if (withE) {
          return { base: stem + 'e', suffix: suf, note: `drop the e from "${stem}e" before -${suf}` };
        }
        if (vowelSuffix && /([bdfglmnprtz])\1$/.test(stem) && isWord(stem.slice(0, -1))) {
          return { base: stem.slice(0, -1), suffix: suf, note: `double the last "${stem.slice(-1)}" before -${suf}` };
        }
        if (stem.endsWith('i') && suf !== 'ing' && isWord(stem.slice(0, -1) + 'y')) {
          return { base: stem.slice(0, -1) + 'y', suffix: suf, note: `y changes to i before -${suf}` };
        }
        if (suf === 'ly' && stem.endsWith('u') && isWord(stem + 'e')) {
          return { base: stem + 'e', suffix: suf, note: `"${stem}e" drops its e: ${word}` };
        }
      }
      return null;
    }

    function wordParts(word) {
      // Endings first (really = real + ly, not re + ally), then a prefix.
      let rest = word;
      const tail = [];
      for (let depth = 0; depth < 3; depth++) {
        const s = splitSuffix(rest);
        if (!s) break;
        tail.unshift({ text: s.suffix, kind: 'suffix', note: s.note });
        rest = s.base;
      }
      const head = [];
      for (const pre of PREFIXES) {
        const after = rest.slice(pre.length);
        if (rest.startsWith(pre) && after.length >= 4 && isWord(after)) {
          const doubled = after[0] === pre[pre.length - 1];
          head.push({ text: pre, kind: 'prefix', note: doubled ? `keep both "${after[0]}"s: ${pre} + ${after}` : '' });
          rest = after;
          break;
        }
      }
      if (!head.length && !tail.length) return [];
      return [...head, { text: rest, kind: 'base', note: '' }, ...tail];
    }

    // ---------- Syllables and "say it" respelling ----------
    // Splits a word into spoken parts (nec·es·sar·y) using its sounds, and
    // writes each part the way it sounds (NESS-uh-sair-ee), like a dictionary.
    const isVowel = (u) => /[01]$/.test(u);
    const SHORT_STRESSED = new Set(['AE1', 'EH1', 'IH1', 'AA1', 'AH1', 'UH1']);
    const ONSET_2 = new Set(['P R', 'B R', 'T R', 'D R', 'K R', 'G R', 'F R', 'TH R', 'SH R', 'P L', 'B L', 'K L', 'G L', 'F L', 'S L',
      'S P', 'S T', 'S K', 'S M', 'S N', 'S W', 'T W', 'K W', 'D W', 'G W']);
    const CONS_SAY = { B: 'b', CH: 'ch', D: 'd', DH: 'th', F: 'f', G: 'g', HH: 'h', JH: 'j', K: 'k', L: 'l', M: 'm', N: 'n',
      NG: 'ng', P: 'p', R: 'r', S: 's', SH: 'sh', T: 't', TH: 'th', V: 'v', W: 'w', Y: 'y', Z: 'z', ZH: 'zh' };
    const VOWEL_SAY = { // [open syllable, closed syllable]
      AA: ['ah', 'o'], AE: ['a', 'a'], AH: ['uh', 'u'], AO: ['aw', 'aw'], AW: ['ow', 'ow'], AY: ['eye', 'y'],
      EH: ['eh', 'e'], ER: ['ur', 'ur'], EY: ['ay', 'ay'], IH: ['ih', 'i'], IY: ['ee', 'ee'], OW: ['oh', 'oh'],
      OY: ['oy', 'oy'], UH: ['uu', 'uu'], UW: ['oo', 'oo'],
    };
    const R_SAY = { AA: 'ar', AE: 'arr', AH: 'ur', AO: 'or', AW: 'owr', AY: 'ire', EH: 'air', EY: 'air', IH: 'eer',
      IY: 'eer', OW: 'or', UH: 'oor', UW: 'oor' };

    function sayPart(units, stressed) {
      const v = units.findIndex(isVowel);
      if (v === -1) return units.map((u) => CONS_SAY[u] || '').join('');
      const onset = units.slice(0, v).map((u) => CONS_SAY[u] || '');
      let coda = units.slice(v + 1);
      const vowel = units[v].replace(/[01]$/, '');
      let middle;
      if (coda[0] === 'R' && R_SAY[vowel]) {
        middle = R_SAY[vowel];
        coda = coda.slice(1);
      } else if (units[v] === 'AH0' || units[v] === 'ER0') {
        middle = units[v] === 'AH0' ? 'uh' : 'er';
      } else {
        const [open, closed] = VOWEL_SAY[vowel] || ['', ''];
        middle = coda.length ? closed : open;
        if (vowel === 'AY' && !onset.length) middle = 'eye';
      }
      let codaSay = coda.map((u) => CONS_SAY[u] || '').join('');
      // Make short vowels read right: "NESS" not "NES", "byke" for bike.
      if (codaSay === 's' && /^(e|i|a|u|o)$/.test(middle)) codaSay = 'ss';
      if (vowel === 'AY' && middle === 'y' && coda.length === 1) codaSay += 'e';
      let out = onset.join('') + middle + codaSay;
      out = out.replace(/g(?=[eiy])/g, 'gh');
      return stressed ? out.toUpperCase() : out;
    }

    function syllables(word) {
      const entry = byWord.get(cleanLetters(word));
      if (!entry) return null;
      const best = bestPronFor(entry);
      if (!best) return null;
      const segs = best.a.rows.map((r) => {
        const units = r.unit ? r.unit.split(' ') : [];
        return { letters: r.chunk, units, vowel: units.some(isVowel) };
      });
      const nuclei = segs.map((sg, i) => (sg.vowel ? i : -1)).filter((i) => i >= 0);
      const parts = [{ letters: '', units: [] }];
      const addTo = (part, letters, units) => {
        part.letters += letters;
        part.units.push(...units);
      };
      let n = 0;
      segs.forEach((sg, i) => {
        const cur = parts[parts.length - 1];
        if (sg.vowel) {
          // Two vowel sounds in a row are two parts: cre·ate.
          if (cur.units.some(isVowel)) parts.push({ letters: '', units: [] });
          addTo(parts[parts.length - 1], sg.letters, sg.units);
          n++;
          return;
        }
        const left = nuclei[n - 1];
        const right = nuclei[n];
        if (left === undefined || right === undefined) return addTo(cur, sg.letters, sg.units);
        // Consonants between two vowels: decide where the break goes.
        if (i === left + 1) {
          const between = segs.slice(left + 1, right);
          const lastUnits = between.flatMap((b) => b.units);
          let toRight = 1;
          if (between.length >= 2) {
            const two = lastUnits.slice(-2).join(' ');
            toRight = ONSET_2.has(two) ? 2 : 1;
          }
          const prevVowel = segs[left].units.filter(isVowel).pop();
          const single = between.length === 1 ? between[0] : null;
          if (single && /^(.)\1$/.test(single.letters)) {
            toRight = 'split'; // "ss" in necessary: es·sar
          } else if (SHORT_STRESSED.has(prevVowel)) {
            // A stressed short vowel keeps a consonant: nec·es, hos·pi·tal.
            toRight = Math.min(toRight, between.length - 1);
          }
          segs.splitInfo = segs.splitInfo || {};
          segs.splitInfo[left] = { toRight, count: between.length };
        }
        const info = segs.splitInfo[left];
        const pos = i - left - 1; // position among the consonants
        const goesRight = info.toRight === 'split' ? null : pos >= info.count - info.toRight;
        if (goesRight === null) {
          addTo(cur, sg.letters[0], []);
          parts.push({ letters: sg.letters.slice(1), units: sg.units.slice() });
        } else if (goesRight) {
          if (cur.units.some(isVowel)) parts.push({ letters: '', units: [] });
          addTo(parts[parts.length - 1], sg.letters, sg.units);
        } else {
          addTo(cur, sg.letters, sg.units);
        }
        if (i === right - 1 && parts[parts.length - 1].units.some(isVowel)) parts.push({ letters: '', units: [] });
      });
      const merged = parts.filter((p) => p.letters || p.units.length);
      let v = -1;
      const primary = best.units.primary;
      const out = merged.map((p) => {
        const hasV = p.units.some(isVowel);
        if (hasV) v++;
        const stressed = hasV && v === primary && merged.length > 1;
        return { letters: p.letters, say: sayPart(p.units, stressed), stressed };
      });
      // Parts with no vowel sound (a stray silent letter) join their neighbour.
      for (let i = out.length - 1; i >= 0; i--) {
        if (!merged[i].units.some(isVowel) && out.length > 1) {
          const j = i > 0 ? i - 1 : 1;
          if (j < i) {
            out[j].letters += out[i].letters;
            out[j].say += out[i].say;
          } else {
            out[j].letters = out[i].letters + out[j].letters;
            out[j].say = out[i].say + out[j].say;
          }
          out.splice(i, 1);
          merged.splice(i, 1);
        }
      }
      return { word: entry.word, parts: out, say: out.map((p) => p.say).join('-') };
    }

    // ---------- Levels ----------
    function levelOf(word) {
      const e = byWord.get(cleanLetters(word));
      return e && e.level ? e.level : 0;
    }

    // Practice words for a level, most common first. Skips the other spelling
    // style (colour vs color) when a style is given.
    function levelWords(level, style) {
      return words
        .filter((e) => e.practice && e.level === level && !(style && e.variant && e.variant !== style))
        .map((e) => e.word);
    }

    // ---------- Learning your habits ----------
    // Call when you've confirmed that `text` was your try at `word`.
    function learn(text, word, user) {
      const info = explain(text, word, user);
      if (!info) return user;
      info.sounds.forEach((row) => {
        if (row.yours === null || row.unit.includes(' ')) return;
        const u = row.unit;
        user.counts[u] = user.counts[u] || {};
        user.counts[u][row.yours] = (user.counts[u][row.yours] || 0) + 1;
        user.totals[u] = (user.totals[u] || 0) + 1;
        if (!row.ok) {
          const key = `${u}|${row.right}|${row.yours}`;
          const p = user.patterns[key] || { unit: u, right: row.right, yours: row.yours, n: 0, words: [] };
          p.n++;
          p.last = Date.now();
          if (!p.words.includes(word)) p.words = [word, ...p.words].slice(0, 5);
          user.patterns[key] = p;
        }
      });
      return user;
    }

    function topPatterns(user, limit = 5) {
      return Object.values((user && user.patterns) || {})
        .sort((a, b) => b.n - a.n || b.last - a.last)
        .slice(0, limit)
        .map((p) => Object.assign({ sound: soundName(p.unit) }, p));
    }

    // Common words that use the same spelling for the same sound, to practise
    // the pattern rather than one word.
    const alignCache = new Map();
    function practiceWords(unit, chunk, limit = 10, exclude = []) {
      const out = [];
      const skip = new Set(exclude);
      for (const entry of words) {
        if (out.length >= limit) break;
        if (entry.word.length < 4 || skip.has(entry.word) || !entry.word.includes(chunk)) continue;
        let rows = alignCache.get(entry.word);
        if (!rows) {
          const b = bestPronFor(entry);
          rows = b ? b.a.rows : [];
          alignCache.set(entry.word, rows);
        }
        if (rows.some((r) => r.unit === unit && r.chunk === chunk)) out.push(entry.word);
      }
      return out;
    }

    return {
      find,
      explain,
      learn,
      topPatterns,
      practiceWords,
      wordParts,
      syllables,
      levelOf,
      levelWords,
      variantOf: (w) => (byWord.get(cleanLetters(w)) || {}).variant || '',
      soundName,
      has: (w) => byWord.has(cleanLetters(w)),
      size: words.length,
    };
  }

  return { create, emptyUserModel, editDistance, cleanLetters };
});
