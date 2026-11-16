import { test, expect, type Page } from '@playwright/test';
import { triaged } from './triage';

/**
 * 2026-11-16, Monday: "after the oral presentation session today (7:45 - 8:45)
 * add the math homework I missed yesterday". Soma said study hours end at
 * 9 PM, so it wouldn't fit, and proposed nothing; the "7:45 - 8:45" in the
 * message would also have been taken as the new block's own time. Now the
 * block missed yesterday is moved, right after the session, past study hours,
 * and the move is pinned so the task scheduler leaves it. Also: while Soma
 * works on a message, a "Planning" bubble shows and Send stays off (the owner
 * sent the message twice when nothing showed).
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const at = (n: number, t: string) => { const d = offset(n); const [h, m] = t.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };
const TODAY = key(offset(0)), YESTERDAY = key(offset(-1));
type Row = Record<string, unknown>;

/** The short id Soma is shown for an entry, from its context line (plan or lastWeek). */
const idIn = (context: string, title: string) => {
  const ctx = JSON.parse(context.match(/CONTEXT[^:]*: (\{[^\n]*\})/)![1]) as { plan: Record<string, string[]>; lastWeek: Record<string, string[]> };
  const all = [...Object.values(ctx.plan), ...Object.values(ctx.lastWeek)].flat();
  return all.find(l => l.split(' · ')[0].endsWith(` ${title}`))!.split(' ')[0];
};

async function setup(page: Page, reply: (context: string) => unknown, delay = 0) {
  const db: Record<string, Row[]> = {
    subjects: [
      { id: 'lit', user_id: account.id, name: 'COMLIT R1A', color: '#ef5350', archived: false },
      { id: 'math', user_id: account.id, name: 'MATH 53', color: '#42a5f5', archived: false },
    ],
    todos: [
      { id: 't-oral', user_id: account.id, text: 'Oral Presentations', subject_id: 'lit', status: 'nothing', date: TODAY },
      { id: 't-math', user_id: account.id, text: 'Math 53 homework: 15.6–15.9', subject_id: 'math', status: 'nothing', date: YESTERDAY },
    ],
    todo_sessions: [
      { id: 's-oral', user_id: account.id, todo_id: 't-oral', date: TODAY, start_time: at(0, '19:45'), end_time: at(0, '20:45') },
      { id: 's-math', user_id: account.id, todo_id: 't-math', date: YESTERDAY, start_time: at(-1, '20:00'), end_time: at(-1, '22:00') },
    ],
    timer_sessions: [],
  };
  const state = { db, writes: [] as { method: string; table: string; body: unknown }[] };
  const noon = new Date(); noon.setHours(11, 30, 0, 0);
  await page.clock.install({ time: noon });
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
    localStorage.setItem('soma_settings', JSON.stringify({ onboardingCompleted: true, theme: 'light', studyWindow: { start: '08:00', end: '21:00' } }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    const rows = db[table];
    if (req.method() !== 'GET') state.writes.push({ method: req.method(), table, body: req.postDataJSON() });
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
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/chat', async route => { if (triaged(route)) return;
    const body = route.request().postDataJSON();
    if (delay) await new Promise(r => setTimeout(r, delay));
    return route.fulfill({ json: { content: [{ text: JSON.stringify(reply(`${body.context ?? ''}`)) }] } });
  });
  await page.goto('/dashboard');
  await expect(page.getByText('Oral Presentations').first()).toBeVisible();
  return state;
}
async function ask(page: Page, text: string) {
  await page.getByLabel('What do you need to work on?').fill(text);
  await page.getByRole('button', { name: 'Send to Soma' }).click();
}

test('"after the 7:45–8:45 session, add the math homework I missed yesterday" moves it to 8:45–10:45 PM, past study hours, pinned', async ({ page }) => {
  const state = await setup(page, ctx => ({
    reply: 'Math homework goes right after the oral presentation session.',
    changes: [{ action: 'move', id: idIn(ctx, 'Math 53 homework: 15.6–15.9'), date: TODAY, minutes: 120, after: idIn(ctx, 'Oral Presentations') }],
  }));
  await ask(page, 'after the oral presentation session today (7:45 - 8:45) add the math homework i missed yesterday');
  const log = page.getByRole('log');
  await expect(log).toContainText('right after the oral presentation session');
  await expect(log).not.toContainText("Couldn't place");
  await expect(log).not.toContainText('Needs your call');
  await expect(log).not.toContainText('study hours');
  await expect(page.getByText(/Moves from 8:00 PM–10:00 PM/)).toBeVisible();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.todo_sessions.find(s => s.id === 's-math')?.start_time).toBe(at(0, '20:45'));
  expect(state.db.todo_sessions.find(s => s.id === 's-math')?.end_time).toBe(at(0, '22:45'));
  // Pinned on every device, so the task scheduler leaves it where the student put it.
  await expect.poll(() => state.writes.some(w => w.table === 'todo_sessions' && JSON.stringify(w.body) === '{"pinned":true}')).toBe(true);
});

test('while Soma plans, a "Planning" bubble shows and Send stays off', async ({ page }) => {
  await setup(page, () => ({ reply: 'Nothing to change.' }), 1500);
  await ask(page, 'anything I should move?');
  const log = page.getByRole('log');
  await expect(log.getByText('Planning')).toBeVisible();
  await page.getByLabel('What do you need to work on?').fill('and again');
  await expect(page.getByRole('button', { name: 'Send to Soma' })).toBeDisabled();
  await expect(log).toContainText('Nothing to change.');
  await expect(log.getByText('Planning')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send to Soma' })).toBeEnabled();
});
