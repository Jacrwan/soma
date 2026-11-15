import { test, expect, type Page } from '@playwright/test';

/**
 * The Tasks page and the scheduler on the dashboard (2026-11-15): tasks with
 * a due date place their own sittings, a missed sitting moves on its own,
 * checking off one sitting doesn't finish the task, and dragging (or arrow
 * keys on the handle) changes the silent priority order. No AI.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const now = new Date(2026, 10, 16, 9, 0);                      // Mon, Nov 16, 9 AM
const dateOf = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (offset: number, time: string) => new Date(`${dateOf(offset)}T${time}:00`).toISOString();
type Row = Record<string, unknown>;
type State = { tables: Record<string, Row[]> };

async function setup(page: Page, tables: Record<string, Row[]> = {}) {
  const state: State = { tables: { subjects: [{ id: 'hist', user_id: account.id, name: 'HIST 10', color: '#ab47bc', archived: false }], todos: [], todo_sessions: [], timer_sessions: [], active_timer: [], brain_dump_items: [], ...tables } };
  await page.clock.setFixedTime(now);
  await page.addInitScript(account => { localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 'test-token', refresh_token: 'test-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: account })); }, account);
  await page.route('https://soma-regression.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, walkthroughCompleted: true, theme: 'light' } } });
    const id = url.searchParams.get('id')?.replace(/^eq\./, '');
    if (req.method() === 'DELETE') { state.tables[table] = (state.tables[table] ?? []).filter(r => String(r.id) !== id); return route.fulfill({ json: [{ id }] }); }
    if (req.method() === 'PATCH') {
      const patch = req.postDataJSON() as Row;
      state.tables[table] = (state.tables[table] ?? []).map(r => String(r.id) === id ? { ...r, ...patch } : r);
      return route.fulfill({ json: null });
    }
    if (req.method() === 'GET') {
      let rows = state.tables[table] ?? [];
      for (const key of ['id', 'todo_id', 'date']) { const f = url.searchParams.get(key); if (f?.startsWith('eq.')) rows = rows.filter(r => String(r[key]) === f.slice(3)); }
      return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
    }
    if (req.method() === 'POST') {
      const row = req.postDataJSON(); const items = Array.isArray(row) ? row : [row];
      for (const item of items) state.tables[table] = [...(state.tables[table] ?? []).filter(r => r.id !== item.id), item];
    }
    return route.fulfill({ json: null });
  });
  await page.route('**/api/stripe', route => route.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', route => route.fulfill({ json: { events: [], incomplete: false } }));
  return state;
}

const task = (id: string, text: string, due: string, extra: Row = {}): Row => ({ id, user_id: account.id, text, subject_id: 'hist', status: 'nothing', date: dateOf(0), due_date: due, estimated_minutes: 60, auto_schedule: true, ...extra });

test('Tasks: adding a task places its sittings right away, before it is due', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/tasks');
  await page.getByRole('textbox', { name: 'New task' }).fill('Essay draft');
  await page.getByRole('combobox', { name: 'Course' }).selectOption({ label: 'HIST 10' });
  await page.getByLabel('Due date').fill(dateOf(4));
  await page.getByRole('combobox', { name: 'How long' }).selectOption({ label: '2h' });
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const row = page.getByRole('listitem').filter({ hasText: 'Essay draft' });
  await expect(row).toBeVisible();
  await expect(row.getByText(/^Next: Today/)).toBeVisible();
  const todo = state.tables.todos.find(t => t.text === 'Essay draft')!;
  expect(todo).toMatchObject({ auto_schedule: true, estimated_minutes: 120, due_date: dateOf(4) });
  const sittings = state.tables.todo_sessions.filter(s => s.todo_id === todo.id);
  // Two hours in sittings of about 50 minutes: three of 40, on different days, all before the due day.
  expect(sittings).toHaveLength(3);
  expect(sittings.every(s => +new Date(String(s.end_time)) - +new Date(String(s.start_time)) === 40 * 60000)).toBe(true);
  expect(new Set(sittings.map(s => s.date)).size).toBe(3);
  expect(sittings.every(s => String(s.date) < dateOf(4))).toBe(true);
  await expect(row.getByText('2h left')).toBeVisible();
});

test('Tasks: the order is the priority, and arrow keys on the handle change it', async ({ page }) => {
  // Soma's guess: a project counts as due 3 days sooner, so it comes before homework due a day earlier.
  const state = await setup(page, { todos: [task('a', 'Homework 3', dateOf(2)), task('b', 'Project proposal', dateOf(3)), task('c', 'Reading ch. 5', dateOf(6))] });
  await page.goto('/tasks');
  const titles = page.getByRole('list', { name: 'Tasks, most important first' }).locator('li span[class*="title"]');
  await expect(titles).toHaveText(['Project proposal', 'Homework 3', 'Reading ch. 5']);
  await page.getByRole('button', { name: /Reorder Reading ch\. 5/ }).press('ArrowUp');
  await expect(titles).toHaveText(['Project proposal', 'Reading ch. 5', 'Homework 3']);
  // Its rank now sits between its new neighbours' places.
  await expect.poll(() => typeof state.tables.todos.find(t => t.id === 'c')!.rank).toBe('number');
});

test('dashboard: a missed sitting moves to the next open time and says so', async ({ page }) => {
  const state = await setup(page, {
    todos: [task('essay', 'Essay draft', dateOf(1))],
    todo_sessions: [{ id: 'missed', user_id: account.id, todo_id: 'essay', date: dateOf(0), start_time: at(0, '07:00'), end_time: at(0, '08:00') }],
  });
  await page.goto('/dashboard');
  await expect(page.getByText('Moved a sitting that had to move')).toBeVisible();
  const moved = state.tables.todo_sessions.find(s => s.id === 'missed')!;
  expect(moved.start_time).toBe(at(0, '09:00'));
  expect(moved.end_time).toBe(at(0, '10:00'));
});

test('dashboard: checking off one sitting leaves the task in progress until nothing is left', async ({ page }) => {
  const state = await setup(page, {
    todos: [task('essay', 'Essay draft', dateOf(4), { estimated_minutes: 120 })],
    todo_sessions: [
      { id: 's1', user_id: account.id, todo_id: 'essay', date: dateOf(0), start_time: at(0, '10:00'), end_time: at(0, '11:00') },
      { id: 's2', user_id: account.id, todo_id: 'essay', date: dateOf(2), start_time: at(2, '10:00'), end_time: at(2, '11:00') },
    ],
  });
  await page.goto('/dashboard');
  const block = page.locator('article').filter({ hasText: 'Essay draft' }).first();
  await expect(block).toBeVisible();
  await block.getByRole('button', { name: 'Complete: Essay draft' }).click();
  await expect.poll(() => state.tables.todo_sessions.find(s => s.id === 's1')?.done_at).toBeTruthy();
  expect(state.tables.todo_sessions.find(s => s.id === 's2')?.done_at).toBeFalsy();
  await expect.poll(() => state.tables.todos.find(t => t.id === 'essay')!.status).toBe('in_progress');
});

test('Tasks: open to-dos long past their date are not listed; ones still ahead are, to schedule', async ({ page }) => {
  await setup(page, { todos: [
    { id: 'old', user_id: account.id, text: 'K&K Ch.2 — End-of-chapter problem set', status: 'nothing', date: '2026-06-20', due_date: '2026-06-28' },
    { id: 'ahead', user_id: account.id, text: 'Read ch. 4 notes', status: 'nothing', date: dateOf(0), due_date: dateOf(5) },
  ] });
  await page.goto('/tasks');
  const ahead = page.getByRole('listitem').filter({ hasText: 'Read ch. 4 notes' });
  await expect(ahead).toBeVisible();
  await expect(ahead.getByRole('button', { name: 'Schedule' })).toBeVisible();
  await expect(page.getByText('K&K Ch.2 — End-of-chapter problem set')).toHaveCount(0);
});
