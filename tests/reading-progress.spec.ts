import { test, expect, type Page } from '@playwright/test';
import { triaged } from './triage';

// The reported case: memory said "read through 3.7", and Soma still called
// last week's assigned reading (4.1–4.9) "completed". Progress now comes only
// from the reading list, which moves when blocks are checked off.
const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const at = (n: number, t: string) => { const d = offset(n); const [h, m] = t.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };
const TODAY = key(offset(0)), TOMORROW = key(offset(1));
type Row = Record<string, unknown>;
type Ctx = { unchecked?: { id: string; title: string; did: number; cov?: string }[]; courses: { s: string; done: string; behind: number; unconfirmed?: string; open: { id: string; l: string; due?: string; planned?: unknown }[] }[]; plan: { id?: string; title: string; cov?: string }[] };

const SECTIONS: [string, number][] = [['3.7', -9], ['4.1', -4], ['4.2', -4], ['4.3', -4], ['4.4', -4], ['4.5', -4], ['4.6', -4], ['4.7', -2], ['4.8', -2], ['4.9', -2], ['5.1', 3], ['5.2', 3], ['5.3', 3], ['5.4', 3]];
const item = (label: string) => `item-${label}`;

function data() {
  return {
    subjects: [
      { id: 'phys', user_id: account.id, name: 'Physics 5A', color: '#ab47bc', archived: false },
      { id: 'cs', user_id: account.id, name: 'CS 61A', color: '#66bb6a', archived: false },
    ],
    todos: [
      // Planned for 4.1–4.6, over just after midnight today, never checked off.
      { id: 't-read', user_id: account.id, text: 'Physics reading: 4.1–4.6 Momentum', subject_id: 'phys', status: 'nothing', date: TODAY },
      { id: 't-cs', user_id: account.id, text: 'Hog project review', subject_id: 'cs', status: 'nothing', date: TOMORROW },
    ] as Row[],
    todo_sessions: [
      { id: 's-read', user_id: account.id, todo_id: 't-read', date: TODAY, start_time: at(0, '00:00'), end_time: at(0, '00:01') },
      { id: 's-cs', user_id: account.id, todo_id: 't-cs', date: TOMORROW, start_time: at(1, '17:30'), end_time: at(1, '19:30') },
    ] as Row[],
    course_items: SECTIONS.map(([label, due], position) => ({
      id: item(label), user_id: account.id, subject_id: 'phys', label, title: label.startsWith('3') ? 'Forces' : label.startsWith('4') ? 'Momentum' : 'Energy', due_date: key(offset(due)), position,
      done_at: label === '3.7' ? at(-9, '21:00') : null,
      todo_id: ['4.1', '4.2', '4.3', '4.4', '4.5', '4.6'].includes(label) ? 't-read' : null,
    })) as Row[],
    // Half an hour of Focus on the 4.1–4.6 block, which was never checked off.
    timer_sessions: [{ id: 'f-read', user_id: account.id, subject_id: 'phys', task_text: 'Physics reading: 4.1–4.6 Momentum', date: TODAY, start_time: at(0, '00:00'), end_time: at(0, '00:30'), duration_seconds: 1800 }] as Row[],
  };
}

/** Rows matching PostgREST filters like id=eq.x and id=in.(a,b). */
function matching(rows: Row[], params: URLSearchParams) {
  return rows.filter(r => [...params].every(([k, v]) => {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map(x => x.replace(/"/g, '')).includes(String(r[k]));
    return true;
  }));
}

async function setup(page: Page, reply: (ctx: Ctx) => unknown, edit?: (db: Record<string, Row[]>) => void) {
  const db: Record<string, Row[]> = data();
  edit?.(db);
  const state = { db, prompt: '' };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
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
    if (req.method() === 'PATCH' && rows) {
      for (const r of matching(rows, url.searchParams)) Object.assign(r, req.postDataJSON());
      return route.fulfill({ json: null });
    }
    if (req.method() === 'DELETE' && rows) {
      const gone = matching(rows, url.searchParams);
      db[table] = rows.filter(r => !gone.includes(r));
      return route.fulfill({ json: gone.map(r => ({ id: r.id })) });
    }
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    const out = matching(rows ?? [], url.searchParams);
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? out[0] ?? null : out });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/memory', r => r.fulfill({ json: { revision: 0, enabled: true, entries: [] } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/chat', route => { if (triaged(route)) return;
    const body = route.request().postDataJSON();
    state.prompt = `${body.systemPrompt}\n${body.context ?? ''}`;
    const ctx = JSON.parse(String(body.context).match(/CONTEXT[^:]*: (\{[^\n]*\})/)![1]) as Ctx;
    return route.fulfill({ json: { content: [{ text: JSON.stringify(reply(ctx)) }] } });
  });
  await page.goto('/dashboard');
  await expect(page.getByText('Physics reading: 4.1–4.6 Momentum')).toBeVisible();
  return state;
}
async function ask(page: Page, text: string) {
  await page.getByLabel('What do you need to work on?').fill(text);
  await page.getByRole('button', { name: 'Send to Soma' }).click();
}
const idOf = (ctx: Ctx, label: string) => ctx.courses[0].open.find(i => i.l === label)!.id;
const items = (db: Record<string, Row[]>) => Object.fromEntries(db.course_items.map(r => [String(r.label), r]));

test('Soma sees what is actually read, not what the syllabus says should be', async ({ page }) => {
  const state = await setup(page, () => ({ reply: 'ok' }));
  await ask(page, 'what physics reading have i done?');
  await expect(page.getByRole('log')).toContainText('ok');
  const ctx = JSON.parse(state.prompt.match(/CONTEXT[^:]*: (\{[^\n]*\})/)![1]) as Ctx;
  const phys = ctx.courses.find(c => c.s === 'Physics 5A')!;
  expect(phys.done).toBe('through 3.7');
  expect(phys.open[0].l).toBe('4.1');
  expect(phys.behind).toBe(9);                          // 4.1–4.9 are past due and unread
  // Due dates carry their weekday: Soma once called Thursday Oct 1 "Wednesday".
  const due = phys.open[0].due!.slice(4);
  expect(phys.open[0].due).toBe(`${new Date(`${due}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })} ${due}`);
  expect(phys.open[0].due).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{4}-\d{2}-\d{2}$/);
  expect(phys.unconfirmed).toBe('4.1–4.6');             // its block ended unchecked
  expect(phys.open[0].planned).toBe('ended unchecked');
  expect(ctx.plan.find(p => p.title.startsWith('Physics reading'))!.cov).toBe('4.1–4.6');
  expect(state.prompt).toContain('never infer it from a due date');
  // Worked on but never checked off: Soma is told to ask.
  expect(ctx.unchecked).toEqual([expect.objectContaining({ id: expect.stringMatching(/^b[0-9a-z]{6}$/), did: 30, cov: '4.1–4.6' })]);
});

test('a block that ended with no Focus time counts as not started: no question, no bookmark', async ({ page }) => {
  const state = await setup(page, () => ({ reply: 'ok' }), db => { db.timer_sessions = []; });
  await expect(page.getByRole('button', { name: /Stopped part way/ })).toHaveCount(0);
  await ask(page, 'plan physics');
  await expect(page.getByRole('log')).toContainText('ok');
  const ctx = JSON.parse(state.prompt.match(/CONTEXT[^:]*: (\{[^\n]*\})/)![1]) as Ctx;
  expect(ctx.unchecked).toBeUndefined();
  expect(ctx.courses[0].unconfirmed).toBeUndefined();
  expect(ctx.courses[0].open[0].planned).toBeUndefined();
});

test('saying it was finished marks a past block done from today’s plan', async ({ page }) => {
  const state = await setup(page, () => ({ reply: 'Nice.', changes: [{ action: 'complete', id: 's-read' }] }));
  await ask(page, 'yes i finished it');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.todos.find(t => t.id === 't-read')!.status).toBe('done');
  expect(items(state.db)['4.6'].done_at).toBeTruthy();
});

test('"I got through 4.3" marks only 4.1–4.3 and hands 4.4–4.6 back', async ({ page }) => {
  const state = await setup(page, ctx => ({ reply: 'Noted.', changes: [{ action: 'progress', id: 's-read', through: idOf(ctx, '4.3') }] }));
  await ask(page, 'i only got through 4.3');
  await expect(page.getByText('Marks 4.1–4.3 read; 4.4–4.6 goes back on your list').first()).toBeVisible();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.getByText('Physics reading: 4.1–4.3 Momentum')).toBeVisible();
  const it = items(state.db);
  for (const l of ['4.1', '4.2', '4.3']) expect(it[l].done_at).toBeTruthy();
  for (const l of ['4.4', '4.5', '4.6', '4.7']) { expect(it[l].done_at).toBeNull(); }
  for (const l of ['4.4', '4.5', '4.6']) expect(it[l].todo_id).toBeNull();
  expect(state.db.todos.find(t => t.id === 't-read')!.status).toBe('done');
});

test('a proposed block covers the sections it names once accepted', async ({ page }) => {
  const state = await setup(page, ctx => ({ reply: 'Planned.', blocks: [{ title: 'Physics reading: 4.7–4.9 Mass flow', subject: 'Physics 5A', date: TOMORROW, start: '14:00', end: '15:00', covers: [idOf(ctx, '4.7'), idOf(ctx, '4.9')] }] }));
  await ask(page, 'plan the next reading tomorrow');
  await expect(page.getByText('Covers 4.7–4.9').first()).toBeVisible();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.getByRole('button', { name: /Accept/ })).toHaveCount(0);
  const todo = state.db.todos.find(t => t.text === 'Physics reading: 4.7–4.9 Mass flow')!;
  const it = items(state.db);
  for (const l of ['4.7', '4.8', '4.9']) expect(it[l].todo_id).toBe(todo.id);
  expect(it['5.1'].todo_id).toBeNull();
});

test('a block cannot re-plan sections already in an upcoming block', async ({ page }) => {
  const state = await setup(page, ctx => ({ reply: 'Planned.', blocks: [{ title: 'Momentum 4.7–4.9 again', subject: 'Physics 5A', date: TOMORROW, start: '14:00', end: '15:00', covers: [idOf(ctx, '4.7'), idOf(ctx, '4.9')] }] }));
  state.db.todos.push({ id: 't-next', user_id: account.id, text: 'Physics reading: 4.7–4.9', subject_id: 'phys', status: 'nothing', date: TOMORROW });
  state.db.todo_sessions.push({ id: 's-next', user_id: account.id, todo_id: 't-next', date: TOMORROW, start_time: at(1, '09:00'), end_time: at(1, '10:00') });
  for (const r of state.db.course_items) if (['4.7', '4.8', '4.9'].includes(String(r.label))) r.todo_id = 't-next';
  await ask(page, 'plan 4.7 to 4.9');
  await expect(page.getByRole('log')).toContainText('4.7 is already planned in another block');
  const ctx = JSON.parse(state.prompt.match(/CONTEXT[^:]*: (\{[^\n]*\})/)![1]) as Ctx;
  expect(ctx.courses[0].open.find(i => i.l === '4.7')!.planned).toBe(true);
});

test('a block worked on shows a bookmark that records how far you got', async ({ page }) => {
  const state = await setup(page, () => ({ reply: 'ok' }));
  await page.getByRole('button', { name: 'Stopped part way: Physics reading: 4.1–4.6 Momentum' }).click();
  await page.getByRole('menuitem', { name: '4.2', exact: true }).click();
  await expect(page.getByText('Physics reading: 4.1–4.2 Momentum')).toBeVisible();
  const it = items(state.db);
  expect(it['4.2'].done_at).toBeTruthy();
  expect(it['4.3'].done_at).toBeNull();
  expect(it['4.3'].todo_id).toBeNull();
});

test('checking a block off marks every section it covers', async ({ page }) => {
  const state = await setup(page, () => ({ reply: 'ok' }));
  await page.getByRole('button', { name: 'Complete: Physics reading: 4.1–4.6 Momentum' }).click();
  await expect.poll(() => items(state.db)['4.6'].done_at).toBeTruthy();
  expect(items(state.db)['4.7'].done_at).toBeNull();
});

// Reported: "I studied physics reading 4.6–4.9 from 11:40 to 12:52, add it"
// couldn't be saved: past times were refused and 11:40 was read as 11:40 PM.
test('work already done is logged at the stated past times, recorded, and its sections read', async ({ page }) => {
  const TODAY = key(offset(0));
  const state = await setup(page, ctx => ({ reply: 'Logged it.', blocks: [{ title: 'Physics reading: 4.6–4.9 Mass flow', subject: 'Physics 5A', date: TODAY, start: '00:40', end: '00:52', done: true, covers: [idOf(ctx, '4.6'), idOf(ctx, '4.9')] }] }));
  await ask(page, 'i studied 4.6 to 4.9 just now, add it');
  await expect(page.getByText(/Already done · records 12 min of study/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.todos.find(t => t.text === 'Physics reading: 4.6–4.9 Mass flow')?.status).toBe('done');
  const todo = state.db.todos.find(t => t.text === 'Physics reading: 4.6–4.9 Mass flow')!;
  expect(state.db.todo_sessions.find(s => s.todo_id === todo.id)!.start_time).toBe(at(0, '00:40'));
  await expect.poll(() => state.db.timer_sessions.some(r => r.task_text === todo.text && r.duration_seconds === 12 * 60)).toBe(true);
  const it = items(state.db);
  for (const l of ['4.6', '4.7', '4.8', '4.9']) expect(it[l].done_at).toBeTruthy();
  expect(it['4.5'].done_at).toBeNull();
});

test('Soma asks about unchecked work once, not every message', async ({ page }) => {
  let n = 0;
  const state = await setup(page, () => (++n === 1 ? { reply: 'Did you finish Physics reading: 4.1–4.6 Momentum? You logged 30 min.' } : { reply: 'ok' }));
  await ask(page, 'hi');
  await expect(page.getByRole('log')).toContainText('Did you finish');
  await ask(page, 'plan physics');
  await expect(page.getByRole('log')).toContainText('ok');
  const ctx = JSON.parse(state.prompt.match(/CONTEXT[^:]*: (\{[^\n]*\})/)![1]) as Ctx;
  expect(ctx.unchecked).toBeUndefined();
});
