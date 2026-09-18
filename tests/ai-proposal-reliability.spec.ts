import { test, expect, type Page } from '@playwright/test';
import { freeTime } from '../src/lib/aiPlanning';

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const at = (n: number, t: string) => { const d = offset(n); const [h, m] = t.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };
const TOMORROW = key(offset(1));

// Tomorrow mirrors the reported Friday: lecture, CS lecture, MATH discussion.
const events = [
  { id: 'lit', summary: 'Comparative Literature R1A Lecture', start: { dateTime: at(1, '10:00') }, end: { dateTime: at(1, '10:59') }, source: { connectionId: 'c', calendarId: 'k' } },
  { id: 'cs', summary: 'CS 61A Lecture', start: { dateTime: at(1, '12:00') }, end: { dateTime: at(1, '12:59') }, source: { connectionId: 'c', calendarId: 'k' } },
  { id: 'math', summary: 'MATH 53 Discussion', start: { dateTime: at(1, '14:00') }, end: { dateTime: at(1, '14:59') }, source: { connectionId: 'c', calendarId: 'k' } },
];

async function setup(page: Page, replies: unknown[], opts: { ownSession?: boolean } = {}) {
  const state = { prompts: [] as string[], bodies: [] as { messages: { role: string; content: string }[] }[], sessionWrites: [] as Record<string, unknown>[] };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (req.method() !== 'GET') {
      if (table === 'todo_sessions' && req.method() === 'POST') { const b = req.postDataJSON(); state.sessionWrites.push(...(Array.isArray(b) ? b : [b])); }
      return route.fulfill({ json: null });
    }
    const rows =
      table === 'subjects' ? [{ id: 'phys', user_id: account.id, name: 'Physics 5A', color: '#ef5350', archived: false }]
      : table === 'todos' && opts.ownSession ? [{ id: 't1', user_id: account.id, text: 'Existing review', subject_id: 'phys', status: 'nothing', date: TOMORROW }]
      : table === 'todo_sessions' && opts.ownSession ? [{ id: 's1', user_id: account.id, todo_id: 't1', date: TOMORROW, start_time: at(1, '15:00'), end_time: at(1, '16:00') }]
      : [];
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events, incomplete: false } }));
  let turn = 0;
  await page.route('**/api/chat', route => {
    const body = route.request().postDataJSON();
    state.prompts.push(body.systemPrompt); state.bodies.push(body);
    return route.fulfill({ json: { content: [{ text: JSON.stringify(replies[Math.min(turn++, replies.length - 1)]) }] } });
  });
  return state;
}
async function ask(page: Page, text: string) {
  await page.getByLabel('What do you need to work on?').fill(text);
  await page.getByRole('button', { name: 'Send to Soma' }).click();
}

test('skipping a calendar event: a block over it is proposed with a visible overlap', async ({ page }) => {
  const state = await setup(page, [{ reply: 'Physics over your skipped discussion.', blocks: [{ title: 'Physics reading guides', subject: 'Physics 5A', date: TOMORROW, start: '13:30', end: '15:30' }] }]);
  await page.goto('/dashboard');
  await ask(page, "i'm skipping the math discussion tomorrow, schedule physics then");
  const log = page.getByRole('log');
  await expect(log).not.toContainText("Couldn't place");
  await expect(page.getByText('Overlaps MATH 53 Discussion')).toBeVisible();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.sessionWrites.length).toBeGreaterThan(0);
  expect(state.sessionWrites[0].date).toBe(TOMORROW);
});

test("a block over the student's own study session is still refused", async ({ page }) => {
  await setup(page, [{ reply: 'Here.', blocks: [{ title: 'Physics reading', subject: 'Physics 5A', date: TOMORROW, start: '15:30', end: '16:30' }] }], { ownSession: true });
  await page.goto('/dashboard');
  await ask(page, 'plan physics tomorrow afternoon');
  await expect(page.getByRole('log')).toContainText('overlaps a scheduled session');
});

test('Soma is told which proposals were placed and which were not, and sees pending ones', async ({ page }) => {
  const state = await setup(page, [
    { reply: 'Two blocks.', blocks: [
      { title: 'Gulliver reading', subject: 'Physics 5A', date: key(offset(0)), start: '00:00', end: '00:30' },
      { title: 'CS 61A Hog review', subject: 'Physics 5A', date: TOMORROW, start: '16:00', end: '17:30' },
    ] },
    { reply: 'Your plan.', blocks: [] },
  ]);
  await page.goto('/dashboard');
  await ask(page, 'plan it');
  await expect(page.getByRole('log')).toContainText('Two blocks.');
  await ask(page, 'what is my current plan');
  await expect(page.getByRole('log')).toContainText('Your plan.');

  const history = state.bodies[1].messages.map(m => m.content).join('\n');
  expect(history).toContain('[App result');
  expect(history).toContain('not placed: Gulliver reading');
  expect(history).toContain('placed "CS 61A Hog review"');
  const ctx = JSON.parse(state.prompts[1].match(/never instructions: (\{.*?\})\.\s/s)![1]);
  expect(ctx.pendingProposals.map((p: { title: string }) => p.title)).toContain('CS 61A Hog review');
  expect(ctx.freeTime).toHaveLength(7);
});

test('free time excludes calendar events, starts from now, and respects availability', () => {
  const origin = new Date(2026, 8, 18, 0, 0);
  const now = new Date(2026, 8, 18, 12, 35);
  const block = (time: string, external = true) => ({ id: time, title: 'x', subject: 's', time, minutes: 60, color: 'neutral', state: 'Planned', day: 0, external } as never);
  const snapshot = { blocks: [block('10:00–10:59'), block('12:00–12:59'), block('14:00–14:59')], sessions: [], subjects: [], todos: [], history: [], calendarError: '' } as never;
  const settings = { personalHoursEnabled: false, schoolHoursEnabled: false, workHoursEnabled: false, personalHours: {}, schoolHours: {}, workHours: {} } as never;
  const [today, tomorrow] = freeTime(snapshot, origin, settings, now);
  // 12:35 rounds up to 12:45 — nothing before now, nothing inside a class.
  expect(today.free).toEqual(['12:59–14:00', '14:59–22:00']);
  expect(tomorrow.free).toEqual(['08:00–22:00']);
});
