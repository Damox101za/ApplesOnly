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

Data is stored locally in the browser (`localStorage`) — no backend database
required.

## Running locally

```bash
npm install
npm start
```

Then open http://localhost:1337 in your browser.
