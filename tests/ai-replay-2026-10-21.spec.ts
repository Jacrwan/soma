import { test, expect, type Page } from '@playwright/test';
import { triaged } from './triage';

// The morning of 2026-10-21, replayed. At 11:35 the student wrote: "I SAID
// MATH 53 HOMEWORK 14.3 to 14.6 FROM NOW UNTIL LIKE 1:00PM, and then MATH
// PRACTICE QUIZZES UNTIL THE MATH 53 DISCUSSION. THEN I HAVE SCHEDULED GOOGLE
// EVENTS THAT IM ATTENDING UNTIL 5:15PM. AFTER THAT IM WORKING ON THE ESSAY 1
// until 7:15 PM. THEN AFTER THAT UNTIL 10:00PM IM WORKING ON PROJECT 3
// Checkpoint 2 and CS LAB 7", with the reviews after everything. Soma sent the
// times; the app refused five of them ("That time overlaps a scheduled
// session"), asked about four reviews, and a single Accept failed with "it
// is waiting to move". The plan, events and settings below are the real ones.

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const at = (n: number, t: string) => { const d = day(n); const [h, m] = t.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };
const TODAY = key(day(0)), TOMORROW = key(day(1));
type Row = Record<string, unknown>;

const event = (id: string, summary: string, from: string, to: string) => ({ id, summary, start: { dateTime: at(0, from) }, end: { dateTime: at(0, to) }, source: { connectionId: 'c', calendarId: 'k' } });
const events = [
  event('complit', 'Comparative Literature R1A Lecture', '10:00', '10:59'),
  event('cs', 'CS 61A Lecture', '12:00', '12:59'),
  event('mathdisc', 'MATH 53 Discussion', '14:00', '14:59'),
  event('kaiju', 'Virtual 2026 PM/PD Kaiju Cats & Coding Cookies', '15:00', '16:00'),
  event('oh', 'Comparative Literature OH', '16:15', '17:15'),
];

const reviews = ['10.5', '10.7', '10.9', '10.12', '10.14', '10.16', '10.19'];
const plan: [string, string, string, number, string, string, string?][] = [
  // id, title, subject, day, from, to, due
  ['quiz', 'Math 53 practice quizzes', 'math', 0, '11:30', '12:30'],
  ['lab', 'Lab 7: Lazy Evaluation', 'cs', 0, '12:30', '13:00', TODAY],
  ['r10.5', 'CS 61A: review lecture video (10.5.2026)', 'cs', 0, '13:00', '13:50'],
  ['r10.16', 'CS 61A: review lecture video (10.16.2026)', 'cs', 0, '16:00', '16:50'],
  ['r10.19', 'CS 61A: review lecture video (10.19.2026)', 'cs', 0, '16:50', '17:40'],
  ['r10.12', 'CS 61A: review lecture video (10.12.2026)', 'cs', 0, '17:40', '18:30'],
  ['r10.14', 'CS 61A: review lecture video (10.14.2026)', 'cs', 0, '18:30', '19:20'],
  ['essay', 'Essay 1: finish up', 'comlit', 0, '19:20', '21:20'],
  ['r10.7', 'CS 61A: review lecture video (10.7.2026)', 'cs', 0, '21:35', '22:25'],
  ['r10.9', 'CS 61A: review lecture video (10.9.2026)', 'cs', 0, '23:00', '23:50'],
  ['p3', 'Project 3: Ants Vs. SomeBees checkpoint 2', 'cs', 0, '23:50', '01:50', TODAY],
  ['hw', 'Math 53 Homework — Chapter 14.3 - 14.6', 'math', 1, '11:00', '12:00'],
];

async function setup(page: Page, reply: (ctx: string) => unknown) {
  const db: Record<string, Row[]> = {
    subjects: [
      { id: 'math', user_id: account.id, name: 'MATH 53-LEC-002', color: '#42a5f5', archived: false },
      { id: 'cs', user_id: account.id, name: 'CS 61A', color: '#66bb6a', archived: false },
      { id: 'comlit', user_id: account.id, name: 'COMLIT R1A-LEC-001', color: '#ef5350', archived: false },
    ],
    todos: plan.map(([id, text, subject, n, , , due]) => ({ id: `t-${id}`, user_id: account.id, text, subject_id: subject, status: 'nothing', date: key(day(n)), ...(due ? { due_date: due } : {}) })),
    todo_sessions: [
      ...plan.map(([id, , , n, from, to]) => ({ id: `s-${id}`, user_id: account.id, todo_id: `t-${id}`, date: key(day(n)), start_time: at(n, from), end_time: from > to ? at(n + 1, to) : at(n, to) })),
      // Lab 7's second piece, from an earlier split.
      { id: 's-lab2', user_id: account.id, todo_id: 't-lab', date: TODAY, start_time: at(0, '21:20'), end_time: at(0, '21:35') },
    ],
    timer_sessions: [],
  };
  const now = new Date(); now.setHours(11, 35, 0, 0);
  await page.clock.install({ time: now });
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
    localStorage.setItem('soma_settings', JSON.stringify({ onboardingCompleted: true, theme: 'light', studyWindow: { start: '08:00', end: '23:00', off: true } }));
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
      const id = url.searchParams.get('id')?.slice(3), b = req.postDataJSON() as Row;
      db[table] = rows.map(r => r.id === id ? { ...r, ...b } : r);
      return route.fulfill({ json: null });
    }
    if (req.method() === 'DELETE' && rows) {
      const id = url.searchParams.get('id')?.slice(3);
      db[table] = rows.filter(r => r.id !== id);
      return route.fulfill({ json: null });
    }
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    let out = rows ?? [];
    for (const k of ['id', 'todo_id']) { const f = url.searchParams.get(k); if (f?.startsWith('eq.')) out = out.filter(r => String(r[k]) === f.slice(3)); }
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? out[0] ?? null : out });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/memory', r => r.fulfill({ json: { revision: 0, enabled: true, entries: [] } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events, incomplete: false } }));
  await page.route('**/api/chat', route => { if (triaged(route)) return;
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { content: [{ text: JSON.stringify(reply(String(body.context ?? ''))) }] } });
  });
  await page.goto('/dashboard');
  await expect(page.getByText('Math 53 practice quizzes').first()).toBeVisible();
  return db;
}

/** The short id Soma is shown for an entry, read from its context line. */
const idIn = (ctx: string, title: string) => {
  const line = ctx.match(/CONTEXT[^:]*: (\{[^\n]*\})/)![1];
  const all = Object.values((JSON.parse(line) as { plan: Record<string, string[]> }).plan).flat();
  return all.find(l => l.split(' · ')[0].endsWith(` ${title}`))!.split(' ')[0];
};
/** Where each task's sessions are now, as [start, end] pairs. */
const where = (db: Record<string, Row[]>, id: string) => db.todo_sessions.filter(s => s.todo_id === `t-${id}`).map(s => [s.start_time, s.end_time]).sort();

const message = 'bro send all the cs review lectures AFTER ive done everything. MATH 53 HOMEWORK 14.3 to 14.6 FROM NOW UNTIL LIKE 1:00PM, and then MATH PRACTICE QUIZZES UNTIL THE MATH 53 DISCUSSION. THEN I HAVE SCHEDULED GOOGLE EVENTS THAT IM ATTENDING UNTIL 5:15PM. AFTER THAT IM WORKING ON THE ESSAY 1 until 7:15 PM. THEN AFTER THAT UNTIL 10:00PM IM WORKING ON PROJECT 3 Checkpoint 2 and CS LAB 7.';

// What Soma sent for that message: the student's times as given, and the
// reviews chained after each other from 10 PM.
const reply = (ctx: string) => {
  const id = (title: string) => idIn(ctx, title);
  const review = (r: string) => `CS 61A: review lecture video (${r}.2026)`;
  return {
    reply: "Here's the order you described.",
    skip: ['CS 61A Lecture'],
    changes: [
      { action: 'move', id: id('Math 53 Homework — Chapter 14.3 - 14.6'), date: TODAY, start: 'now', end: '13:00' },
      { action: 'move', id: id('Math 53 practice quizzes'), date: TODAY, start: '13:00', end: '14:00' },
      { action: 'move', id: id('Essay 1: finish up'), date: TODAY, start: '17:15', end: '19:15' },
      { action: 'move', id: id('Project 3: Ants Vs. SomeBees checkpoint 2'), date: TODAY, start: '19:15', end: '21:15' },
      { action: 'move', id: idIn(ctx, 'Lab 7: Lazy Evaluation'), date: TODAY, start: '21:15', end: '22:00' },
      ...reviews.map((r, i) => ({ action: 'move', id: id(review(r)), date: TODAY, minutes: 50, after: i === 0 ? '22:00' : id(review(reviews[i - 1])) })),
    ],
  };
};

test('the student\'s day goes in as they said it: nothing refused, nothing asked', async ({ page }) => {
  // A whole day of moves, accepted: longer than one change.
  test.setTimeout(60_000);
  const db = await setup(page, reply);
  await page.getByLabel('What do you need to work on?').fill(message);
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  const log = page.getByRole('log');
  await expect(log).toContainText("Here's the order you described.");
  await expect(log).not.toContainText('Needs your call');
  await expect(log).not.toContainText("Couldn't place");

  // One card on its own, the quizzes, where the 10.5 review sits now.
  await page.getByRole('article').filter({ hasText: 'Proposal · Moves from 11:30 AM–12:30 PM' }).getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => where(db, 'quiz')).toEqual([[at(0, '13:00'), at(0, '14:00')]]);
  await expect(page.getByText('Saving your plan…')).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByText(/waiting to move|overlaps a scheduled session/)).toHaveCount(0);

  // The rest (the homework, Lab 7, and Thursday's review) with Accept all.
  await page.getByRole('button', { name: /^Accept all/ }).click();
  await expect(page.getByRole('article').filter({ hasText: /Proposal ·/ })).toHaveCount(0, { timeout: 15000 });
  await expect.poll(() => where(db, 'r10.16')[0][0], { timeout: 15000 }).not.toBe(at(0, '16:00'));
  await expect(page.getByText(/waiting to move|overlaps a scheduled session|weren't saved|not saved/i)).toHaveCount(0);
  expect(where(db, 'essay')).toEqual([[at(0, '17:15'), at(0, '19:15')]]);
  expect(where(db, 'hw')).toEqual([[at(0, '11:35'), at(0, '13:00')]]);
  expect(where(db, 'p3')).toEqual([[at(0, '19:15'), at(0, '21:15')]]);
  // Lab 7 at 9:15–10 PM, its leftover 9:20 piece taken into that time, not moved elsewhere.
  expect(where(db, 'lab')).toEqual([[at(0, '21:15'), at(0, '22:00')]]);
  // The reviews after 10 PM, in order, each after the one before; none from 2 to 8 AM.
  const starts = reviews.map(r => where(db, `r${r}`)[0][0] as string);
  expect(starts[0]).toBe(at(0, '22:00'));
  expect(starts[1]).toBe(at(0, '22:50'));
  for (let i = 1; i < starts.length; i++) expect(+new Date(starts[i])).toBeGreaterThan(+new Date(starts[i - 1]));
  for (const s of starts) { const h = new Date(s).getHours(); expect(h < 2 || h >= 8).toBe(true); }
  expect(starts.some(s => s.startsWith(TOMORROW) || new Date(s).toDateString() === day(1).toDateString())).toBe(true);
});
