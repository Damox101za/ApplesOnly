'use strict';

const STORAGE_KEYS = {
  habits: 'lifeTracker.habits',
  journal: 'lifeTracker.journal',
  goals: 'lifeTracker.goals',
  tasks: 'lifeTracker.tasks',
  schemaVersion: 'lifeTracker.schemaVersion',
  lastBackupAt: 'lifeTracker.lastBackupAt',
  googleClientId: 'lifeTracker.googleClientId',
  lastGoogleSyncAt: 'lifeTracker.lastGoogleSyncAt',
  taskViewMode: 'lifeTracker.taskViewMode',
};

const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const SCHEMA_VERSION = 2;

// ---------- Storage helpers ----------
function safeParse(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function load(key, fallback = []) {
  try {
    return safeParse(localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

function save(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (err) {
    showWarning('Could not save — your browser storage may be full or blocked.');
    return false;
  }
}

function showWarning(message) {
  const el = document.getElementById('warningBanner');
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(showWarning._t);
  showWarning._t = setTimeout(() => el.classList.remove('visible'), 5000);
}

// ---------- Local date helpers (avoid UTC/local-day mismatch) ----------
function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayKey() {
  return localDateKey(new Date());
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- Schema migrations ----------
// Each migration takes the full {habits, journal, goals} bundle at version N-1
// and returns it upgraded to version N. Add new entries here as the data
// model changes; never edit old ones once shipped.
const MIGRATIONS = {
  1(data) {
    // Clean up data that predates versioning: dedupe ids and dedupe
    // per-habit log dates (both could occur from double-clicks/races).
    const seenIds = new Set();
    const dedupeId = (item) => {
      if (seenIds.has(item.id)) item.id = uid();
      seenIds.add(item.id);
      return item;
    };
    data.habits = (data.habits || []).map((h) => {
      h.log = [...new Set(h.log || [])];
      return dedupeId(h);
    });
    data.journal = (data.journal || []).map(dedupeId);
    data.goals = (data.goals || []).map(dedupeId);
    return data;
  },
  2(data) {
    // Replace the old done boolean with a three-state status so tasks can
    // live on a kanban board (todo / in_progress / done).
    data.tasks = (data.tasks || []).map((t) => {
      if (t.status === undefined) {
        t.status = t.done ? 'done' : 'todo';
      }
      delete t.done;
      return t;
    });
    return data;
  },
};

function migrate(data) {
  let version = data.schemaVersion || 0;
  while (MIGRATIONS[version + 1]) {
    data = MIGRATIONS[version + 1](data);
    version++;
  }
  data.schemaVersion = version;
  return data;
}

function loadAndMigrate() {
  const storedVersion = load(STORAGE_KEYS.schemaVersion, 0);
  let data = {
    habits: load(STORAGE_KEYS.habits, []),
    journal: load(STORAGE_KEYS.journal, []),
    goals: load(STORAGE_KEYS.goals, []),
    tasks: load(STORAGE_KEYS.tasks, []),
    schemaVersion: storedVersion,
  };

  if (data.schemaVersion < SCHEMA_VERSION) {
    data = migrate(data);
    save(STORAGE_KEYS.habits, data.habits);
    save(STORAGE_KEYS.journal, data.journal);
    save(STORAGE_KEYS.goals, data.goals);
    save(STORAGE_KEYS.tasks, data.tasks);
    save(STORAGE_KEYS.schemaVersion, data.schemaVersion);
  }

  return data;
}

let { habits, journal, goals, tasks } = loadAndMigrate();

// ---------- Tabs ----------
document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(btn.dataset.tab).classList.add('active');
});

// ---------- Undo-delete ----------
// Deleting an item hides it immediately but defers the actual save+removal
// until the toast times out, so Undo can restore it for free. Only one
// pending delete is tracked at a time; starting a new one finalizes the last.
let pendingDelete = null; // { type, item, index, timer }

function listFor(type) {
  if (type === 'habit') return habits;
  if (type === 'journal') return journal;
  if (type === 'goal') return goals;
  return tasks;
}

function saveList(type) {
  if (type === 'habit') save(STORAGE_KEYS.habits, habits);
  else if (type === 'journal') save(STORAGE_KEYS.journal, journal);
  else if (type === 'goal') save(STORAGE_KEYS.goals, goals);
  else save(STORAGE_KEYS.tasks, tasks);
}

function finalizePendingDelete() {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timer);
  const { type, item } = pendingDelete;
  pendingDelete = null;
  hideToast();
  saveList(type);
  if (type === 'task' && item.googleEventId) {
    deleteTaskFromCalendar(item.googleEventId);
  }
}

function queueDelete(type, list, id, renderFn) {
  finalizePendingDelete();
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) return;
  const [item] = list.splice(index, 1);
  renderFn();
  renderDashboard();
  pendingDelete = {
    type,
    item,
    index,
    timer: setTimeout(finalizePendingDelete, 6000),
  };
  showToast('Deleted.', () => undoDelete(renderFn));
}

function undoDelete(renderFn) {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timer);
  const { type, item, index } = pendingDelete;
  listFor(type).splice(index, 0, item);
  pendingDelete = null;
  hideToast();
  renderFn();
  renderDashboard();
}

function showToast(message, onUndo) {
  const toast = document.getElementById('toast');
  toast.querySelector('.toast-message').textContent = message;
  const undoBtn = toast.querySelector('.toast-undo');
  undoBtn.onclick = onUndo;
  toast.classList.add('visible');
}

function hideToast() {
  document.getElementById('toast').classList.remove('visible');
}

window.addEventListener('beforeunload', finalizePendingDelete);

// ---------- Habits ----------
function habitStreak(habit) {
  let streak = 0;
  const cursor = new Date();
  // If today isn't logged yet, start counting from yesterday so the streak
  // doesn't drop to 0 every morning before you've had a chance to check in.
  if (!habit.log.includes(localDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (habit.log.includes(localDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function renderHabits() {
  const list = document.getElementById('habitList');
  list.innerHTML = '';
  if (habits.length === 0) {
    list.innerHTML = '<li class="empty-state">No habits yet. Add one above.</li>';
    return;
  }
  const today = todayKey();
  habits.forEach((habit) => {
    const done = habit.log.includes(today);
    const li = document.createElement('li');
    li.className = 'item-card';
    li.dataset.id = habit.id;
    li.innerHTML = `
      <button class="check-btn ${done ? 'done' : ''}" data-id="${escapeHtml(habit.id)}" aria-label="Mark done today">${done ? '✓' : ''}</button>
      <div class="item-main">
        <div class="item-title" data-title>${escapeHtml(habit.name)}</div>
        <div class="item-meta">🔥 ${habitStreak(habit)} day streak</div>
      </div>
      <button class="edit-btn" data-edit="${escapeHtml(habit.id)}" aria-label="Edit">✎</button>
      <button class="delete-btn" data-delete="${escapeHtml(habit.id)}" aria-label="Delete">✕</button>
    `;
    list.appendChild(li);
  });
}

document.getElementById('habitForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('habitInput');
  const name = input.value.trim();
  if (!name) return;
  habits.push({ id: uid(), name, log: [] });
  save(STORAGE_KEYS.habits, habits);
  input.value = '';
  renderHabits();
  renderDashboard();
});

document.getElementById('habitList').addEventListener('click', (e) => {
  const checkBtn = e.target.closest('.check-btn');
  const editBtn = e.target.closest('[data-edit]');
  const delBtn = e.target.closest('[data-delete]');
  if (checkBtn) {
    const habit = habits.find((h) => h.id === checkBtn.dataset.id);
    const today = todayKey();
    const idx = habit.log.indexOf(today);
    if (idx >= 0) habit.log.splice(idx, 1);
    else habit.log.push(today);
    save(STORAGE_KEYS.habits, habits);
    renderHabits();
    renderDashboard();
  } else if (editBtn) {
    startHabitEdit(editBtn.dataset.edit);
  } else if (delBtn) {
    queueDelete('habit', habits, delBtn.dataset.delete, renderHabits);
  }
});

function startHabitEdit(id) {
  const habit = habits.find((h) => h.id === id);
  const li = document.querySelector(`#habitList [data-id="${CSS.escape(id)}"]`);
  const titleEl = li.querySelector('[data-title]');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-input';
  input.value = habit.name;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const val = input.value.trim();
    if (val) {
      habit.name = val;
      save(STORAGE_KEYS.habits, habits);
    }
    renderHabits();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') renderHabits();
  });
  input.addEventListener('blur', commit);
}

// ---------- Journal ----------
const MOODS = ['😄', '🙂', '😐', '🙁', '😢'];
let selectedMood = '🙂';
document.getElementById('moodPicker').addEventListener('click', (e) => {
  const btn = e.target.closest('.mood-btn');
  if (!btn) return;
  document.querySelectorAll('#moodPicker .mood-btn').forEach((b) => {
    b.classList.remove('selected');
    b.setAttribute('aria-checked', 'false');
  });
  btn.classList.add('selected');
  btn.setAttribute('aria-checked', 'true');
  selectedMood = btn.dataset.mood;
});

function renderJournal() {
  const list = document.getElementById('journalList');
  list.innerHTML = '';
  if (journal.length === 0) {
    list.innerHTML = '<li class="empty-state">No journal entries yet.</li>';
    return;
  }
  [...journal]
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach((entry) => {
      const li = document.createElement('li');
      li.className = 'item-card';
      li.dataset.id = entry.id;
      const editedTag = entry.editedAt ? ' <span class="edited-tag">(edited)</span>' : '';
      li.innerHTML = `
        <div class="item-main">
          <div class="item-title" data-title>${escapeHtml(entry.mood)} ${new Date(entry.createdAt).toLocaleDateString()}${editedTag}</div>
          <div class="item-text" data-text>${escapeHtml(entry.text)}</div>
        </div>
        <button class="edit-btn" data-edit="${escapeHtml(entry.id)}" aria-label="Edit">✎</button>
        <button class="delete-btn" data-delete="${escapeHtml(entry.id)}" aria-label="Delete">✕</button>
      `;
      list.appendChild(li);
    });
}

document.getElementById('journalForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('journalInput');
  const text = input.value.trim();
  if (!text) return;
  journal.push({ id: uid(), text, mood: selectedMood, createdAt: Date.now() });
  const ok = save(STORAGE_KEYS.journal, journal);
  if (!ok) {
    // Roll back the in-memory push so state matches what's actually saved,
    // and keep the user's text in the box so nothing is lost.
    journal.pop();
    return;
  }
  input.value = '';
  renderJournal();
  renderDashboard();
});

document.getElementById('journalList').addEventListener('click', (e) => {
  const editBtn = e.target.closest('[data-edit]');
  const delBtn = e.target.closest('[data-delete]');
  if (editBtn) {
    startJournalEdit(editBtn.dataset.edit);
  } else if (delBtn) {
    queueDelete('journal', journal, delBtn.dataset.delete, renderJournal);
  }
});

function startJournalEdit(id) {
  const entry = journal.find((j) => j.id === id);
  const li = document.querySelector(`#journalList [data-id="${CSS.escape(id)}"]`);
  const textEl = li.querySelector('[data-text]');

  const wrap = document.createElement('div');
  wrap.className = 'edit-journal';

  const moodRow = document.createElement('div');
  moodRow.className = 'mood-picker';
  MOODS.forEach((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mood-btn' + (m === entry.mood ? ' selected' : '');
    b.dataset.mood = m;
    b.textContent = m;
    moodRow.appendChild(b);
  });
  let editMood = entry.mood;
  moodRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.mood-btn');
    if (!btn) return;
    moodRow.querySelectorAll('.mood-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    editMood = btn.dataset.mood;
  });

  const textarea = document.createElement('textarea');
  textarea.className = 'edit-input';
  textarea.rows = 3;
  textarea.value = entry.text;

  wrap.appendChild(moodRow);
  wrap.appendChild(textarea);
  textEl.replaceWith(wrap);
  textarea.focus();

  const commit = () => {
    const val = textarea.value.trim();
    if (val) {
      entry.text = val;
      entry.mood = editMood;
      entry.editedAt = Date.now();
      save(STORAGE_KEYS.journal, journal);
    }
    renderJournal();
  };
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') renderJournal();
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
  });
  textarea.addEventListener('blur', () => {
    // Allow a click on the mood row without losing the edit.
    setTimeout(() => {
      if (!wrap.contains(document.activeElement)) commit();
    }, 0);
  });
}

// ---------- Goals ----------
function renderGoals() {
  const list = document.getElementById('goalList');
  list.innerHTML = '';
  if (goals.length === 0) {
    list.innerHTML = '<li class="empty-state">No goals yet. Add one above.</li>';
    return;
  }
  goals.forEach((goal) => {
    const li = document.createElement('li');
    li.className = 'item-card';
    li.dataset.id = goal.id;
    const dueText = goal.dueDate ? ` · due ${goal.dueDate}` : '';
    li.innerHTML = `
      <div class="item-main">
        <div class="item-title" data-title>${escapeHtml(goal.title)}${goal.progress >= 100 ? ' 🎉' : ''}</div>
        <div class="item-meta" data-meta>${goal.progress}% complete${dueText}</div>
        <div class="progress-track"><div class="progress-fill" style="width:${goal.progress}%"></div></div>
      </div>
      <div class="goal-controls">
        <button class="step-btn" data-dec="${escapeHtml(goal.id)}">-</button>
        <button class="step-btn" data-inc="${escapeHtml(goal.id)}">+</button>
      </div>
      <button class="edit-btn" data-edit="${escapeHtml(goal.id)}" aria-label="Edit">✎</button>
      <button class="delete-btn" data-delete="${escapeHtml(goal.id)}" aria-label="Delete">✕</button>
    `;
    list.appendChild(li);
  });
}

document.getElementById('goalForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('goalInput');
  const dateInput = document.getElementById('goalDate');
  const title = input.value.trim();
  if (!title) return;
  goals.push({ id: uid(), title, dueDate: dateInput.value || null, progress: 0 });
  save(STORAGE_KEYS.goals, goals);
  input.value = '';
  dateInput.value = '';
  renderGoals();
  renderDashboard();
});

document.getElementById('goalList').addEventListener('click', (e) => {
  const incBtn = e.target.closest('[data-inc]');
  const decBtn = e.target.closest('[data-dec]');
  const editBtn = e.target.closest('[data-edit]');
  const delBtn = e.target.closest('[data-delete]');
  if (incBtn) {
    const goal = goals.find((g) => g.id === incBtn.dataset.inc);
    goal.progress = Math.min(100, goal.progress + 10);
    save(STORAGE_KEYS.goals, goals);
    renderGoals();
    renderDashboard();
  } else if (decBtn) {
    const goal = goals.find((g) => g.id === decBtn.dataset.dec);
    goal.progress = Math.max(0, goal.progress - 10);
    save(STORAGE_KEYS.goals, goals);
    renderGoals();
    renderDashboard();
  } else if (editBtn) {
    startGoalEdit(editBtn.dataset.edit);
  } else if (delBtn) {
    queueDelete('goal', goals, delBtn.dataset.delete, renderGoals);
  }
});

function startGoalEdit(id) {
  const goal = goals.find((g) => g.id === id);
  const li = document.querySelector(`#goalList [data-id="${CSS.escape(id)}"]`);
  const titleEl = li.querySelector('[data-title]');
  const metaEl = li.querySelector('[data-meta]');

  const wrap = document.createElement('div');
  wrap.className = 'edit-goal';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'edit-input';
  titleInput.value = goal.title;
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'edit-input';
  dateInput.value = goal.dueDate || '';
  wrap.appendChild(titleInput);
  wrap.appendChild(dateInput);

  titleEl.replaceWith(wrap);
  metaEl.remove();
  titleInput.focus();
  titleInput.select();

  const commit = () => {
    const val = titleInput.value.trim();
    if (val) {
      goal.title = val;
      goal.dueDate = dateInput.value || null;
      save(STORAGE_KEYS.goals, goals);
      renderDashboard();
    }
    renderGoals();
  };
  [titleInput, dateInput].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') renderGoals();
    });
    el.addEventListener('blur', () => {
      setTimeout(() => {
        if (!wrap.contains(document.activeElement)) commit();
      }, 0);
    });
  });
}

// ---------- Google Calendar ----------
// Client-side-only OAuth via Google Identity Services (no backend, no client
// secret). The Client ID is the user's own — it's not a secret, it just
// identifies which Google Cloud project to authenticate against, so it's
// safe to keep in localStorage. Access tokens are kept in memory only (never
// persisted) since they're short-lived and sensitive; reload = reconnect.
let googleTokenClient = null;
let googleAccessToken = null;
let googleTokenExpiresAt = 0;
let googleConnected = false;

function getGoogleClientId() {
  return load(STORAGE_KEYS.googleClientId, null);
}

function isGoogleConnected() {
  return googleConnected;
}

function ensureGoogleTokenClient() {
  const clientId = getGoogleClientId();
  if (!clientId) throw new Error('Add your Google Client ID first.');
  if (!window.google || !window.google.accounts) {
    throw new Error("Google sign-in script hasn't loaded yet — check your connection and try again.");
  }
  if (!googleTokenClient || googleTokenClient._clientId !== clientId) {
    googleTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_CALENDAR_SCOPE,
      callback: () => {}, // overridden per-request in requestGoogleAccessToken
    });
    googleTokenClient._clientId = clientId;
  }
  return googleTokenClient;
}

function requestGoogleAccessToken(interactive) {
  return new Promise((resolve, reject) => {
    let client;
    try {
      client = ensureGoogleTokenClient();
    } catch (err) {
      reject(err);
      return;
    }
    client.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error));
        return;
      }
      googleAccessToken = resp.access_token;
      googleTokenExpiresAt = Date.now() + resp.expires_in * 1000;
      resolve(googleAccessToken);
    };
    client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

async function calendarFetch(path, options = {}, retried = false) {
  if (!googleAccessToken || Date.now() >= googleTokenExpiresAt - 5000) {
    await requestGoogleAccessToken(!googleAccessToken);
  }
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${googleAccessToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (res.status === 401 && !retried) {
    googleAccessToken = null;
    return calendarFetch(path, options, true);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Calendar error ${res.status}${text ? `: ${text}` : ''}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function setGoogleStatus(text) {
  const el = document.getElementById('googleStatus');
  if (el) el.textContent = text;
}

function updateGoogleUI() {
  const connected = isGoogleConnected();
  document.getElementById('googleConnectBtn').hidden = connected;
  document.getElementById('googleDisconnectBtn').hidden = !connected;
  document.getElementById('googleSyncBtn').hidden = !connected;
  if (connected) {
    const last = load(STORAGE_KEYS.lastGoogleSyncAt, null);
    const lastText = last ? ` · last synced ${new Date(last).toLocaleTimeString()}` : '';
    setGoogleStatus(`Connected${lastText}`);
  } else {
    setGoogleStatus('Not connected.');
  }
}

async function connectGoogleCalendar() {
  try {
    await requestGoogleAccessToken(true);
    // The calendar.events scope covers the Events resource but not
    // Calendars.get, so verify the token with an events call, not a
    // calendar-metadata call (which would 403 with this scope).
    await calendarFetch('/calendars/primary/events?maxResults=1');
    googleConnected = true;
    updateGoogleUI();
    await syncFromGoogleCalendar();
  } catch (err) {
    showWarning('Could not connect to Google Calendar: ' + err.message);
  }
}

function disconnectGoogleCalendar() {
  if (googleAccessToken && window.google && window.google.accounts) {
    google.accounts.oauth2.revoke(googleAccessToken, () => {});
  }
  googleAccessToken = null;
  googleTokenExpiresAt = 0;
  googleConnected = false;
  updateGoogleUI();
}

async function pushTaskToCalendar(task) {
  if (!isGoogleConnected() || !task.dueDate) return;
  const body = {
    summary: task.title,
    start: { date: task.dueDate },
    end: { date: task.dueDate },
    extendedProperties: { private: { appleTaskApp: 'true', appleTaskId: task.id } },
  };
  try {
    let ev;
    if (task.googleEventId) {
      ev = await calendarFetch(`/calendars/primary/events/${task.googleEventId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    } else {
      ev = await calendarFetch('/calendars/primary/events', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      task.googleEventId = ev.id;
    }
    save(STORAGE_KEYS.tasks, tasks);
    renderTasksView();
  } catch (err) {
    showWarning('Could not sync task to Google Calendar: ' + err.message);
  }
}

async function deleteTaskFromCalendar(googleEventId) {
  try {
    await calendarFetch(`/calendars/primary/events/${googleEventId}`, { method: 'DELETE' });
  } catch (err) {
    showWarning('Could not remove the matching Google Calendar event: ' + err.message);
  }
}

function eventDueDate(ev) {
  return ev.start && (ev.start.date || (ev.start.dateTime || '').slice(0, 10));
}

async function tagEventAsTask(googleEventId, taskId) {
  try {
    await calendarFetch(`/calendars/primary/events/${googleEventId}`, {
      method: 'PATCH',
      body: JSON.stringify({ extendedProperties: { private: { appleTaskApp: 'true', appleTaskId: taskId } } }),
    });
  } catch (err) {
    // Import still succeeds locally even if tagging fails — worst case this
    // event gets re-checked as "untagged" on the next sync.
  }
}

async function syncFromGoogleCalendar() {
  if (!isGoogleConnected()) return;
  try {
    const tracked = new URLSearchParams({
      privateExtendedProperty: 'appleTaskApp=true',
      showDeleted: 'false',
      singleEvents: 'true',
      maxResults: '250',
    });
    const trackedData = await calendarFetch(`/calendars/primary/events?${tracked}`);

    // Also pull everything else on the primary calendar in a near-term
    // window, so an event added straight in Google Calendar (never touched
    // by this app) shows up as a task too — not just round-tripped edits to
    // tasks the app already created.
    const now = Date.now();
    const windowParams = new URLSearchParams({
      timeMin: new Date(now - 30 * 86400000).toISOString(),
      timeMax: new Date(now + 90 * 86400000).toISOString(),
      showDeleted: 'false',
      singleEvents: 'true',
      maxResults: '250',
      orderBy: 'startTime',
    });
    const windowData = await calendarFetch(`/calendars/primary/events?${windowParams}`);

    const remoteById = new Map();
    (trackedData.items || []).forEach((ev) => remoteById.set(ev.id, ev));
    (windowData.items || []).forEach((ev) => remoteById.set(ev.id, ev));

    let changed = false;
    tasks.forEach((task) => {
      if (!task.googleEventId) return;
      const ev = remoteById.get(task.googleEventId);
      if (!ev) {
        // Removed on Google's side — unlink but keep the local task, so a
        // calendar-side delete never silently destroys tracked data here.
        task.googleEventId = null;
        changed = true;
        return;
      }
      const remoteDue = eventDueDate(ev);
      if (ev.summary && ev.summary !== task.title) {
        task.title = ev.summary;
        changed = true;
      }
      if (remoteDue && remoteDue !== task.dueDate) {
        task.dueDate = remoteDue;
        changed = true;
      }
    });

    const linkedIds = new Set(tasks.map((t) => t.googleEventId).filter(Boolean));
    const imported = [];
    (windowData.items || []).forEach((ev) => {
      if (ev.status === 'cancelled' || linkedIds.has(ev.id)) return;
      if (ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.appleTaskApp === 'true') return;
      const dueDate = eventDueDate(ev);
      if (!dueDate) return;
      const task = { id: uid(), title: ev.summary || '(untitled event)', dueDate, status: 'todo', googleEventId: ev.id };
      tasks.push(task);
      linkedIds.add(ev.id);
      imported.push(task);
      changed = true;
    });

    if (changed) {
      save(STORAGE_KEYS.tasks, tasks);
      renderTasksView();
      renderDashboard();
    }
    save(STORAGE_KEYS.lastGoogleSyncAt, Date.now());
    updateGoogleUI();

    // Tag imports after the local state is saved so a page reload never
    // loses the task even if these PATCH calls are slow or fail.
    await Promise.all(imported.map((task) => tagEventAsTask(task.googleEventId, task.id)));
  } catch (err) {
    showWarning('Google Calendar sync failed: ' + err.message);
  }
}

document.getElementById('googleConnectBtn').addEventListener('click', connectGoogleCalendar);
document.getElementById('googleDisconnectBtn').addEventListener('click', disconnectGoogleCalendar);
document.getElementById('googleSyncBtn').addEventListener('click', syncFromGoogleCalendar);
document.getElementById('googleClientIdSaveBtn').addEventListener('click', () => {
  const input = document.getElementById('googleClientIdInput');
  const value = input.value.trim();
  if (!value) return;
  save(STORAGE_KEYS.googleClientId, value);
  googleTokenClient = null; // force re-init against the new client id
  showWarning('Google Client ID saved. Click Connect to sign in.');
});

(function initGoogleClientIdField() {
  const saved = getGoogleClientId();
  if (saved) document.getElementById('googleClientIdInput').value = saved;
  updateGoogleUI();
})();

// ---------- Tasks ----------
const TASK_STATUSES = ['todo', 'in_progress', 'done'];
const TASK_STATUS_LABELS = { todo: 'Open', in_progress: 'In Progress', done: 'Done' };

function taskMeta(task, today) {
  const overdue = task.dueDate && task.dueDate < today && task.status !== 'done';
  const dueText = task.dueDate ? ` · due ${task.dueDate}` : '';
  const label = overdue ? 'Overdue' : TASK_STATUS_LABELS[task.status];
  return { overdue, dueText, label };
}

function taskCardHTML(task, today) {
  const { overdue, dueText, label } = taskMeta(task, today);
  const syncBadge = task.googleEventId ? '<span class="sync-badge">📅 synced</span>' : '';
  return `
    <button class="check-btn ${task.status === 'done' ? 'done' : ''}" data-id="${escapeHtml(task.id)}" aria-label="Mark done">${task.status === 'done' ? '✓' : ''}</button>
    <div class="item-main">
      <div class="item-title" data-title>${escapeHtml(task.title)}</div>
      <div class="item-meta ${overdue ? 'overdue' : ''}" data-meta>${escapeHtml(label)}${escapeHtml(dueText)} ${syncBadge}</div>
    </div>
    <button class="edit-btn" data-edit="${escapeHtml(task.id)}" aria-label="Edit">✎</button>
    <button class="delete-btn" data-delete="${escapeHtml(task.id)}" aria-label="Delete">✕</button>
  `;
}

function sortedTasks() {
  return [...tasks].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
}

function renderTasks() {
  const list = document.getElementById('taskList');
  list.innerHTML = '';
  if (tasks.length === 0) {
    list.innerHTML = '<li class="empty-state">No tasks yet. Add one above.</li>';
    return;
  }
  const today = todayKey();
  sortedTasks().forEach((task) => {
    const li = document.createElement('li');
    li.className = 'item-card';
    li.dataset.id = task.id;
    li.innerHTML = taskCardHTML(task, today);
    list.appendChild(li);
  });
}

// ---------- Task board (kanban) ----------
function renderBoard() {
  const board = document.getElementById('taskBoard');
  board.innerHTML = '';
  const today = todayKey();
  const byStatus = sortedTasks().reduce(
    (acc, t) => {
      (acc[t.status] || acc.todo).push(t);
      return acc;
    },
    { todo: [], in_progress: [], done: [] }
  );

  TASK_STATUSES.forEach((status) => {
    const col = document.createElement('div');
    col.className = 'board-column';
    col.dataset.status = status;
    const statusIdx = TASK_STATUSES.indexOf(status);
    const cards = byStatus[status]
      .map((task) => {
        const { overdue, dueText, label } = taskMeta(task, today);
        const syncBadge = task.googleEventId ? '<span class="sync-badge">📅 synced</span>' : '';
        return `
        <li class="item-card board-card" draggable="true" data-id="${escapeHtml(task.id)}">
          <div class="item-main">
            <div class="item-title" data-title>${escapeHtml(task.title)}</div>
            <div class="item-meta ${overdue ? 'overdue' : ''}" data-meta>${escapeHtml(label)}${escapeHtml(dueText)} ${syncBadge}</div>
          </div>
          <div class="board-card-actions">
            <button class="board-move-btn" data-move="prev" data-id="${escapeHtml(task.id)}" aria-label="Move left" ${statusIdx === 0 ? 'disabled' : ''}>‹</button>
            <button class="board-move-btn" data-move="next" data-id="${escapeHtml(task.id)}" aria-label="Move right" ${statusIdx === TASK_STATUSES.length - 1 ? 'disabled' : ''}>›</button>
            <button class="edit-btn" data-edit="${escapeHtml(task.id)}" aria-label="Edit">✎</button>
            <button class="delete-btn" data-delete="${escapeHtml(task.id)}" aria-label="Delete">✕</button>
          </div>
        </li>`;
      })
      .join('');
    col.innerHTML = `
      <div class="board-column-header">
        <span>${escapeHtml(TASK_STATUS_LABELS[status])}</span>
        <span class="board-count">${byStatus[status].length}</span>
      </div>
      <ul class="board-card-list">${cards || '<li class="empty-state board-empty">No tasks</li>'}</ul>
    `;
    board.appendChild(col);
  });
}

function setTaskStatus(id, newStatus) {
  const task = tasks.find((t) => t.id === id);
  if (!task || task.status === newStatus) return;
  task.status = newStatus;
  save(STORAGE_KEYS.tasks, tasks);
  // Kanban status has no Google Calendar equivalent, so this deliberately
  // never calls pushTaskToCalendar() — only title/date edits sync.
  renderTasksView();
  renderDashboard();
}

// ---------- List / Board view toggle ----------
let taskViewMode = load(STORAGE_KEYS.taskViewMode, 'list');

function renderTasksView() {
  const isBoard = taskViewMode === 'board';
  document.getElementById('taskList').hidden = isBoard;
  document.getElementById('taskBoard').hidden = !isBoard;
  document.querySelectorAll('#taskViewToggle .view-toggle-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === taskViewMode);
  });
  if (isBoard) renderBoard();
  else renderTasks();
}

document.getElementById('taskViewToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  taskViewMode = btn.dataset.view;
  save(STORAGE_KEYS.taskViewMode, taskViewMode);
  renderTasksView();
});

document.getElementById('taskForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('taskInput');
  const dateInput = document.getElementById('taskDate');
  const title = input.value.trim();
  if (!title) return;
  const task = { id: uid(), title, dueDate: dateInput.value || null, status: 'todo', googleEventId: null };
  tasks.push(task);
  const ok = save(STORAGE_KEYS.tasks, tasks);
  if (!ok) {
    tasks.pop();
    return;
  }
  input.value = '';
  dateInput.value = '';
  renderTasksView();
  renderDashboard();
  pushTaskToCalendar(task);
});

document.getElementById('taskList').addEventListener('click', (e) => {
  const checkBtn = e.target.closest('.check-btn');
  const editBtn = e.target.closest('[data-edit]');
  const delBtn = e.target.closest('[data-delete]');
  if (checkBtn) {
    const task = tasks.find((t) => t.id === checkBtn.dataset.id);
    setTaskStatus(task.id, task.status === 'done' ? 'todo' : 'done');
  } else if (editBtn) {
    startTaskEdit(editBtn.dataset.edit);
  } else if (delBtn) {
    queueDelete('task', tasks, delBtn.dataset.delete, renderTasksView);
  }
});

document.getElementById('taskBoard').addEventListener('click', (e) => {
  const moveBtn = e.target.closest('[data-move]');
  const editBtn = e.target.closest('[data-edit]');
  const delBtn = e.target.closest('[data-delete]');
  if (moveBtn) {
    const task = tasks.find((t) => t.id === moveBtn.dataset.id);
    const idx = TASK_STATUSES.indexOf(task.status) + (moveBtn.dataset.move === 'next' ? 1 : -1);
    if (idx >= 0 && idx < TASK_STATUSES.length) setTaskStatus(task.id, TASK_STATUSES[idx]);
  } else if (editBtn) {
    startTaskEdit(editBtn.dataset.edit);
  } else if (delBtn) {
    queueDelete('task', tasks, delBtn.dataset.delete, renderTasksView);
  }
});

document.getElementById('taskBoard').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.board-card');
  if (!card) return;
  e.dataTransfer.setData('text/plain', card.dataset.id);
  card.classList.add('dragging');
});

document.getElementById('taskBoard').addEventListener('dragend', (e) => {
  const card = e.target.closest('.board-card');
  if (card) card.classList.remove('dragging');
});

document.getElementById('taskBoard').addEventListener('dragover', (e) => {
  const col = e.target.closest('.board-column');
  if (!col) return;
  e.preventDefault();
  col.classList.add('drag-over');
});

document.getElementById('taskBoard').addEventListener('dragleave', (e) => {
  const col = e.target.closest('.board-column');
  if (col) col.classList.remove('drag-over');
});

document.getElementById('taskBoard').addEventListener('drop', (e) => {
  const col = e.target.closest('.board-column');
  if (!col) return;
  e.preventDefault();
  col.classList.remove('drag-over');
  const id = e.dataTransfer.getData('text/plain');
  if (id) setTaskStatus(id, col.dataset.status);
});

function startTaskEdit(id) {
  const task = tasks.find((t) => t.id === id);
  const li = document.querySelector(`#taskList [data-id="${CSS.escape(id)}"], #taskBoard [data-id="${CSS.escape(id)}"]`);
  const titleEl = li.querySelector('[data-title]');
  const metaEl = li.querySelector('[data-meta]');

  const wrap = document.createElement('div');
  wrap.className = 'edit-goal';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'edit-input';
  titleInput.value = task.title;
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'edit-input';
  dateInput.value = task.dueDate || '';
  wrap.appendChild(titleInput);
  wrap.appendChild(dateInput);

  titleEl.replaceWith(wrap);
  metaEl.remove();
  titleInput.focus();
  titleInput.select();

  const commit = () => {
    const val = titleInput.value.trim();
    if (val) {
      task.title = val;
      task.dueDate = dateInput.value || null;
      save(STORAGE_KEYS.tasks, tasks);
      pushTaskToCalendar(task);
      renderDashboard();
    }
    renderTasksView();
  };
  [titleInput, dateInput].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') renderTasksView();
    });
    el.addEventListener('blur', () => {
      setTimeout(() => {
        if (!wrap.contains(document.activeElement)) commit();
      }, 0);
    });
  });
}

// ---------- .ics import / export ----------
// Lets tasks round-trip through any calendar app (not just Google): export
// writes a standard iCalendar file, import reads one (e.g. a forwarded
// meeting invite) and turns each VEVENT into a task.
function icsUnescapeText(str) {
  return str.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function icsEscapeText(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function icsDateValueToLocalDateKey(value) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseICS(text) {
  // Unfold RFC5545 continuation lines (a line starting with a space/tab
  // continues the previous line) before parsing property:value pairs.
  const rawLines = text.split(/\r\n|\n|\r/);
  const lines = [];
  rawLines.forEach((line) => {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  });

  const events = [];
  let current = null;
  lines.forEach((line) => {
    if (line === 'BEGIN:VEVENT') {
      current = {};
    } else if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      const idx = line.indexOf(':');
      if (idx === -1) return;
      const key = line.slice(0, idx).split(';')[0].toUpperCase();
      const value = line.slice(idx + 1);
      if (key === 'SUMMARY') current.summary = icsUnescapeText(value);
      else if (key === 'DTSTART') current.dtstart = value;
      else if (key === 'UID') current.uid = value;
    }
  });

  return events
    .map((ev) => ({
      title: ev.summary || 'Untitled event',
      dueDate: icsDateValueToLocalDateKey(ev.dtstart),
      uid: ev.uid || null,
    }))
    .filter((ev) => ev.dueDate);
}

function exportTasksAsICS() {
  const withDates = tasks.filter((t) => t.dueDate);
  if (withDates.length === 0) {
    showWarning('No tasks with a due date to export.');
    return;
  }
  const stampDate = `${todayKey().replace(/-/g, '')}T000000Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ApplesOnly//Tasks//EN', 'CALSCALE:GREGORIAN'];
  withDates.forEach((t) => {
    const dateStr = t.dueDate.replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${t.icsUid || t.id}@applesonly`,
      `DTSTAMP:${stampDate}`,
      `DTSTART;VALUE=DATE:${dateStr}`,
      `DTEND;VALUE=DATE:${dateStr}`,
      `SUMMARY:${icsEscapeText(t.title)}`,
      `STATUS:${t.status === 'done' ? 'CONFIRMED' : 'NEEDS-ACTION'}`,
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `apples-only-tasks-${todayKey()}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

let pendingICSImport = null;

function handleICSFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let events;
    try {
      events = parseICS(reader.result);
    } catch {
      showWarning("Could not read that .ics file.");
      return;
    }
    if (events.length === 0) {
      showWarning('No dated events found in that file.');
      return;
    }
    pendingICSImport = events;
    document.getElementById('icsImportSummary').textContent =
      `Found ${events.length} event(s) in this file. Add them as tasks?`;
    document.getElementById('icsImportConfirm').classList.add('visible');
  };
  reader.readAsText(file);
}

function confirmICSImport() {
  if (!pendingICSImport) return;
  const existingUids = new Set(tasks.map((t) => t.icsUid).filter(Boolean));
  const newTasks = [];
  pendingICSImport.forEach((ev) => {
    if (ev.uid && existingUids.has(ev.uid)) return; // already imported previously
    const task = { id: uid(), title: ev.title, dueDate: ev.dueDate, status: 'todo', googleEventId: null, icsUid: ev.uid || null };
    tasks.push(task);
    newTasks.push(task);
  });
  const skipped = pendingICSImport.length - newTasks.length;
  save(STORAGE_KEYS.tasks, tasks);
  renderTasksView();
  renderDashboard();
  newTasks.forEach((task) => {
    if (task.dueDate) pushTaskToCalendar(task);
  });
  cancelICSImport();
  showWarning(`Imported ${newTasks.length} task(s).${skipped ? ` Skipped ${skipped} already-imported duplicate(s).` : ''}`);
}

function cancelICSImport() {
  pendingICSImport = null;
  document.getElementById('icsImportConfirm').classList.remove('visible');
  document.getElementById('icsImportFile').value = '';
}

document.getElementById('icsExportBtn').addEventListener('click', exportTasksAsICS);
document.getElementById('icsImportFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleICSFile(file);
});
document.getElementById('icsImportConfirmBtn').addEventListener('click', confirmICSImport);
document.getElementById('icsImportCancelBtn').addEventListener('click', cancelICSImport);

// ---------- Backup: export / import ----------
function hasAnyData() {
  return habits.length > 0 || journal.length > 0 || goals.length > 0 || tasks.length > 0;
}

function daysSinceLastBackup() {
  const last = load(STORAGE_KEYS.lastBackupAt, null);
  if (!last) return Infinity;
  return (Date.now() - last) / (1000 * 60 * 60 * 24);
}

function exportBackup() {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    habits,
    journal,
    goals,
    tasks,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = todayKey();
  a.href = url;
  a.download = `apples-only-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  save(STORAGE_KEYS.lastBackupAt, Date.now());
  renderDashboard();
}

function isValidBackup(data) {
  return (
    data &&
    typeof data === 'object' &&
    Array.isArray(data.habits) &&
    Array.isArray(data.journal) &&
    Array.isArray(data.goals) &&
    (data.tasks === undefined || Array.isArray(data.tasks))
  );
}

let pendingImport = null;

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch {
      showWarning('That file isn’t valid JSON.');
      return;
    }
    if (!isValidBackup(data)) {
      showWarning('That file doesn’t look like an ApplesOnly backup.');
      return;
    }
    pendingImport = data;
    const summary = document.getElementById('importSummary');
    const taskCount = Array.isArray(data.tasks) ? data.tasks.length : 0;
    summary.textContent =
      `This file has ${data.habits.length} habit(s), ${data.journal.length} journal entr${data.journal.length === 1 ? 'y' : 'ies'}, ` +
      `${data.goals.length} goal(s), and ${taskCount} task(s)` +
      (data.exportedAt ? `, exported ${new Date(data.exportedAt).toLocaleString()}` : '') +
      '. Importing will replace your current data. Continue?';
    document.getElementById('importConfirm').classList.add('visible');
  };
  reader.readAsText(file);
}

function confirmImport() {
  if (!pendingImport) return;
  const previous = { habits, journal, goals, tasks };
  const migrated = migrate({
    habits: pendingImport.habits,
    journal: pendingImport.journal,
    goals: pendingImport.goals,
    tasks: Array.isArray(pendingImport.tasks) ? pendingImport.tasks : [],
    schemaVersion: pendingImport.schemaVersion || 0,
  });
  habits = migrated.habits;
  journal = migrated.journal;
  goals = migrated.goals;
  tasks = migrated.tasks;
  save(STORAGE_KEYS.habits, habits);
  save(STORAGE_KEYS.journal, journal);
  save(STORAGE_KEYS.goals, goals);
  save(STORAGE_KEYS.tasks, tasks);
  save(STORAGE_KEYS.schemaVersion, migrated.schemaVersion);
  renderHabits();
  renderJournal();
  renderGoals();
  renderTasksView();
  renderDashboard();
  cancelImport();
  showToast('Backup imported.', () => {
    habits = previous.habits;
    journal = previous.journal;
    goals = previous.goals;
    tasks = previous.tasks;
    save(STORAGE_KEYS.habits, habits);
    save(STORAGE_KEYS.journal, journal);
    save(STORAGE_KEYS.goals, goals);
    save(STORAGE_KEYS.tasks, tasks);
    renderHabits();
    renderJournal();
    renderGoals();
    renderTasksView();
    renderDashboard();
    hideToast();
  });
}

function cancelImport() {
  pendingImport = null;
  document.getElementById('importConfirm').classList.remove('visible');
  document.getElementById('importFile').value = '';
}

document.getElementById('exportBtn').addEventListener('click', exportBackup);
document.getElementById('importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleImportFile(file);
});
document.getElementById('importConfirmBtn').addEventListener('click', confirmImport);
document.getElementById('importCancelBtn').addEventListener('click', cancelImport);

// ---------- Cross-tab sync ----------
window.addEventListener('storage', (e) => {
  if (!Object.values(STORAGE_KEYS).includes(e.key)) return;
  finalizePendingDelete();
  habits = load(STORAGE_KEYS.habits, []);
  journal = load(STORAGE_KEYS.journal, []);
  goals = load(STORAGE_KEYS.goals, []);
  tasks = load(STORAGE_KEYS.tasks, []);
  renderHabits();
  renderJournal();
  renderGoals();
  renderTasksView();
  renderDashboard();
});

// ---------- Activity heatmap ----------
const HEATMAP_WEEKS = 53;

function activityCounts() {
  const counts = {};
  habits.forEach((h) => {
    h.log.forEach((d) => {
      counts[d] = (counts[d] || 0) + 1;
    });
  });
  journal.forEach((entry) => {
    const d = localDateKey(new Date(entry.createdAt));
    counts[d] = (counts[d] || 0) + 1;
  });
  return counts;
}

function activityStreaks(counts) {
  let current = 0;
  const cursor = new Date();
  if (!counts[localDateKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  while (counts[localDateKey(cursor)]) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const days = Object.keys(counts).sort();
  let longest = 0;
  let run = 0;
  let prevKey = null;
  days.forEach((d) => {
    if (prevKey) {
      const expected = new Date(prevKey + 'T00:00:00');
      expected.setDate(expected.getDate() + 1);
      run = localDateKey(expected) === d ? run + 1 : 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prevKey = d;
  });

  const totalEvents = Object.values(counts).reduce((a, b) => a + b, 0);
  return { current, longest, activeDays: days.length, totalEvents };
}

function heatLevel(count) {
  if (!count) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

function renderActivity() {
  const counts = activityCounts();
  const stats = activityStreaks(counts);

  const grid = document.getElementById('streakGrid');
  grid.innerHTML = [
    { value: stats.current, label: 'Current streak (days)' },
    { value: stats.longest, label: 'Longest streak (days)' },
    { value: stats.activeDays, label: 'Active days total' },
    { value: stats.totalEvents, label: 'Total check-ins' },
  ]
    .map(
      (s) => `
      <div class="stat-card">
        <div class="stat-value">${escapeHtml(String(s.value))}</div>
        <div class="stat-label">${escapeHtml(s.label)}</div>
      </div>`
    )
    .join('');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay())); // round out to end of this week (Sat)
  const start = new Date(end);
  start.setDate(start.getDate() - (HEATMAP_WEEKS * 7 - 1));

  const heatmap = document.getElementById('activityHeatmap');
  const monthsRow = document.getElementById('activityMonths');
  heatmap.innerHTML = '';
  monthsRow.innerHTML = '';

  let cursor = new Date(start);
  let prevMonth = null;
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    const label = document.createElement('div');
    label.className = 'heatmap-month-label';
    if (cursor.getMonth() !== prevMonth) {
      label.textContent = cursor.toLocaleDateString(undefined, { month: 'short' });
      prevMonth = cursor.getMonth();
    }
    monthsRow.appendChild(label);

    const col = document.createElement('div');
    col.className = 'heatmap-col';
    for (let d = 0; d < 7; d++) {
      const inRange = cursor <= today;
      const key = localDateKey(cursor);
      const count = counts[key] || 0;
      const cell = document.createElement('div');
      cell.className = `heatmap-cell ${inRange ? `heat-${heatLevel(count)}` : 'heat-empty'}`;
      if (inRange) {
        cell.title = `${count} ${count === 1 ? 'check-in' : 'check-ins'} on ${key}`;
      }
      col.appendChild(cell);
      cursor.setDate(cursor.getDate() + 1);
    }
    heatmap.appendChild(col);
  }
}

// ---------- Calendar ----------
let calendarViewDate = new Date();
calendarViewDate.setDate(1);
let calendarSelectedDay = null;

function getMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay()); // back up to the Sunday on/before the 1st
  const days = [];
  const cursor = new Date(start);
  for (let i = 0; i < 42; i++) {
    days.push({ date: new Date(cursor), key: localDateKey(cursor), inMonth: cursor.getMonth() === month });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function itemsByDueDate() {
  const map = {};
  tasks.forEach((t) => {
    if (!t.dueDate) return;
    (map[t.dueDate] = map[t.dueDate] || { tasks: [], goals: [] }).tasks.push(t);
  });
  goals.forEach((g) => {
    if (!g.dueDate) return;
    (map[g.dueDate] = map[g.dueDate] || { tasks: [], goals: [] }).goals.push(g);
  });
  return map;
}

function renderCalendar() {
  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth();
  document.getElementById('calendarMonthLabel').textContent = calendarViewDate.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const today = todayKey();
  const byDate = itemsByDueDate();
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  getMonthGrid(year, month).forEach((day) => {
    const entry = byDate[day.key];
    const itemCount = entry ? entry.tasks.length + entry.goals.length : 0;
    const overdue = entry && entry.tasks.some((t) => t.status !== 'done' && day.key < today);
    const firstTitle = entry ? (entry.tasks[0] || entry.goals[0]).title : '';

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'calendar-day';
    if (!day.inMonth) cell.classList.add('other-month');
    if (day.key === today) cell.classList.add('today');
    if (day.key === calendarSelectedDay) cell.classList.add('selected');
    cell.dataset.date = day.key;
    cell.innerHTML = `
      <span class="calendar-day-num">${day.date.getDate()}</span>
      ${itemCount ? `<span class="calendar-day-badge ${overdue ? 'overdue' : ''}">${itemCount}</span>` : ''}
      ${firstTitle ? `<span class="calendar-day-preview">${escapeHtml(firstTitle)}</span>` : ''}
    `;
    grid.appendChild(cell);
  });

  renderCalendarDayDetail(calendarSelectedDay);
}

function renderCalendarDayDetail(dateKey) {
  const panel = document.getElementById('calendarDayDetail');
  const byDate = itemsByDueDate();
  const entry = dateKey && byDate[dateKey];
  if (!entry) {
    panel.hidden = true;
    return;
  }
  const today = todayKey();
  document.getElementById('calendarDayDetailTitle').textContent = new Date(`${dateKey}T00:00:00`).toLocaleDateString(
    undefined,
    { weekday: 'long', month: 'long', day: 'numeric' }
  );
  const list = document.getElementById('calendarDayDetailList');
  const taskRows = entry.tasks.map((t) => {
    const overdue = t.status !== 'done' && dateKey < today;
    return `<li class="item-card"><div class="item-main"><div class="item-title">📋 ${escapeHtml(t.title)}</div><div class="item-meta ${overdue ? 'overdue' : ''}">${escapeHtml(TASK_STATUS_LABELS[t.status])}</div></div></li>`;
  });
  const goalRows = entry.goals.map(
    (g) =>
      `<li class="item-card"><div class="item-main"><div class="item-title">🎯 ${escapeHtml(g.title)}</div><div class="item-meta">${g.progress}% complete</div></div></li>`
  );
  list.innerHTML = taskRows.concat(goalRows).join('') || '<li class="empty-state">Nothing due.</li>';
  panel.hidden = false;
}

document.getElementById('calendarPrevBtn').addEventListener('click', () => {
  calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
  renderCalendar();
});

document.getElementById('calendarNextBtn').addEventListener('click', () => {
  calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
  renderCalendar();
});

document.getElementById('calendarTodayBtn').addEventListener('click', () => {
  calendarViewDate = new Date();
  calendarViewDate.setDate(1);
  calendarSelectedDay = todayKey();
  renderCalendar();
});

document.getElementById('calendarGrid').addEventListener('click', (e) => {
  const cell = e.target.closest('.calendar-day');
  if (!cell) return;
  calendarSelectedDay = calendarSelectedDay === cell.dataset.date ? null : cell.dataset.date;
  renderCalendar();
});

// ---------- Dashboard ----------
function renderDashboard() {
  const grid = document.getElementById('dashboardGrid');
  const today = todayKey();
  const habitsDoneToday = habits.filter((h) => h.log.includes(today)).length;
  const bestStreak = habits.reduce((max, h) => Math.max(max, habitStreak(h)), 0);
  const activeGoals = goals.filter((g) => g.progress < 100).length;
  const completedGoals = goals.filter((g) => g.progress >= 100).length;
  const latestMood = journal.length
    ? [...journal].sort((a, b) => b.createdAt - a.createdAt)[0].mood
    : '—';
  const tasksDueToday = tasks.filter((t) => t.status !== 'done' && t.dueDate === today).length;
  const overdueTasks = tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < today).length;

  const stats = [
    { value: `${habitsDoneToday}/${habits.length || 0}`, label: 'Habits done today' },
    { value: bestStreak, label: 'Best streak (days)' },
    { value: activeGoals, label: 'Active goals' },
    { value: completedGoals, label: 'Goals completed' },
    { value: journal.length, label: 'Journal entries' },
    { value: latestMood, label: 'Latest mood' },
    { value: tasksDueToday, label: 'Tasks due today' },
    { value: overdueTasks, label: 'Overdue tasks' },
  ];

  grid.innerHTML = stats
    .map(
      (s) => `
      <div class="stat-card">
        <div class="stat-value">${escapeHtml(String(s.value))}</div>
        <div class="stat-label">${escapeHtml(s.label)}</div>
      </div>`
    )
    .join('');

  renderActivity();
  renderCalendar();

  const backupCard = document.getElementById('backupCard');
  const backupStatus = document.getElementById('backupStatus');
  const daysSince = daysSinceLastBackup();
  const stale = hasAnyData() && daysSince >= 7;
  backupCard.classList.toggle('stale', stale);
  if (!hasAnyData()) {
    backupStatus.textContent = 'No data yet.';
  } else if (daysSince === Infinity) {
    backupStatus.textContent = "You haven't backed up yet.";
  } else {
    const d = Math.floor(daysSince);
    backupStatus.textContent = d === 0 ? 'Backed up today.' : `Last backed up ${d} day${d === 1 ? '' : 's'} ago.`;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

renderHabits();
renderJournal();
renderGoals();
renderTasksView();
renderDashboard();
