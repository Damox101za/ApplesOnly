'use strict';

const STORAGE_KEYS = {
  habits: 'lifeTracker.habits',
  journal: 'lifeTracker.journal',
  goals: 'lifeTracker.goals',
  schemaVersion: 'lifeTracker.schemaVersion',
  lastBackupAt: 'lifeTracker.lastBackupAt',
};

const SCHEMA_VERSION = 1;

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
    schemaVersion: storedVersion,
  };

  if (data.schemaVersion < SCHEMA_VERSION) {
    data = migrate(data);
    save(STORAGE_KEYS.habits, data.habits);
    save(STORAGE_KEYS.journal, data.journal);
    save(STORAGE_KEYS.goals, data.goals);
    save(STORAGE_KEYS.schemaVersion, data.schemaVersion);
  }

  return data;
}

let { habits, journal, goals } = loadAndMigrate();

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

function finalizePendingDelete() {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timer);
  const { type } = pendingDelete;
  pendingDelete = null;
  hideToast();
  if (type === 'habit') save(STORAGE_KEYS.habits, habits);
  else if (type === 'journal') save(STORAGE_KEYS.journal, journal);
  else if (type === 'goal') save(STORAGE_KEYS.goals, goals);
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
  const list = type === 'habit' ? habits : type === 'journal' ? journal : goals;
  list.splice(index, 0, item);
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

// ---------- Backup: export / import ----------
function hasAnyData() {
  return habits.length > 0 || journal.length > 0 || goals.length > 0;
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
    Array.isArray(data.goals)
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
    summary.textContent =
      `This file has ${data.habits.length} habit(s), ${data.journal.length} journal entr${data.journal.length === 1 ? 'y' : 'ies'}, ` +
      `and ${data.goals.length} goal(s)` +
      (data.exportedAt ? `, exported ${new Date(data.exportedAt).toLocaleString()}` : '') +
      '. Importing will replace your current data. Continue?';
    document.getElementById('importConfirm').classList.add('visible');
  };
  reader.readAsText(file);
}

function confirmImport() {
  if (!pendingImport) return;
  const previous = { habits, journal, goals };
  const migrated = migrate({
    habits: pendingImport.habits,
    journal: pendingImport.journal,
    goals: pendingImport.goals,
    schemaVersion: pendingImport.schemaVersion || 0,
  });
  habits = migrated.habits;
  journal = migrated.journal;
  goals = migrated.goals;
  save(STORAGE_KEYS.habits, habits);
  save(STORAGE_KEYS.journal, journal);
  save(STORAGE_KEYS.goals, goals);
  save(STORAGE_KEYS.schemaVersion, migrated.schemaVersion);
  renderHabits();
  renderJournal();
  renderGoals();
  renderDashboard();
  cancelImport();
  showToast('Backup imported.', () => {
    habits = previous.habits;
    journal = previous.journal;
    goals = previous.goals;
    save(STORAGE_KEYS.habits, habits);
    save(STORAGE_KEYS.journal, journal);
    save(STORAGE_KEYS.goals, goals);
    renderHabits();
    renderJournal();
    renderGoals();
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
  renderHabits();
  renderJournal();
  renderGoals();
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

  const stats = [
    { value: `${habitsDoneToday}/${habits.length || 0}`, label: 'Habits done today' },
    { value: bestStreak, label: 'Best streak (days)' },
    { value: activeGoals, label: 'Active goals' },
    { value: completedGoals, label: 'Goals completed' },
    { value: journal.length, label: 'Journal entries' },
    { value: latestMood, label: 'Latest mood' },
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
renderDashboard();
