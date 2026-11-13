# ApplesOnly

A personal life tracker — tasks, habits, journal, goals, projects and money —
served by a small dependency-free Node.js server.

## Features

- **Today** — your daily home: tasks due and overdue, the habits scheduled for
  today, a progress summary, and rule-based nudges for overdue tasks, lapsed
  habits and streaks at risk.
- **Quick add** — the bar in the header (press `/` to focus it) turns text like
  `pay rent every month !high #goal @project` into a task. It understands
  dates (`tomorrow`, `next friday`, `dec 25`), repeats, priority, a goal
  (`#name`) and a project (`@name`), with a live preview.
- **Search** — press `Ctrl+K` (`⌘K` on a Mac) or the magnifier in the header
  to search tasks, habits, goals, projects, journal entries and tags, and to
  jump to any page. Picking a result opens its page and highlights the item.
- **Tasks** — list and kanban-board views, due dates, priority, daily / weekly /
  monthly repeats, and links to a goal and a project. Import/export `.ics`
  files, and optionally sync two-way with Google Calendar (the Connect button on the Settings
  page; it uses the same Firebase sign-in, so there is nothing extra to set up).
  Adding a task on the Tasks tab needs only a title; due date, priority,
  repeat, goal and project sit under **More options**.
- **Habits** — daily, weekdays, weekends, specific days, or once a week. Streaks
  respect the schedule, so off days never break them.
- **Journal** — entries with a mood and tags, with a tag filter.
- **Goals** — progress comes from the tasks linked to a goal, or a manual +/-
  when none are linked.
- **Projects** — group goals and tasks, with progress rolled up.
- **Life Wheel** — radar chart of 8 life areas scored 0–10. Tag habits with an
  area and the score comes from how often you did them in the last 30 days;
  areas without habits use a manual slider.
- **Money** — a 50/30/20 budget split from your monthly income, with spending
  logged against it: add what you spent (amount, what for, needs / wants /
  savings, date) and each part shows how much is left or how far over you are,
  month by month. Plus a sinking-fund calculator and short budgeting guides.
  Spending syncs, is encrypted, and is part of backups like everything else.
- **Import spending from CSV or Excel** — a bank statement export or your own
  spreadsheet (`.csv` or `.xlsx`). The file doesn't need to be tidy: the
  header row is found below any account details, columns can be in any order
  (date, description, one amount column or separate money out / money in,
  an optional category), and dates and amounts are read in the common
  formats (`13/11/2026`, `13 Nov 2026`, `R1 234,56`, `(250.00)`, `250 DR`...).
  Money coming in is left out, rows you've already logged are spotted, and
  each entry is sorted into needs, wants or savings from its description.
  A preview lets you change any column or category before anything is added,
  and Undo takes a whole import back out. The file is read in your browser
  and never uploaded. Old `.xls` files need saving as `.xlsx` or CSV first.
- **Dashboard** — stats, a task-status breakdown, streak cards and a
  GitHub-style activity heatmap.
- **Settings** — one place for theme, the animated background, Google
  Calendar, `.ics` import/export and backups. A dot on the Settings nav item
  means it has been a week since your last backup.
- **Backup** — export/import all data as JSON (on the Settings page), with undo on deletes and
  automatic schema migrations. Backups can be password-protected: the file is
  encrypted in your browser (AES-256-GCM, key from your password via PBKDF2),
  and there is no way to open it without the password.
- **Keeping your data safe** — see [Data safety](#data-safety).
- **Install as an app** — on a phone or computer, add it to your home screen
  or dock (Settings → Install the app, or Share → Add to Home Screen on an
  iPhone). It opens in its own window and still works with no connection;
  changes sync when you are back online. Offline support needs https (or
  localhost), which Vercel provides.
- **Light and dark themes** — follows your system, or use the toggle in the
  header.
- **Animated background** — a soft, slowly moving banner at the top of every page
  and on the sign-in screen. Turn it off on the Settings page
  (your choice is remembered). It stays still if your system asks for reduced
  motion.

Data is kept in the browser (`localStorage`). When sign-in is set up (below) it
is also saved to your account, so it follows you to any device; see
[Syncing across devices](#syncing-across-devices).

## Sign in with Google (optional)

Sign-in uses [Firebase Authentication](https://firebase.google.com/docs/auth),
which looks after the Google OAuth client for you, so there is no Client ID to
create by hand. Set `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY` **and**
`SESSION_SECRET` and the app asks people to sign in with Google before it
loads. With any of them missing the app stays open, exactly as before, so a
half-finished setup can never lock anyone out. Any Google account can sign in;
your tasks, habits and journal still live in each person's own browser, and
signing out does not erase them.

Put the settings in a `.env` file (copy `.env.example`; it is git-ignored and
never served) or export them as environment variables. Real environment
variables always win over `.env`, so hosted settings are never overridden.

```bash
cp .env.example .env     # then fill in the three values
npm start
```

1. In the [Firebase console](https://console.firebase.google.com/) create a
   project for this app (or add Firebase to an existing Google Cloud project).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**,
   and pick a support email.
3. **Authentication → Settings → Authorized domains**: add your deployed domain
   (for example `applesonly.vercel.app`). `localhost` is already there.
4. **Project settings (gear) → General → Your apps → Web app (`</>`)**: register
   a web app. From its config copy `projectId` and `apiKey`. The API key is not
   a secret; Firebase web keys are meant to be public.
5. Set `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY` and `SESSION_SECRET` (a long
   random string, at least 16 characters; without it sign-in stays off). On
   a host these are its environment settings instead of a `.env` file. Optionally set
   `FIREBASE_AUTH_DOMAIN` if you don't use the default
   `<projectId>.firebaseapp.com`.

How it works: the browser signs in with Firebase's Google popup and sends the
resulting ID token to the server. The server checks it (signature against
Google's published keys, issuer, audience, expiry, issued-at, verified email,
and that the method was Google) and issues its own signed, HttpOnly session
cookie that lasts 7 days. Nothing is stored on the server. Sign-in attempts are
rate-limited.

### On Vercel

Vercel serves `public/` as static files, so the Node server doesn't run there.
Instead `middleware.js` (Vercel Routing Middleware, which runs before static
files) guards the whole site, and `api/auth/` and `api/ai/` are Vercel
Functions. They use the same code as the Node server (`gate.js`, `auth.js`).

1. In the Vercel project settings, add `FIREBASE_PROJECT_ID`,
   `FIREBASE_API_KEY` and `SESSION_SECRET` for the **Production** environment
   only. The names must match exactly. Generate the secret with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. Make sure your production domain is under Firebase's **Authorized domains**.
3. Redeploy. Environment variables only apply to new deployments.

Preview deployments stay open (and are already behind Vercel's own login).
To turn sign-in off again, remove `SESSION_SECRET` and redeploy.

## Syncing across devices

Once sign-in works, your tasks, goals, habits, journal, projects, money and Life
Wheel ratings are also saved under your Google account on the server, a couple of
seconds after each change, and pulled onto any other device you sign in on. The
browser's copy stays the working copy, so the app still opens and works offline;
changes sync when you are back. Theme, background and view settings stay per
device. The sidebar footer shows the state (*Saved to your account*, *Saving…*,
*Offline*).

- **Locally / your own server:** nothing to set up. The copy goes in
  `data/store.json` (git-ignored). Set `DATA_FILE` to put it elsewhere.
- **On Vercel:** in the dashboard open **Storage → Create → Upstash for Redis**
  (free plan is plenty), connect it to the project, and redeploy. It adds
  `KV_REST_API_URL` and `KV_REST_API_TOKEN` itself. Without a store, Vercel
  keeps the old behaviour: data stays on each device.

Each account only ever sees its own data (it is keyed by the verified Google
account, never by anything the browser sends). Saves carry the revision they were
based on, so two devices cannot silently overwrite each other: if both changed
things, lists are merged item by item. A deletion made on one device can come
back if the other device still had that item. Set `DATA_ENCRYPTION_KEY` (see
[Data safety](#data-safety)) so the stored copy is encrypted.

The first time you sign in on a device that already holds data, it is merged with
the account's copy, so nothing on that device is lost. Signing in as a different
Google account on the same browser clears that browser's copy first; it is safe in
the first account.

## Data safety

- **Encrypted storage.** Set `DATA_ENCRYPTION_KEY` (at least 32 characters) and
  each person's synced data is encrypted with AES-256-GCM before it is stored, so
  someone who gets into the database (Upstash or `data/store.json`) sees only
  scrambled text. Make one with:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```

  On Vercel add it under **Settings → Environment Variables** and redeploy.
  Data saved before the key was set is still read and is encrypted on its next
  save. **Keep the key safe and never change it**: without it the synced copy
  can't be read (your devices and backup files still have your data). If the key
  goes missing the server refuses to overwrite encrypted data.
- **Earlier versions.** Before your synced data changes, the account keeps the
  previous copy, at most one every 6 hours and the last 30. Restoring a version
  or importing a backup always keeps one first, so either can be undone. Restore
  from **Settings → Your data → Earlier versions**.
- **Sign out and remove from this device.** In the account menu. Use it on a
  shared computer: it saves any unsynced changes to your account, signs out, and
  removes your data, settings and the offline copy of the app from that browser.
- **Password-protected backups.** See *Backup* above.
- **Security headers.** Every response carries a strict Content Security Policy
  (only this app's own scripts and Google's sign-in code may run), plus
  `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy` and `Strict-Transport-Security`. They live in
  `security.js`, used by both the Node server and Vercel's middleware. Adding a
  new outside service (a script, API or frame) means adding its host there.

## AI helpers (currently turned off)

The code for three helpers is still here — **Plan with AI** (Goals), and a
**decision helper** and **journal summary** (Journal) — but they are switched
off, and none of their controls show. They call Gemini with one server-side
key, which would bill every user's requests to the owner, so they stay off
until usage is charged to each person's own account (see
[issue #9](https://github.com/Damox101za/ApplesOnly/issues/9)).

To try them locally you need both settings; a key alone does nothing:

```bash
AI_ENABLED=true GEMINI_API_KEY=your-key npm start
```

- `GEMINI_MODEL` (default `gemini-2.5-flash`) and `GEMINI_API_BASE` are optional.
- The key stays on the server; the browser only talks to `/api/ai/*`.
- Requests are size-limited and rate-limited (20 per 10 minutes per client,
  300 per hour overall).
- The text you send (a goal, a decision, recent journal entries) goes to
  Google's Gemini API.

## Running locally

```bash
npm install
npm start
```

Then open http://localhost:1337 in your browser.

## Tests

```bash
npm test
```

Runs the server and data tests with Node's built-in test runner: encryption,
the version history, the sign-in gate, security headers, and `/api/data`
against a real server process. The Redis tests run only when a Redis is
listening on `REDIS_PORT` (default 6379); otherwise they are skipped.

```bash
npx playwright install chromium   # once
npm run test:browser
```

Runs the app in a real browser: quick-add parsing, data migrations, habit
streaks, goal progress, `.ics` import, sync merging, password-protected
backups, and a click-through of every page with the Content Security Policy
enforced.

GitHub runs both on every push and pull request (`.github/workflows/tests.yml`,
with a real Redis), so a pull request shows a red cross if something broke.
The live site is deployed by Vercel from `main`.
