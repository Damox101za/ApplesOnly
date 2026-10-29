'use strict';

// Spelling trainer. Loaded before app.js; it only touches app.js helpers
// (load, save, escapeHtml, todayKey, uid, showToast, STORAGE_KEYS) from inside
// functions, which run after app.js has loaded and called Spelling.init().

// Commonly misspelled words. Sentences use ___ where the word goes.
// Words with different US/UK spellings are left out on purpose.
const STARTER_WORDS = [
  ['definitely', 'definately|definitly|defiantly', 'I will ___ be there on time.', 'It has "finite" inside: de-FINITE-ly.'],
  ['separate', 'seperate|separete|seprate', 'Keep the eggs ___ from the flour.', 'There is "a rat" in sep-A-RAT-e.'],
  ['necessary', 'neccessary|necesary|neccesary', 'Is it ___ to bring a coat?', 'One Collar, two Sleeves: 1 c, 2 s.'],
  ['receive', 'recieve|receeve|receve', 'Did you ___ my message?', 'i before e, except after c: rec-EI-ve.'],
  ['believe', 'beleive|belive|beleave', 'I ___ you.', 'Never be-LIE-ve a lie.'],
  ['because', 'becuase|becouse|becase', 'I stayed home ___ it rained.', 'Big Elephants Can Always Understand Small Elephants.'],
  ['tomorrow', 'tommorow|tomorow|tommorrow', 'See you ___ morning.', 'One m, two r\'s: to-mor-row.'],
  ['beginning', 'begining|beggining|beginnig', 'At the ___ of the story, it was dark.', 'begin + n + ing: the n doubles.'],
  ['business', 'buisness|busness|bussiness', 'She runs her own ___.', 'You ride the BUS to your BUS-I-ness.'],
  ['calendar', 'calender|calandar|calander', 'Put it on the ___.', 'Ends in -dar, like "radar".'],
  ['embarrass', 'embarass|embarras|embaress', 'Please don\'t ___ me.', 'Double r, double s: you go Really Red and Smile Shyly.'],
  ['environment', 'enviroment|enviornment|enviorment', 'Recycling helps the ___.', 'There is "iron" inside: env-IRON-ment.'],
  ['friend', 'freind|frend|friand', 'My best ___ lives next door.', 'A fri-END to the END.'],
  ['government', 'goverment|govermnent|govenment', 'The ___ passed a new law.', 'govern + ment. Say the n.'],
  ['grateful', 'greatful|gratefull|graitful', 'I am ___ for your help.', 'Not "great": it comes from "gratitude".'],
  ['guarantee', 'garantee|guarentee|gaurantee', 'We ___ you will love it.', 'g-U-A-r-a-n-t-E-E: "gua" then double e.'],
  ['immediately', 'immediatly|imediately|immedietly', 'Call me back ___.', 'immediate + ly: keep the e.'],
  ['interesting', 'intresting|interisting|intristing', 'That is an ___ idea.', 'inter + est + ing.'],
  ['knowledge', 'knowlege|knowladge|knoledge', 'She has a lot of ___.', 'know + ledge.'],
  ['library', 'libary|liberry|librery', 'I borrowed a book from the ___.', 'Two r\'s: li-BRAR-y.'],
  ['maintenance', 'maintainance|maintenence|maintanance', 'The car needs ___.', 'main-TEN-ance: there is "ten" in it.'],
  ['occasion', 'ocassion|occassion|ocasion', 'It was a special ___.', 'Two c\'s, one s.'],
  ['occurred', 'occured|ocurred|ocured', 'The accident ___ last night.', 'Double c, double r.'],
  ['probably', 'probly|probaly|probabley', 'It will ___ rain later.', 'probable + ly: pro-bab-ly.'],
  ['really', 'realy|reallly|relly', 'That was ___ fun.', 'real + ly: two l\'s.'],
  ['recommend', 'reccommend|recomend|reccomend', 'Can you ___ a good film?', 're + commend: one c, two m\'s.'],
  ['restaurant', 'resturant|restaraunt|restarant', 'Let\'s eat at the ___.', 'rest-AU-rant: "au" in the middle.'],
  ['schedule', 'schedual|shedule|scedule', 'What is on your ___ today?', 's-c-h-e-d-u-l-e: "school" starts the same.'],
  ['surprise', 'suprise|surprize|surpise', 'The party was a ___.', 'sur + prise: two r\'s.'],
  ['until', 'untill|untile|intil', 'Wait ___ I get home.', 'Only one l at the end.'],
  ['weird', 'wierd|weard|werid', 'I had a ___ dream.', 'Weird is weird: it breaks i-before-e.'],
  ['which', 'wich|whitch|whcih', '___ one do you want?', 'Starts with wh-, like "what".'],
  ['writing', 'writting|writeing|writing', 'I am ___ a letter.', 'write, drop the e, add ing: one t.'],
  ['address', 'adress|addres|adres', 'What is your home ___?', 'Double d, double s.'],
  ['accommodate', 'accomodate|acommodate|acomodate', 'The hotel can ___ 100 guests.', 'Double c, double m: big enough to fit both.'],
  ['argument', 'arguement|argumant|arguemant', 'They had an ___ about money.', 'argue drops its e: argument.'],
  ['apparently', 'apparantly|aparently|apparentley', '___ it is going to snow.', 'ap-PAR-ent-ly: two p\'s, "ent".'],
  ['across', 'accross|acros|acrross', 'Walk ___ the road.', 'One c: a + cross.'],
  ['a lot', 'alot|allot|alott', 'Thanks ___!', '"a lot" is always two words.'],
  ['truly', 'truely|truley|truily', 'Yours ___.', 'true drops its e: truly.'],
  ['piece', 'peice|pice|peace', 'Can I have a ___ of cake?', 'A PIE-ce of PIE.'],
  ['their', 'thier|ther|theyr', 'They left ___ bags here.', 'the + ir.'],
  ['different', 'diffrent|diferent|differant', 'We have ___ ideas.', 'differ + ent: say all three parts.'],
  ['February', 'Febuary|Febrary|Feburary', 'My birthday is in ___.', 'Feb-RU-ary: say the first r.'],
  ['Wednesday', 'Wensday|Wednsday|Wedensday', 'The meeting is on ___.', 'Say it slowly: Wed-nes-day.'],
  ['unfortunately', 'unfortunatly|unfortunetly|unfortunatley', '___ the shop was closed.', 'un + fortunate + ly: keep the e.'],
  ['tongue', 'tounge|tung|tonge', 'Don\'t bite your ___.', 't-o-n-g-u-e: "gue" at the end, like "league".'],
  ['vacuum', 'vaccum|vacume|vaccuum', 'I need to ___ the floor.', 'One c, two u\'s.'],
  ['conscious', 'concious|consious|conscous', 'Was he ___ after the fall?', 'It has "sc" like "science".'],
  ['disappoint', 'dissapoint|disapoint|dissappoint', 'I don\'t want to ___ you.', 'dis + appoint: one s, two p\'s.'],
  ['exaggerate', 'exagerate|exxagerate|exagerrate', 'Don\'t ___ the story.', 'Double g, one r.'],
  ['familiar', 'familar|famillar|familier', 'That face looks ___.', 'family + ar: famil-I-ar.'],
  ['foreign', 'foriegn|forein|foregin', 'She speaks a ___ language.', 'Breaks the rule: for-EI-gn, with a silent g.'],
  ['height', 'hieght|hight|heigth', 'What is your ___?', 'There is "eight" inside: h-EIGHT.'],
  ['independent', 'independant|indepindent|independint', 'She is very ___.', 'Ends in -ent, not -ant.'],
  ['millennium', 'millenium|milennium|milenium', 'A new ___ began in 2000.', 'Double l, double n.'],
  ['mischievous', 'mischievious|mischevous|mischeivous', 'The ___ cat hid my keys.', 'mis-CHIEF-vous: only three parts.'],
  ['noticeable', 'noticable|noticeble|notisable', 'The change is very ___.', 'notice + able: keep the e.'],
  ['possession', 'posession|possesion|posesion', 'The book is in my ___.', 'Four s\'s: po-SS-e-SS-ion.'],
  ['privilege', 'priviledge|privelege|privilage', 'It is a ___ to meet you.', 'No d: pri-vi-lege.'],
  ['pronunciation', 'pronounciation|pronunciaton|pronunsiation', 'Her ___ is very clear.', 'No "noun" inside: pro-NUN-ciation.'],
  ['questionnaire', 'questionaire|questionnare|questionnair', 'Please fill in the ___.', 'question + naire: double n.'],
  ['rhythm', 'rythm|rhythem|rhytm', 'Clap to the ___.', 'Rhythm Helps Your Two Hips Move.'],
  ['sincerely', 'sincerly|sincerley|sincerelly', 'Yours ___.', 'sincere + ly: keep the e.'],
  ['successful', 'succesful|successfull|sucessful', 'The plan was ___.', 'Double c, double s, one l at the end.'],
  ['vegetable', 'vegtable|vegatable|vegitable', 'Eat a ___ with dinner.', 'veg-E-table: there is a "table" in it.'],
].map(([word, wrongs, sentence, tip]) => ({
  word,
  wrongs: wrongs.split('|').filter((w) => w !== word),
  sentence,
  tip,
}));

const FALLBACK_SENTENCES = [
  'I typed ___ in my message.',
  'Can you spell ___ for me?',
  'The word ___ was on my list.',
];

// Leitner boxes: a correct answer moves a word up one box, a miss sends it
// back to box 0. The box decides how many days until it comes back.
const BOX_INTERVAL_DAYS = [0, 1, 2, 4, 7, 14];
const MASTERED_BOX = 5;
const ROUND_SIZE = 10;

const Spelling = (() => {
  let data = null; // { words, stats, log, bestTower, onlyMine }
  let session = null; // practice round state
  let tower = null; // tower game state
  const starterByKey = new Map(STARTER_WORDS.map((w) => [keyOf(w.word), w]));

  function keyOf(word) {
    return word.trim().toLowerCase();
  }

  function emptyData() {
    return { words: [], stats: {}, log: {}, bestTower: 0, onlyMine: false, sound: null };
  }

  function normalize(raw) {
    const d = Object.assign(emptyData(), raw && typeof raw === 'object' ? raw : {});
    if (!Array.isArray(d.words)) d.words = [];
    if (!d.stats || typeof d.stats !== 'object') d.stats = {};
    if (!d.log || typeof d.log !== 'object') d.log = {};
    d.words = d.words.filter((w) => w && typeof w.word === 'string' && w.word.trim());
    // Your sound-spelling habits, learned by the Sound it out finder.
    const s = d.sound;
    if (!s || typeof s !== 'object' || !s.counts || !s.totals || !s.patterns) d.sound = { counts: {}, totals: {}, patterns: {} };
    return d;
  }

  function persist() {
    save(STORAGE_KEYS.spelling, data);
  }

  function reload() {
    data = normalize(load(STORAGE_KEYS.spelling, null));
    renderAll();
  }

  // ---------- Word info ----------
  function isMine(word) {
    const k = keyOf(word);
    return data.words.some((w) => keyOf(w.word) === k);
  }

  function entryFor(word) {
    const k = keyOf(word);
    const starter = starterByKey.get(k);
    const mine = data.words.find((w) => keyOf(w.word) === k);
    const base = starter ? starter.word : (mine ? mine.word.trim() : word.trim());
    let sentence = (mine && mine.sentence) || (starter && starter.sentence) || '';
    if (sentence && !sentence.includes('___')) sentence = '';
    if (!sentence) sentence = FALLBACK_SENTENCES[hash(k) % FALLBACK_SENTENCES.length];
    let wrongs = starter ? starter.wrongs.slice() : [];
    if (wrongs.length < 3) {
      wrongs = [...new Set([...wrongs, ...generateMisspellings(base)])].slice(0, 3);
    }
    return { word: base, key: k, sentence, wrongs, tip: starter ? starter.tip : '', mine: !!mine };
  }

  function statFor(word) {
    return data.stats[keyOf(word)] || { box: 0, due: null, right: 0, wrong: 0 };
  }

  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }

  // Builds believable wrong spellings for words that have none on file.
  function generateMisspellings(word) {
    const w = word.toLowerCase();
    const out = new Set();
    const add = (s) => {
      if (s && s !== w && /[a-z]/.test(s)) out.add(s);
    };
    if (w.includes('ie')) add(w.replace('ie', 'ei'));
    if (w.includes('ei')) add(w.replace('ei', 'ie'));
    // Undouble a double letter, or double a single consonant.
    const dbl = w.match(/([a-z])\1/);
    if (dbl) add(w.slice(0, dbl.index) + w.slice(dbl.index + 1));
    for (let i = 1; i < w.length - 1; i++) {
      if (/[bcdfglmnprst]/.test(w[i]) && w[i] !== w[i - 1] && w[i] !== w[i + 1]) {
        add(w.slice(0, i) + w[i] + w.slice(i));
        break;
      }
    }
    // Swap a vowel for a similar-sounding one.
    const swaps = { a: 'e', e: 'a', i: 'e', o: 'u', u: 'o' };
    for (let i = 1; i < w.length; i++) {
      if (swaps[w[i]]) {
        add(w.slice(0, i) + swaps[w[i]] + w.slice(i + 1));
        break;
      }
    }
    // Drop a silent-ish e, or swap two neighbouring letters.
    if (w.length > 4 && w.endsWith('e')) add(w.slice(0, -1));
    if (w.length > 3) {
      const i = Math.floor(w.length / 2);
      add(w.slice(0, i - 1) + w[i] + w[i - 1] + w.slice(i + 1));
    }
    // Keep a capital first letter so the right answer doesn't stand out.
    const cap = word[0] !== word[0].toLowerCase();
    return [...out].map((s) => (cap ? s[0].toUpperCase() + s.slice(1) : s));
  }

  // ---------- Picking words ----------
  function pool() {
    const mine = data.words.map((w) => w.word);
    if (data.onlyMine && mine.length) return mine;
    const seen = new Set();
    return [...mine, ...STARTER_WORDS.map((w) => w.word)].filter((w) => {
      const k = keyOf(w);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // Due words first, then your own words, then the weakest, with a little shuffle.
  function pickWords(n) {
    const today = todayKey();
    const ranked = pool().map((word) => {
      const s = statFor(word);
      const due = !s.due || s.due <= today;
      return { word, score: (due ? 0 : 100) + (isMine(word) ? 0 : 10) + s.box * 2 + Math.random() * 3 };
    });
    ranked.sort((a, b) => a.score - b.score);
    return shuffle(ranked.slice(0, n).map((r) => r.word));
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- Recording answers ----------
  function addDays(dateKey, days) {
    const d = new Date(dateKey + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return localDateKey(d);
  }

  function record(word, correct, attempt) {
    const k = keyOf(word);
    const today = todayKey();
    const s = Object.assign({ box: 0, due: null, right: 0, wrong: 0 }, data.stats[k]);
    if (correct) {
      s.right++;
      s.box = Math.min(s.box + 1, MASTERED_BOX);
    } else {
      s.wrong++;
      s.box = 0;
      if (attempt) s.lastWrong = attempt;
    }
    s.due = addDays(today, BOX_INTERVAL_DAYS[s.box]);
    s.lastSeen = Date.now();
    data.stats[k] = s;
    data.log[today] = (data.log[today] || 0) + 1;

    let added = false;
    if (!correct && !isMine(word)) {
      data.words.push({ id: uid(), word: entryFor(word).word, sentence: '', addedAt: Date.now(), source: 'missed' });
      added = true;
    }
    persist();
    return added;
  }

  function isCorrect(target, attempt) {
    const clean = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    return clean(target) === clean(attempt);
  }

  // ---------- Letter-by-letter diff ----------
  // Levenshtein alignment between the right word and what you typed.
  function diffOps(target, attempt) {
    const t = target.toLowerCase();
    const a = attempt.trim().toLowerCase();
    const m = t.length;
    const n = a.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j - 1] + (t[i - 1] === a[j - 1] ? 0 : 1),
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1
        );
      }
    }
    const ops = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (t[i - 1] === a[j - 1] ? 0 : 1)) {
        ops.push({ type: t[i - 1] === a[j - 1] ? 'match' : 'sub', t: target[i - 1], a: attempt.trim()[j - 1] });
        i--;
        j--;
      } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
        ops.push({ type: 'missing', t: target[i - 1], a: '' });
        i--;
      } else {
        ops.push({ type: 'extra', t: '', a: attempt.trim()[j - 1] });
        j--;
      }
    }
    return ops.reverse();
  }

  function diffHTML(target, attempt) {
    const ops = diffOps(target, attempt);
    // Too far off for letter notes to help: just show both words.
    const errors = ops.filter((op) => op.type !== 'match').length;
    if (!attempt.trim() || errors > Math.max(2, Math.ceil(target.length / 2))) {
      return `
        <div class="sp-diff">
          ${attempt.trim() ? `<div class="sp-diff-row"><span class="sp-diff-label">You typed</span><span class="sp-word"><span class="sp-l sp-bad">${escapeHtml(attempt.trim())}</span></span></div>` : ''}
          <div class="sp-diff-row"><span class="sp-diff-label">Correct</span><span class="sp-word">${escapeHtml(target)}</span></div>
        </div>`;
    }
    const yours = ops
      .map((op) => {
        if (op.type === 'match') return `<span class="sp-l">${escapeHtml(op.a)}</span>`;
        if (op.type === 'missing') return '<span class="sp-l sp-gap">_</span>';
        return `<span class="sp-l sp-bad">${escapeHtml(op.a)}</span>`;
      })
      .join('');
    const right = ops
      .filter((op) => op.type !== 'extra')
      .map((op) => `<span class="sp-l${op.type === 'match' ? '' : ' sp-fix'}">${escapeHtml(op.t)}</span>`)
      .join('');

    // Group neighbouring mistakes into plain-English notes.
    const notes = [];
    let cur = null;
    ops.forEach((op) => {
      if (op.type === 'match') {
        if (cur) notes.push(cur);
        cur = null;
      } else {
        cur = cur || { wrote: '', should: '' };
        cur.wrote += op.a;
        cur.should += op.t;
      }
    });
    if (cur) notes.push(cur);
    const lines = notes.slice(0, 3).map((nt) => {
      if (!nt.wrote) return `You missed <b>${escapeHtml(nt.should)}</b>.`;
      if (!nt.should) return `Take out the extra <b>${escapeHtml(nt.wrote)}</b>.`;
      return `You wrote <b>${escapeHtml(nt.wrote)}</b>, it should be <b>${escapeHtml(nt.should)}</b>.`;
    });

    return `
      <div class="sp-diff">
        <div class="sp-diff-row"><span class="sp-diff-label">You typed</span><span class="sp-word">${yours || '<span class="sp-l sp-gap">(nothing)</span>'}</span></div>
        <div class="sp-diff-row"><span class="sp-diff-label">Correct</span><span class="sp-word">${right}</span></div>
      </div>
      ${lines.length ? `<ul class="sp-notes">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>` : ''}`;
  }

  // ---------- Speech ----------
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

  function speak(text, rate = 0.85) {
    if (!canSpeak) return false;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const lang = (navigator.language || '').toLowerCase().startsWith('en') ? navigator.language : 'en-US';
      u.lang = lang;
      u.rate = rate;
      window.speechSynthesis.speak(u);
      return true;
    } catch {
      return false;
    }
  }

  function sayWord(entry) {
    speak(entry.word);
  }

  function saySentence(entry) {
    speak(entry.sentence.replace('___', entry.word), 0.9);
  }

  // Shown when the browser can't talk: flash the word, then hide it.
  function peek(el, word, ms = 1800) {
    el.textContent = word;
    el.classList.add('visible');
    clearTimeout(peek._t);
    peek._t = setTimeout(() => {
      el.textContent = '';
      el.classList.remove('visible');
    }, ms);
  }

  function blankSentence(entry, reveal) {
    const [before, after] = entry.sentence.split('___');
    const mid = reveal
      ? `<span class="sp-blank">${escapeHtml(entry.word[0])}${'_'.repeat(Math.max(entry.word.length - 1, 0))}</span>`
      : '<span class="sp-blank">_____</span>';
    return `${escapeHtml(before)}${mid}${escapeHtml(after || '')}`;
  }

  // ---------- Practice rounds (hear / spot / fix) ----------
  const MODES = {
    hear: { icon: '🔊', title: 'Hear it, type it', desc: 'Listen to the word, then type it.' },
    spot: { icon: '🔍', title: 'Spot the right one', desc: 'Pick the correct spelling.' },
    fix: { icon: '✏️', title: 'Fix the sentence', desc: 'Find the mistake and fix it.' },
    tower: { icon: '🏰', title: 'Spelling tower', desc: 'Build a tower before time runs out.' },
  };

  function playEl() {
    return document.getElementById('spellingPlay');
  }

  function startMode(mode, customWords, title) {
    stopTower();
    if (mode === 'tower') return startTower();
    session = {
      mode,
      title: title || '',
      words: customWords && customWords.length ? customWords : pickWords(ROUND_SIZE),
      index: 0,
      results: [],
      answered: false,
      hint: false,
      fixFound: false,
      options: null,
      wrongShown: null,
    };
    showPlay(true);
    renderQuestion();
  }

  function showPlay(on) {
    document.getElementById('spellingHome').hidden = on;
    playEl().hidden = !on;
    if (!on) {
      playEl().innerHTML = '';
      if (canSpeak) window.speechSynthesis.cancel();
    }
  }

  function quit() {
    session = null;
    stopTower();
    showPlay(false);
    renderHome();
  }

  function playHeader(title) {
    const progress = session ? `Word ${session.index + 1} of ${session.words.length}` : '';
    return `
      <div class="sp-play-head">
        <button type="button" class="secondary-btn sp-quit" data-sp="quit">‹ Back</button>
        <div class="sp-play-title">${escapeHtml(title)}</div>
        <div class="sp-play-progress">${escapeHtml(progress)}</div>
      </div>`;
  }

  function renderQuestion() {
    const el = playEl();
    const entry = entryFor(session.words[session.index]);
    session.entry = entry;
    session.answered = false;
    session.hint = false;
    session.fixFound = false;
    const head = playHeader(session.title || MODES[session.mode].title);

    if (session.mode === 'hear') {
      el.innerHTML = `${head}
        <div class="sp-card">
          <div class="sp-listen">
            <button type="button" class="sp-big-btn" data-sp="say">${canSpeak ? '🔊 Hear the word' : '👀 Peek at the word'}</button>
            <button type="button" class="secondary-btn" data-sp="sentence">${canSpeak ? 'Hear it in a sentence' : 'Show the sentence'}</button>
          </div>
          <div class="sp-peek" id="spPeek" aria-live="polite"></div>
          <p class="sp-sentence" id="spSentence" hidden></p>
          <form class="sp-answer" id="spAnswerForm">
            ${answerInput()}
            <button type="submit">Check</button>
          </form>
          <button type="button" class="sp-link" data-sp="hint">Need a hint?</button>
          <div id="spFeedback"></div>
        </div>`;
      if (canSpeak) setTimeout(() => sayWord(entry), 250);
      else peek(document.getElementById('spPeek'), entry.word);
    } else if (session.mode === 'spot') {
      session.options = shuffle([entry.word, ...entry.wrongs.slice(0, 3)]);
      el.innerHTML = `${head}
        <div class="sp-card">
          <p class="sp-prompt">Which spelling is right?</p>
          <p class="sp-sentence">${blankSentence(entry, false)}</p>
          <div class="sp-options">
            ${session.options.map((o, i) => `<button type="button" class="sp-option" data-sp="option" data-i="${i}">${escapeHtml(o)}</button>`).join('')}
          </div>
          <div id="spFeedback"></div>
        </div>`;
    } else if (session.mode === 'fix') {
      const wrong = entry.wrongs[Math.floor(Math.random() * entry.wrongs.length)] || entry.word;
      session.wrongShown = wrong;
      const [before, after] = entry.sentence.split('___');
      const tokens = (text) =>
        text
          .split(/(\s+)/)
          .map((t) => (t.trim() ? `<button type="button" class="sp-token" data-sp="token">${escapeHtml(t)}</button>` : t))
          .join('');
      el.innerHTML = `${head}
        <div class="sp-card">
          <p class="sp-prompt" id="spFixPrompt">Tap the misspelled word.</p>
          <p class="sp-sentence sp-tokens">${tokens(before)}<button type="button" class="sp-token" data-sp="token" data-target="1">${escapeHtml(wrong)}</button>${tokens(after || '')}</p>
          <form class="sp-answer" id="spAnswerForm" hidden>
            ${answerInput('Type it correctly')}
            <button type="submit">Check</button>
          </form>
          <div id="spFeedback"></div>
        </div>`;
    }
    const input = document.getElementById('spAnswer');
    if (input && session.mode === 'hear') input.focus();
  }

  // Autocorrect and spellcheck are switched off so you practise on your own.
  function answerInput(placeholder = 'Type the word') {
    return `<input type="text" id="spAnswer" class="sp-input" placeholder="${escapeHtml(placeholder)}"
      autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" required>`;
  }

  function submitAnswer(attempt) {
    if (!session || session.answered) return;
    const entry = session.entry;
    const correct = isCorrect(entry.word, attempt);
    finishQuestion(correct, attempt);
  }

  function finishQuestion(correct, attempt) {
    session.answered = true;
    const entry = session.entry;
    const added = record(entry.word, correct, correct ? '' : attempt);
    session.results.push({ word: entry.word, correct, attempt });
    const soundTips = correct ? [] : learnFromMiss(attempt, entry.word);
    const input = document.getElementById('spAnswer');
    if (input) input.disabled = true;
    const form = document.getElementById('spAnswerForm');
    if (form) form.querySelector('button').disabled = true;

    const last = session.index === session.words.length - 1;
    const fb = document.getElementById('spFeedback');
    fb.innerHTML = `
      <div class="sp-feedback ${correct ? 'good' : 'bad'}">
        <div class="sp-feedback-title">${correct ? '✅ Correct!' : '❌ Not quite'}</div>
        ${correct ? `<div class="sp-word sp-word-big">${escapeHtml(entry.word)}</div>` : diffHTML(entry.word, attempt)}
        ${soundTips.map((t) => `<p class="sp-tip">🔈 ${t}</p>`).join('')}
        ${entry.tip ? `<p class="sp-tip">💡 ${escapeHtml(entry.tip)}</p>` : ''}
        ${added ? '<p class="sp-added">Added to your tricky words, so you will see it again.</p>' : ''}
        <div class="sp-feedback-actions">
          ${canSpeak ? '<button type="button" class="secondary-btn" data-sp="say">🔊 Hear it</button>' : ''}
          <button type="button" class="sp-next" data-sp="next">${last ? 'See results' : 'Next word ›'}</button>
        </div>
      </div>`;
    fb.querySelector('.sp-next').focus();
    if (!correct && canSpeak) setTimeout(() => sayWord(entry), 200);
  }

  function next() {
    if (!session) return;
    if (session.index < session.words.length - 1) {
      session.index++;
      renderQuestion();
    } else {
      renderResults();
    }
  }

  function renderResults() {
    const right = session.results.filter((r) => r.correct).length;
    const total = session.results.length;
    const missed = session.results.filter((r) => !r.correct);
    const pct = total ? Math.round((right / total) * 100) : 0;
    const msg = pct === 100 ? 'Perfect round! 🎉' : pct >= 70 ? 'Nice work!' : 'Good practice. Those words will come back soon.';
    const mode = session.mode;
    playEl().innerHTML = `
      <div class="sp-play-head">
        <button type="button" class="secondary-btn sp-quit" data-sp="quit">‹ Back</button>
        <div class="sp-play-title">Round done</div>
        <div class="sp-play-progress"></div>
      </div>
      <div class="sp-card sp-results">
        <div class="sp-score">${right}/${total}</div>
        <p>${escapeHtml(msg)}</p>
        ${missed.length ? `
          <h3 class="sp-subhead">Words to work on</h3>
          <ul class="sp-missed">
            ${missed.map((r) => `<li><b>${escapeHtml(r.word)}</b>${r.attempt ? ` <span class="sp-muted">(you wrote ${escapeHtml(r.attempt)})</span>` : ''}</li>`).join('')}
          </ul>` : ''}
        <div class="sp-feedback-actions">
          <button type="button" class="secondary-btn" data-sp="quit">Done</button>
          <button type="button" class="sp-next" data-sp="again" data-mode="${mode}">Play again</button>
        </div>
      </div>`;
    session = null;
    renderSummary();
  }

  // ---------- Tower game ----------
  const TOWER_LIVES = 3;
  const BLOCK_COLORS = ['#4f46e5', '#7c3aed', '#0891b2', '#16a34a', '#ea580c', '#db2777'];

  function towerTime(height) {
    return Math.max(6, 18 - height * 0.75); // seconds per word
  }

  function startTower() {
    session = null;
    tower = {
      blocks: [],
      lives: TOWER_LIVES,
      queue: pickWords(40),
      qi: 0,
      entry: null,
      deadline: 0,
      timer: null,
      busy: false,
      over: false,
    };
    showPlay(true);
    playEl().innerHTML = `
      <div class="sp-play-head">
        <button type="button" class="secondary-btn sp-quit" data-sp="quit">‹ Back</button>
        <div class="sp-play-title">Spelling tower</div>
        <div class="sp-play-progress" id="towerLives"></div>
      </div>
      <div class="sp-card sp-tower-card">
        <div class="tower-stage">
          <div class="tower-height" id="towerHeight">0</div>
          <div class="tower-stack" id="towerStack"></div>
          <div class="tower-ground"></div>
        </div>
        <div class="tower-timer"><div class="tower-timer-fill" id="towerTimerFill"></div></div>
        <div class="sp-listen">
          <button type="button" class="sp-big-btn" data-sp="tsay">${canSpeak ? '🔊 Hear again' : '👀 Peek'}</button>
          <button type="button" class="secondary-btn" data-sp="tsentence">Sentence hint</button>
        </div>
        <div class="sp-peek" id="spPeek" aria-live="polite"></div>
        <p class="sp-sentence" id="towerSentence" hidden></p>
        <form class="sp-answer" id="towerForm">
          ${answerInput('Spell it to add a block')}
          <button type="submit">Stack</button>
        </form>
        <div id="towerMsg" class="tower-msg" aria-live="polite"></div>
      </div>`;
    renderTowerStack();
    nextTowerWord();
  }

  function stopTower() {
    if (tower && tower.timer) cancelAnimationFrame(tower.timer);
    tower = null;
  }

  function renderTowerStack() {
    const stack = document.getElementById('towerStack');
    if (!stack) return;
    // Only the top blocks fit on screen; the base sinks out of view.
    const shown = tower.blocks.slice(-9);
    stack.innerHTML = shown
      .map((b, i) => `<div class="tower-block${i === shown.length - 1 && b.fresh ? ' drop' : ''}" style="background:${b.color};transform:translateX(${b.offset}px)">${escapeHtml(b.word)}</div>`)
      .join('');
    tower.blocks.forEach((b) => (b.fresh = false));
    document.getElementById('towerHeight').textContent = tower.blocks.length;
    document.getElementById('towerLives').textContent = '❤️'.repeat(tower.lives) + '🤍'.repeat(TOWER_LIVES - tower.lives);
  }

  function nextTowerWord() {
    if (!tower) return;
    if (tower.qi >= tower.queue.length) {
      tower.queue = pickWords(40);
      tower.qi = 0;
    }
    tower.entry = entryFor(tower.queue[tower.qi++]);
    tower.busy = false;
    const input = document.getElementById('spAnswer');
    input.value = '';
    input.disabled = false;
    input.focus();
    document.getElementById('towerSentence').hidden = true;
    document.getElementById('towerMsg').innerHTML = '';
    tower.total = towerTime(tower.blocks.length) * 1000;
    tower.deadline = performance.now() + tower.total;
    if (canSpeak) setTimeout(() => tower && sayWord(tower.entry), 200);
    else peek(document.getElementById('spPeek'), tower.entry.word, 1500);
    tickTower();
  }

  function tickTower() {
    if (!tower || tower.busy) return;
    const left = tower.deadline - performance.now();
    const fill = document.getElementById('towerTimerFill');
    if (!fill) return;
    const pct = Math.max(0, left / tower.total) * 100;
    fill.style.width = pct + '%';
    fill.classList.toggle('low', pct < 30);
    if (left <= 0) return towerAnswer('', true);
    tower.timer = requestAnimationFrame(tickTower);
  }

  function towerAnswer(attempt, timedOut) {
    if (!tower || tower.busy || tower.over) return;
    tower.busy = true;
    cancelAnimationFrame(tower.timer);
    const entry = tower.entry;
    const correct = !timedOut && isCorrect(entry.word, attempt);
    record(entry.word, correct, correct ? '' : attempt);
    const input = document.getElementById('spAnswer');
    input.disabled = true;
    const msg = document.getElementById('towerMsg');

    if (correct) {
      tower.blocks.push({
        word: entry.word,
        color: BLOCK_COLORS[tower.blocks.length % BLOCK_COLORS.length],
        offset: Math.round((Math.random() - 0.5) * 24),
        fresh: true,
      });
      tower.peak = Math.max(tower.peak || 0, tower.blocks.length);
      renderTowerStack();
      msg.innerHTML = '<span class="tower-good">✅ Stacked!</span>';
      setTimeout(nextTowerWord, 700);
      return;
    }

    tower.lives--;
    const stack = document.getElementById('towerStack');
    const top = stack.lastElementChild;
    if (top) top.classList.add('fall');
    msg.innerHTML = `<div class="sp-feedback bad">
      <div class="sp-feedback-title">${timedOut ? '⏰ Out of time' : '❌ Wobble!'}${tower.blocks.length ? ' The top block fell.' : ''}</div>
      ${diffHTML(entry.word, attempt)}
      ${entry.tip ? `<p class="sp-tip">💡 ${escapeHtml(entry.tip)}</p>` : ''}
    </div>`;
    if (canSpeak) sayWord(entry);
    setTimeout(() => {
      if (!tower) return;
      tower.blocks.pop();
      renderTowerStack();
      if (tower.lives <= 0) towerOver();
      else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sp-next';
        btn.dataset.sp = 'tnext';
        btn.textContent = 'Next word ›';
        msg.appendChild(btn);
        btn.focus();
      }
    }, 600);
  }

  function towerOver() {
    tower.over = true;
    const best = Math.max(data.bestTower || 0, tower.peak || 0);
    const height = tower.peak || 0;
    const isRecord = height > (data.bestTower || 0);
    data.bestTower = best;
    persist();
    document.getElementById('towerMsg').innerHTML = `
      <div class="sp-feedback">
        <div class="sp-feedback-title">Game over</div>
        <p>Highest tower: <b>${height}</b> block${height === 1 ? '' : 's'}${isRecord ? ' — new record! 🏆' : ` (best: ${best})`}</p>
        <div class="sp-feedback-actions">
          <button type="button" class="secondary-btn" data-sp="quit">Done</button>
          <button type="button" class="sp-next" data-sp="again" data-mode="tower">Play again</button>
        </div>
      </div>`;
    renderSummary();
  }

  // ---------- My words ----------
  function addWords(text, sentence) {
    const parts = text
      .split(/[\n,;]+/)
      .map((w) => w.trim().replace(/\s+/g, ' '))
      .filter((w) => w && w.length <= 40);
    let count = 0;
    parts.forEach((w) => {
      if (isMine(w)) return;
      const s = parts.length === 1 && sentence ? sentence.trim() : '';
      data.words.push({ id: uid(), word: w, sentence: s, addedAt: Date.now(), source: 'mine' });
      count++;
    });
    if (count) persist();
    return count;
  }

  function removeWord(id) {
    const idx = data.words.findIndex((w) => w.id === id);
    if (idx === -1) return;
    const [removed] = data.words.splice(idx, 1);
    persist();
    renderHome();
    showToast(`Removed "${removed.word}".`, () => {
      data.words.splice(idx, 0, removed);
      persist();
      renderHome();
      hideToast();
    });
    clearTimeout(removeWord._t);
    removeWord._t = setTimeout(hideToast, 6000);
  }

  // ---------- Rendering ----------
  function counts() {
    const today = todayKey();
    const all = pool();
    const mastered = Object.values(data.stats).filter((s) => s.box >= MASTERED_BOX).length;
    const due = all.filter((w) => {
      const s = statFor(w);
      return s.due && s.due <= today && s.box < MASTERED_BOX;
    }).length;
    return { today: data.log[today] || 0, mastered, mine: data.words.length, due, best: data.bestTower || 0 };
  }

  function renderSummary() {
    const el = document.getElementById('spellingSummary');
    if (!el) return;
    const c = counts();
    const stats = [
      { value: c.today, label: 'Words practised today' },
      { value: c.mine, label: 'Your tricky words' },
      { value: c.mastered, label: 'Words mastered' },
      { value: c.best, label: 'Best tower' },
    ];
    el.innerHTML = stats
      .map((s) => `<div class="stat-card"><div class="stat-value">${escapeHtml(String(s.value))}</div><div class="stat-label">${escapeHtml(s.label)}</div></div>`)
      .join('');
  }

  function renderModes() {
    const el = document.getElementById('spellingModes');
    if (!el) return;
    el.innerHTML = Object.entries(MODES)
      .map(([key, m]) => `
        <button type="button" class="sp-mode" data-sp="mode" data-mode="${key}">
          <span class="sp-mode-icon">${m.icon}</span>
          <span class="sp-mode-title">${escapeHtml(m.title)}</span>
          <span class="sp-mode-desc">${escapeHtml(m.desc)}</span>
        </button>`)
      .join('');
  }

  function boxDots(box) {
    let out = '';
    for (let i = 0; i < MASTERED_BOX; i++) out += `<span class="sp-dot${i < box ? ' on' : ''}"></span>`;
    return `<span class="sp-dots" title="${box >= MASTERED_BOX ? 'Mastered' : `Level ${box} of ${MASTERED_BOX}`}">${out}</span>`;
  }

  function renderWordList() {
    const list = document.getElementById('spellingWordList');
    if (!list) return;
    document.getElementById('spOnlyMine').checked = !!data.onlyMine;
    if (!data.words.length) {
      list.innerHTML = '<li class="empty-state">No words yet. Add words that autocorrect fixes for you, or just practise. Any word you miss lands here automatically.</li>';
      return;
    }
    const sorted = [...data.words].sort((a, b) => statFor(a.word).box - statFor(b.word).box || b.addedAt - a.addedAt);
    list.innerHTML = sorted
      .map((w) => {
        const s = statFor(w.word);
        const meta = [];
        if (s.right || s.wrong) meta.push(`${s.right} right · ${s.wrong} missed`);
        else meta.push('Not practised yet');
        if (s.lastWrong) meta.push(`last tried "${s.lastWrong}"`);
        if (w.source === 'missed') meta.push('added after a miss');
        return `
          <li class="item-card">
            <div class="item-main">
              <div class="item-title">${escapeHtml(w.word)} ${boxDots(s.box)}</div>
              <div class="item-meta">${escapeHtml(meta.join(' · '))}</div>
            </div>
            ${canSpeak ? `<button type="button" class="edit-btn" data-sp="sayword" data-word="${escapeHtml(w.word)}" aria-label="Hear ${escapeHtml(w.word)}">🔊</button>` : ''}
            <button type="button" class="delete-btn" data-sp="remove" data-id="${escapeHtml(w.id)}" aria-label="Remove ${escapeHtml(w.word)}">✕</button>
          </li>`;
      })
      .join('');
  }

  function renderHome() {
    renderSummary();
    renderWordList();
    renderHabits();
  }

  function renderAll() {
    renderModes();
    renderHome();
    if (typeof renderDashboard === 'function') renderDashboard();
  }

  // ---------- Sound it out finder ----------
  // Uses SoundEngine (sound-engine.js) and the learned data file.
  let engine = null;
  let engineLoading = null;
  let lastQuery = '';
  let lastLearned = '';
  let findTimer = null;

  const CAPITALISED = new Set(['i', 'english', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);

  function displayWord(w) {
    return CAPITALISED.has(w) ? w[0].toUpperCase() + w.slice(1) : w;
  }

  function ensureEngine() {
    if (engine) return Promise.resolve(engine);
    if (engineLoading) return engineLoading;
    if (typeof SoundEngine === 'undefined') return Promise.reject(new Error('Sound engine missing'));
    setFinderStatus('Loading the English sound dictionary…');
    engineLoading = fetch('sound-data.json')
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then((raw) => {
        engine = SoundEngine.create(raw);
        setFinderStatus('');
        renderHabits();
        const input = document.getElementById('soundInput');
        if (input && input.value.trim()) runFind();
        return engine;
      })
      .catch((err) => {
        engineLoading = null;
        setFinderStatus('Could not load the sound dictionary. Check your connection and try again.');
        throw err;
      });
    return engineLoading;
  }

  function setFinderStatus(text) {
    const el = document.getElementById('soundStatus');
    if (el) {
      el.textContent = text;
      el.hidden = !text;
    }
  }

  function scheduleFind() {
    clearTimeout(findTimer);
    findTimer = setTimeout(runFind, 220);
  }

  function runFind() {
    const input = document.getElementById('soundInput');
    const list = document.getElementById('soundResults');
    const query = input.value.trim();
    document.getElementById('soundExplain').innerHTML = '';
    if (!query) {
      list.innerHTML = '';
      lastQuery = '';
      return;
    }
    if (!engine) {
      ensureEngine().catch(() => {});
      return;
    }
    lastQuery = query;
    const results = engine.find(query, { limit: 5, user: data.sound });
    if (!results.length) {
      list.innerHTML = '<li class="sp-muted">No match yet. Try typing more of the word.</li>';
      return;
    }
    const exact = results[0].exact && results[0].chance > 0.5;
    list.innerHTML =
      (exact ? '<li class="sound-ok">✅ That is already a real word. Other words it might be:</li>' : '') +
      results
        .map((r) => {
          const pct = Math.max(1, Math.round(r.chance * 100));
          return `
          <li>
            <button type="button" class="sound-result" data-sp="pick" data-word="${escapeHtml(r.word)}">
              <span class="sound-result-word">${escapeHtml(displayWord(r.word))}</span>
              <span class="sound-bar"><span style="width:${pct}%"></span></span>
              <span class="sound-pct">${r.chance < 0.01 ? '<1' : pct}%</span>
            </button>
          </li>`;
        })
        .join('');
  }

  function pickWord(word) {
    if (!engine) return;
    const typed = lastQuery;
    const info = engine.explain(typed, word, data.sound);
    if (!info) return;
    // Picking a match tells the engine what you meant, so it learns your habits.
    const key = typed.toLowerCase() + '|' + word;
    const learned = typed && SoundEngine.cleanLetters(typed) !== word && key !== lastLearned;
    if (learned) {
      engine.learn(typed, word, data.sound);
      lastLearned = key;
      persist();
      renderHabits();
    }
    if (canSpeak) speak(word);
    const shown = displayWord(word);
    const anyWrong = info.sounds.some((r) => !r.ok);
    const rows = info.sounds
      .map((r) => `
        <tr class="${r.ok ? '' : 'off'}">
          <td>${escapeHtml(r.sound)}</td>
          <td class="sound-chunk">${r.yours === null ? '' : r.yours ? escapeHtml(r.yours) : '<span class="sp-muted">—</span>'}</td>
          <td class="sound-chunk right">${r.right ? escapeHtml(r.right) : '<span class="sp-muted">(silent)</span>'}</td>
        </tr>
        ${r.tip ? `<tr class="sound-tip-row"><td colspan="3">💡 ${escapeHtml(r.tip)}</td></tr>` : ''}`)
      .join('');
    const parts = info.parts.length
      ? `<h4 class="sp-subhead">Word parts</h4>
         <div class="sound-parts">${info.parts.map((p) => `<span class="sound-part ${p.kind}">${escapeHtml(p.text)}</span>`).join('<span class="sp-muted">+</span>')}</div>
         ${info.parts.filter((p) => p.note).map((p) => `<p class="sp-tip">🧩 ${escapeHtml(p.note)}</p>`).join('')}`
      : '';
    document.getElementById('soundExplain').innerHTML = `
      <div class="sound-explain">
        <div class="sound-explain-head">
          <div class="sp-word sp-word-big">${escapeHtml(shown)}</div>
          <div class="sp-feedback-actions">
            ${canSpeak ? `<button type="button" class="secondary-btn" data-sp="sayword" data-word="${escapeHtml(word)}">🔊 Hear</button>` : ''}
            <button type="button" class="secondary-btn" data-sp="copy" data-word="${escapeHtml(shown)}">Copy</button>
            ${isMine(word) ? '' : `<button type="button" class="secondary-btn" data-sp="addtricky" data-word="${escapeHtml(shown)}">+ Tricky words</button>`}
          </div>
        </div>
        <h4 class="sp-subhead">Sound by sound</h4>
        <table class="sound-table">
          <thead><tr><th>Sound</th><th>${typed ? 'You wrote' : ''}</th><th>Spelled</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${!anyWrong && typed ? '<p class="sp-tip">You had every sound right.</p>' : ''}
        ${parts}
        ${learned ? '<p class="sp-added">Got it. The finder now knows a bit more about how you spell.</p>' : ''}
      </div>`;
  }

  // From practice: a wrong answer teaches the finder too, and gives sound tips.
  function learnFromMiss(attempt, word) {
    const w = String(word).toLowerCase();
    if (!engine || !attempt || !engine.has(w) || w.includes(' ')) return [];
    // Only learn from real tries, not from "xx" or a different word.
    const tried = SoundEngine.cleanLetters(attempt);
    if (SoundEngine.editDistance(tried, w, 8) > Math.max(2, Math.ceil(w.length * 0.5))) return [];
    const info = engine.explain(attempt, w, data.sound);
    engine.learn(attempt, w, data.sound);
    persist();
    if (!info) return [];
    return info.sounds
      .filter((r) => !r.ok && r.tip)
      .slice(0, 2)
      .map((r) => `<b>${escapeHtml(r.yours || '—')} → ${escapeHtml(r.right)}</b>: ${escapeHtml(r.tip)}`);
  }

  function renderHabits() {
    const el = document.getElementById('soundHabits');
    if (!el) return;
    const list = engine ? engine.topPatterns(data.sound, 5) : [];
    if (!list.length) {
      el.innerHTML = '<li class="empty-state">Use the finder or practise a few words. Patterns in how you spell will show up here.</li>';
      return;
    }
    el.innerHTML = list
      .map((p) => {
        const key = `${p.unit}|${p.right}|${p.yours}`;
        const example = p.words[0] ? ` e.g. <i>${escapeHtml(displayWord(p.words[0]))}</i>` : '';
        const wrote = p.yours ? `you write <b>${escapeHtml(p.yours)}</b>` : 'you leave it out';
        return `
          <li class="item-card">
            <div class="item-main">
              <div class="item-title">For the ${escapeHtml(p.sound)} sound, ${wrote} where the word uses <b>${escapeHtml(p.right || '(nothing)')}</b></div>
              <div class="item-meta">${p.n} time${p.n === 1 ? '' : 's'}${example}</div>
            </div>
            ${p.right ? `<button type="button" class="secondary-btn" data-sp="pattern" data-key="${escapeHtml(key)}">Practise</button>` : ''}
          </li>`;
      })
      .join('');
  }

  function practisePattern(key) {
    if (!engine) return;
    const p = data.sound.patterns[key];
    if (!p) return;
    const words = shuffle([...new Set([...p.words, ...engine.practiceWords(p.unit, p.right, 12, p.words)])].slice(0, ROUND_SIZE));
    if (!words.length) return showWarning('No practice words found for that pattern yet.');
    startMode('hear', words.map(displayWord), `Practise "${p.right}" for the ${engine.soundName(p.unit)} sound`);
  }

  function copyText(text) {
    const done = () => showToast(`Copied "${text}".`);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => showWarning('Could not copy. Long-press the word to copy it.'));
    } else {
      showWarning('Copy is not available here. Long-press the word to copy it.');
    }
  }

  // ---------- Events ----------
  function onClick(e) {
    const btn = e.target.closest('[data-sp]');
    if (!btn) return;
    const action = btn.dataset.sp;
    if (action === 'mode' || action === 'again') return startMode(btn.dataset.mode);
    if (action === 'quit') return quit();
    if (action === 'next') return next();
    if (action === 'remove') return removeWord(btn.dataset.id);
    if (action === 'sayword') return speak(btn.dataset.word);
    if (action === 'pick') return pickWord(btn.dataset.word);
    if (action === 'copy') return copyText(btn.dataset.word);
    if (action === 'pattern') return practisePattern(btn.dataset.key);
    if (action === 'addtricky') {
      if (addWords(btn.dataset.word, '')) {
        renderHome();
        showToast(`Added "${btn.dataset.word}" to your tricky words.`);
      }
      btn.remove();
      return;
    }

    if (session) {
      const entry = session.entry;
      if (action === 'say') {
        if (canSpeak) sayWord(entry);
        else peek(document.getElementById('spPeek'), entry.word);
      } else if (action === 'sentence') {
        const s = document.getElementById('spSentence');
        s.innerHTML = blankSentence(entry, session.hint);
        s.hidden = false;
        if (canSpeak) saySentence(entry);
      } else if (action === 'hint') {
        session.hint = true;
        const s = document.getElementById('spSentence');
        s.innerHTML = `${blankSentence(entry, true)}<br><span class="sp-muted">${entry.word.length} letters, starts with "${escapeHtml(entry.word[0])}"</span>`;
        s.hidden = false;
        btn.hidden = true;
      } else if (action === 'option' && !session.answered) {
        const choice = session.options[Number(btn.dataset.i)];
        const correct = choice === entry.word;
        document.querySelectorAll('.sp-option').forEach((o, i) => {
          o.disabled = true;
          if (session.options[i] === entry.word) o.classList.add('right');
          else if (i === Number(btn.dataset.i)) o.classList.add('wrong');
        });
        finishQuestion(correct, choice);
      } else if (action === 'token' && !session.fixFound) {
        if (btn.dataset.target) {
          session.fixFound = true;
          btn.classList.add('found');
          document.getElementById('spFixPrompt').textContent = `Found it! Now type "${session.wrongShown}" correctly.`;
          const form = document.getElementById('spAnswerForm');
          form.hidden = false;
          document.getElementById('spAnswer').focus();
        } else {
          btn.classList.remove('shake');
          void btn.offsetWidth;
          btn.classList.add('shake');
          document.getElementById('spFixPrompt').textContent = 'That one is spelled right. Try another word.';
        }
      }
      return;
    }

    if (tower) {
      if (action === 'tsay') {
        if (canSpeak) sayWord(tower.entry);
        else peek(document.getElementById('spPeek'), tower.entry.word, 1500);
      } else if (action === 'tsentence') {
        const s = document.getElementById('towerSentence');
        s.innerHTML = blankSentence(tower.entry, false);
        s.hidden = false;
        if (canSpeak) saySentence(tower.entry);
      } else if (action === 'tnext') {
        nextTowerWord();
      }
    }
  }

  function onSubmit(e) {
    if (e.target.id === 'spAnswerForm') {
      e.preventDefault();
      submitAnswer(document.getElementById('spAnswer').value);
    } else if (e.target.id === 'towerForm') {
      e.preventDefault();
      const val = document.getElementById('spAnswer').value;
      if (!val.trim()) return;
      towerAnswer(val, false);
    }
  }

  function init() {
    data = normalize(load(STORAGE_KEYS.spelling, null));
    const panel = document.getElementById('spelling');
    panel.addEventListener('click', onClick);
    panel.addEventListener('submit', onSubmit);

    document.getElementById('spellingWordForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('spellingWordInput');
      const sentence = document.getElementById('spellingSentenceInput');
      const n = addWords(input.value, sentence.value);
      if (n) {
        input.value = '';
        sentence.value = '';
        renderHome();
        showToast(`Added ${n} word${n === 1 ? '' : 's'}.`);
      } else {
        showWarning('Those words are already on your list.');
      }
    });
    // Leaving the tab ends a round, so the tower timer doesn't run out unseen.
    document.getElementById('tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab-btn');
      if (tab && tab.dataset.tab !== 'spelling' && (session || tower)) quit();
      if (tab && tab.dataset.tab === 'spelling') ensureEngine().catch(() => {});
    });
    const soundInput = document.getElementById('soundInput');
    soundInput.addEventListener('input', scheduleFind);
    soundInput.addEventListener('focus', () => ensureEngine().catch(() => {}));
    document.getElementById('soundForm').addEventListener('submit', (e) => {
      e.preventDefault();
      clearTimeout(findTimer);
      runFind();
      const first = document.querySelector('#soundResults .sound-result');
      if (first) first.click();
    });
    document.getElementById('spOnlyMine').addEventListener('change', (e) => {
      data.onlyMine = e.target.checked;
      persist();
    });

    document.getElementById('spellingSpeechNote').hidden = canSpeak;
    renderModes();
    renderHome();
  }

  // ---------- Hooks used by app.js ----------
  return {
    init,
    reload,
    // Days practised count toward the dashboard activity graph.
    activityCounts() {
      const out = {};
      if (!data) return out;
      Object.entries(data.log).forEach(([d, n]) => {
        if (n > 0) out[d] = 1;
      });
      return out;
    },
    dashboardStats() {
      if (!data) return [];
      const c = counts();
      return [
        { value: c.today, label: 'Words spelled today' },
        { value: c.mastered, label: 'Words mastered' },
      ];
    },
    hasData() {
      return !!data && (data.words.length > 0 || Object.keys(data.stats).length > 0);
    },
    exportData() {
      return data;
    },
    importData(raw) {
      data = normalize(raw);
      lastLearned = '';
      persist();
      quit();
      renderAll();
    },
    // Exposed for tests in the browser console.
    _diffOps: diffOps,
    _generateMisspellings: generateMisspellings,
  };
})();
