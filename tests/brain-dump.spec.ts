import { test, expect, type Page } from '@playwright/test';

/**
 * The brain dump (2026-10-30): a list on the dashboard for getting everything
 * out of your head, with no AI. + puts a line on the plan in the next open
 * time. The list is saved to the account (brain_dump_items), so every device
 * shows the same one; before that table exists it stays in the browser. Also:
 * a hidden morning brief can be brought back.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const now = new Date(2026, 9, 29, 9, 0);                       // Thu, Oct 29, 9 AM
const dateOf = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (offset: number, time: string) => new Date(`${dateOf(offset)}T${time}:00`).toISOString();

type State = { tables: Record<string, Record<string, unknown>[]> };
const fresh = (tables: Record<string, Record<string, unknown>[]> = {}): State => ({ tables: { subjects: [{ id: 'math', user_id: account.id, name: 'MATH 221', color: '#42a5f5', archived: false }], todos: [], todo_sessions: [], timer_sessions: [], active_timer: [], brain_dump_items: [], ...tables } });

/** `dump`: 'missing' answers as Supabase does before the migration; 'failing' refuses brain dump saves. */
async function setup(page: Page, tables: Record<string, Record<string, unknown>[]> | State = {}, dump?: 'missing' | 'failing') {
  const state: State = 'tables' in tables && !Array.isArray(tables.tables) ? tables as State : fresh(tables as Record<string, Record<string, unknown>[]>);
  await page.clock.setFixedTime(now);
  await page.addInitScript(account => { localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 'test-token', refresh_token: 'test-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: account })); }, account);
  await page.route('https://soma-regression.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (table === 'brain_dump_items' && dump === 'missing') return route.fulfill({ status: 404, json: { code: 'PGRST205', message: 'Could not find the table \'public.brain_dump_items\' in the schema cache' } });
    if (table === 'brain_dump_items' && dump === 'failing' && req.method() !== 'GET') return route.fulfill({ status: 500, json: { code: '500', message: 'boom' } });
    if (req.method() === 'DELETE') {
      const id = url.searchParams.get('id');
      if (id?.startsWith('eq.')) state.tables[table] = (state.tables[table] ?? []).filter(r => String(r.id) !== id.slice(3));
      return route.fulfill({ json: null });
    }
    if (req.method() === 'GET') {
      let rows = state.tables[table] ?? [];
      for (const key of ['id', 'todo_id', 'date']) { const filter = url.searchParams.get(key); if (filter?.startsWith('eq.')) rows = rows.filter(r => String(r[key]) === filter.slice(3)); }
      return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
    }
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

test('brain dump: lines are kept, + puts one on today’s plan in open time, and × removes one', async ({ page }) => {
  // 9:00–10:00 is taken, so the first open time is after it.
  const state = await setup(page, {
    todos: [{ id: 'lab', user_id: account.id, text: 'Lab 7 report', subject_id: 'math', status: 'nothing', date: dateOf(0), estimated_minutes: 60 }],
    todo_sessions: [{ id: 'lab-slot', user_id: account.id, todo_id: 'lab', date: dateOf(0), start_time: at(0, '09:00'), end_time: at(0, '10:00') }],
  });
  await page.goto('/dashboard');
  const dump = page.getByRole('region', { name: 'Brain dump' });
  const input = dump.getByRole('textbox', { name: 'Add to your brain dump' });
  for (const line of ['Email TA about the lab grade', 'Buy a poster board', 'Call home']) { await input.fill(line); await input.press('Enter'); }
  await expect(dump.getByRole('listitem')).toHaveCount(3);
  expect(state.tables.todos).toHaveLength(1);

  await page.reload();
  await expect(dump.getByRole('listitem')).toHaveCount(3);
  await dump.getByRole('button', { name: 'Remove “Buy a poster board”' }).click();
  await expect(dump.getByRole('listitem')).toHaveCount(2);

  await dump.getByRole('button', { name: 'Add “Email TA about the lab grade” to your plan' }).click();
  await expect(dump.getByRole('status')).toContainText('Added “Email TA about the lab grade” for today');
  await expect(dump.getByRole('listitem')).toHaveCount(1);
  const todo = state.tables.todos.find(t => t.text === 'Email TA about the lab grade');
  expect(todo).toBeTruthy();
  const session = state.tables.todo_sessions.find(s => s.todo_id === todo!.id)!;
  expect(session.date).toBe(dateOf(0));
  const start = new Date(String(session.start_time)), end = new Date(String(session.end_time));
  expect(start.getTime()).toBeGreaterThanOrEqual(new Date(at(0, '10:00')).getTime());
  expect((end.getTime() - start.getTime()) / 60000).toBe(30);
  await expect(page.getByRole('button', { name: 'Edit: Email TA about the lab grade' })).toBeVisible();
});

test('brain dump: pasting a list adds each line, and a course named in the words is used', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/dashboard');
  const dump = page.getByRole('region', { name: 'Brain dump' });
  const input = dump.getByRole('textbox', { name: 'Add to your brain dump' });
  await input.focus();
  await input.evaluate(el => { const data = new DataTransfer(); data.setData('text/plain', '- math pset 4\n- return library books\n\n- ask about internship'); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
  await expect(dump.getByRole('listitem')).toHaveText(['math pset 4', 'return library books', 'ask about internship']);

  await dump.getByRole('button', { name: 'Add “math pset 4” to your plan' }).click();
  await expect(dump.getByRole('status')).toContainText('Added “math pset 4”');
  const todo = state.tables.todos.find(t => t.text === 'math pset 4')!;
  expect(todo.subject_id).toBe('math');
});

test('a hidden morning brief can be brought back with "Show today’s brief"', async ({ page }) => {
  const missed = { id: 'lab', user_id: account.id, text: 'Lab 7 report', subject_id: 'math', status: 'nothing', date: dateOf(-1), estimated_minutes: 60 };
  await setup(page, { todos: [missed], todo_sessions: [{ id: 'lab-slot', user_id: account.id, todo_id: 'lab', date: dateOf(-1), start_time: at(-1, '15:00'), end_time: at(-1, '16:00') }] });
  await page.goto('/dashboard');
  const brief = page.getByRole('region', { name: 'Good morning. Here’s your day.' });
  await brief.getByRole('button', { name: 'Hide today’s brief' }).click();
  await expect(brief).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Show today’s brief' })).toBeVisible();
  await expect(brief).toHaveCount(0);
  await page.getByRole('button', { name: 'Show today’s brief' }).click();
  await expect(brief.getByRole('button', { name: 'Plan my day' })).toBeVisible();
  await page.reload();
  await expect(brief).toBeVisible();
});

test('brain dump: the list is the account’s, so another device shows the same lines and removals', async ({ browser }) => {
  const state = fresh();
  const laptop = await (await browser.newContext()).newPage();
  const phone = await (await browser.newContext()).newPage();
  await setup(laptop, state);
  await setup(phone, state);

  await laptop.goto('/dashboard');
  const dumpA = laptop.getByRole('region', { name: 'Brain dump' });
  const input = dumpA.getByRole('textbox', { name: 'Add to your brain dump' });
  for (const line of ['Email TA about the lab grade', 'Call home']) { await input.fill(line); await input.press('Enter'); }
  await expect.poll(() => state.tables.brain_dump_items.map(r => r.text)).toEqual(['Email TA about the lab grade', 'Call home']);
  expect(state.tables.brain_dump_items.every(r => r.user_id === account.id)).toBe(true);

  await phone.goto('/dashboard');
  const dumpB = phone.getByRole('region', { name: 'Brain dump' });
  await expect(dumpB.getByRole('listitem')).toHaveText(['Email TA about the lab grade', 'Call home']);
  await dumpB.getByRole('button', { name: 'Remove “Call home”' }).click();
  await expect.poll(() => state.tables.brain_dump_items.length).toBe(1);

  // Coming back to the laptop's tab reads the list again.
  await laptop.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dumpA.getByRole('listitem')).toHaveText(['Email TA about the lab grade']);
});

test('brain dump: lines a browser kept before the table existed are added to the account once', async ({ browser }) => {
  const state = fresh();
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript(id => {
    if (!localStorage.getItem(`soma_brain_dump:${id}`)) localStorage.setItem(`soma_brain_dump:${id}`, JSON.stringify([{ id: '0b6a3c1e-0000-4000-8000-000000000001', text: 'Old line from before' }]));
  }, account.id);
  await setup(page, state);
  await page.goto('/dashboard');
  await expect.poll(() => state.tables.brain_dump_items.map(r => r.text)).toEqual(['Old line from before']);

  const other = await (await browser.newContext()).newPage();
  await setup(other, state);
  await other.goto('/dashboard');
  await expect(other.getByRole('region', { name: 'Brain dump' }).getByRole('listitem')).toHaveText(['Old line from before']);
});

test('brain dump: before the table exists, the list stays in the browser with no error', async ({ page }) => {
  await setup(page, {}, 'missing');
  await page.goto('/dashboard');
  const dump = page.getByRole('region', { name: 'Brain dump' });
  const input = dump.getByRole('textbox', { name: 'Add to your brain dump' });
  await input.fill('Buy a poster board'); await input.press('Enter');
  await page.reload();
  await expect(dump.getByRole('listitem')).toHaveText(['Buy a poster board']);
  await dump.getByRole('button', { name: 'Remove “Buy a poster board”' }).click();
  await expect(dump.getByRole('listitem')).toHaveCount(0);
  await expect(dump.getByRole('alert')).toHaveCount(0);
});

test('brain dump: a line that couldn’t be saved comes off the list and says so', async ({ page }) => {
  await setup(page, {}, 'failing');
  await page.goto('/dashboard');
  const dump = page.getByRole('region', { name: 'Brain dump' });
  const input = dump.getByRole('textbox', { name: 'Add to your brain dump' });
  await input.fill('Buy a poster board'); await input.press('Enter');
  await expect(dump.getByRole('alert')).toHaveText('Couldn’t save “Buy a poster board”. Please add it again.');
  await expect(dump.getByRole('listitem')).toHaveCount(0);
});
