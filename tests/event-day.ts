import { expect, type Page } from '@playwright/test';
import { triaged } from './triage';

// A Monday at 12:28 like the one reported on 2026-10-05: classes all day, and
// "Physics HW 5: KK-5" on the plan with no time yet. Shared by the mocked
// tests (ai-event-times) and the real-model check (ai-real-model).
const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = key(new Date());
export const at = (t: string) => new Date(`${TODAY}T${t}:00`).toISOString();
export type Row = Record<string, unknown>;
// Soma's context lists entries as lines: "<id> <time> <title> · <course> · <flags>", grouped by day or course.
export type Ctx = { plan: Record<string, string[]>; tasks: Record<string, string[]>; lastWeek?: Record<string, string[]>; lateNight?: string };
export const lines = (group?: Record<string, string[]>) => Object.values(group ?? {}).flat();
/** The line for an entry titled exactly `title`, in plan or tasks. */
export const lineOf = (ctx: Ctx, title: string) => [...lines(ctx.plan), ...lines(ctx.tasks)].find(l => l.split(' · ')[0].endsWith(` ${title}`));

const event = (id: string, summary: string, from: string, to: string) => ({ id, summary, start: { dateTime: at(from) }, end: { dateTime: at(to) }, source: { connectionId: 'c', calendarId: 'k' } });
const events = [
  event('complit', 'Comparative Literature R1A Lecture', '10:00', '10:59'),
  event('cs', 'CS 61A Lecture', '12:00', '12:59'),
  event('math', 'MATH 53 Discussion', '14:00', '14:59'),
  event('disc', 'Physics 5A Discussion', '16:00', '17:59'),
  event('gym', 'gym', '18:00', '19:00'),
];

export async function setup(page: Page, reply: (ctx: Ctx, body: Record<string, unknown>) => unknown | Promise<unknown>, seed?: (db: Record<string, Row[]>) => void, clock = '12:28') {
  const db: Record<string, Row[]> = {
    subjects: [{ id: 'phys', user_id: account.id, name: 'Physics 5A', color: '#ab47bc', archived: false }],
    // The homework is on today's plan with no time yet.
    todos: [{ id: 't-kk5', user_id: account.id, text: 'Physics HW 5: KK-5', subject_id: 'phys', status: 'nothing', date: TODAY }],
    todo_sessions: [],
    timer_sessions: [],
  };
  seed?.(db);
  await page.clock.install({ time: new Date(`${TODAY}T${clock}:00`) });
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
    localStorage.setItem('soma_settings', JSON.stringify({ onboardingCompleted: true, theme: 'light', studyWindow: { start: '08:00', end: '23:00' } }));
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
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    let out = rows ?? [];
    for (const k of ['id', 'todo_id']) { const f = url.searchParams.get(k); if (f?.startsWith('eq.')) out = out.filter(r => String(r[k]) === f.slice(3)); }
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? out[0] ?? null : out });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/memory', r => r.fulfill({ json: { revision: 0, enabled: true, entries: [] } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events, incomplete: false } }));
  await page.route('**/api/chat', async route => { if (triaged(route)) return;
    const body = route.request().postDataJSON();
    const ctx = JSON.parse(String(body.context).match(/CONTEXT[^:]*: (\{[^\n]*\})/)![1]) as Ctx;
    const out = await reply(ctx, body);
    return route.fulfill({ json: typeof out === 'string' ? { content: [{ text: out }] } : { content: [{ text: JSON.stringify(out) }] } });
  });
  await page.goto('/dashboard');
  await expect(page.getByText('Physics HW 5: KK-5')).toBeVisible();
  return db;
}
export const idOf = (ctx: Ctx, title: string) => lineOf(ctx, title)!.split(' ')[0];
export async function ask(page: Page, text: string) {
  await page.getByLabel('What do you need to work on?').fill(text);
  await page.getByRole('button', { name: 'Send to Soma' }).click();
}
export async function acceptedTimes(page: Page, db: Record<string, Row[]>) {
  await expect(page.getByRole('log')).not.toContainText("Couldn't place");
  await expect(page.getByRole('log')).not.toContainText('Needs your call');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => db.todo_sessions.length).toBeGreaterThan(0);
  // One task, one session, no second copy of the homework.
  expect(db.todos.map(t => t.text)).toEqual(['Physics HW 5: KK-5']);
  return db.todo_sessions.map(s => [s.start_time, s.end_time]);
}
