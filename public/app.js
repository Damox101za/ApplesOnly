'use strict';

const STORAGE_KEYS = {
  habits: 'lifeTracker.habits',
  journal: 'lifeTracker.journal',
  goals: 'lifeTracker.goals',
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}

function save(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

let habits = load(STORAGE_KEYS.habits);
let journal = load(STORAGE_KEYS.journal);
let goals = load(STORAGE_KEYS.goals);

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- Tabs ----------
document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(btn.dataset.tab).classList.add('active');
});

// ---------- Habits ----------
function habitStreak(habit) {
  let streak = 0;
  let cursor = new Date();
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (habit.log.includes(key)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
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
    li.innerHTML = `
      <button class="check-btn ${done ? 'done' : ''}" data-id="${habit.id}">${done ? '✓' : ''}</button>
      <div class="item-main">
        <div class="item-title">${escapeHtml(habit.name)}</div>
        <div class="item-meta">🔥 ${habitStreak(habit)} day streak</div>
      </div>
      <button class="delete-btn" data-delete="${habit.id}">✕</button>
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
  } else if (delBtn) {
    habits = habits.filter((h) => h.id !== delBtn.dataset.delete);
    save(STORAGE_KEYS.habits, habits);
    renderHabits();
    renderDashboard();
  }
});

// ---------- Journal ----------
let selectedMood = '🙂';
document.getElementById('moodPicker').addEventListener('click', (e) => {
  const btn = e.target.closest('.mood-btn');
  if (!btn) return;
  document.querySelectorAll('.mood-btn').forEach((b) => b.classList.remove('selected'));
  btn.classList.add('selected');
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
      li.innerHTML = `
        <div class="item-main">
          <div class="item-title">${entry.mood} ${new Date(entry.createdAt).toLocaleDateString()}</div>
          <div class="item-text">${escapeHtml(entry.text)}</div>
        </div>
        <button class="delete-btn" data-delete="${entry.id}">✕</button>
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
  save(STORAGE_KEYS.journal, journal);
  input.value = '';
  renderJournal();
  renderDashboard();
});

document.getElementById('journalList').addEventListener('click', (e) => {
  const delBtn = e.target.closest('[data-delete]');
  if (!delBtn) return;
  journal = journal.filter((entry) => entry.id !== delBtn.dataset.delete);
  save(STORAGE_KEYS.journal, journal);
  renderJournal();
  renderDashboard();
});

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
    const dueText = goal.dueDate ? ` · due ${goal.dueDate}` : '';
    li.innerHTML = `
      <div class="item-main">
        <div class="item-title">${escapeHtml(goal.title)}${goal.progress >= 100 ? ' 🎉' : ''}</div>
        <div class="item-meta">${goal.progress}% complete${dueText}</div>
        <div class="progress-track"><div class="progress-fill" style="width:${goal.progress}%"></div></div>
      </div>
      <div class="goal-controls">
        <button class="step-btn" data-dec="${goal.id}">-</button>
        <button class="step-btn" data-inc="${goal.id}">+</button>
      </div>
      <button class="delete-btn" data-delete="${goal.id}">✕</button>
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
  } else if (delBtn) {
    goals = goals.filter((g) => g.id !== delBtn.dataset.delete);
    save(STORAGE_KEYS.goals, goals);
    renderGoals();
    renderDashboard();
  }
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
        <div class="stat-value">${s.value}</div>
        <div class="stat-label">${s.label}</div>
      </div>`
    )
    .join('');
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
