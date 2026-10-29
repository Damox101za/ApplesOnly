# ApplesOnly

A simple personal life tracker — habits, journal, and goals — served by a
minimal Node.js static file server.

## Features

- **Dashboard** — at-a-glance stats: habits done today, best streak, active
  and completed goals, journal entries, and latest mood.
- **Habits** — add daily habits, check them off, and track streaks.
- **Journal** — log entries with a mood and free text.
- **Goals** — add goals with an optional due date and track progress in 10%
  steps.
- **Tasks** — list and kanban-board views (Open / In Progress / Done) with due
  dates. Import/export `.ics` files, and optionally sync two-way with Google
  Calendar (enter your own Google OAuth client ID in the Calendar tab).
- **Activity graph** — a GitHub-style contribution heatmap and streak cards on
  the dashboard, computed from your habit and journal data.
- **Spelling** — a spelling trainer for words autocorrect usually fixes for
  you. Four ways to practise: *Hear it, type it* (the word is read aloud),
  *Spot the right one*, *Fix the sentence*, and *Spelling tower*, a timed
  game where each correct word adds a block. Wrong answers show which letters
  were off, plus a memory tip. Words you miss go to your own list, and spaced
  repetition brings weak words back more often. Autocorrect is switched off
  in the answer boxes so the practice is all you.
- **Sound it out** — type a word the way it sounds (e.g. *nesesery*) and get
  the real spelling (*necessary*), a sound-by-sound breakdown of what was
  different and why, and the word's parts (*un + fortunate + ly*). It learns
  your habits ("you write *s* where words use *c*") and lets you practise the
  pattern. See [How Sound it out works](#how-sound-it-out-works).
- **Levels 1–5** — Starter, Easy, Medium, Hard, Expert. Each level picks
  harder words and changes the game: tower timer, lives, Spot-it choices and
  hints. Score 90%+ and you're offered the next level. See
  [Changing how hard the game is](#changing-how-hard-the-game-is).
- **Pronunciation help** — pick any English voice on your device (South
  African, British, American…) and a speed. Every word can be played normally,
  slowly, or part by part (*nec · es · sar · y*), with a dictionary-style
  "say it" line (**NESS**-uh-sair-ee). British or American spelling style
  (colour/color) is a setting too.
- **Backup** — export/import all data as JSON, with undo on deletes and
  automatic schema migrations.

Data is stored locally in the browser (`localStorage`) — no backend database
required.

## Running locally

```bash
npm install
npm start
```

Then open http://localhost:1337 in your browser.

## How Sound it out works

It uses Bayes' rule, the "noisy channel" model behind spellcheckers:

```
best word = the word w with the highest  P(w) × P(typed | w)
```

- **P(w)** is how common the word is.
- **P(typed | w)** is how likely you'd type those letters for the word's
  sounds: the product of P(your letters | sound) over each sound, found with
  dynamic programming over every way to split your letters into one chunk
  per sound. A plain-typo score (edit distance) is added for slips like *teh*.

**P(letters | sound)** is learned from the CMU Pronouncing Dictionary by
`scripts/build-sound-data.js`. It splits ~30,000 common words into one letter
chunk per sound (*phone* = ph·o·ne) and counts how often each sound is spelled
each way, repeating until the counts settle (Viterbi / hard EM). For example,
the "s" sound is spelled *s* 76% of the time, *c* 9%, *ss* 7%.

Your own habits are blended in as you confirm words:

```
P_you(letters | sound) = (your count + 30 × P_english) / (your total + 30)
```

The engine is in `public/sound-engine.js`; tests are in `test/`.

## Changing how hard the game is

Everything is in the `LEVELS` table at the top of `public/spelling.js`. Each
level has these dials:

| Dial | What it does |
|---|---|
| `roundSize` | Words per practice round |
| `towerStart` | Seconds per word when the tower starts |
| `towerFastest` | The tower timer never goes below this |
| `lives` | Misses allowed in the tower |
| `spotChoices` | Options in "Spot the right one" (2–4) |
| `hints` | Show the hint and sentence buttons |
| `showLetters` | Show how many letters the word has |

Which words each level uses comes from a difficulty score made for every word
when the sound data is built:

```
difficulty = surprise + 0.7 × rarity
```

- **surprise** = −log P(spelling | sounds): how unusual the letters are for
  the way the word sounds. *cat* is low, *colonel* and *rhythm* are high.
- **rarity** = ln(rank + 20) − ln 20: how uncommon the word is.

The 16,000 practice words among the 20,000 most common are sorted by this
score and cut into five equal groups. To make levels lean more on rare words,
raise `RARITY_WEIGHT` in `scripts/build-sound-data.js` and rebuild. Other knobs
in `spelling.js`: `LEVEL_POOL_SIZE` (how many words per level to draw from),
and `LEVEL_UP_SCORE` / `LEVEL_DOWN_SCORE` (when to suggest moving level).

Your tricky words always come up, whatever the level.

### Rebuilding the sound data

`public/sound-data.json` is generated. To rebuild it, download the two sources
and run the script:

```bash
curl -LO https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict
curl -LO https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt
# Optional but recommended: marks names, swear words and UK/US spellings
curl -L -o en.dic https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/en/index.dic
curl -L -o en.aff https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/en/index.aff
curl -L -o en-GB.dic https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/en-GB/index.dic
curl -L -o en-GB.aff https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/en-GB/index.aff
curl -L -o bad.txt https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en

npm run build:sounds -- cmudict.dict en_50k.txt --us en.dic en.aff --gb en-GB.dic en-GB.aff --bad bad.txt
```

Data credits: [CMU Pronouncing Dictionary](https://github.com/cmusphinx/cmudict)
(© Carnegie Mellon University, BSD-style licence) and
[FrequencyWords](https://github.com/hermitdave/FrequencyWords) by Hermit Dave
(CC BY-SA 4.0), plus word flags from the
[Hunspell en_US / en_GB dictionaries](https://github.com/wooorm/dictionaries)
(SCOWL) and the
[LDNOOBW list](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words)
(CC BY 4.0). `public/sound-data.json` is derived from these, so it is shared
under CC BY-SA 4.0.

## Tests

```bash
npm test
```
