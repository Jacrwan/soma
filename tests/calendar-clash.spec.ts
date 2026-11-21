import { test, expect, type Page } from '@playwright/test';

/**
 * 2026-11-19: the owner moved gym in Google Calendar to 5 PM, and the
 * "Review: CS 61A lecture" block already there stayed under it. Only tasks
 * with a due date ever moved, and a calendar change didn't run the scheduler.
 * Now a block an event sits on moves to the first open time after it.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const now = new Date(2026, 10, 19, 11, 30);                    // Thu, Nov 19, 11:30 AM
const dateOf = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (offset: number, time: string) => new Date(`${dateOf(offset)}T${time}:00`).toISOString();
type Row = Record<string, unknown>;
type State = { tables: Record<string, Row[]> };

/** `running`: a clock the test moves forward (page.clock.runFor), instead of one stopped at `now`. */
async function setup(page: Page, tables: Record<string, Row[]> = {}, opts: { running?: boolean; events?: () => Row[]; init?: (userId: string) => void } = {}) {
  const state: State = { tables: { subjects: [{ id: 'hist', user_id: account.id, name: 'HIST 10', color: '#ab47bc', archived: false }], todos: [], todo_sessions: [], timer_sessions: [], active_timer: [], brain_dump_items: [], ...tables } };
  if (opts.running) await page.clock.install({ time: now });
  else await page.clock.setFixedTime(now);
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
  await page.route('**/api/google-calendar-events', route => route.fulfill({ json: { events: opts.events?.() ?? [], incomplete: false } }));
  return state;
}


const block = (id: string, text: string, from: string, to: string, extra: Row = {}) => ({
  todo: { id, user_id: account.id, text, subject_id: 'hist', status: 'nothing', date: dateOf(0), assignment_id: null },
  session: { id: `s-${id}`, user_id: account.id, todo_id: id, date: dateOf(0), start_time: at(0, from), end_time: at(0, to), ...extra },
});
const event = (id: string, title: string, from: string, to: string) => ({ id, summary: title, start: { dateTime: at(0, from) }, end: { dateTime: at(0, to) }, source: { connectionId: 'c', calendarId: 'primary' } });

test('an event that moves onto a block moves it, and a review that comes after it keeps its place in line', async ({ page }) => {
  const review = block('review', 'Review: CS 61A lecture from Mon 11-02', '17:00', '18:00');
  const next = block('next', 'Review: CS 61A lecture from Wed 11-04', '18:00', '19:00');
  let gym = event('gym', 'gym', '15:00', '16:00');
  const state = await setup(page, { todos: [review.todo, next.todo], todo_sessions: [review.session, next.session] }, { events: () => [gym] });
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Edit: Review: CS 61A lecture from Mon 11-02' })).toBeVisible();
  await page.waitForTimeout(500);
  gym = event('gym', 'gym', '17:00', '18:00');
  // Opened again after the change in Google Calendar.
  await page.reload();
  // Since 2026-11-21 lecture reviews keep their order: the 11-02 review goes
  // where the 11-04 one was, and that one takes the slot the move found.
  await expect.poll(() => state.tables.todo_sessions.find(s => s.id === 's-review')!.start_time).toBe(at(0, '18:00'));
  expect(state.tables.todo_sessions.find(s => s.id === 's-review')!.end_time).toBe(at(0, '19:00'));
  await expect.poll(() => state.tables.todo_sessions.find(s => s.id === 's-next')!.start_time).toBe(at(0, '19:10'));
  expect(state.tables.todo_sessions).toHaveLength(2);
  expect(state.tables.todos).toHaveLength(2);
  await expect(page.getByText('Moved 2 sittings that had to move')).toBeVisible();
});

test('a block already over an event (a class the student may skip) stays, and so does every clash on the first run', async ({ page }) => {
  const study = block('study', 'Math 53 homework', '12:00', '13:00');
  const state = await setup(page, { todos: [study.todo], todo_sessions: [study.session] }, { events: () => [event('lec', 'CS 61A Lecture', '12:00', '12:59')] });
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Edit: Math 53 homework' })).toBeVisible();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit: Math 53 homework' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(state.tables.todo_sessions[0].start_time).toBe(at(0, '12:00'));
});

test('moving an event in Google Calendar moves the block it lands on when the dashboard is opened again', async ({ page }) => {
  const review = block('review', 'Review: CS 61A lecture', '17:00', '18:00');
  let gym = event('gym', 'gym', '15:00', '16:00');
  const state = await setup(page, { todos: [review.todo], todo_sessions: [review.session] }, { events: () => [gym] });
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Edit: Review: CS 61A lecture' })).toBeVisible();
  expect(state.tables.todo_sessions[0].start_time).toBe(at(0, '17:00'));
  gym = event('gym', 'gym', '17:00', '18:00');
  // Back from Google Calendar: the window gets focus and the plan is read again.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => state.tables.todo_sessions[0].start_time).toBe(at(0, '18:00'));
});

test('a block whose time the student chose moves too when an event moves onto it, and keeps its pin', async ({ page }) => {
  const study = block('study', 'Math 53 homework', '14:00', '15:00', { pinned: true });
  let lecture = event('lec', 'CS 61A Lecture', '12:00', '12:59');
  const state = await setup(page, { todos: [study.todo], todo_sessions: [study.session] }, { events: () => [lecture] });
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Edit: Math 53 homework' })).toBeVisible();
  await page.waitForTimeout(500);
  lecture = event('lec', 'CS 61A Lecture', '14:00', '14:59');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => state.tables.todo_sessions[0].start_time).toBe(at(0, '15:00'));
});

test('a checked-off block stays under the event', async ({ page }) => {
  const done = block('done', 'Reading notes', '17:00', '18:00');
  let gym = event('gym', 'gym', '15:00', '16:00');
  const state = await setup(page, { todos: [{ ...done.todo, status: 'done' }], todo_sessions: [done.session] }, { events: () => [gym] });
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Edit: Reading notes' })).toBeVisible();
  await page.waitForTimeout(500);
  gym = event('gym', 'gym', '17:00', '18:00');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit: Reading notes' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(state.tables.todo_sessions[0].start_time).toBe(at(0, '17:00'));
});
