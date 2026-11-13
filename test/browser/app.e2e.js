'use strict';
// The app in a real browser (Chromium via Playwright), against the real server
// with sign-in off. Covers the logic that lives in public/app.js and sync.js:
// quick add, data migrations, streaks, goal progress, .ics import, sync
// merging and password-protected backups, plus a click-through of the UI with
// the Content Security Policy enforced.
//
// Run with: npm run test:browser   (needs Playwright's Chromium:
//   npx playwright install chromium)
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer } = require('../helpers');

let srv;
let browser;

test.before(async () => {
  srv = await startServer();
  browser = await chromium.launch();
});

test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.stop();
});

// A fresh page with the app loaded and ready. Collects page errors and any
// Content Security Policy violations so tests can assert there were none.
async function openApp(t) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(`CSP: ${m.text()}`);
  });
  await page.goto(srv.base + '/');
  await page.waitForFunction(() => typeof parseQuickAdd === 'function' && document.querySelector('.tab-btn'));
  return { page, problems };
}

test('quick add understands dates, repeats, priority, goals and projects', async (t) => {
  const { page } = await openApp(t);
  const results = await page.evaluate(() => {
    const now = new Date(2026, 10, 13); // Friday 13 November 2026
    const goals = [{ id: 'g1', title: 'Run a 5k' }];
    const projects = [{ id: 'p1', name: 'Home renovation' }];
    const pick = ({ title, dueDate, recurrence, priority, goalId, projectId, unmatchedGoal }) => ({
      title, dueDate, recurrence, priority, goalId, projectId, unmatchedGoal,
    });
    return Object.fromEntries(
      [
        'pay rent every month !high',
        'dentist tomorrow',
        'call mom next friday',
        'gift dec 25',
        'buy shoes #run @home',
        'gym every monday',
        'thing #nothing',
        'water plants every day !low',
        'report in 3 days',
        'taxes 2026-12-01',
      ].map((s) => [s, pick(parseQuickAdd(s, now, goals, projects))])
    );
  });
  const base = { recurrence: null, priority: 'medium', goalId: null, projectId: null, unmatchedGoal: null };
  assert.deepEqual(results['pay rent every month !high'], { ...base, title: 'Pay rent', dueDate: '2026-11-13', recurrence: 'monthly', priority: 'high' });
  assert.deepEqual(results['dentist tomorrow'], { ...base, title: 'Dentist', dueDate: '2026-11-14' });
  assert.deepEqual(results['call mom next friday'], { ...base, title: 'Call mom', dueDate: '2026-11-20' });
  assert.deepEqual(results['gift dec 25'], { ...base, title: 'Gift', dueDate: '2026-12-25' });
  assert.deepEqual(results['buy shoes #run @home'], { ...base, title: 'Buy shoes', dueDate: null, goalId: 'g1', projectId: 'p1' });
  assert.deepEqual(results['gym every monday'], { ...base, title: 'Gym', dueDate: '2026-11-16', recurrence: 'weekly' });
  assert.deepEqual(results['thing #nothing'], { ...base, title: 'Thing #nothing', dueDate: null, unmatchedGoal: 'nothing' });
  assert.deepEqual(results['water plants every day !low'], { ...base, title: 'Water plants', dueDate: '2026-11-13', recurrence: 'daily', priority: 'low' });
  assert.deepEqual(results['report in 3 days'], { ...base, title: 'Report', dueDate: '2026-11-16' });
  assert.deepEqual(results['taxes 2026-12-01'], { ...base, title: 'Taxes', dueDate: '2026-12-01' });
});

test('old saved data is migrated to the current shape', async (t) => {
  const { page } = await openApp(t);
  const out = await page.evaluate(() =>
    migrate({
      schemaVersion: 1,
      habits: [{ id: 'h1', name: 'Read', log: [] }],
      journal: [{ id: 'j1', text: 'hi', mood: '🙂', createdAt: 1 }],
      goals: [{ id: 'g1', title: 'Run', progress: 10 }],
      tasks: [{ id: 't1', title: 'Old done task', done: true }, { id: 't2', title: 'Old open task', done: false }],
    })
  );
  assert.equal(out.schemaVersion, await page.evaluate(() => SCHEMA_VERSION));
  assert.deepEqual(
    out.tasks.map((x) => [x.status, x.priority, x.recurrence, x.goalId, x.projectId, 'done' in x]),
    [['done', 'medium', null, null, null, false], ['todo', 'medium', null, null, null, false]]
  );
  assert.deepEqual(out.habits[0].frequency, { type: 'daily', days: [] });
  assert.deepEqual(out.journal[0].tags, []);
  assert.equal(out.goals[0].projectId, null);
  assert.deepEqual(out.projects, []);
});

test('habit streaks: daily, scheduled days and weekly', async (t) => {
  const { page } = await openApp(t);
  const s = await page.evaluate(() => {
    const day = (n) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return localDateKey(d);
    };
    const today = new Date().getDay();
    return {
      // done today and the 3 days before, then a gap
      daily: habitStreak({ log: [day(0), day(1), day(2), day(3), day(5)], frequency: { type: 'daily', days: [] } }),
      // not done yet today: yesterday's run still counts
      notYetToday: habitStreak({ log: [day(1), day(2)], frequency: { type: 'daily', days: [] } }),
      broken: habitStreak({ log: [day(2), day(3)], frequency: { type: 'daily', days: [] } }),
      // scheduled only on today's weekday: off days never break it
      scheduled: habitStreak({ log: [day(0), day(7), day(14)], frequency: { type: 'days', days: [today] } }),
      weekly: habitStreak({ log: [day(0), day(7), day(14)], frequency: { type: 'weekly', days: [] } }),
    };
  });
  assert.deepEqual(s, { daily: 4, notYetToday: 2, broken: 0, scheduled: 3, weekly: 3 });
});

test('goal progress comes from linked tasks, ignoring repeating ones', async (t) => {
  const { page } = await openApp(t);
  const p = await page.evaluate(() => {
    tasks = [
      { id: 'a', goalId: 'g1', status: 'done', recurrence: null },
      { id: 'b', goalId: 'g1', status: 'todo', recurrence: null },
      { id: 'c', goalId: 'g1', status: 'todo', recurrence: 'daily' },
    ];
    const linked = goalProgress({ id: 'g1', progress: 0 });
    const manual = goalProgress({ id: 'g2', progress: 40 });
    tasks = [];
    return { linked, manual };
  });
  assert.deepEqual(p.linked, { pct: 50, auto: true, total: 2, done: 1, repeating: 1 });
  assert.deepEqual(p.manual, { pct: 40, auto: false, total: 0, done: 0, repeating: 0 });
});

test('.ics import reads events, including folded lines', async (t) => {
  const { page } = await openApp(t);
  const events = await page.evaluate(() =>
    parseICS(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:abc-123',
        'SUMMARY:Dentist appoint',
        ' ment',
        'DTSTART;VALUE=DATE:20261201',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:def-456',
        'SUMMARY:Call with Sam',
        'DTSTART:20261203T140000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')
    )
  );
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => [e.uid, e.title, e.dueDate]), [
    ['abc-123', 'Dentist appointment', '2026-12-01'],
    ['def-456', 'Call with Sam', '2026-12-03'],
  ]);
});

test('sync merging keeps items from both devices', async (t) => {
  const { page } = await openApp(t);
  const merged = await page.evaluate(() =>
    CloudSync._mergeData(
      { tasks: [{ id: 'a', title: 'A (edited here)' }, { id: 'local', title: 'Only here' }], money: { income: 100 } },
      { tasks: [{ id: 'a', title: 'A (old)' }, { id: 'remote', title: 'Only there' }], money: { currency: 'R' } },
      true,
      ['tasks', 'money']
    )
  );
  assert.deepEqual(merged.tasks.map((x) => x.title).sort(), ['A (edited here)', 'Only here', 'Only there']);
  assert.deepEqual(merged.money, { income: 100, currency: 'R' });
});

test('password-protected backups: only the right password opens them', async (t) => {
  const { page } = await openApp(t);
  const r = await page.evaluate(async () => {
    const original = JSON.stringify({ habits: [], journal: [{ text: 'very private' }], goals: [], tasks: [] });
    const fileText = await protectBackup(original, 'correct horse battery');
    const file = JSON.parse(fileText);
    let wrong = null;
    try {
      await unprotectBackup(file, 'wrong password');
    } catch (e) {
      wrong = e.message;
    }
    const tampered = { ...file, data: file.data.slice(0, -4) + (file.data.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
    let tamperErr = null;
    try {
      await unprotectBackup(tampered, 'correct horse battery');
    } catch (e) {
      tamperErr = e.message;
    }
    const back = await unprotectBackup(file, 'correct horse battery');
    return {
      readable: fileText.includes('very private'),
      recognised: isProtectedBackup(file),
      wrong,
      tamperErr,
      roundTrip: JSON.stringify(back) === original,
    };
  });
  assert.equal(r.readable, false, 'the file must not contain the data in readable form');
  assert.equal(r.recognised, true);
  assert.match(r.wrong, /password is not right/);
  assert.ok(r.tamperErr, 'a changed file is rejected');
  assert.equal(r.roundTrip, true);
});

test('spending: logged against the 50/30/20 budget, month by month', async (t) => {
  const { page, problems } = await openApp(t);
  await page.click('.tab-btn[data-tab="money"]');
  await page.fill('#moneyIncome', '10000');
  await page.fill('#moneyCurrency', 'R');
  await page.click('#moneyForm button[type="submit"]');

  const add = async (amount, note, category, date) => {
    await page.fill('#expenseAmount', String(amount));
    await page.fill('#expenseNote', note);
    await page.selectOption('#expenseCategory', category);
    if (date) await page.fill('#expenseDate', date);
    await page.click('#expenseForm button[type="submit"]');
  };
  const today = await page.evaluate(() => todayKey());
  await add(3000, 'Rent', 'needs', today);
  await add(3500, 'Weekend away', 'wants', today); // over the 30% (R3,000) budget
  await add(1000, 'Emergency fund', 'savings', today);

  const rows = await page.locator('#moneyAllocation .money-row').allTextContents();
  const flat = rows.map((r) => r.replace(/\s+/g, ' ').trim());
  assert.match(flat[0], /Needs R3,000 of R5,000/);
  assert.match(flat[0], /R2,000 left/);
  assert.match(flat[1], /Wants R3,500 of R3,000/);
  assert.match(flat[1], /R500 over budget/);
  assert.match(flat[2], /R1,000 of R2,000/);
  assert.match(await page.textContent('#spendSummary'), /Spent R7,500 of R10,000 · R2,500 left/);
  assert.equal(await page.locator('#moneyAllocation .progress-fill.over').count(), 1, 'only Wants is over');
  assert.equal(await page.locator('#expenseList .item-card').count(), 3);

  // An entry in an earlier month goes to that month, not this one.
  const lastMonth = await page.evaluate(() => shiftMonth(monthKey(new Date()), -1));
  await add(200, 'Old groceries', 'needs', `${lastMonth}-15`);
  assert.equal(await page.textContent('#spendMonthLabel'), await page.evaluate((m) => monthLabel(m), lastMonth));
  assert.equal(await page.locator('#expenseList .item-card').count(), 1);
  await page.click('#spendNext');
  assert.equal(await page.locator('#expenseList .item-card').count(), 3);
  assert.equal(await page.isDisabled('#spendNext'), true, "can't page into the future");

  // Delete with undo.
  await page.locator('#expenseList [data-delete-expense]').first().click();
  assert.equal(await page.locator('#expenseList .item-card').count(), 2);
  await page.click('.toast-undo');
  assert.equal(await page.locator('#expenseList .item-card').count(), 3);

  // Saved, and part of backups and search.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lifeTracker.expenses')).length);
  assert.equal(stored, 4);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('weekend');
  assert.match(await page.locator('.search-hit').first().textContent(), /Weekend away/);
  await page.keyboard.press('Escape');

  assert.deepEqual(problems, []);
});

test('spending import: messy bank CSV and Excel, with fixes in the preview', async (t) => {
  const path = require('path');
  const fixtures = path.join(__dirname, '..', 'fixtures');
  const { page, problems } = await openApp(t);
  await page.click('.tab-btn[data-tab="money"]');

  await page.setInputFiles('#spendImportFile', path.join(fixtures, 'bank-statement.csv'));
  await page.waitForSelector('#spendImportDialog[open]');
  assert.match(await page.textContent('#spendImportFileName'), /9 rows · skipped 3 lines above the table/);
  assert.match(await page.textContent('#spendImportSummary'), /8 to add, \$6,960\.24\. Left out: 1 money in\./);
  assert.equal(await page.locator('#spendImportRows select.guessed').count(), 1, 'the one it could not sort is marked');

  // Fix the guess, leave one row out, and add.
  const rows = page.locator('#spendImportRows tr');
  await rows.nth(0).locator('select').selectOption('wants');
  await rows.nth(1).locator('input[type="checkbox"]').uncheck();
  assert.equal(await page.textContent('#spendImportGo'), 'Add 7 entries');
  await page.click('#spendImportGo');
  assert.equal(await page.isVisible('#spendImportDialog'), false);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('lifeTracker.expenses')));
  assert.equal(saved.length, 7);
  assert.equal(saved.find((e) => e.note === 'SOMETHING UNUSUAL').category, 'wants');
  assert.ok(!saved.some((e) => e.note === 'ENGEN GARAGE N1'), 'the unticked row stayed out');

  // The same file again: everything already there is left unticked.
  await page.setInputFiles('#spendImportFile', path.join(fixtures, 'bank-statement.csv'));
  await page.waitForSelector('#spendImportDialog[open]');
  assert.match(await page.textContent('#spendImportSummary'), /^1 to add/, 'only the row left out last time');
  assert.match(await page.textContent('#spendImportSummary'), /7 already logged/);

  // Point "Description" at another column: the preview follows.
  await page.click('#spendImportMap summary');
  await page.selectOption('#mapDescription', '2'); // the Balance column
  assert.match(await page.locator('#spendImportRows tr').first().textContent(), /6039\.76/);
  await page.click('#spendImportCancel');

  // Excel, read entirely in the browser under the Content Security Policy.
  await page.setInputFiles('#spendImportFile', path.join(fixtures, 'budget.xlsx'));
  await page.waitForSelector('#spendImportDialog[open]');
  assert.match(await page.textContent('#spendImportSummary'), /^4 to add/);
  await page.click('#spendImportGo');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lifeTracker.expenses')).length), 11);

  // Undo takes the whole import back out.
  await page.click('.toast-undo');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lifeTracker.expenses')).length), 7);

  assert.deepEqual(problems, []);
});

test('click-through: add, search, every page, no CSP violations or errors', async (t) => {
  const { page, problems } = await openApp(t);

  await page.fill('#quickAddInput', 'renew passport tomorrow !high');
  await page.press('#quickAddInput', 'Enter');
  await page.click('.tab-btn[data-tab="tasks"]');
  await page.fill('#taskInput', 'Book dentist');
  await page.press('#taskInput', 'Enter');
  assert.equal(await page.locator('#taskList .item-card').count(), 2);

  await page.keyboard.press('Control+k');
  await page.keyboard.type('passport');
  assert.match(await page.locator('.search-hit').first().textContent(), /Renew passport/);
  await page.keyboard.press('Enter');
  assert.equal(await page.textContent('#pageTitle'), 'Tasks');

  for (const tab of await page.$$eval('.tab-btn', (els) => els.map((e) => e.dataset.tab))) {
    await page.click(`.tab-btn[data-tab="${tab}"]`);
  }
  await page.click('#exportBtn');
  assert.equal(await page.isVisible('#exportPanel'), true, 'export offers a password');
  assert.equal(await page.isHidden('#versionsCard'), true, 'no account versions without sign-in');

  assert.deepEqual(problems, []);
});
