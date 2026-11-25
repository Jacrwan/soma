import { test, expect, type Page } from '@playwright/test';
import { triaged } from './triage';

// Reported 2026-11-24: "did i review 11.2.2026 cs review lecture sometime?" got
// "I can only check the last seven days". Soma now also gets `earlier`: 8 to 60
// days back, only work that was checked off or has logged time.

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const at = (d: string, t: string) => new Date(`${d}T${t}:00`).toISOString();
const NOW = '2026-11-24';

const subjects = [
  { id: 'cs', name: 'CS 61A', color: '#66bb6a' },
  { id: 'phys', name: 'Physics 7A', color: '#ef5350' },
].map(s => ({ ...s, user_id: account.id, archived: false }));

type Data = { todos: Record<string, unknown>[]; sessions: Record<string, unknown>[]; timer: Record<string, unknown>[] };

async function setup(page: Page, data: Data) {
  const bodies: { context: string; systemPrompt: string }[] = [];
  await page.clock.install({ time: new Date(`${NOW}T19:30:00`) });
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 30 * 86400, expires_in: 30 * 86400, user: a }));
    localStorage.setItem('soma_settings', JSON.stringify({ theme: 'light', studyWindow: { start: '08:00', end: '02:00' } }));
  }, account);
  const own = <T extends Record<string, unknown>>(rows: T[]) => rows.map(r => ({ ...r, user_id: account.id }));
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    const rows = table === 'subjects' ? subjects : table === 'todos' ? own(data.todos) : table === 'todo_sessions' ? own(data.sessions) : table === 'timer_sessions' ? own(data.timer) : [];
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/chat', route => { if (triaged(route)) return;
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { content: [{ text: JSON.stringify({ reply: 'Noted.', blocks: [] }) }] } });
  });
  return bodies;
}

async function ask(page: Page, text: string) {
  await page.goto('/dashboard');
  await page.getByLabel('What do you need to work on?').fill(text);
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect(page.getByRole('log')).toContainText('Noted.');
}

const contextOf = (body: { context: string }) => JSON.parse(body.context.match(/CONTEXT[^:]*: (\{[^\n]*\})/)![1]);

test('work 8 to 60 days back reaches Soma: checked off or logged only', async ({ page }) => {
  const bodies = await setup(page, {
    todos: [
      { id: 'rev', text: 'CS 61A Lecture Review', subject_id: 'cs', status: 'done', date: '2026-11-05' },
      { id: 'read', text: 'Physics reading 4.1', subject_id: 'phys', status: 'nothing', date: '2026-11-03' },
      { id: 'part', text: 'Physics HW 6', subject_id: 'phys', status: 'in_progress', date: '2026-10-10' },
      { id: 'old', text: 'CS 61A HW 1', subject_id: 'cs', status: 'done', date: '2026-09-10' },
      { id: 'recent', text: 'CS 61A HW 9', subject_id: 'cs', status: 'done', date: '2026-11-20' },
    ],
    sessions: [
      { id: 's-rev', todo_id: 'rev', date: '2026-11-05', start_time: at('2026-11-05', '14:00'), end_time: at('2026-11-05', '15:00') },
      { id: 's-read', todo_id: 'read', date: '2026-11-03', start_time: at('2026-11-03', '10:00'), end_time: at('2026-11-03', '11:00') },
      { id: 's-old', todo_id: 'old', date: '2026-09-10', start_time: at('2026-09-10', '10:00'), end_time: at('2026-09-10', '11:00') },
      { id: 's-recent', todo_id: 'recent', date: '2026-11-20', start_time: at('2026-11-20', '10:00'), end_time: at('2026-11-20', '11:00') },
    ],
    timer: [
      { id: 'h1', subject_id: 'cs', task_text: 'CS 61A Lecture Review', duration_seconds: 50 * 60, date: '2026-11-05', start_time: at('2026-11-05', '14:05'), end_time: at('2026-11-05', '14:55') },
      { id: 'h2', subject_id: 'cs', task_text: 'watch lecture 11-02', duration_seconds: 40 * 60, date: '2026-11-02', start_time: at('2026-11-02', '20:00'), end_time: at('2026-11-02', '20:40') },
    ],
  });
  await ask(page, 'did i review the 11-02 cs lecture sometime?');
  const { earlier, lastWeek } = contextOf(bodies.at(-1)!);
  expect(earlier).toEqual({
    'Thu 2026-11-05': ['14:00–15:00 CS 61A Lecture Review · CS 61A · Completed · did 50m'],
    'Mon 2026-11-02': ['watch lecture 11-02 · CS 61A · did 40m · no block'],
    'Sat 2026-10-10': ['Physics HW 6 · Physics 7A · Partially completed'],
  });
  // Last week stays in lastWeek; older than 60 days isn't sent.
  expect(JSON.stringify(lastWeek)).toContain('CS 61A HW 9');
  expect(JSON.stringify(earlier)).not.toContain('HW 9');
  expect(JSON.stringify(earlier)).not.toContain('HW 1');
  expect(bodies.at(-1)!.systemPrompt).toContain('earlier lists work from 8 to 60 days back');
});

test('a busy two months is capped at 120 lines, newest kept', async ({ page }) => {
  const timer = Array.from({ length: 50 }, (_, i) => {
    const d = new Date(`${NOW}T12:00:00`); d.setDate(d.getDate() - 8 - i);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return [1, 2, 3].map(n => ({ id: `h${i}-${n}`, subject_id: 'cs', task_text: `Task ${n}`, duration_seconds: 30 * 60, date }));
  }).flat();
  const bodies = await setup(page, { todos: [], sessions: [], timer });
  await ask(page, 'what did i do last month?');
  const { earlier } = contextOf(bodies.at(-1)!);
  expect(Object.values(earlier as Record<string, string[]>).flat()).toHaveLength(120);
  expect(Object.keys(earlier)[0]).toBe('Mon 2026-11-16');
});

test('nothing done 8 to 60 days back means no earlier key', async ({ page }) => {
  const bodies = await setup(page, { todos: [], sessions: [], timer: [] });
  await ask(page, 'what did i do last month?');
  expect(contextOf(bodies.at(-1)!).earlier).toBeUndefined();
});
