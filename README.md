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
