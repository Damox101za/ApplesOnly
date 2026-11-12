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

Data is stored locally in the browser (`localStorage`) — no database.

## Optional AI helpers

With a Gemini API key set on the server, three helpers appear: **Plan with AI**
(Goals), and a **decision helper** and **journal summary** (Journal). Without a
key none of them show, and nothing else changes.

```bash
GEMINI_API_KEY=your-key npm start
```

- `GEMINI_MODEL` (default `gemini-2.5-flash`) and `GEMINI_API_BASE` are optional.
- The key stays on the server; the browser only talks to `/api/ai/*`.
- The app has no login, so anyone who can reach your server can use the key.
  Requests are size-limited and rate-limited (20 per 10 minutes per client,
  300 per hour overall), but set a spending cap on the key as well.
- The text you send (a goal, a decision, recent journal entries) is sent to
  Google's Gemini API to generate the answer.

## Running locally

```bash
npm install
npm start
```

Then open http://localhost:1337 in your browser.
