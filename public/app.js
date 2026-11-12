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
  wheelRatings: 'lifeTracker.wheelRatings',
  projects: 'lifeTracker.projects',
  money: 'lifeTracker.money',
  theme: 'lifeTracker.theme',
};

const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const SCHEMA_VERSION = 4;

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
  3(data) {
    // Tasks gain priority, optional recurrence, and an optional link to a goal.
    data.tasks = (data.tasks || []).map((t) => {
      if (t.priority === undefined) t.priority = 'medium';
      if (t.recurrence === undefined) t.recurrence = null;
      if (t.goalId === undefined) t.goalId = null;
      return t;
    });
    return data;
  },
  4(data) {
    // Projects group goals and tasks; habits get a schedule; journal gets tags.
    data.projects = data.projects || [];
    data.goals = (data.goals || []).map((g) => {
      if (g.projectId === undefined) g.projectId = null;
      return g;
    });
    data.tasks = (data.tasks || []).map((t) => {
      if (t.projectId === undefined) t.projectId = null;
      return t;
    });
    data.habits = (data.habits || []).map((h) => {
      if (!h.frequency) h.frequency = { type: 'daily', days: [] };
      return h;
    });
    data.journal = (data.journal || []).map((j) => {
      if (!Array.isArray(j.tags)) j.tags = [];
      return j;
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
    projects: load(STORAGE_KEYS.projects, []),
    schemaVersion: storedVersion,
  };

  if (data.schemaVersion < SCHEMA_VERSION) {
    data = migrate(data);
    save(STORAGE_KEYS.habits, data.habits);
    save(STORAGE_KEYS.journal, data.journal);
    save(STORAGE_KEYS.goals, data.goals);
    save(STORAGE_KEYS.tasks, data.tasks);
    save(STORAGE_KEYS.projects, data.projects);
    save(STORAGE_KEYS.schemaVersion, data.schemaVersion);
  }

  return data;
}

let { habits, journal, goals, tasks, projects } = loadAndMigrate();
let money = load(STORAGE_KEYS.money, {});

// ---------- Icons ----------
// Small stroke icons (24px grid), inlined so there are no extra requests.
const ICON_PATHS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  'layout-dashboard': '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  'list-checks': '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  'calendar-check': '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  'book-open': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  hexagon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
  'alert-triangle': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'trending-up': '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4"/>',
  'chart-pie': '<path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"/><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>',
};

function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}

// ---------- Tabs ----------
const NAV = [
  { group: 'Daily', items: [['today', 'Today', 'sun'], ['tasks', 'Tasks', 'list-checks'], ['calendar', 'Calendar', 'calendar'], ['habits', 'Habits', 'flame'], ['journal', 'Journal', 'book-open']] },
  { group: 'Plan', items: [['goals', 'Goals', 'target'], ['projects', 'Projects', 'folder']] },
  { group: 'Insights', items: [['dashboard', 'Dashboard', 'layout-dashboard'], ['wheel', 'Life Wheel', 'hexagon'], ['money', 'Money', 'wallet']] },
];

function showTab(tab) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  btn.setAttribute('aria-current', 'page');
  document.getElementById(tab).classList.add('active');
  document.getElementById('pageTitle').textContent = btn.dataset.label;
  document.getElementById('pageIcon').innerHTML = icon(btn.dataset.icon);
  const main = document.getElementById('main');
  if (main) main.scrollTo(0, 0);
}

document.getElementById('tabs').innerHTML = NAV.map(
  (g) => `
  <div class="nav-group">
    <div class="nav-group-label">${g.group}</div>
    ${g.items
      .map(
        ([tab, label, ic]) =>
          `<button type="button" class="tab-btn" data-tab="${tab}" data-label="${label}" data-icon="${ic}">${icon(ic)}<span>${label}</span></button>`
      )
      .join('')}
  </div>`
).join('');

document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (btn) showTab(btn.dataset.tab);
});
showTab('today');

// ---------- Undo-delete ----------
// Deleting an item hides it immediately but defers the actual save+removal
// until the toast times out, so Undo can restore it for free. Only one
// pending delete is tracked at a time; starting a new one finalizes the last.
let pendingDelete = null; // { type, item, index, timer }

function listFor(type) {
  if (type === 'habit') return habits;
  if (type === 'journal') return journal;
  if (type === 'goal') return goals;
  if (type === 'project') return projects;
  return tasks;
}

function saveList(type) {
  if (type === 'habit') save(STORAGE_KEYS.habits, habits);
  else if (type === 'journal') save(STORAGE_KEYS.journal, journal);
  else if (type === 'goal') save(STORAGE_KEYS.goals, goals);
  else if (type === 'project') save(STORAGE_KEYS.projects, projects);
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
  if (type === 'goal') {
    // Goal is gone for good now (no Undo) — unlink any tasks that pointed at it.
    let unlinked = false;
    tasks.forEach((t) => {
      if (t.goalId === item.id) {
        t.goalId = null;
        unlinked = true;
      }
    });
    if (unlinked) {
      save(STORAGE_KEYS.tasks, tasks);
      renderTasksAndGoals();
    }
  }
  if (type === 'project') {
    goals.forEach((g) => {
      if (g.projectId === item.id) g.projectId = null;
    });
    tasks.forEach((t) => {
      if (t.projectId === item.id) t.projectId = null;
    });
    save(STORAGE_KEYS.goals, goals);
    save(STORAGE_KEYS.tasks, tasks);
    renderTasksAndGoals();
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
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// A habit's schedule: every day, specific weekdays, or once a week (any day).
function habitFrequency(habit) {
  const f = habit.frequency;
  if (f && f.type === 'weekly') return { type: 'weekly', days: [] };
  if (f && f.type === 'days' && Array.isArray(f.days) && f.days.length) {
    return { type: 'days', days: [...new Set(f.days)].sort((a, b) => a - b) };
  }
  return { type: 'daily', days: [] };
}

function describeFrequency(f) {
  if (f.type === 'weekly') return 'Once a week';
  if (f.type === 'daily') return 'Every day';
  const key = f.days.join(',');
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '0,6') return 'Weekends';
  return f.days.map((d) => WEEKDAY_SHORT[d]).join(', ');
}

function weekStartKey(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday-based weeks
  return localDateKey(d);
}

// Is this habit part of today's to-do? Done-today always counts; a weekly
// habit stays due until it's done once this week.
function habitDueToday(habit) {
  const now = new Date();
  if (habit.log.includes(localDateKey(now))) return true;
  const f = habitFrequency(habit);
  if (f.type === 'daily') return true;
  if (f.type === 'days') return f.days.includes(now.getDay());
  const wk = weekStartKey(now);
  return !habit.log.some((k) => weekStartKey(new Date(`${k}T00:00:00`)) === wk);
}

function habitStreakUnit(habit) {
  return habitFrequency(habit).type === 'weekly' ? 'week' : 'day';
}

// Daily habits count consecutive days; "specific days" habits count
// consecutive scheduled days (off days never break a streak); weekly habits
// count consecutive weeks with at least one check-in.
function habitStreak(habit) {
  const f = habitFrequency(habit);
  const log = new Set(habit.log);
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  if (f.type === 'weekly') {
    const weeks = new Set(habit.log.map((k) => weekStartKey(new Date(`${k}T00:00:00`))));
    if (!weeks.has(weekStartKey(cursor))) cursor.setDate(cursor.getDate() - 7);
    let streak = 0;
    while (weeks.has(weekStartKey(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 7);
    }
    return streak;
  }

  // If today isn't logged yet, start counting from yesterday so the streak
  // doesn't drop to 0 every morning before you've had a chance to check in.
  if (!log.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  for (let i = 0; i < 3660; i++) {
    if (log.has(localDateKey(cursor))) streak++;
    else if (f.type === 'daily' || f.days.includes(cursor.getDay())) break;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// Select + weekday chips. Used by the add form and the inline editor.
const FREQ_PRESETS = {
  daily: 'Every day',
  weekdays: 'Weekdays',
  weekends: 'Weekends',
  weekly: 'Once a week',
  custom: 'Specific days…',
};

function frequencyPresetOf(f) {
  if (f.type === 'daily') return 'daily';
  if (f.type === 'weekly') return 'weekly';
  const key = f.days.join(',');
  if (key === '1,2,3,4,5') return 'weekdays';
  if (key === '0,6') return 'weekends';
  return 'custom';
}

function createFrequencyControl(initial) {
  const wrap = document.createElement('div');
  wrap.className = 'freq-control';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Schedule');
  select.innerHTML = Object.entries(FREQ_PRESETS)
    .map(([k, label]) => `<option value="${k}">${label}</option>`)
    .join('');
  const chips = document.createElement('div');
  chips.className = 'freq-days';
  chips.innerHTML = [1, 2, 3, 4, 5, 6, 0]
    .map(
      (d) =>
        `<label class="freq-day"><input type="checkbox" value="${d}"><span>${WEEKDAY_SHORT[d]}</span></label>`
    )
    .join('');
  wrap.append(select, chips);

  const boxes = () => [...chips.querySelectorAll('input')];
  const sync = () => {
    chips.hidden = select.value !== 'custom';
  };
  const set = (f) => {
    const freq = f || { type: 'daily', days: [] };
    select.value = frequencyPresetOf(freq);
    boxes().forEach((b) => {
      b.checked = freq.type === 'days' && freq.days.includes(Number(b.value));
    });
    sync();
  };
  const get = () => {
    const days = boxes().filter((b) => b.checked).map((b) => Number(b.value)).sort((a, b) => a - b);
    switch (select.value) {
      case 'weekly':
        return { type: 'weekly', days: [] };
      case 'weekdays':
        return { type: 'days', days: [1, 2, 3, 4, 5] };
      case 'weekends':
        return { type: 'days', days: [0, 6] };
      case 'custom':
        return days.length ? { type: 'days', days } : { type: 'daily', days: [] };
      default:
        return { type: 'daily', days: [] };
    }
  };
  select.addEventListener('change', sync);
  set(initial);
  return { el: wrap, get, set };
}

function habitStreakText(habit) {
  const n = habitStreak(habit);
  const unit = habitStreakUnit(habit);
  return `${n}-${unit} streak`;
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
        <div class="item-meta">🔥 ${escapeHtml(habitStreakText(habit))} · ${escapeHtml(describeFrequency(habitFrequency(habit)))}${habitDueToday(habit) ? '' : ' · not today'}
          <select class="area-select small" data-area="${escapeHtml(habit.id)}" aria-label="Life area">${areaOptionsHTML(habit.area)}</select>
        </div>
      </div>
      <button class="edit-btn" data-edit="${escapeHtml(habit.id)}" aria-label="Edit">✎</button>
      <button class="delete-btn" data-delete="${escapeHtml(habit.id)}" aria-label="Delete">✕</button>
    `;
    list.appendChild(li);
  });
}

function toggleHabitToday(id) {
  const habit = habits.find((h) => h.id === id);
  if (!habit) return;
  const today = todayKey();
  const idx = habit.log.indexOf(today);
  if (idx >= 0) habit.log.splice(idx, 1);
  else habit.log.push(today);
  save(STORAGE_KEYS.habits, habits);
  renderHabits();
  renderDashboard();
}

const habitFreqControl = createFrequencyControl(null);
document.getElementById('habitFreqMount').appendChild(habitFreqControl.el);

document.getElementById('habitForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('habitInput');
  const name = input.value.trim();
  if (!name) return;
  const area = document.getElementById('habitArea').value || null;
  habits.push({ id: uid(), name, log: [], area, createdAt: Date.now(), frequency: habitFreqControl.get() });
  save(STORAGE_KEYS.habits, habits);
  input.value = '';
  habitFreqControl.set(null);
  renderHabits();
  renderDashboard();
});

document.getElementById('habitList').addEventListener('click', (e) => {
  const checkBtn = e.target.closest('.check-btn');
  const editBtn = e.target.closest('[data-edit]');
  const delBtn = e.target.closest('[data-delete]');
  if (checkBtn) {
    toggleHabitToday(checkBtn.dataset.id);
  } else if (editBtn) {
    startHabitEdit(editBtn.dataset.edit);
  } else if (delBtn) {
    queueDelete('habit', habits, delBtn.dataset.delete, renderHabits);
  }
});

document.getElementById('habitList').addEventListener('change', (e) => {
  const sel = e.target.closest('[data-area]');
  if (!sel) return;
  const habit = habits.find((h) => h.id === sel.dataset.area);
  if (!habit) return;
  habit.area = sel.value || null;
  save(STORAGE_KEYS.habits, habits);
  renderWheel();
});

function startHabitEdit(id) {
  const habit = habits.find((h) => h.id === id);
  const li = document.querySelector(`#habitList [data-id="${CSS.escape(id)}"]`);
  const titleEl = li.querySelector('[data-title]');
  const metaEl = li.querySelector('.item-meta');
  const wrap = document.createElement('div');
  wrap.className = 'edit-goal';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-input';
  input.value = habit.name;
  const freq = createFrequencyControl(habitFrequency(habit));
  freq.el.classList.add('edit');
  wrap.append(input, freq.el);
  titleEl.replaceWith(wrap);
  if (metaEl) metaEl.remove();
  input.focus();
  input.select();

  const commit = () => {
    const val = input.value.trim();
    if (val) {
      habit.name = val;
      habit.frequency = freq.get();
      save(STORAGE_KEYS.habits, habits);
    }
    renderHabits();
    renderDashboard();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') renderHabits();
  });
  wrap.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!wrap.contains(document.activeElement)) commit();
    }, 0);
  });
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

// Tags: comma- or space-separated, lowercased, '#' optional, de-duplicated.
function parseTags(str) {
  const tags = String(str || '')
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#+/, '').trim().toLowerCase().slice(0, 24))
    .filter(Boolean);
  return [...new Set(tags)].slice(0, 8);
}

let journalTagFilter = null;

function renderJournalFilter() {
  const bar = document.getElementById('journalFilter');
  const counts = {};
  journal.forEach((j) => (j.tags || []).forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
  const tags = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  if (journalTagFilter && !counts[journalTagFilter]) journalTagFilter = null;
  bar.hidden = tags.length === 0;
  bar.innerHTML = tags.length
    ? `<button type="button" class="tag-chip ${journalTagFilter ? '' : 'active'}" data-filter="">All</button>` +
      tags
        .map(
          (t) =>
            `<button type="button" class="tag-chip ${journalTagFilter === t ? 'active' : ''}" data-filter="${escapeHtml(t)}">#${escapeHtml(t)} <span class="tag-count">${counts[t]}</span></button>`
        )
        .join('')
    : '';
}

document.getElementById('journalFilter').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  journalTagFilter = btn.dataset.filter || null;
  renderJournal();
});

function renderJournal() {
  const list = document.getElementById('journalList');
  list.innerHTML = '';
  renderJournalFilter();
  if (journal.length === 0) {
    list.innerHTML = '<li class="empty-state">No journal entries yet.</li>';
    return;
  }
  const visible = journalTagFilter ? journal.filter((j) => (j.tags || []).includes(journalTagFilter)) : journal;
  [...visible]
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
          ${
            (entry.tags || []).length
              ? `<div class="tag-row" data-tags>${entry.tags
                  .map((t) => `<button type="button" class="tag-chip small" data-filter="${escapeHtml(t)}">#${escapeHtml(t)}</button>`)
                  .join('')}</div>`
              : ''
          }
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
  const tagsInput = document.getElementById('journalTags');
  journal.push({ id: uid(), text, mood: selectedMood, createdAt: Date.now(), tags: parseTags(tagsInput.value) });
  const ok = save(STORAGE_KEYS.journal, journal);
  if (!ok) {
    // Roll back the in-memory push so state matches what's actually saved,
    // and keep the user's text in the box so nothing is lost.
    journal.pop();
    return;
  }
  input.value = '';
  tagsInput.value = '';
  renderJournal();
  renderDashboard();
});

document.getElementById('journalList').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filter]');
  if (chip) {
    journalTagFilter = journalTagFilter === chip.dataset.filter ? null : chip.dataset.filter;
    renderJournal();
    return;
  }
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

  const tagsEdit = document.createElement('input');
  tagsEdit.type = 'text';
  tagsEdit.className = 'edit-input';
  tagsEdit.placeholder = 'Tags (comma separated)';
  tagsEdit.setAttribute('aria-label', 'Tags');
  tagsEdit.value = (entry.tags || []).map((t) => `#${t}`).join(', ');

  wrap.appendChild(moodRow);
  wrap.appendChild(textarea);
  wrap.appendChild(tagsEdit);
  const oldTags = li.querySelector('[data-tags]');
  if (oldTags) oldTags.remove();
  textEl.replaceWith(wrap);
  textarea.focus();

  const commit = () => {
    const val = textarea.value.trim();
    if (val) {
      entry.text = val;
      entry.mood = editMood;
      entry.tags = parseTags(tagsEdit.value);
      entry.editedAt = Date.now();
      save(STORAGE_KEYS.journal, journal);
    }
    renderJournal();
  };
  [textarea, tagsEdit].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') renderJournal();
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
      else if (e.key === 'Enter' && el === tagsEdit) commit();
    });
  });
  wrap.addEventListener('focusout', () => {
    // Allow a click on the mood row or tags field without losing the edit.
    setTimeout(() => {
      if (!wrap.contains(document.activeElement)) commit();
    }, 0);
  });
}

// ---------- Goals ----------
// A goal with linked (non-repeating) tasks gets its progress from them;
// otherwise the manual +/- value is used. Repeating tasks never "finish", so
// they're excluded from the percentage.
function goalProgress(goal) {
  const linked = tasks.filter((t) => t.goalId === goal.id);
  const counted = linked.filter((t) => !t.recurrence);
  const repeating = linked.length - counted.length;
  if (counted.length === 0) return { pct: goal.progress, auto: false, total: 0, done: 0, repeating };
  const done = counted.filter((t) => t.status === 'done').length;
  return { pct: Math.round((done / counted.length) * 100), auto: true, total: counted.length, done, repeating };
}

function goalOptionsHTML(selectedId) {
  return (
    '<option value="">No goal</option>' +
    goals
      .map(
        (g) =>
          `<option value="${escapeHtml(g.id)}"${g.id === selectedId ? ' selected' : ''}>${escapeHtml(g.title)}</option>`
      )
      .join('')
  );
}

function populateGoalSelect() {
  const select = document.getElementById('taskGoal');
  const current = select.value;
  select.innerHTML = goalOptionsHTML(current);
  select.disabled = goals.length === 0;
}

function renderTasksAndGoals() {
  renderTasksView();
  renderGoals();
  renderProjects();
}

function renderGoals() {
  populateGoalSelect();
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
    const p = goalProgress(goal);
    const taskText = p.auto ? ` · ${p.done}/${p.total} tasks done` : '';
    const repeatText = p.repeating ? ` · ${p.repeating} repeating not counted` : '';
    const controls = p.auto
      ? '<span class="auto-badge" title="Progress is calculated from the tasks linked to this goal">auto</span>'
      : `<button class="step-btn" data-dec="${escapeHtml(goal.id)}">-</button>
        <button class="step-btn" data-inc="${escapeHtml(goal.id)}">+</button>`;
    li.innerHTML = `
      <div class="item-main">
        <div class="item-title" data-title>${escapeHtml(goal.title)}${p.pct >= 100 ? ' 🎉' : ''}</div>
        <div class="item-meta" data-meta>${p.pct}% complete${escapeHtml(taskText)}${escapeHtml(repeatText)}${dueText}</div>
        <div class="progress-track"><div class="progress-fill" style="width:${p.pct}%"></div></div>
      </div>
      <div class="goal-controls">
        ${controls}
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
  const projectSel = document.getElementById('goalProject');
  goals.push({ id: uid(), title, dueDate: dateInput.value || null, progress: 0, projectId: projectSel.value || null });
  save(STORAGE_KEYS.goals, goals);
  input.value = '';
  dateInput.value = '';
  projectSel.value = '';
  renderTasksAndGoals();
  renderDashboard();
});

document.getElementById('goalList').addEventListener('click', (e) => {
  const incBtn = e.target.closest('[data-inc]');
  const decBtn = e.target.closest('[data-dec]');
  const editBtn = e.target.closest('[data-edit]');
  const delBtn = e.target.closest('[data-delete]');
  if (incBtn) {
    const goal = goals.find((g) => g.id === incBtn.dataset.inc);
    if (!goal) return;
    goal.progress = Math.min(100, goal.progress + 10);
    save(STORAGE_KEYS.goals, goals);
    renderGoals();
    renderDashboard();
  } else if (decBtn) {
    const goal = goals.find((g) => g.id === decBtn.dataset.dec);
    if (!goal) return;
    goal.progress = Math.max(0, goal.progress - 10);
    save(STORAGE_KEYS.goals, goals);
    renderGoals();
    renderDashboard();
  } else if (editBtn) {
    startGoalEdit(editBtn.dataset.edit);
  } else if (delBtn) {
    queueDelete('goal', goals, delBtn.dataset.delete, renderTasksAndGoals);
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
  const projectSelect = document.createElement('select');
  projectSelect.className = 'edit-input';
  projectSelect.setAttribute('aria-label', 'Project');
  projectSelect.innerHTML = projectOptionsHTML(goal.projectId);
  wrap.appendChild(titleInput);
  wrap.appendChild(dateInput);
  wrap.appendChild(projectSelect);

  titleEl.replaceWith(wrap);
  metaEl.remove();
  titleInput.focus();
  titleInput.select();

  const commit = () => {
    const val = titleInput.value.trim();
    if (val) {
      goal.title = val;
      goal.dueDate = dateInput.value || null;
      goal.projectId = projectSelect.value || null;
      save(STORAGE_KEYS.goals, goals);
      renderDashboard();
    }
    renderTasksAndGoals();
  };
  [titleInput, dateInput, projectSelect].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') renderTasksAndGoals();
    });
    el.addEventListener('blur', () => {
      setTimeout(() => {
        if (!wrap.contains(document.activeElement)) commit();
      }, 0);
    });
  });
}

// ---------- Projects ----------
// A project groups goals and tasks. A task belongs to a project directly, or
// through its goal.
function projectOptionsHTML(selectedId) {
  return (
    '<option value="">No project</option>' +
    projects
      .map(
        (p) =>
          `<option value="${escapeHtml(p.id)}"${p.id === selectedId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
      )
      .join('')
  );
}

function populateProjectSelects() {
  ['taskProject', 'goalProject'].forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = projectOptionsHTML(current);
    select.disabled = projects.length === 0;
  });
}

function taskProjectId(task) {
  if (task.projectId) return task.projectId;
  const goal = task.goalId && goals.find((g) => g.id === task.goalId);
  return goal ? goal.projectId || null : null;
}

function projectStats(project) {
  const pGoals = goals.filter((g) => g.projectId === project.id);
  const pTasks = tasks.filter((t) => taskProjectId(t) === project.id);
  const counted = pTasks.filter((t) => !t.recurrence);
  const done = counted.filter((t) => t.status === 'done').length;
  let pct = 0;
  if (counted.length) pct = Math.round((done / counted.length) * 100);
  else if (pGoals.length) pct = Math.round(pGoals.reduce((sum, g) => sum + goalProgress(g).pct, 0) / pGoals.length);
  return { goals: pGoals, tasks: pTasks, counted: counted.length, done, pct };
}

const openProjects = new Set();

function renderProjects() {
  populateProjectSelects();
  const list = document.getElementById('projectList');
  if (!list) return;
  list.innerHTML = '';
  if (projects.length === 0) {
    list.innerHTML = '<li class="empty-state">No projects yet. A project groups related goals and tasks.</li>';
    return;
  }
  projects.forEach((project) => {
    const st = projectStats(project);
    const goalRows = st.goals
      .map((g) => `<li>🎯 ${escapeHtml(g.title)} <span class="item-meta">${goalProgress(g).pct}%</span></li>`)
      .join('');
    const taskRows = [...st.tasks]
      .sort((a, b) => (a.status === 'done') - (b.status === 'done') || priorityRank(a) - priorityRank(b))
      .map(
        (t) =>
          `<li class="${t.status === 'done' ? 'is-done' : ''}">${t.status === 'done' ? '✓' : '○'} ${escapeHtml(t.title)}${t.dueDate ? ` <span class="item-meta">${escapeHtml(t.dueDate)}</span>` : ''}</li>`
      )
      .join('');
    const summary = [
      `${st.goals.length} goal${st.goals.length === 1 ? '' : 's'}`,
      `${st.tasks.length} task${st.tasks.length === 1 ? '' : 's'}`,
      `${st.pct}% done`,
    ].join(' · ');
    const li = document.createElement('li');
    li.className = 'item-card project-card';
    li.dataset.id = project.id;
    li.innerHTML = `
      <div class="project-body">
        <div class="project-head">
          <div class="item-main">
            <div class="item-title" data-title>${icon('folder', 'inline')}${escapeHtml(project.name)}${st.pct >= 100 && st.counted ? ' 🎉' : ''}</div>
            <div class="item-meta" data-meta>${escapeHtml(summary)}</div>
          </div>
          <button class="edit-btn" data-edit="${escapeHtml(project.id)}" aria-label="Rename">✎</button>
          <button class="delete-btn" data-delete="${escapeHtml(project.id)}" aria-label="Delete">✕</button>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${st.pct}%"></div></div>
        <details class="project-details" data-project="${escapeHtml(project.id)}" ${openProjects.has(project.id) ? 'open' : ''}>
          <summary>Goals &amp; tasks</summary>
          ${goalRows || taskRows ? `<ul class="project-items">${goalRows}${taskRows}</ul>` : '<p class="item-meta">Nothing linked yet. Pick this project when adding a goal or task.</p>'}
        </details>
      </div>`;
    list.appendChild(li);
  });
}

document.getElementById('projectForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('projectInput');
  const name = input.value.trim();
  if (!name) return;
  projects.push({ id: uid(), name, createdAt: Date.now() });
  if (!save(STORAGE_KEYS.projects, projects)) {
    projects.pop();
    return;
  }
  input.value = '';
  renderProjects();
});

document.getElementById('projectList').addEventListener('toggle', (e) => {
  const d = e.target.closest('[data-project]');
  if (!d) return;
  if (d.open) openProjects.add(d.dataset.project);
  else openProjects.delete(d.dataset.project);
}, true);

document.getElementById('projectList').addEventListener('click', (e) => {
  const editBtn = e.target.closest('[data-edit]');
  const delBtn = e.target.closest('[data-delete]');
  if (editBtn) {
    startProjectEdit(editBtn.dataset.edit);
  } else if (delBtn) {
    queueDelete('project', projects, delBtn.dataset.delete, renderTasksAndGoals);
  }
});

function startProjectEdit(id) {
  const project = projects.find((p) => p.id === id);
  const li = document.querySelector(`#projectList [data-id="${CSS.escape(id)}"]`);
  if (!project || !li) return;
  const titleEl = li.querySelector('[data-title]');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-input';
  input.value = project.name;
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    const val = input.value.trim();
    if (val) {
      project.name = val;
      save(STORAGE_KEYS.projects, projects);
    }
    renderTasksAndGoals();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') renderProjects();
  });
  input.addEventListener('blur', commit);
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
      const task = makeTask({ title: ev.summary || '(untitled event)', dueDate, googleEventId: ev.id });
      tasks.push(task);
      linkedIds.add(ev.id);
      imported.push(task);
      changed = true;
    });

    if (changed) {
      save(STORAGE_KEYS.tasks, tasks);
      renderTasksAndGoals();
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

const PRIORITIES = ['high', 'medium', 'low'];
const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };
const RECURRENCE_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

function makeTask(fields) {
  return {
    id: uid(),
    title: '',
    dueDate: null,
    status: 'todo',
    googleEventId: null,
    priority: 'medium',
    recurrence: null,
    goalId: null,
    projectId: null,
    ...fields,
  };
}

function priorityRank(task) {
  const i = PRIORITIES.indexOf(task.priority);
  return i === -1 ? 1 : i;
}

// Next due date for a repeating task: step forward from its current due date
// until it lands after today, so finishing a task late doesn't schedule the
// next one in the past. Monthly keeps the original day (clamped to month end).
function nextOccurrence(dueKey, recurrence) {
  const today = todayKey();
  let d = new Date(`${dueKey}T00:00:00`);
  const anchorDay = d.getDate();
  do {
    if (recurrence === 'daily') {
      d.setDate(d.getDate() + 1);
    } else if (recurrence === 'weekly') {
      d.setDate(d.getDate() + 7);
    } else {
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const lastDay = new Date(y, m + 1, 0).getDate();
      d = new Date(y, m, Math.min(anchorDay, lastDay));
    }
  } while (localDateKey(d) <= today);
  return localDateKey(d);
}

function spawnNextOccurrence(task) {
  if (!task.recurrence || !task.dueDate || task.nextTaskId) return;
  const next = makeTask({
    title: task.title,
    dueDate: nextOccurrence(task.dueDate, task.recurrence),
    priority: task.priority,
    recurrence: task.recurrence,
    goalId: task.goalId,
    projectId: task.projectId,
  });
  tasks.push(next);
  task.nextTaskId = next.id;
  pushTaskToCalendar(next);
}

// Un-completing a repeating task takes back the occurrence it created, as
// long as that occurrence hasn't been touched yet.
function retractNextOccurrence(task) {
  if (!task.nextTaskId) return;
  const idx = tasks.findIndex((t) => t.id === task.nextTaskId);
  if (idx === -1) {
    task.nextTaskId = null;
    return;
  }
  const next = tasks[idx];
  if (next.status !== 'todo') return;
  tasks.splice(idx, 1);
  if (next.googleEventId) deleteTaskFromCalendar(next.googleEventId);
  task.nextTaskId = null;
}

function taskMeta(task, today) {
  const overdue = task.dueDate && task.dueDate < today && task.status !== 'done';
  const dueText = task.dueDate ? ` · due ${task.dueDate}` : '';
  const label = overdue ? 'Overdue' : TASK_STATUS_LABELS[task.status];
  return { overdue, dueText, label };
}

function taskMetaHTML(task, today) {
  const { dueText, label } = taskMeta(task, today);
  const priority = task.priority && PRIORITY_LABELS[task.priority] ? task.priority : 'medium';
  const priorityBadge = `<span class="priority-badge ${priority}">${escapeHtml(PRIORITY_LABELS[priority])}</span>`;
  const repeatBadge = task.recurrence && RECURRENCE_LABELS[task.recurrence]
    ? `<span class="sync-badge">🔁 ${escapeHtml(RECURRENCE_LABELS[task.recurrence])}</span>`
    : '';
  const goal = task.goalId && goals.find((g) => g.id === task.goalId);
  const goalBadge = goal ? `<span class="sync-badge">🎯 ${escapeHtml(goal.title)}</span>` : '';
  const project = projects.find((p) => p.id === taskProjectId(task));
  const projectBadge = project ? `<span class="sync-badge">📁 ${escapeHtml(project.name)}</span>` : '';
  const syncBadge = task.googleEventId ? '<span class="sync-badge">📅 synced</span>' : '';
  return `${escapeHtml(label)}${escapeHtml(dueText)} ${priorityBadge}${repeatBadge}${goalBadge}${projectBadge}${syncBadge}`;
}

function taskCardHTML(task, today) {
  const { overdue } = taskMeta(task, today);
  return `
    <button class="check-btn ${task.status === 'done' ? 'done' : ''}" data-id="${escapeHtml(task.id)}" aria-label="Mark done">${task.status === 'done' ? '✓' : ''}</button>
    <div class="item-main">
      <div class="item-title" data-title>${escapeHtml(task.title)}</div>
      <div class="item-meta ${overdue ? 'overdue' : ''}" data-meta>${taskMetaHTML(task, today)}</div>
    </div>
    <button class="edit-btn" data-edit="${escapeHtml(task.id)}" aria-label="Edit">✎</button>
    <button class="delete-btn" data-delete="${escapeHtml(task.id)}" aria-label="Delete">✕</button>
  `;
}

function sortedTasks() {
  return [...tasks].sort(
    (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || priorityRank(a) - priorityRank(b)
  );
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
        const { overdue } = taskMeta(task, today);
        return `
        <li class="item-card board-card" draggable="true" data-id="${escapeHtml(task.id)}">
          <div class="item-main">
            <div class="item-title" data-title>${escapeHtml(task.title)}</div>
            <div class="item-meta ${overdue ? 'overdue' : ''}" data-meta>${taskMetaHTML(task, today)}</div>
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
  const wasDone = task.status === 'done';
  task.status = newStatus;
  if (newStatus === 'done' && !wasDone) spawnNextOccurrence(task);
  else if (wasDone && newStatus !== 'done') retractNextOccurrence(task);
  save(STORAGE_KEYS.tasks, tasks);
  // Kanban status has no Google Calendar equivalent, so this deliberately
  // never calls pushTaskToCalendar() on the task itself — only title/date
  // edits sync (a spawned repeat occurrence is pushed as its own new task).
  renderTasksAndGoals();
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

// Shared by the Tasks form and Quick Add. Returns the task, or null if it
// couldn't be saved (e.g. storage full).
function addTask(fields) {
  const task = makeTask(fields);
  tasks.push(task);
  if (!save(STORAGE_KEYS.tasks, tasks)) {
    tasks.pop();
    return null;
  }
  renderTasksAndGoals();
  renderDashboard();
  pushTaskToCalendar(task);
  return task;
}

document.getElementById('taskForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('taskInput');
  const dateInput = document.getElementById('taskDate');
  const title = input.value.trim();
  if (!title) return;
  const repeatSel = document.getElementById('taskRepeat');
  const prioritySel = document.getElementById('taskPriority');
  const goalSel = document.getElementById('taskGoal');
  const projectSel = document.getElementById('taskProject');
  const recurrence = repeatSel.value || null;
  const task = addTask({
    title,
    // A repeating task needs an anchor date to repeat from.
    dueDate: dateInput.value || (recurrence ? todayKey() : null),
    priority: prioritySel.value,
    recurrence,
    goalId: goalSel.value || null,
    projectId: projectSel.value || null,
  });
  if (!task) return;
  input.value = '';
  dateInput.value = '';
  repeatSel.value = '';
  prioritySel.value = 'medium';
  goalSel.value = '';
  projectSel.value = '';
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
    queueDelete('task', tasks, delBtn.dataset.delete, renderTasksAndGoals);
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
    queueDelete('task', tasks, delBtn.dataset.delete, renderTasksAndGoals);
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
  const prioritySelect = document.createElement('select');
  prioritySelect.className = 'edit-input';
  prioritySelect.setAttribute('aria-label', 'Priority');
  prioritySelect.innerHTML = PRIORITIES.map(
    (p) => `<option value="${p}"${p === (task.priority || 'medium') ? ' selected' : ''}>${PRIORITY_LABELS[p]} priority</option>`
  ).join('');
  const repeatSelect = document.createElement('select');
  repeatSelect.className = 'edit-input';
  repeatSelect.setAttribute('aria-label', 'Repeat');
  repeatSelect.innerHTML =
    `<option value="">Does not repeat</option>` +
    Object.entries(RECURRENCE_LABELS)
      .map(([k, label]) => `<option value="${k}"${k === task.recurrence ? ' selected' : ''}>Repeats ${label.toLowerCase()}</option>`)
      .join('');
  const goalSelect = document.createElement('select');
  goalSelect.className = 'edit-input';
  goalSelect.setAttribute('aria-label', 'Goal');
  goalSelect.innerHTML = goalOptionsHTML(task.goalId);
  const projectSelect = document.createElement('select');
  projectSelect.className = 'edit-input';
  projectSelect.setAttribute('aria-label', 'Project');
  projectSelect.innerHTML = projectOptionsHTML(task.projectId);
  const controls = [titleInput, dateInput, prioritySelect, repeatSelect, goalSelect, projectSelect];
  controls.forEach((el) => wrap.appendChild(el));

  titleEl.replaceWith(wrap);
  metaEl.remove();
  titleInput.focus();
  titleInput.select();

  const commit = () => {
    const val = titleInput.value.trim();
    if (val) {
      task.title = val;
      task.recurrence = repeatSelect.value || null;
      // A repeating task needs an anchor date to repeat from.
      task.dueDate = dateInput.value || (task.recurrence ? todayKey() : null);
      task.priority = prioritySelect.value;
      task.goalId = goalSelect.value || null;
      task.projectId = projectSelect.value || null;
      save(STORAGE_KEYS.tasks, tasks);
      pushTaskToCalendar(task);
      renderDashboard();
    }
    renderTasksAndGoals();
  };
  controls.forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') renderTasksAndGoals();
    });
    el.addEventListener('blur', () => {
      setTimeout(() => {
        if (!wrap.contains(document.activeElement)) commit();
      }, 0);
    });
  });
}

// ---------- Quick Add ----------
// Rule-based natural-language parsing (no AI, works offline). Recognises:
//   dates:      today, tomorrow, in 3 days, next week, friday, next friday,
//               dec 25, 25 dec, 2026-12-25 (optionally after by/on/due/before)
//   repeats:    every day|week|month, every monday, or a trailing
//               daily|weekly|monthly
//   priority:   !high !medium !low, or "high priority"
//   goal:       #run matches a goal whose title contains "run"
//   project:    @home matches a project whose name contains "home"
const QA_WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const QA_WEEKDAY_ABBR = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, weds: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const QA_MONTHS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4, june: 5, jun: 5,
  july: 6, jul: 6, august: 7, aug: 7, september: 8, sept: 8, sep: 8, october: 9, oct: 9,
  november: 10, nov: 10, december: 11, dec: 11,
};
const QA_PREP = '(?:(?:by|on|due|due on|before|until)\\s+)?';
const qaAlt = (obj) => Object.keys(obj).sort((a, b) => b.length - a.length).join('|');

function parseQuickAdd(input, now = new Date(), goalList = goals, projectList = projects) {
  let text = ` ${input} `;
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const result = {
    title: '',
    dueDate: null,
    recurrence: null,
    priority: 'medium',
    goalId: null,
    unmatchedGoal: null,
    projectId: null,
    unmatchedProject: null,
  };
  const take = (re) => {
    const m = text.match(re);
    if (m) text = text.replace(re, ' ');
    return m;
  };
  const shift = (n) => {
    const d = new Date(base);
    d.setDate(d.getDate() + n);
    return d;
  };
  // Next occurrence of a weekday. includeToday=false means strictly after today.
  const weekdayDate = (target, includeToday) => {
    let diff = (target - base.getDay() + 7) % 7;
    if (diff === 0 && !includeToday) diff = 7;
    return shift(diff);
  };
  const mondayOf = (d) => {
    const m = new Date(d);
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    return localDateKey(m);
  };

  // Priority
  let m;
  if ((m = take(/\s!(high|h|medium|med|m|low|l)(?=\s)/i))) {
    const k = m[1].toLowerCase()[0];
    result.priority = k === 'h' ? 'high' : k === 'l' ? 'low' : 'medium';
  } else if ((m = take(/\b(high|medium|low)\s+priority\b/i))) {
    result.priority = m[1].toLowerCase();
  }

  // Goal (#tag)
  const norm = (str) => str.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  text = text.replace(/\s#([\p{L}\p{N}_-]+)(?=\s)/gu, (whole, tag) => {
    const tagN = norm(tag);
    if (result.goalId || tagN.length < 2) return whole;
    const matches = goalList.filter((g) => norm(g.title).includes(tagN));
    const best = matches.find((g) => norm(g.title).startsWith(tagN)) || matches[0];
    if (best) {
      result.goalId = best.id;
      return ' ';
    }
    result.unmatchedGoal = result.unmatchedGoal || tag;
    return whole;
  });

  // Project (@name)
  text = text.replace(/\s@([\p{L}\p{N}_-]+)(?=\s)/gu, (whole, tag) => {
    const tagN = norm(tag);
    if (result.projectId || tagN.length < 2) return whole;
    const matches = projectList.filter((p) => norm(p.name).includes(tagN));
    const best = matches.find((p) => norm(p.name).startsWith(tagN)) || matches[0];
    if (best) {
      result.projectId = best.id;
      return ' ';
    }
    result.unmatchedProject = result.unmatchedProject || tag;
    return whole;
  });

  // Repeat
  let anchorWeekday = null;
  if ((m = take(new RegExp(`\\bevery\\s+(${qaAlt(QA_WEEKDAYS)})\\b`, 'i')))) {
    result.recurrence = 'weekly';
    anchorWeekday = QA_WEEKDAYS[m[1].toLowerCase()];
  } else if ((m = take(/\bevery\s+(day|week|month)\b/i))) {
    result.recurrence = { day: 'daily', week: 'weekly', month: 'monthly' }[m[1].toLowerCase()];
  } else if ((m = take(/\s(daily|weekly|monthly)\s*$/i))) {
    result.recurrence = m[1].toLowerCase();
  }

  // Due date
  const fromKey = (d) => localDateKey(d);
  if ((m = take(/\b(\d{4})-(\d{2})-(\d{2})\b/))) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (d.getMonth() === +m[2] - 1) result.dueDate = fromKey(d);
  } else if ((m = take(new RegExp(`${QA_PREP}\\bin\\s+(\\d{1,3})\\s+(day|days|week|weeks|month|months)\\b`, 'i')))) {
    const n = +m[1];
    const unit = m[2].toLowerCase();
    if (unit.startsWith('month')) {
      const d = new Date(base);
      d.setMonth(d.getMonth() + n);
      result.dueDate = fromKey(d);
    } else {
      result.dueDate = fromKey(shift(unit.startsWith('week') ? n * 7 : n));
    }
  } else if (take(new RegExp(`${QA_PREP}\\bday after tomorrow\\b`, 'i'))) {
    result.dueDate = fromKey(shift(2));
  } else if (take(new RegExp(`${QA_PREP}\\b(?:tomorrow|tmrw|tmr)\\b`, 'i'))) {
    result.dueDate = fromKey(shift(1));
  } else if (take(new RegExp(`${QA_PREP}\\b(?:today|tonight)\\b`, 'i'))) {
    result.dueDate = fromKey(base);
  } else if (take(new RegExp(`${QA_PREP}\\bnext\\s+week\\b`, 'i'))) {
    result.dueDate = fromKey(shift(7));
  } else if (take(new RegExp(`${QA_PREP}\\bnext\\s+month\\b`, 'i'))) {
    const d = new Date(base);
    d.setMonth(d.getMonth() + 1);
    result.dueDate = fromKey(d);
  } else {
    const monthRe = new RegExp(
      `${QA_PREP}\\b(?:(${qaAlt(QA_MONTHS)})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?|(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${qaAlt(QA_MONTHS)}))\\b`,
      'i'
    );
    const mm = text.match(monthRe);
    const monthIdx = mm && QA_MONTHS[(mm[1] || mm[4]).toLowerCase()];
    const dayNum = mm && +(mm[2] || mm[3]);
    if (mm && dayNum >= 1 && dayNum <= 31) {
      let d = new Date(base.getFullYear(), monthIdx, dayNum);
      if (d.getMonth() === monthIdx) {
        if (d < base) d = new Date(base.getFullYear() + 1, monthIdx, dayNum);
        if (d.getMonth() === monthIdx) {
          text = text.replace(monthRe, ' ');
          result.dueDate = fromKey(d);
        }
      }
    }
    if (!result.dueDate) {
      const fullRe = new RegExp(`${QA_PREP}\\b(?:(next|this)\\s+)?(${qaAlt(QA_WEEKDAYS)})\\b`, 'i');
      const abbrRe = new RegExp(`(?:by|on|next|this|due|before|until)\\s+(?:(next|this)\\s+)?(${qaAlt(QA_WEEKDAY_ABBR)})\\b`, 'i');
      const wm = take(fullRe) || take(abbrRe);
      if (wm) {
        const wd = QA_WEEKDAYS[wm[2].toLowerCase()] ?? QA_WEEKDAY_ABBR[wm[2].toLowerCase()];
        let d = weekdayDate(wd, false);
        // "next friday" means the one in next week, not later this week.
        if (wm[1] && wm[1].toLowerCase() === 'next' && mondayOf(d) === mondayOf(base)) d = shift(Math.round((d - base) / 86400000) + 7);
        result.dueDate = fromKey(d);
      }
    }
  }

  if (result.recurrence && !result.dueDate) {
    result.dueDate = fromKey(anchorWeekday !== null ? weekdayDate(anchorWeekday, true) : base);
  }

  let title = text.replace(/\s+/g, ' ').trim().replace(/^[\s,;:.\-–]+|[\s,;:\-–]+$/g, '');
  if (title) title = title[0].toUpperCase() + title.slice(1);
  result.title = title;
  return result;
}

function describeQuickAdd(parsed) {
  const bits = [`“${parsed.title}”`];
  if (parsed.dueDate) {
    bits.push(
      'due ' +
        new Date(`${parsed.dueDate}T00:00:00`).toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })
    );
  }
  if (parsed.recurrence) bits.push(`🔁 ${RECURRENCE_LABELS[parsed.recurrence]}`);
  if (parsed.priority !== 'medium') bits.push(`${PRIORITY_LABELS[parsed.priority]} priority`);
  const goal = parsed.goalId && goals.find((g) => g.id === parsed.goalId);
  if (goal) bits.push(`🎯 ${goal.title}`);
  const project = parsed.projectId && projects.find((p) => p.id === parsed.projectId);
  if (project) bits.push(`📁 ${project.name}`);
  return bits.join(' · ');
}

const quickAddInput = document.getElementById('quickAddInput');
const quickAddPreview = document.getElementById('quickAddPreview');
let quickAddStatusTimer = null;

function setQuickAddPreview(text, isError = false) {
  clearTimeout(quickAddStatusTimer);
  quickAddPreview.textContent = text;
  quickAddPreview.classList.toggle('error', isError);
}

quickAddInput.addEventListener('input', () => {
  const value = quickAddInput.value.trim();
  if (!value) {
    setQuickAddPreview('');
    return;
  }
  const parsed = parseQuickAdd(value);
  if (!parsed.title) {
    setQuickAddPreview('Add a task name, e.g. “pay rent tomorrow”.');
    return;
  }
  const notes = [];
  if (parsed.unmatchedGoal) notes.push(`no goal matches #${parsed.unmatchedGoal}`);
  if (parsed.unmatchedProject) notes.push(`no project matches @${parsed.unmatchedProject}`);
  const note = notes.length ? ` (${notes.join('; ')})` : '';
  setQuickAddPreview(`Will add ${describeQuickAdd(parsed)}${note}`);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  e.preventDefault();
  quickAddInput.focus();
});

quickAddInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    quickAddInput.value = '';
    setQuickAddPreview('');
  }
});

document.getElementById('quickAddForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = quickAddInput.value.trim();
  if (!value) return;
  const parsed = parseQuickAdd(value);
  if (!parsed.title) {
    setQuickAddPreview('Add a task name first, e.g. “pay rent tomorrow”.', true);
    return;
  }
  const task = addTask({
    title: parsed.title,
    dueDate: parsed.dueDate,
    priority: parsed.priority,
    recurrence: parsed.recurrence,
    goalId: parsed.goalId,
    projectId: parsed.projectId,
  });
  if (!task) return;
  quickAddInput.value = '';
  setQuickAddPreview(`Added ${describeQuickAdd(parsed)}`);
  quickAddStatusTimer = setTimeout(() => setQuickAddPreview(''), 5000);
});

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
    const task = makeTask({ title: ev.title, dueDate: ev.dueDate, icsUid: ev.uid || null });
    tasks.push(task);
    newTasks.push(task);
  });
  const skipped = pendingICSImport.length - newTasks.length;
  save(STORAGE_KEYS.tasks, tasks);
  renderTasksAndGoals();
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
  return habits.length > 0 || journal.length > 0 || goals.length > 0 || tasks.length > 0 || projects.length > 0;
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
    projects,
    money,
    wheelRatings,
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
    (data.tasks === undefined || Array.isArray(data.tasks)) &&
    (data.projects === undefined || Array.isArray(data.projects))
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
      `${data.goals.length} goal(s), ${taskCount} task(s), and ${Array.isArray(data.projects) ? data.projects.length : 0} project(s)` +
      (data.exportedAt ? `, exported ${new Date(data.exportedAt).toLocaleString()}` : '') +
      '. Importing will replace your current data. Continue?';
    document.getElementById('importConfirm').classList.add('visible');
  };
  reader.readAsText(file);
}

function confirmImport() {
  if (!pendingImport) return;
  const previous = { habits, journal, goals, tasks, projects, money };
  const migrated = migrate({
    habits: pendingImport.habits,
    journal: pendingImport.journal,
    goals: pendingImport.goals,
    tasks: Array.isArray(pendingImport.tasks) ? pendingImport.tasks : [],
    projects: Array.isArray(pendingImport.projects) ? pendingImport.projects : [],
    schemaVersion: pendingImport.schemaVersion || 0,
  });
  habits = migrated.habits;
  journal = migrated.journal;
  goals = migrated.goals;
  tasks = migrated.tasks;
  projects = migrated.projects;
  money = pendingImport.money && typeof pendingImport.money === 'object' ? pendingImport.money : {};
  save(STORAGE_KEYS.habits, habits);
  save(STORAGE_KEYS.journal, journal);
  save(STORAGE_KEYS.goals, goals);
  save(STORAGE_KEYS.tasks, tasks);
  save(STORAGE_KEYS.projects, projects);
  save(STORAGE_KEYS.money, money);
  save(STORAGE_KEYS.schemaVersion, migrated.schemaVersion);
  if (pendingImport.wheelRatings && typeof pendingImport.wheelRatings === 'object') {
    wheelRatings = pendingImport.wheelRatings;
    save(STORAGE_KEYS.wheelRatings, wheelRatings);
  }
  renderHabits();
  renderJournal();
  renderTasksAndGoals();
  renderMoney();
  renderDashboard();
  cancelImport();
  showToast('Backup imported.', () => {
    habits = previous.habits;
    journal = previous.journal;
    goals = previous.goals;
    tasks = previous.tasks;
    projects = previous.projects;
    money = previous.money;
    save(STORAGE_KEYS.habits, habits);
    save(STORAGE_KEYS.journal, journal);
    save(STORAGE_KEYS.goals, goals);
    save(STORAGE_KEYS.tasks, tasks);
    save(STORAGE_KEYS.projects, projects);
    save(STORAGE_KEYS.money, money);
    renderHabits();
    renderJournal();
    renderTasksAndGoals();
    renderMoney();
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
  projects = load(STORAGE_KEYS.projects, []);
  money = load(STORAGE_KEYS.money, {});
  wheelRatings = load(STORAGE_KEYS.wheelRatings, {});
  renderHabits();
  renderJournal();
  renderTasksAndGoals();
  renderMoney();
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
    { icon: 'flame', value: stats.current, label: 'Current streak (days)' },
    { icon: 'trending-up', value: stats.longest, label: 'Longest streak (days)' },
    { icon: 'calendar', value: stats.activeDays, label: 'Active days total' },
    { icon: 'check-circle', value: stats.totalEvents, label: 'Total check-ins' },
  ]
    .map(kpiHTML)
    .join('');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay())); // round out to end of this week (Sat)
  const start = new Date(end);
  start.setDate(start.getDate() - (HEATMAP_WEEKS * 7 - 1));

  const heatmap = document.getElementById('activityHeatmap');
  const monthsRow = document.getElementById('activityMonths');
  document.getElementById('heatmapInner').style.setProperty('--weeks', HEATMAP_WEEKS);
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

  // On narrow screens the grid scrolls sideways; start at the most recent weeks.
  const scroller = document.getElementById('heatmapScroll');
  scroller.scrollLeft = scroller.scrollWidth;
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
      `<li class="item-card"><div class="item-main"><div class="item-title">🎯 ${escapeHtml(g.title)}</div><div class="item-meta">${goalProgress(g).pct}% complete</div></div></li>`
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

// ---------- Today ----------
function daysBetweenKeys(fromKey, toKey) {
  const a = new Date(`${fromKey}T00:00:00`);
  const b = new Date(`${toKey}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

function todayTaskRowHTML(task, today, { reschedule = false } = {}) {
  const done = task.status === 'done';
  const overdue = !done && task.dueDate && task.dueDate < today;
  return `
    <li class="item-card" data-id="${escapeHtml(task.id)}">
      <button class="check-btn ${done ? 'done' : ''}" data-task="${escapeHtml(task.id)}" aria-label="${done ? 'Mark not done' : 'Mark done'}">${done ? '✓' : ''}</button>
      <div class="item-main">
        <div class="item-title">${escapeHtml(task.title)}</div>
        <div class="item-meta ${overdue ? 'overdue' : ''}">${taskMetaHTML(task, today)}</div>
      </div>
      ${reschedule ? `<button type="button" class="secondary-btn today-move-btn" data-reschedule="${escapeHtml(task.id)}">Move to today</button>` : ''}
    </li>`;
}

function renderToday() {
  const root = document.getElementById('todayContent');
  if (!root) return;
  const today = todayKey();
  const byUrgency = (a, b) =>
    priorityRank(a) - priorityRank(b) || (a.dueDate || '').localeCompare(b.dueDate || '');

  const overdue = tasks
    .filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < today)
    .sort((a, b) => priorityRank(a) - priorityRank(b) || a.dueDate.localeCompare(b.dueDate));
  const dueToday = tasks
    .filter((t) => t.dueDate === today)
    .sort((a, b) => (a.status === 'done') - (b.status === 'done') || byUrgency(a, b));

  const habitStates = habits.filter(habitDueToday).map((h) => {
    const done = h.log.includes(today);
    const streak = habitStreak(h);
    const lastLogged = h.log.length ? [...h.log].sort().pop() : null;
    return {
      habit: h,
      done,
      streak,
      atRisk: !done && streak > 0,
      lapsed: !done && streak === 0 && lastLogged !== null,
      daysAgo: lastLogged ? daysBetweenKeys(lastLogged, today) : 0,
    };
  });

  const doneCount = dueToday.filter((t) => t.status === 'done').length + habitStates.filter((h) => h.done).length;
  const totalCount = dueToday.length + habitStates.length;
  const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  // Rule-based nudges: no AI, just what the data says is slipping.
  const lapsed = habitStates.filter((h) => h.lapsed).sort((a, b) => a.daysAgo - b.daysAgo);
  const atRisk = habitStates.filter((h) => h.atRisk).sort((a, b) => b.streak - a.streak);
  const steps = [];
  if (overdue.length) {
    const more = overdue.length > 1 ? ` (${overdue.length - 1} more overdue)` : '';
    steps.push(`Finish or reschedule “${overdue[0].title}”${more}.`);
  }
  if (lapsed.length) {
    steps.push(`Do a tiny version of “${lapsed[0].habit.name}” today — it’s been ${lapsed[0].daysAgo} days.`);
  }
  if (atRisk.length) {
    steps.push(`Keep your ${atRisk[0].streak}-${habitStreakUnit(atRisk[0].habit)} streak alive: “${atRisk[0].habit.name}”.`);
  }
  const slipping = overdue.length > 0 || lapsed.length > 0;
  const nudgeHTML = steps.length
    ? `<div class="nudge ${slipping ? 'slipping' : ''}">
        <div class="nudge-title">${icon(slipping ? 'alert-triangle' : 'flame')}<span>${slipping ? 'Back on track' : 'Streaks to protect'}</span></div>
        <ol class="nudge-steps">${steps.slice(0, 3).map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ol>
      </div>`
    : '';

  const listCard = (iconName, title, count, body, tone = '') => `
    <section class="card list-card ${tone}">
      <header class="card-head">
        <div class="card-title">${icon(iconName)}<span>${escapeHtml(title)}</span><span class="count-pill">${count}</span></div>
      </header>
      <ul class="item-list">${body}</ul>
    </section>`;

  const habitsBody = habitStates
    .map(
      ({ habit, done }) => `
      <li class="item-card">
        <button class="check-btn ${done ? 'done' : ''}" data-habit="${escapeHtml(habit.id)}" aria-label="${done ? 'Mark not done today' : 'Mark done today'}">${done ? '✓' : ''}</button>
        <div class="item-main">
          <div class="item-title">${escapeHtml(habit.name)}</div>
          <div class="item-meta">${escapeHtml(habitStreakText(habit))}</div>
        </div>
      </li>`
    )
    .join('');

  const openDue = dueToday.filter((t) => t.status !== 'done').length;
  const habitsLeft = habitStates.filter((h) => !h.done).length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  let sentence;
  if (totalCount === 0 && overdue.length === 0) sentence = 'Nothing is scheduled yet. Add a task or a habit to get started.';
  else if (openDue === 0 && habitsLeft === 0 && overdue.length === 0) sentence = 'Everything for today is done. Nice work.';
  else {
    const parts = [`<strong>${plural(openDue, 'task')}</strong> due today`];
    if (overdue.length) parts.push(`<strong>${overdue.length} overdue</strong>`);
    if (habitStates.length) parts.push(`<strong>${plural(habitsLeft, 'habit')}</strong> left`);
    sentence = `You have ${parts.join(', ')}.`;
  }
  const empty = !overdue.length && !dueToday.length && !habitStates.length;

  // The hero lives outside todayContent so its canvas survives re-renders.
  document.getElementById('heroTitle').textContent = greeting;
  document.getElementById('heroSub').innerHTML = `${escapeHtml(dateLabel)} · ${sentence}`;

  root.innerHTML = `
    <div class="kpi-strip">
      ${kpiHTML({
        icon: 'check-circle',
        label: 'Progress today',
        value: `${pct}%`,
        sub: totalCount ? `${doneCount} of ${totalCount} done` : 'Nothing scheduled',
        extra: `<div class="progress-track kpi-progress"><div class="progress-fill" style="width:${pct}%"></div></div>`,
      })}
      ${kpiHTML({ icon: 'calendar-check', label: 'Due today', value: openDue, sub: `${dueToday.length - openDue} completed` })}
      ${kpiHTML({
        icon: 'alert-triangle',
        label: 'Overdue',
        value: overdue.length,
        sub: overdue.length ? 'Needs attention' : 'All caught up',
        tone: overdue.length ? 'neg' : 'pos',
      })}
      ${kpiHTML({ icon: 'flame', label: 'Habits left', value: habitsLeft, sub: `${habitStates.length} scheduled today` })}
    </div>
    ${nudgeHTML}
    ${overdue.length ? listCard('alert-triangle', 'Overdue', overdue.length, overdue.map((t) => todayTaskRowHTML(t, today, { reschedule: true })).join(''), 'danger') : ''}
    ${dueToday.length ? listCard('calendar-check', 'Due today', dueToday.length, dueToday.map((t) => todayTaskRowHTML(t, today)).join('')) : ''}
    ${habitStates.length ? listCard('flame', 'Habits', habitStates.length, habitsBody) : ''}
    ${empty ? '<p class="empty-state">Nothing for today. Use the quick add bar above to add a task.</p>' : ''}
  `;
}

document.getElementById('todayContent').addEventListener('click', (e) => {
  const taskBtn = e.target.closest('[data-task]');
  const habitBtn = e.target.closest('[data-habit]');
  const moveBtn = e.target.closest('[data-reschedule]');
  if (taskBtn) {
    const task = tasks.find((t) => t.id === taskBtn.dataset.task);
    if (task) setTaskStatus(task.id, task.status === 'done' ? 'todo' : 'done');
  } else if (habitBtn) {
    toggleHabitToday(habitBtn.dataset.habit);
  } else if (moveBtn) {
    const task = tasks.find((t) => t.id === moveBtn.dataset.reschedule);
    if (!task) return;
    task.dueDate = todayKey();
    save(STORAGE_KEYS.tasks, tasks);
    pushTaskToCalendar(task);
    renderTasksAndGoals();
    renderDashboard();
  }
});

// ---------- Dashboard ----------
function kpiHTML({ icon: name, label, value, sub = '', tone = '', extra = '' }) {
  return `
    <div class="kpi">
      <div class="kpi-label">${icon(name)}<span>${escapeHtml(label)}</span></div>
      <div class="kpi-value">${escapeHtml(String(value))}</div>
      ${sub ? `<div class="kpi-sub ${tone}">${escapeHtml(sub)}</div>` : ''}
      ${extra}
    </div>`;
}

function renderTaskStatus() {
  const el = document.getElementById('taskStatusCard');
  if (!el) return;
  const counts = { todo: 0, in_progress: 0, done: 0 };
  tasks.forEach((t) => {
    counts[counts[t.status] === undefined ? 'todo' : t.status]++;
  });
  const total = tasks.length;
  const rows = TASK_STATUSES.map((st, i) => ({ st, i, n: counts[st], pct: total ? Math.round((counts[st] / total) * 100) : 0 }));
  el.innerHTML = `
    <div class="card-head">
      <div class="card-title">${icon('list-checks')}<span>Task status</span></div>
      <span class="card-sub">${total} task${total === 1 ? '' : 's'}</span>
    </div>
    ${
      total
        ? `<div class="stack-bar" role="img" aria-label="Task status breakdown">${rows
            .filter((r) => r.n)
            .map((r) => `<span class="stack-seg seg-${r.i + 1}" style="width:${(r.n / total) * 100}%"></span>`)
            .join('')}</div>
           <div class="stack-legend">${rows
             .map(
               (r) =>
                 `<span class="legend-item"><span class="legend-dot seg-${r.i + 1}"></span>${escapeHtml(TASK_STATUS_LABELS[r.st])}<b>${r.n}</b><span class="legend-pct">${r.pct}%</span></span>`
             )
             .join('')}</div>`
        : '<p class="empty-state">No tasks yet. Add one with the quick add bar.</p>'
    }`;
}

function renderDashboard() {
  const grid = document.getElementById('dashboardGrid');
  const today = todayKey();
  const dueHabits = habits.filter(habitDueToday);
  const habitsDoneToday = dueHabits.filter((h) => h.log.includes(today)).length;
  const bestStreak = habits.reduce((max, h) => (habitStreakUnit(h) === 'day' ? Math.max(max, habitStreak(h)) : max), 0);
  const activeGoals = goals.filter((g) => goalProgress(g).pct < 100).length;
  const completedGoals = goals.filter((g) => goalProgress(g).pct >= 100).length;
  const latestMood = journal.length
    ? [...journal].sort((a, b) => b.createdAt - a.createdAt)[0].mood
    : '—';
  const tasksDueToday = tasks.filter((t) => t.status !== 'done' && t.dueDate === today).length;
  const overdueTasks = tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < today).length;

  const stats = [
    { icon: 'check-circle', value: `${habitsDoneToday}/${dueHabits.length}`, label: 'Habits done today' },
    { icon: 'flame', value: bestStreak, label: 'Best streak (days)' },
    { icon: 'target', value: activeGoals, label: 'Active goals' },
    { icon: 'flag', value: completedGoals, label: 'Goals completed' },
    { icon: 'book-open', value: journal.length, label: 'Journal entries' },
    { icon: 'smile', value: latestMood, label: 'Latest mood' },
    { icon: 'calendar-check', value: tasksDueToday, label: 'Tasks due today' },
    {
      icon: 'alert-triangle',
      value: overdueTasks,
      label: 'Overdue tasks',
      sub: overdueTasks ? 'Needs attention' : 'All caught up',
      tone: overdueTasks ? 'neg' : 'pos',
    },
  ];

  grid.innerHTML = stats.map(kpiHTML).join('');
  renderTaskStatus();

  renderActivity();
  renderCalendar();
  renderToday();
  renderWheel();

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

// ---------- Life Wheel ----------
// Each life area gets a 0-10 score. If any habits are tagged with the area,
// the score is the share of possible check-ins actually done in the last 30
// days. Areas with no habits fall back to a manual slider rating.
const LIFE_AREAS = [
  { id: 'health', label: 'Health' },
  { id: 'career', label: 'Career' },
  { id: 'finances', label: 'Finances' },
  { id: 'relationships', label: 'Family & Friends', short: 'Family' },
  { id: 'romance', label: 'Romance' },
  { id: 'growth', label: 'Personal Growth', short: 'Growth' },
  { id: 'fun', label: 'Fun & Recreation', short: 'Fun' },
  { id: 'environment', label: 'Environment' },
];
const WHEEL_WINDOW_DAYS = 30;

let wheelRatings = load(STORAGE_KEYS.wheelRatings, {});

function areaOptionsHTML(selected) {
  return (
    `<option value="">No area</option>` +
    LIFE_AREAS.map(
      (a) => `<option value="${a.id}"${a.id === selected ? ' selected' : ''}>${escapeHtml(a.label)}</option>`
    ).join('')
  );
}

function habitCompletionRate(habit) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Don't punish a habit for days before it existed.
  let days = WHEEL_WINDOW_DAYS;
  if (habit.createdAt) {
    const created = new Date(habit.createdAt);
    created.setHours(0, 0, 0, 0);
    const age = Math.round((today - created) / 86400000) + 1;
    days = Math.max(1, Math.min(days, age));
  }
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  const startKey = localDateKey(start);
  const logged = habit.log.filter((d) => d >= startKey && d <= localDateKey(today));
  const f = habitFrequency(habit);

  if (f.type === 'weekly') {
    const expected = Math.max(1, Math.round(days / 7));
    const weeks = new Set(logged.map((k) => weekStartKey(new Date(`${k}T00:00:00`)))).size;
    return Math.min(1, weeks / expected);
  }
  if (f.type === 'days') {
    let expected = 0;
    const cursor = new Date(start);
    for (let i = 0; i < days; i++) {
      if (f.days.includes(cursor.getDay())) expected++;
      cursor.setDate(cursor.getDate() + 1);
    }
    return Math.min(1, new Set(logged).size / Math.max(1, expected));
  }
  return new Set(logged).size / days;
}

function wheelScores() {
  return LIFE_AREAS.map((area) => {
    const tagged = habits.filter((h) => h.area === area.id);
    if (tagged.length) {
      const avg = tagged.reduce((sum, h) => sum + habitCompletionRate(h), 0) / tagged.length;
      return { ...area, score: Math.round(avg * 100) / 10, source: 'habits', count: tagged.length };
    }
    const manual = wheelRatings[area.id];
    return { ...area, score: typeof manual === 'number' ? manual : 5, source: 'manual' };
  });
}

function wheelSVG(scores) {
  const size = 320;
  const c = size / 2;
  const r = 110;
  const n = scores.length;
  const pt = (i, frac) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [c + Math.cos(ang) * r * frac, c + Math.sin(ang) * r * frac];
  };
  let out = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Life wheel">`;
  [0.2, 0.4, 0.6, 0.8, 1].forEach((f) => {
    const ring = scores.map((_, i) => pt(i, f).map((v) => v.toFixed(1)).join(',')).join(' ');
    out += `<polygon class="wheel-ring" points="${ring}"/>`;
  });
  scores.forEach((s, i) => {
    const [x, y] = pt(i, 1);
    out += `<line class="wheel-spoke" x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    const [lx, ly] = pt(i, 1.2);
    const anchor = Math.abs(lx - c) < 5 ? 'middle' : lx > c ? 'start' : 'end';
    out += `<text class="wheel-label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle">${escapeHtml(s.short || s.label)}</text>`;
  });
  const shape = scores
    .map((s, i) => pt(i, Math.max(0.02, s.score / 10)).map((v) => v.toFixed(1)).join(','))
    .join(' ');
  out += `<polygon class="wheel-shape" points="${shape}"/>`;
  scores.forEach((s, i) => {
    const [x, y] = pt(i, Math.max(0.02, s.score / 10));
    out += `<circle class="wheel-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"/>`;
  });
  return out + '</svg>';
}

function renderWheel() {
  const chart = document.getElementById('wheelChart');
  const list = document.getElementById('wheelList');
  if (!chart || !list) return;
  const scores = wheelScores();
  chart.innerHTML = wheelSVG(scores);
  list.innerHTML = scores
    .map((s) => {
      const value = Number.isInteger(s.score) ? s.score : s.score.toFixed(1);
      const detail =
        s.source === 'habits'
          ? `From ${s.count} habit${s.count === 1 ? '' : 's'}, last ${WHEEL_WINDOW_DAYS} days`
          : `<input type="range" min="0" max="10" step="1" value="${s.score}" data-rate="${s.id}" aria-label="Rate ${escapeHtml(s.label)}">`;
      return `
      <li class="item-card wheel-row">
        <div class="item-main">
          <div class="item-title">${escapeHtml(s.label)}</div>
          <div class="item-meta">${detail}</div>
        </div>
        <div class="wheel-score">${value}</div>
      </li>`;
    })
    .join('');
}

document.getElementById('wheelList').addEventListener('input', (e) => {
  const slider = e.target.closest('[data-rate]');
  if (!slider) return;
  wheelRatings[slider.dataset.rate] = Number(slider.value);
  // Update chart + number live without rebuilding the slider mid-drag.
  document.getElementById('wheelChart').innerHTML = wheelSVG(wheelScores());
  slider.closest('.wheel-row').querySelector('.wheel-score').textContent = slider.value;
});
document.getElementById('wheelList').addEventListener('change', (e) => {
  if (e.target.closest('[data-rate]')) save(STORAGE_KEYS.wheelRatings, wheelRatings);
});

document.getElementById('habitArea').innerHTML = areaOptionsHTML(null);

// ---------- Money ----------
// Monthly income drives a 50/30/20 split and a sinking-fund calculator.
// Everything stays local, like the rest of the app.
function moneyCurrency() {
  return typeof money.currency === 'string' ? money.currency : '$';
}

function moneyIncome() {
  return typeof money.income === 'number' && money.income >= 0 ? money.income : 0;
}

function fmtMoney(n) {
  return `${moneyCurrency()}${Math.round(n).toLocaleString()}`;
}

const MONEY_SPLITS = [
  { key: 'needs', label: 'Needs', pct: 50, hint: 'Housing, utilities, groceries, transport' },
  { key: 'wants', label: 'Wants', pct: 30, hint: 'Eating out, hobbies, entertainment' },
  { key: 'savings', label: 'Savings & debt', pct: 20, hint: 'Emergency fund, investing, debt repayment' },
];

function renderMoney() {
  const incomeInput = document.getElementById('moneyIncome');
  const currencyInput = document.getElementById('moneyCurrency');
  if (!incomeInput) return;
  if (document.activeElement !== incomeInput) incomeInput.value = typeof money.income === 'number' ? money.income : '';
  if (document.activeElement !== currencyInput) currencyInput.value = moneyCurrency();

  const income = moneyIncome();
  document.getElementById('moneyAllocation').innerHTML = income
    ? MONEY_SPLITS.map(
        (r) => `
        <div class="money-row">
          <div class="money-row-head">
            <span class="money-row-label">${escapeHtml(r.label)}</span>
            <span class="money-row-amount">${escapeHtml(fmtMoney((income * r.pct) / 100))} <span class="item-meta">${r.pct}%</span></span>
          </div>
          <div class="progress-track"><div class="progress-fill money-${r.key}" style="width:${r.pct}%"></div></div>
          <div class="item-meta">${escapeHtml(r.hint)}</div>
        </div>`
      ).join('')
    : '<p class="empty-state">Enter your monthly after-tax income above to see your split.</p>';
  renderSinkingFund();
}

function renderSinkingFund() {
  const target = parseFloat(document.getElementById('sfTarget').value);
  const months = parseInt(document.getElementById('sfMonths').value, 10);
  const out = document.getElementById('sfResult');
  if (!(target > 0) || !(months > 0)) {
    out.textContent = 'Enter a target and a number of months.';
    return;
  }
  const monthly = target / months;
  const income = moneyIncome();
  const share = income ? ` — ${Math.round((monthly / income) * 100)}% of your income` : '';
  out.textContent = `Set aside ${fmtMoney(monthly)} a month${share}.`;
}

document.getElementById('moneyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = document.getElementById('moneyIncome').value.trim();
  const status = document.getElementById('moneyStatus');
  const income = raw === '' ? null : parseFloat(raw);
  if (income !== null && (Number.isNaN(income) || income < 0)) {
    status.textContent = 'Enter a positive number for your income.';
    status.classList.add('error');
    return;
  }
  const currency = document.getElementById('moneyCurrency').value.trim().slice(0, 4);
  money = { income, currency: currency || '$' };
  if (save(STORAGE_KEYS.money, money)) {
    status.textContent = 'Saved.';
    status.classList.remove('error');
    setTimeout(() => {
      status.textContent = '';
    }, 3000);
  }
  renderMoney();
});

['sfTarget', 'sfMonths'].forEach((id) => document.getElementById(id).addEventListener('input', renderSinkingFund));

// ---------- Theme ----------
function currentTheme() {
  return (
    document.documentElement.dataset.theme ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const btn = document.getElementById('themeToggle');
  if (btn) {
    const dark = currentTheme() === 'dark';
    btn.setAttribute('aria-pressed', String(dark));
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.innerHTML = icon(dark ? 'sun' : 'moon');
  }
}

document.getElementById('themeToggle').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  save(STORAGE_KEYS.theme, next);
});

// ---------- AI helpers (optional) ----------
// The server only exposes /api/ai/* when GEMINI_API_KEY is set. We probe once
// and reveal the AI controls only if it answers, so static hosting and
// key-less setups never show buttons that can't work.
let aiAvailable = false;

async function aiRequest(kind, body) {
  const res = await fetch(`/api/ai/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `AI request failed (${res.status})`);
  return data;
}

async function detectAI() {
  try {
    const res = await fetch('/api/ai/status');
    if (res.ok) aiAvailable = !!(await res.json()).enabled;
  } catch {
    aiAvailable = false;
  }
  document.querySelectorAll('.ai-only').forEach((el) => {
    el.hidden = !aiAvailable;
  });
}

async function withBusy(btn, label, fn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try {
    await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function aiListHTML(items, { addTask: withAdd = false } = {}) {
  if (!items.length) return '<p class="item-meta">Nothing suggested.</p>';
  return `<ul class="ai-list">${items
    .map(
      (t) =>
        `<li><span>${escapeHtml(t)}</span>${withAdd ? ` <button type="button" class="mini-btn" data-add-task="${escapeHtml(t)}">+ Task</button>` : ''}</li>`
    )
    .join('')}</ul>`;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-add-task]');
  if (!btn || btn.disabled) return;
  const task = addTask({ title: btn.dataset.addTask.slice(0, 200) });
  if (task) {
    btn.textContent = 'Added ✓';
    btn.disabled = true;
  }
});

// Goal plan
const goalPlanPanel = document.getElementById('goalPlanPanel');
let pendingPlan = null;

document.getElementById('goalPlanBtn').addEventListener('click', () => {
  if (!document.getElementById('goalInput').value.trim()) {
    showWarning('Type your goal first, then ask for a plan.');
    return;
  }
  goalPlanPanel.hidden = false;
  document.getElementById('goalPlanResult').innerHTML = '';
  pendingPlan = null;
  document.getElementById('goalAvailability').focus();
});

document.getElementById('goalPlanClose').addEventListener('click', () => {
  goalPlanPanel.hidden = true;
  pendingPlan = null;
});

document.getElementById('goalPlanGo').addEventListener('click', (e) => {
  const goalText = document.getElementById('goalInput').value.trim();
  const availability = document.getElementById('goalAvailability').value.trim() || 'flexible';
  if (!goalText) return;
  const result = document.getElementById('goalPlanResult');
  withBusy(e.currentTarget, 'Thinking…', async () => {
    try {
      const plan = await aiRequest('plan', { goalText, availability });
      pendingPlan = plan;
      result.innerHTML = `
        <h4>Phases</h4>
        <ol class="ai-list">${plan.phases.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ol>
        <h4>Weekly tasks</h4>
        <ul class="ai-list checks">${plan.tasks
          .map((t, i) => `<li><label><input type="checkbox" data-plan-task="${i}" checked> ${escapeHtml(t)}</label></li>`)
          .join('')}</ul>
        <h4>14-day checkpoints</h4>
        <ul class="ai-list checks">${plan.checkpoints
          .map((t, i) => `<li><label><input type="checkbox" data-plan-check="${i}" checked> ${escapeHtml(t)}</label></li>`)
          .join('')}</ul>
        <button type="button" id="goalPlanApply">Add goal + selected tasks</button>`;
    } catch (err) {
      result.innerHTML = `<p class="ai-error">${escapeHtml(err.message)}</p>`;
    }
  });
});

document.getElementById('goalPlanResult').addEventListener('click', (e) => {
  if (!e.target.closest('#goalPlanApply') || !pendingPlan) return;
  const title = document.getElementById('goalInput').value.trim();
  if (!title) return;
  const goal = {
    id: uid(),
    title,
    dueDate: document.getElementById('goalDate').value || null,
    progress: 0,
    projectId: document.getElementById('goalProject').value || null,
  };
  goals.push(goal);
  save(STORAGE_KEYS.goals, goals);

  const picked = (attr) =>
    [...document.querySelectorAll(`#goalPlanResult [${attr}]:checked`)].map((el) => Number(el.getAttribute(attr)));
  const taskIdx = picked('data-plan-task');
  const checkIdx = picked('data-plan-check');
  taskIdx.forEach((i) => tasks.push(makeTask({ title: pendingPlan.tasks[i], goalId: goal.id })));
  // Spread checkpoints evenly across the next 14 days.
  checkIdx.forEach((i, n) => {
    const d = new Date();
    d.setDate(d.getDate() + Math.round(((n + 1) / checkIdx.length) * 14));
    tasks.push(makeTask({ title: pendingPlan.checkpoints[i], goalId: goal.id, dueDate: localDateKey(d), priority: 'high' }));
  });
  save(STORAGE_KEYS.tasks, tasks);

  document.getElementById('goalInput').value = '';
  document.getElementById('goalDate').value = '';
  document.getElementById('goalProject').value = '';
  goalPlanPanel.hidden = true;
  pendingPlan = null;
  renderTasksAndGoals();
  renderDashboard();
  showWarning(`Added “${title}” with ${taskIdx.length + checkIdx.length} task(s).`);
});

// Journal: decision helper + summary
function entryText(entry) {
  return `${new Date(entry.createdAt).toLocaleDateString()} (${entry.mood}): ${entry.text}`.slice(0, 800);
}

document.getElementById('decisionBtn').addEventListener('click', (e) => {
  const decision = document.getElementById('decisionInput').value.trim();
  const out = document.getElementById('decisionResult');
  if (!decision) {
    out.innerHTML = '<p class="ai-error">Describe the decision first.</p>';
    return;
  }
  const entries = [...journal].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5).map(entryText);
  withBusy(e.currentTarget, 'Thinking…', async () => {
    try {
      const r = await aiRequest('decision', { decision, entries });
      out.innerHTML = `
        <h4>Pros</h4>${aiListHTML(r.pros)}
        <h4>Cons</h4>${aiListHTML(r.cons)}
        <h4>Suggested next step</h4><p>${escapeHtml(r.nextStep)}</p>
        <h4>Small ways to test it</h4>${aiListHTML(r.microTasks, { addTask: true })}`;
    } catch (err) {
      out.innerHTML = `<p class="ai-error">${escapeHtml(err.message)}</p>`;
    }
  });
});

document.getElementById('summaryBtn').addEventListener('click', (e) => {
  const out = document.getElementById('summaryResult');
  if (journal.length === 0) {
    out.innerHTML = '<p class="ai-error">Write a few journal entries first.</p>';
    return;
  }
  const sorted = [...journal].sort((a, b) => b.createdAt - a.createdAt);
  const weekAgo = Date.now() - 7 * 86400000;
  let recent = sorted.filter((j) => j.createdAt >= weekAgo);
  if (recent.length === 0) recent = sorted.slice(0, 5);
  const recentIds = new Set(recent.map((j) => j.id));
  const past = sorted.filter((j) => !recentIds.has(j.id)).slice(0, 5);
  withBusy(e.currentTarget, 'Thinking…', async () => {
    try {
      const r = await aiRequest('summary', {
        entries: recent.slice(0, 15).map(entryText),
        pastEntries: past.map(entryText),
      });
      out.innerHTML = `
        <h4>Summary</h4><p>${escapeHtml(r.summary)}</p>
        <h4>Suggested actions</h4>${aiListHTML(r.actionItems, { addTask: true })}`;
    } catch (err) {
      out.innerHTML = `<p class="ai-error">${escapeHtml(err.message)}</p>`;
    }
  });
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

applyTheme(load(STORAGE_KEYS.theme, null));
if (window.AnimatedBackground) AnimatedBackground.mount(document.getElementById('heroCanvas'));
renderHabits();
renderJournal();
renderGoals();
renderTasksView();
renderProjects();
renderMoney();
renderDashboard();
detectAI();
