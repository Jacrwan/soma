import { test, expect, type Page } from '@playwright/test';

// Reported 2026-10-04: a chat started Saturday evening and picked up after
// midnight. Soma said "you're doing the practice midterm 8:50–10 PM" about
// Saturday's block (unchecked, no time logged), and called a COMLIT exercise
// that was due Friday and already checked off "due tomorrow".

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const at = (d: string, t: string) => new Date(`${d}T${t}:00`).toISOString();
const SAT = '2026-10-03', FRI = '2026-10-02';

const subjects = [
  { id: 'math', name: 'MATH 53-LEC-002', color: '#42a5f5' },
  { id: 'cs', name: 'CS 61A', color: '#66bb6a' },
  { id: 'comlit', name: 'COMLIT R1B', color: '#ab47bc' },
  { id: 'phys', name: 'Physics 7A', color: '#ef5350' },
].map(s => ({ ...s, user_id: account.id, archived: false }));
const todos = [
  { id: 'mid', text: 'Math 53 Practice Midterm', subject_id: 'math', status: 'nothing', date: SAT },
  { id: 'cs5', text: 'CS 61A Missed Lectures Catch-up (5 of 6)', subject_id: 'cs', status: 'done', date: SAT },
  { id: 'ae3', text: 'COMLIT Analysis Exercise 3', subject_id: 'comlit', status: 'done', date: FRI, due_date: FRI },
  { id: 'hw5', text: 'Physics HW 5', subject_id: 'phys', status: 'nothing', date: '', due_date: '2026-10-06' },
  { id: 'essay', text: 'Essay outline', subject_id: 'comlit', status: 'nothing', date: '', due_date: '2026-10-01' },
].map(t => ({ ...t, user_id: account.id, estimated_minutes: 60 }));
const sessions = [
  { id: 's-mid', todo_id: 'mid', date: SAT, start_time: at(SAT, '20:50'), end_time: at(SAT, '22:00') },
  { id: 's-cs5', todo_id: 'cs5', date: SAT, start_time: at(SAT, '14:00'), end_time: at(SAT, '15:00') },
  { id: 's-ae3', todo_id: 'ae3', date: FRI, start_time: at(FRI, '10:00'), end_time: at(FRI, '11:00') },
].map(s => ({ ...s, user_id: account.id }));
const timer = [
  { id: 'h1', subject_id: 'cs', task_text: 'CS 61A Missed Lectures Catch-up (5 of 6)', duration_seconds: 56 * 60, date: SAT, start_time: at(SAT, '14:02'), end_time: at(SAT, '14:58') },
].map(h => ({ ...h, user_id: account.id }));
const assignments = [
  { id: 7, name: 'Analysis Exercise 3', courseId: 3, courseName: 'COMLIT R1B-LEC-005', dueAt: at(FRI, '23:59'), htmlUrl: '', status: 'not_started' },
  { id: 8, name: 'Reading Response 4', courseId: 3, courseName: 'COMLIT R1B-LEC-005', dueAt: at(FRI, '23:59'), htmlUrl: '', status: 'not_started' },
];

async function setup(page: Page) {
  const bodies: { messages: { role: string; content: string }[]; context: string; systemPrompt: string }[] = [];
  await page.clock.install({ time: new Date(`${SAT}T19:30:00`) });
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 30 * 86400, expires_in: 30 * 86400, user: a }));
    localStorage.setItem('soma_settings', JSON.stringify({ theme: 'light', studyWindow: { start: '08:00', end: '02:00' } }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    const rows = table === 'subjects' ? subjects : table === 'todos' ? todos : table === 'todo_sessions' ? sessions : table === 'timer_sessions' ? timer : [];
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/chat', route => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { content: [{ text: JSON.stringify({ reply: `Noted ${bodies.length}.`, blocks: [] }) }] } });
  });
  return bodies;
}

async function ask(page: Page, text: string, n: number) {
  await page.getByLabel('What do you need to work on?').fill(text);
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect(page.getByRole('log')).toContainText(`Noted ${n}.`);
}

const contextOf = (body: { context: string }) => JSON.parse(body.context.match(/CONTEXT[^:]*: (\{[^\n]*\})/)![1]);

test('a chat carried past midnight reads yesterday as yesterday', async ({ page }) => {
  const bodies = await setup(page);
  await page.goto('/dashboard');
  await expect(page.getByText('Math 53 Practice Midterm')).toBeVisible();
  await ask(page, "for the rest of today like 8:50 to 10 i'll do the math practice midterm", 1);

  // Past midnight, with the page left open and nothing done on the midterm.
  await page.clock.fastForward('05:10:00');
  await ask(page, 'what should i do today i got now til 2 am', 2);

  const [first, latest] = [bodies[0], bodies[1]];
  // Saturday's messages say when they were sent; today's doesn't need to.
  expect(first.messages[0].content).not.toContain('[Sent');
  expect(latest.messages[0].content).toMatch(/^\[Sent Sat 2026-10-03 19:30, an earlier day\] for the rest of today/);
  expect(latest.messages.at(-1)!.content).toBe('what should i do today i got now til 2 am');
  for (const m of latest.messages) expect(Object.keys(m).sort()).toEqual(['content', 'role']);

  // Today is Sunday, and Saturday's blocks are in the past with what really happened.
  const ctx = contextOf(latest);
  expect(ctx.now.startsWith('2026-10-04 Sun')).toBe(true);
  expect(ctx.days[0]).toMatchObject({ d: '2026-10-04', sel: true });
  expect(ctx.plan.some((b: { title: string }) => b.title === 'Math 53 Practice Midterm')).toBe(false);
  const midterm = ctx.lastWeek.find((b: { title: string }) => b.title === 'Math 53 Practice Midterm');
  expect(midterm).toMatchObject({ d: 'Sat 2026-10-03', t: '20:50–22:00', st: 'Planned', did: 0 });
  expect(midterm.log).toBeUndefined();
  const catchUp = ctx.lastWeek.find((b: { title: string }) => b.title.includes('(5 of 6)'));
  expect(catchUp).toMatchObject({ st: 'Completed', log: ['Sat 2026-10-03 14:02–14:58 56m'] });

  // Late work says so; the dashboard shows Sunday.
  expect(ctx.tasks).toContainEqual(expect.objectContaining({ title: 'Essay outline', due: 'Thu 2026-10-01', late: true }));
  expect(ctx.tasks.find((t: { title: string }) => t.title === 'Physics HW 5').late).toBeUndefined();
  await expect(page.getByRole('heading', { name: /Sunday/ }).first()).toBeVisible();
});

test('Canvas work checked off as a task is not listed as due, and past dates say so', async ({ page }) => {
  const bodies = await setup(page);
  await page.goto('/dashboard');
  await expect(page.getByText('Math 53 Practice Midterm')).toBeVisible();
  await page.evaluate(async a => {
    // @ts-expect-error Vite serves this browser-only module at runtime.
    const { storage } = await import('/src/lib/storage.ts');
    storage.setCachedIcalAssignments(a);
  }, assignments);
  await ask(page, 'what is due?', 1);

  const prompt = bodies[0].systemPrompt;
  expect(prompt).toContain('CANVAS ASSIGNMENTS');
  expect(prompt).not.toContain('Analysis Exercise 3');
  expect(prompt).toContain('Reading Response 4 — COMLIT R1B-LEC-005 — Due Fri 2026-10-02 23:59 (past due)');
});
