import { test, expect, type Page } from '@playwright/test';
import { triaged } from './triage';

/**
 * 2026-11-17, 5:23 PM: "push project 4 for later, im doing math right now for
 * 2 hours, then oral presentations. im not attending large group." Soma put
 * Project 4 between math and Oral Presentations (each block took the first
 * gap that fit it, and "later" named no other day, so it stayed on tonight).
 * The same day a Lab 10 card had no room at Accept and could only be
 * dismissed. Rescheduling now runs one fixed order (src/lib/replan.ts): a
 * sequence lies back to back, "later" goes after it, before the due time and
 * the task's later steps, only lower-ranked work is pushed aside, the whole
 * board is checked, and Accept places a card again when its time is gone.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const at = (n: number, t: string) => { const d = offset(n); const [h, m] = t.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };
const TODAY = key(offset(0));
type Row = Record<string, unknown>;

type Ctx = { plan: Record<string, string[]>; tasks?: Record<string, string[]> };
const ctxOf = (context: string) => JSON.parse(context.match(/CONTEXT[^:]*: (\{[^\n]*\})/)![1]) as Ctx;
/** The short id Soma is shown for an entry titled exactly `title`. */
const idIn = (context: string, title: string) => {
  const ctx = ctxOf(context);
  const all = [...Object.values(ctx.plan), ...Object.values(ctx.tasks ?? {})].flat();
  return all.find(l => l.split(' · ')[0].endsWith(` ${title}`))!.split(' ')[0];
};

const event = (id: string, summary: string, from: string, to: string) => ({ id, summary, start: { dateTime: at(0, from) }, end: { dateTime: at(0, to) }, source: { connectionId: 'c', calendarId: 'k' } });

type Setup = { todos: Row[]; sessions: Row[]; events?: ReturnType<typeof event>[]; clock?: string; studyEnd?: string };
async function setup(page: Page, s: Setup, reply: (context: string, call: number, body: Record<string, unknown>) => unknown) {
  const db: Record<string, Row[]> = {
    subjects: [
      { id: 'cs', user_id: account.id, name: 'CS 61A', color: '#43a047', archived: false },
      { id: 'math', user_id: account.id, name: 'MATH 53', color: '#42a5f5', archived: false },
      { id: 'lit', user_id: account.id, name: 'COMLIT R1A', color: '#ef5350', archived: false },
    ],
    todos: s.todos.map(t => ({ user_id: account.id, status: 'nothing', date: TODAY, ...t })),
    todo_sessions: s.sessions.map(x => ({ user_id: account.id, date: TODAY, ...x })),
    timer_sessions: [],
  };
  const state = { db, calls: 0 };
  const [h, m] = (s.clock ?? '17:23').split(':').map(Number);
  const now = new Date(); now.setHours(h, m, 0, 0);
  await page.clock.install({ time: now });
  await page.addInitScript(([a, end]) => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
    localStorage.setItem('soma_settings', JSON.stringify({ onboardingCompleted: true, theme: 'light', studyWindow: { start: '08:00', end }, schedule: { autoImported: false } }));
  }, [account, s.studyEnd ?? '23:30'] as const);
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
      const f = url.searchParams.get('id');
      for (const r of rows) if (f?.startsWith('eq.') && String(r.id) === f.slice(3)) Object.assign(r, req.postDataJSON());
      return route.fulfill({ json: null });
    }
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    let out = rows ?? [];
    for (const k of ['id', 'todo_id']) { const f = url.searchParams.get(k); if (f?.startsWith('eq.')) out = out.filter(r => String(r[k]) === f.slice(3)); }
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? out[0] ?? null : out });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/memory', r => r.fulfill({ json: { revision: 0, enabled: true, entries: [] } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: s.events ?? [], incomplete: false } }));
  await page.route('**/api/chat', async route => { if (triaged(route)) return;
    const body = route.request().postDataJSON();
    state.calls++;
    const out = await reply(`${body.context ?? ''}`, state.calls, body);
    return route.fulfill({ json: { content: [{ text: typeof out === 'string' ? out : JSON.stringify(out) }] } });
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /Today/ })).toBeVisible();
  return state;
}
async function ask(page: Page, text: string) {
  await page.getByLabel('What do you need to work on?').fill(text);
  await page.getByRole('button', { name: 'Send to Soma' }).click();
}
const sessionOf = (db: Record<string, Row[]>, id: string) => { const r = db.todo_sessions.find(x => x.id === id)!; return [r.start_time, r.end_time]; };
const sessionsOf = (db: Record<string, Row[]>, todoId: string) => db.todo_sessions.filter(x => x.todo_id === todoId).map(x => [x.start_time, x.end_time]);

// The evening of 2026-11-17.
const NOV17: Setup = {
  todos: [
    { id: 't-math', text: 'Math 53 homework: 16.4, 16.6, 16.7', subject_id: 'math', due_date: key(offset(2)) },
    { id: 't-proj', text: 'Project 4: Animator checkpoint 1', subject_id: 'cs', due_date: key(offset(3)) },
    { id: 't-oral', text: 'Oral Presentations', subject_id: 'lit', due_date: key(offset(2)) },
  ],
  sessions: [
    { id: 's-math', todo_id: 't-math', start_time: at(0, '17:30'), end_time: at(0, '19:30') },
    { id: 's-proj', todo_id: 't-proj', start_time: at(0, '19:30'), end_time: at(0, '20:15') },
    { id: 's-oral', todo_id: 't-oral', start_time: at(0, '20:30'), end_time: at(0, '21:30') },
  ],
  events: [event('lec', 'MATH 53 Lecture', '15:30', '16:59'), event('ruf', 'RUF Large Group', '20:00', '21:30')],
};

test('"push project 4 for later, math right now for 2 hours, then oral presentations, not attending large group": math, oral, then Project 4, back to back', async ({ page }) => {
  const state = await setup(page, NOV17, ctx => ({
    reply: 'Math now, then Oral Presentations, and Project 4 after that.',
    sequence: { anchor: 'now', items: [idIn(ctx, 'Math 53 homework: 16.4, 16.6, 16.7'), idIn(ctx, 'Oral Presentations')] },
    changes: [
      { action: 'move', id: idIn(ctx, 'Math 53 homework: 16.4, 16.6, 16.7'), minutes: 120 },
      { action: 'move', id: idIn(ctx, 'Project 4: Animator checkpoint 1'), later: true },
    ],
    skip: [idIn(ctx, 'RUF Large Group')],
  }));
  await ask(page, 'push project 4 for later, im doing math right now for 2 hours, then oral presentations. im not attending large group.');
  const log = page.getByRole('log');
  await expect(log).toContainText('Math now');
  await expect(log).not.toContainText('Needs your call');
  await expect(log).not.toContainText("Couldn't place");
  await page.getByRole('button', { name: /^Accept all/ }).click();
  await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0);
  expect(sessionOf(state.db, 's-math')).toEqual([at(0, '17:23'), at(0, '19:23')]);
  expect(sessionOf(state.db, 's-oral')).toEqual([at(0, '19:23'), at(0, '20:23')]);
  // After Oral Presentations, over the skipped large group: not between them.
  expect(sessionOf(state.db, 's-proj')).toEqual([at(0, '20:25'), at(0, '21:10')]);
});

test('"later" with no room left today asks about the first spot on another day, and Accept puts it there', async ({ page }) => {
  const state = await setup(page, { ...NOV17, clock: '20:20', studyEnd: '21:00', events: [] }, ctx => ({
    reply: 'Project 4 can wait.',
    changes: [{ action: 'move', id: idIn(ctx, 'Project 4: Animator checkpoint 1'), later: true }],
  }));
  await ask(page, 'push project 4 for later');
  const tomorrow = offset(1).toLocaleDateString('en-US', { weekday: 'short' });
  await expect(page.getByText(new RegExp(`No room left today after 8:20 PM\\. Put it ${tomorrow} 8:00 AM`))).toBeVisible();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => sessionOf(state.db, 's-proj')).toEqual([at(1, '08:00'), at(1, '08:45')]);
});

test('"later" on a step leaves room for the steps after it, or asks', async ({ page }) => {
  const due = `${TODAY}T20:30`;
  await setup(page, {
    todos: [{ id: 't-lab', text: 'Lab 10 SQL', subject_id: 'cs', due_date: due, steps: [{ id: 'a', title: 'Part 1', minutes: 60 }, { id: 'b', title: 'Part 2', minutes: 60 }] }],
    sessions: [{ id: 's-a', todo_id: 't-lab', step_id: 'a', start_time: at(0, '18:00'), end_time: at(0, '19:00') }],
  }, ctx => ({ reply: 'Part 1 later.', changes: [{ action: 'move', id: idIn(ctx, 'Lab 10 SQL'), later: true }] }));
  await ask(page, 'push lab 10 for later');
  // 7–8 PM would end before it's due, but leave no hour for Part 2 before 8:30.
  await expect(page.getByRole('log')).toContainText('leaves room for its later steps');
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
});

test('"later" pushes aside only lower-ranked work; higher-ranked work stays', async ({ page }) => {
  const state = await setup(page, {
    studyEnd: '21:00',
    todos: [
      { id: 't-proj', text: 'Project 4: Animator checkpoint 1', subject_id: 'cs', due_date: key(offset(5)) },
      { id: 't-quiz', text: 'Quiz 9 prep', subject_id: 'math', due_date: key(offset(1)) },
      { id: 't-read', text: 'Reading: chapter 6', subject_id: 'lit', due_date: key(offset(6)) },
    ],
    sessions: [
      { id: 's-proj', todo_id: 't-proj', start_time: at(0, '17:30'), end_time: at(0, '18:15') },
      { id: 's-quiz', todo_id: 't-quiz', start_time: at(0, '18:15'), end_time: at(0, '19:30') },
      { id: 's-read', todo_id: 't-read', start_time: at(0, '19:30'), end_time: at(0, '21:00') },
    ],
  }, ctx => ({ reply: 'Project 4 later.', changes: [{ action: 'move', id: idIn(ctx, 'Project 4: Animator checkpoint 1'), later: true }] }));
  await ask(page, 'push project 4 for later');
  await page.getByRole('button', { name: /^Accept all/ }).click();
  await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0);
  // The quiz (due tomorrow) keeps its time; the reading (due in 6 days) moves.
  expect(sessionOf(state.db, 's-quiz')).toEqual([at(0, '18:15'), at(0, '19:30')]);
  expect(sessionOf(state.db, 's-proj')).toEqual([at(0, '19:30'), at(0, '20:15')]);
  expect(sessionOf(state.db, 's-read')[0]).not.toBe(at(0, '19:30'));
});

test('Accept with the card\'s time taken places it again and asks once more; a second Accept saves it', async ({ page }) => {
  const state = await setup(page, { todos: [{ id: 't-other', text: 'Essay outline', subject_id: 'lit' }], sessions: [], studyEnd: '23:00' }, () => ({
    reply: 'Lab 10 tonight.', blocks: [{ title: 'Lab 10 SQL', subject: 'CS 61A', date: TODAY, minutes: 60 }],
  }));
  await ask(page, 'add lab 10 tonight, an hour');
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeVisible();
  // Something lands on 5:25–6:25 before Accept (another tab, the task scheduler).
  state.db.todo_sessions.push({ id: 's-other', user_id: account.id, todo_id: 't-other', date: TODAY, start_time: at(0, '17:25'), end_time: at(0, '18:30') });
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('now fits 6:30 PM–7:30 PM. Accept again to keep it.');
  expect(state.db.todos.some(t => t.text === 'Lab 10 SQL')).toBe(false);
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => { const t = state.db.todos.find(x => x.text === 'Lab 10 SQL'); return t ? sessionsOf(state.db, String(t.id)) : []; }).toEqual([[at(0, '18:30'), at(0, '19:30')]]);
});

test('Accept on a full day offers the first spot on another day', async ({ page }) => {
  const state = await setup(page, { todos: [{ id: 't-other', text: 'Essay outline', subject_id: 'lit' }], sessions: [], studyEnd: '21:00' }, () => ({
    reply: 'Lab 10 tonight.', blocks: [{ title: 'Lab 10 SQL', subject: 'CS 61A', date: TODAY, minutes: 60 }],
  }));
  await ask(page, 'add lab 10 tonight, an hour');
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeVisible();
  state.db.todo_sessions.push({ id: 's-other', user_id: account.id, todo_id: 't-other', date: TODAY, start_time: at(0, '17:25'), end_time: at(0, '21:00') });
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  const tomorrow = offset(1).toLocaleDateString('en-US', { weekday: 'short' });
  await expect(page.getByRole('alert').first()).toContainText(`There's no room left today for "Lab 10 SQL". Put it ${tomorrow} 8:00 AM–9:00 AM? It's waiting on ${tomorrow}`);
  expect(state.db.todos.some(t => t.text === 'Lab 10 SQL')).toBe(false);
  await page.getByRole('button', { name: /^Accept all/ }).click();
  await expect.poll(() => { const t = state.db.todos.find(x => x.text === 'Lab 10 SQL'); return t ? sessionsOf(state.db, String(t.id)) : []; }).toEqual([[at(1, '08:00'), at(1, '09:00')]]);
});

test('a new card never lands on a card from the turn before that is still waiting', async ({ page }) => {
  await setup(page, {
    todos: [{ id: 't-proj', text: 'Project 4: Animator checkpoint 1', subject_id: 'cs', due_date: key(offset(3)) }],
    sessions: [{ id: 's-proj', todo_id: 't-proj', start_time: at(0, '20:00'), end_time: at(0, '20:45') }],
  }, (ctx, call) => call === 1
    ? { reply: 'Project 4 at 5:30.', changes: [{ action: 'move', id: idIn(ctx, 'Project 4: Animator checkpoint 1'), date: TODAY, start: '17:30', end: '18:15' }] }
    : { reply: 'Essay plan added.', blocks: [{ title: 'Essay plan', subject: 'COMLIT R1A', date: TODAY, minutes: 30 }] });
  await ask(page, 'move project 4 to 5:30 pm until 6:15 pm');
  await expect(page.getByText(/Moves from 8:00 PM–8:45 PM/).first()).toBeVisible();
  await ask(page, 'add 30 min for my essay plan');
  await expect(page.getByRole('log')).toContainText('Essay plan added.');
  // Not at 5:25, on the Project 4 move still waiting for Accept: right after it.
  await expect(page.getByRole('article').filter({ hasText: 'Essay plan' })).toContainText('6:15 PM–6:45 PM');
  await expect(page.locator('article[class*="proposal"]').filter({ hasText: 'Project 4' })).toContainText('5:30 PM–6:15 PM');
});

test('a reply that says it moves something no card changes is retried, and the claim is cut when it stays', async ({ page }) => {
  const state = await setup(page, NOV17, ctx => ({
    reply: 'Oral Presentations goes at 9:30. I\'m also moving Project 4 checkpoint 1 to Thursday evening.',
    changes: [{ action: 'move', id: idIn(ctx, 'Oral Presentations'), date: TODAY, start: '21:30', end: '22:30' }],
  }));
  await ask(page, 'oral presentations at 9:30 to 10:30');
  const log = page.getByRole('log');
  await expect(log).toContainText('Oral Presentations goes at 9:30.');
  await expect(log).not.toContainText('Project 4 checkpoint 1 to Thursday');
  expect(state.calls).toBe(2);
});

// 2026-11-18: "math homework from now until the math discussion" at 1:05 PM.
// Project 4's sitting had begun by the clock (1:00) but nobody started it; the
// stated time couldn't move it, so it stayed under the math block.
test('a stated time moves a scheduled sitting whose time has come but nobody started', async ({ page }) => {
  const state = await setup(page, {
    clock: '13:05',
    todos: [
      { id: 't-math', text: 'Math 53 homework: 16.1, 16.2, 16.3', subject_id: 'math' },
      { id: 't-proj', text: 'Project 4: Animator checkpoint 1', subject_id: 'cs', due_date: key(offset(1)), auto_schedule: true, estimated_minutes: 45 },
    ],
    sessions: [{ id: 's-proj', todo_id: 't-proj', start_time: at(0, '13:00'), end_time: at(0, '13:45') }],
    events: [event('disc', 'MATH 53 Discussion', '14:00', '14:59')],
  }, () => ({ reply: 'Math until the discussion.', blocks: [{ title: 'Math 53 homework: 16.1, 16.2, 16.3', subject: 'MATH 53', date: TODAY, start: '13:05', end: '14:00' }] }));
  await ask(page, 'im doing the math homework from now until the math discussion');
  await expect(page.getByText(/Moves from 1:00 PM–1:45 PM/).first()).toBeVisible();
  await page.getByRole('button', { name: /^Accept all/ }).click();
  await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0);
  const [start] = sessionOf(state.db, 's-proj');
  expect(String(start) >= at(0, '14:00')).toBe(true);
});

// The same three messages against the real model. It calls Anthropic and costs
// money, so it runs only with a key:
//   ANTHROPIC_API_KEY=... npx playwright test tests/ai-reschedule-pipeline.spec.ts -g "real model"
test('real model: the 2026-11-17 evening comes out math, oral, then Project 4', async ({ page }) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  test.skip(!apiKey, 'needs ANTHROPIC_API_KEY');
  test.setTimeout(180_000);
  const state = await setup(page, NOV17, async (_ctx, _call, body) => {
    const system = [...(body.systemPrompt ? [{ type: 'text', text: body.systemPrompt }] : []), ...(body.context ? [{ type: 'text', text: body.context }] : [])];
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 16000, system, messages: body.messages }),
    });
    const data = await res.json() as { content?: { type: string; text?: string }[] };
    const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') ?? '';
    console.log(`\n--- model said:\n${text}`);
    return text;
  });
  await ask(page, 'push project 4 for later, im doing math right now for 2 hours, then oral presentations. im not attending large group.');
  await expect(page.getByRole('button', { name: /^Accept all/ })).toBeVisible({ timeout: 150_000 });
  await page.getByRole('button', { name: /^Accept all/ }).click();
  await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0);
  const [mathStart, mathEnd] = sessionOf(state.db, 's-math'), [oralStart] = sessionOf(state.db, 's-oral'), [projStart] = sessionOf(state.db, 's-proj');
  expect(mathStart).toBe(at(0, '17:23'));
  expect(oralStart).toBe(mathEnd);
  expect(String(projStart) >= String(sessionOf(state.db, 's-oral')[1])).toBe(true);
});
