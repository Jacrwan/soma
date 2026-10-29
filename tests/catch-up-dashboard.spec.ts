import { test, expect, type Page } from '@playwright/test';

/**
 * Catch-Up and the yesterday card on the live dashboard (2026-10-29): the plan
 * is shown, nothing is saved until the student accepts it, and accepting moves
 * the blocks that didn't happen instead of copying them.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const now = new Date(2026, 9, 29, 9, 0);                       // Thu, Oct 29, 9 AM
const dateOf = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (offset: number, time: string) => new Date(`${dateOf(offset)}T${time}:00`).toISOString();

async function setup(page: Page, tables: Record<string, Record<string, unknown>[]>) {
  const state = { writes: 0, tables: { subjects: [{ id: 'math', user_id: account.id, name: 'MATH 221', color: '#42a5f5', archived: false }], todos: [], todo_sessions: [], timer_sessions: [], active_timer: [], ...tables } as Record<string, Record<string, unknown>[]> };
  await page.clock.setFixedTime(now);
  await page.addInitScript(account => { localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 'test-token', refresh_token: 'test-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: account })); }, account);
  await page.route('https://soma-regression.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (req.method() === 'GET') {
      let rows = state.tables[table] ?? [];
      for (const key of ['id', 'todo_id', 'date']) { const filter = url.searchParams.get(key); if (filter?.startsWith('eq.')) rows = rows.filter(r => String(r[key]) === filter.slice(3)); }
      return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
    }
    if (table !== 'chat_sessions') state.writes++;
    if (req.method() === 'POST') {
      const row = req.postDataJSON(); const items = Array.isArray(row) ? row : [row];
      for (const item of items) { const current = state.tables[table] ?? []; state.tables[table] = [...current.filter(r => r.id !== item.id), item]; }
    }
    return route.fulfill({ json: null });
  });
  await page.route('**/api/stripe', route => route.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', route => route.fulfill({ json: { events: [], incomplete: false } }));
  return state;
}

const slipped = (id: string, text: string, offset: number) => ({
  todo: { id, user_id: account.id, text, subject_id: 'math', status: 'nothing', date: dateOf(offset), estimated_minutes: 60 },
  session: { id: `${id}-slot`, user_id: account.id, todo_id: id, date: dateOf(offset), start_time: at(offset, '15:00'), end_time: at(offset, '16:00') },
});

test('Catch-Up shows a ready plan, saves nothing until "Add to my plan", then moves the missed blocks forward', async ({ page }) => {
  const work = [slipped('ps5', 'Problem set 5', -3), slipped('lab', 'Lab 7 report', -2), slipped('read', 'Reading 4.4', -1)];
  const state = await setup(page, { todos: work.map(w => w.todo), todo_sessions: work.map(w => w.session) });
  await page.goto('/dashboard?catchup');

  const card = page.getByRole('region', { name: 'A few things slipped.' });
  await expect(card).toContainText('Soma made a plan to get you caught up today.');
  await card.getByRole('button', { name: 'See the plan' }).click();
  await expect(card.getByText('Planned for Tuesday and didn’t happen.')).toBeVisible();
  // Their own undated task from three days ago is left out, and can come back.
  await expect(card.getByText('Your own task from Monday, with no due date.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Do Problem set 5 anyway' })).toBeVisible();
  const before = state.writes;
  await card.getByRole('button', { name: 'Skip Reading 4.4' }).click();
  await expect(card.getByText('You chose to skip this.')).toBeVisible();
  expect(state.writes).toBe(before);

  await card.getByRole('button', { name: 'Add to my plan' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'You’re on track to be caught up today.' })).toBeVisible();
  const sessions = state.tables.todo_sessions;
  // Moved, not copied: the same row, now today; skipped ones stay where they were.
  expect(state.tables.todos).toHaveLength(3);
  expect(sessions).toHaveLength(3);
  expect(sessions.find(s => s.id === 'lab-slot')?.date).toBe(dateOf(0));
  expect(sessions.find(s => s.id === 'read-slot')?.date).toBe(dateOf(-1));
  expect(sessions.find(s => s.id === 'ps5-slot')?.date).toBe(dateOf(-3));
});

test('Catch-Up waits until enough has slipped; one missed block shows nothing', async ({ page }) => {
  const one = slipped('ps5', 'Problem set 5', -1);
  await setup(page, { todos: [one.todo], todo_sessions: [one.session] });
  await page.goto('/dashboard');
  await expect(page.getByLabel('Day progress')).toBeVisible();
  await expect(page.getByRole('region', { name: /Welcome back|A few things slipped/ })).toHaveCount(0);
});

test('the yesterday card suggests the rest for today, checks nothing off, and "I finished it" is the student’s tap', async ({ page }) => {
  const hw = { id: 'hw4', user_id: account.id, text: 'HW 4', subject_id: 'math', status: 'nothing', date: dateOf(-1), estimated_minutes: 60 };
  const quiz = { id: 'quiz', user_id: account.id, text: 'Quiz prep', subject_id: 'math', status: 'nothing', date: dateOf(-1), estimated_minutes: 30 };
  const state = await setup(page, {
    todos: [hw, quiz],
    todo_sessions: [
      { id: 'hw4-slot', user_id: account.id, todo_id: 'hw4', date: dateOf(-1), start_time: at(-1, '15:00'), end_time: at(-1, '16:00') },
      { id: 'quiz-slot', user_id: account.id, todo_id: 'quiz', date: dateOf(-1), start_time: at(-1, '17:00'), end_time: at(-1, '17:30') },
    ],
    timer_sessions: [
      { id: 'log1', user_id: account.id, subject_id: 'math', task_text: 'HW 4', duration_seconds: 40 * 60, date: dateOf(-1), start_time: at(-1, '15:00'), end_time: at(-1, '15:40') },
      { id: 'log2', user_id: account.id, subject_id: 'math', task_text: 'Quiz prep', duration_seconds: 25 * 60, date: dateOf(-1), start_time: at(-1, '17:00'), end_time: at(-1, '17:25') },
    ],
  });
  await page.goto('/dashboard');
  const card = page.getByRole('region', { name: 'From yesterday' });
  await expect(card).toContainText('You put in 40 min. The last 20 min go on today at 9:00 AM–9:20 AM.');
  await card.getByRole('button', { name: 'Change what happens with Quiz prep' }).click();
  await card.getByRole('button', { name: 'I finished it' }).click();
  await expect(card).toContainText('Checked off, with your time on it.');
  expect(state.tables.todos.every(t => t.status === 'nothing')).toBe(true);

  await card.getByRole('button', { name: 'Looks right' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Yesterday’s work is sorted.' })).toBeVisible();
  expect(state.tables.todos.find(t => t.id === 'hw4')?.status).toBe('nothing');
  expect(state.tables.todos.find(t => t.id === 'quiz')?.status).toBe('done');
  const rest = state.tables.todos.find(t => t.text === 'HW 4' && t.id !== 'hw4');
  expect(rest).toBeTruthy();
  expect(state.tables.todo_sessions.find(s => s.todo_id === rest!.id)?.date).toBe(dateOf(0));
});
