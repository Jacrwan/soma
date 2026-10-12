import { test, expect, type Page } from '@playwright/test';

// "we have to allow the user to be able to choose the date for the schedule
// time as well similar to logging the past sessions" (2026-10-11). The block
// editor had a start and an end time and nothing else: a block could only be
// planned on the day that was on screen.

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const at = (n: number, t: string) => { const d = offset(n); const [h, m] = t.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };
const day = (n: number) => key(offset(n));
const named = (n: number) => offset(n).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
type Row = Record<string, unknown>;

async function setup(page: Page) {
  const db: Record<string, Row[]> = {
    subjects: [{ id: 'phys', user_id: account.id, name: 'Physics 5A', color: '#ab47bc', archived: false }],
    todos: [
      { id: 't-hw', user_id: account.id, text: 'Physics HW 4', subject_id: 'phys', status: 'nothing', date: day(1) },
      // One task planned in two sittings.
      { id: 't-lab', user_id: account.id, text: 'Lab report', subject_id: 'phys', status: 'nothing', date: day(1) },
    ],
    todo_sessions: [
      { id: 's-hw', user_id: account.id, todo_id: 't-hw', date: day(1), start_time: at(1, '20:00'), end_time: at(1, '21:00') },
      { id: 's-lab1', user_id: account.id, todo_id: 't-lab', date: day(1), start_time: at(1, '10:00'), end_time: at(1, '11:00') },
      { id: 's-lab2', user_id: account.id, todo_id: 't-lab', date: day(2), start_time: at(2, '10:00'), end_time: at(2, '11:00') },
    ],
    timer_sessions: [],
  };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
    localStorage.setItem('soma_settings', JSON.stringify({ onboardingCompleted: true, theme: 'light' }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    const rows = db[table];
    if (req.method() === 'POST' && rows) {
      const b = req.postDataJSON();
      for (const r of (Array.isArray(b) ? b : [b]) as Row[]) { const i = rows.findIndex(x => x.id === r.id); if (i < 0) rows.push(r); else rows[i] = { ...rows[i], ...r }; }
      return route.fulfill({ json: null });
    }
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    let out = rows ?? [];
    for (const k of ['id', 'todo_id']) { const f = url.searchParams.get(k); if (f?.startsWith('eq.')) out = out.filter(r => String(r[k]) === f.slice(3)); }
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? out[0] ?? null : out });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/memory', r => r.fulfill({ json: { revision: 0, enabled: true, entries: [] } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.goto('/dashboard');
  await showDay(page, 1);
  await expect(page.getByText('Physics HW 4')).toBeVisible();
  return db;
}
const showDay = (page: Page, n: number) => page.getByLabel('Next seven days').getByRole('button').nth(n).click();
const row = (db: Record<string, Row[]>, table: string, id: string) => db[table].find(r => r.id === id)!;

test('a block opens on its own date, and saving another date moves it there at the same time', async ({ page }) => {
  const db = await setup(page);
  await page.getByRole('button', { name: 'Edit: Physics HW 4' }).click();
  await expect(page.getByLabel('Starts on')).toHaveValue(day(1));
  await expect(page.getByLabel('Ends on')).toHaveValue(day(1));
  await expect(page.getByLabel('Start time')).toHaveValue('20:00');
  await page.getByLabel('Starts on').fill(day(4));
  // The end follows the start, as it does for a past session.
  await expect(page.getByLabel('Ends on')).toHaveValue(day(4));
  await page.getByRole('button', { name: 'Save block' }).click();
  await expect(page.getByLabel('Block editor')).toHaveCount(0);
  // The same clock time, on the new day: this used to save nothing at all.
  expect(row(db, 'todo_sessions', 's-hw')).toMatchObject({ date: day(4), start_time: at(4, '20:00'), end_time: at(4, '21:00') });
  // Its task goes with it, so taking the time off later doesn't send it back.
  expect(row(db, 'todos', 't-hw').date).toBe(day(4));
  // It left the day on screen, and the dashboard says where it went.
  await expect(page.getByText(`Saved on ${named(4)}.`)).toBeVisible();
  await expect(page.getByText('Physics HW 4')).toHaveCount(0);
  await showDay(page, 4);
  await expect(page.getByRole('button', { name: 'Edit: Physics HW 4' })).toBeVisible();
  await expect(page.getByText('60 min').first()).toBeVisible();
});

test('past midnight the end date moves to the next day by itself, and a wrong end date is refused', async ({ page }) => {
  const db = await setup(page);
  await page.getByRole('button', { name: 'Edit: Physics HW 4' }).click();
  await page.getByLabel('Starts on').fill(day(3));
  await page.getByLabel('Start time').fill('23:00');
  await page.getByLabel('End time').fill('01:30');
  await expect(page.getByLabel('Ends on')).toHaveValue(day(4));
  // An end date that the times can't reach: a block is never longer than a day.
  await page.getByLabel('Ends on').fill(day(5));
  await page.getByRole('button', { name: 'Save block' }).click();
  await expect(page.getByText('A block ends on the day it starts, or the next day when it runs past midnight. Check the end date.')).toBeVisible();
  expect(row(db, 'todo_sessions', 's-hw').date).toBe(day(1));
  await page.getByLabel('Ends on').fill(day(3));
  await page.getByRole('button', { name: 'Save block' }).click();
  await expect(page.getByText('The end is before the start. Check the end date.')).toBeVisible();
  expect(row(db, 'todo_sessions', 's-hw').date).toBe(day(1));
  await page.getByLabel('Ends on').fill(day(4));
  await page.getByRole('button', { name: 'Save block' }).click();
  await expect(page.getByLabel('Block editor')).toHaveCount(0);
  expect(row(db, 'todo_sessions', 's-hw')).toMatchObject({ date: day(3), start_time: at(3, '23:00'), end_time: at(4, '01:30') });
});

test('changing only the time leaves the block on its day', async ({ page }) => {
  const db = await setup(page);
  await page.getByRole('button', { name: 'Edit: Physics HW 4' }).click();
  await page.getByLabel('Start time').fill('18:00');
  await page.getByRole('button', { name: 'Save block' }).click();
  await expect(page.getByText('Plan saved.')).toBeVisible();
  // Moving the start keeps the length.
  expect(row(db, 'todo_sessions', 's-hw')).toMatchObject({ date: day(1), start_time: at(1, '18:00'), end_time: at(1, '19:00') });
  expect(row(db, 'todos', 't-hw').date).toBe(day(1));
});

test('one sitting of a task planned twice moves alone; the task and its other sitting stay', async ({ page }) => {
  const db = await setup(page);
  await page.getByRole('button', { name: 'Edit: Lab report' }).click();
  await page.getByLabel('Starts on').fill(day(5));
  await page.getByRole('button', { name: 'Save block' }).click();
  await expect(page.getByLabel('Block editor')).toHaveCount(0);
  expect(row(db, 'todo_sessions', 's-lab1')).toMatchObject({ date: day(5), start_time: at(5, '10:00') });
  expect(row(db, 'todo_sessions', 's-lab2')).toMatchObject({ date: day(2), start_time: at(2, '10:00') });
  expect(row(db, 'todos', 't-lab').date).toBe(day(1));
});

test('a new block can be put on a date other than the one on screen', async ({ page }) => {
  const db = await setup(page);
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  await page.getByRole('button', { name: /^Add block in gap/ }).first().click();
  await expect(page.getByLabel('Starts on')).toHaveValue(day(1));
  await page.getByLabel('Title').fill('Midterm review');
  await page.getByLabel('Subject').selectOption('Physics 5A');
  await page.getByLabel('Starts on').fill(day(6));
  await page.getByLabel('Start time').fill('14:00');
  await page.getByLabel('End time').fill('15:30');
  await page.getByRole('button', { name: 'Save block' }).click();
  await expect(page.getByText(`Saved on ${named(6)}.`)).toBeVisible();
  const task = db.todos.find(t => t.text === 'Midterm review')!;
  expect(task.date).toBe(day(6));
  expect(db.todo_sessions.find(s => s.todo_id === task.id)).toMatchObject({ date: day(6), start_time: at(6, '14:00'), end_time: at(6, '15:30') });
});

test('a task with no time has no date to pick until a time is scheduled', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Edit: Physics HW 4' }).click();
  await page.getByLabel('Schedule a time').uncheck();
  await expect(page.getByLabel('Starts on')).toHaveCount(0);
  await page.getByLabel('Schedule a time').check();
  await expect(page.getByLabel('Starts on')).toHaveValue(day(1));
});
