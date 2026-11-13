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
- **Tasks** — list and kanban-board views, due dates, priority, daily / weekly /
  monthly repeats, and links to a goal and a project. Import/export `.ics`
  files, and optionally sync two-way with Google Calendar (enter your own
  Google OAuth client ID on the Tasks tab).
- **Habits** — daily, weekdays, weekends, specific days, or once a week. Streaks
  respect the schedule, so off days never break them.
- **Journal** — entries with a mood and tags, with a tag filter.
- **Goals** — progress comes from the tasks linked to a goal, or a manual +/-
  when none are linked.
- **Projects** — group goals and tasks, with progress rolled up.
- **Life Wheel** — radar chart of 8 life areas scored 0–10. Tag habits with an
  area and the score comes from how often you did them in the last 30 days;
  areas without habits use a manual slider.
- **Money** — a 50/30/20 budget split from your monthly income, a sinking-fund
  calculator, and short budgeting guides.
- **Dashboard** — stats, a task-status breakdown, streak cards and a
  GitHub-style activity heatmap.
- **Backup** — export/import all data as JSON, with undo on deletes and
  automatic schema migrations.
- **Light and dark themes** — follows your system, or use the toggle in the
  header.
- **Animated background** — a soft, slowly moving banner at the top of every page
  and on the sign-in screen. Turn it off with the sparkle button in the header
  (your choice is remembered). It stays still if your system asks for reduced
  motion.

Data is stored locally in the browser (`localStorage`) — no database.

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
   Azure these are app settings instead of a `.env` file. Optionally set
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
