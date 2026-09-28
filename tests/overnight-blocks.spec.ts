import { test, expect, type Page } from '@playwright/test';
import { freeTime, validateProposal } from '../src/lib/aiPlanning';
import { rangeOf, spanMinutes, windowOf } from '../src/lib/clockRange';

// Reported: "11:30 pm today to 1:00 am" could not be planned at all. Every
// range comparison assumed a block ends on the day it starts, so 23:30–01:00
// was "less than a minute", and Soma split it at midnight into two halves that
// then collided with each other.

test('a range that ends before it starts runs past midnight', () => {
  expect(spanMinutes('23:30', '01:00')).toBe(90);
  expect(spanMinutes('09:00', '10:15')).toBe(75);
  expect(spanMinutes('10:00', '10:00')).toBe(0);
  expect(rangeOf('23:30–01:00')).toEqual([1410, 1500]);
  expect(windowOf({ start: '08:00', end: '02:00' })).toEqual([480, 1560]);
});

const origin = new Date(2026, 8, 27, 0, 0);
const block = (time: string, day = 0, id = time) => ({ id, title: `block ${time}`, subject: 's', time, minutes: spanMinutes(...time.split('–') as [string, string]), color: 'blue', state: 'Planned', day } as never);
const snapshot = (blocks: never[]) => ({ blocks, sessions: [], subjects: [], todos: [], history: [], items: [], calendarError: '' } as never);
const late = { studyWindow: { start: '08:00', end: '02:00' } } as never;

test('an overnight proposal is valid and meets the next morning’s blocks', () => {
  expect(validateProposal(block('23:30–01:00', 1, 'new'), snapshot([]), origin, late, true, true)).toEqual([]);
  // Tomorrow at 00:30 is inside tonight's block.
  expect(() => validateProposal(block('23:30–01:00', 1, 'new'), snapshot([block('00:30–01:30', 2)]), origin, late, true, true)).toThrow(/overlaps/);
  // Past the end of study hours is still refused.
  expect(() => validateProposal(block('01:00–03:00', 2, 'new'), snapshot([]), origin, late, true, true)).toThrow(/study hours/);
  // With the old same-day study hours it is outside them, not "under a minute".
  expect(() => validateProposal(block('23:30–01:00', 1, 'new'), snapshot([]), origin, { studyWindow: { start: '08:00', end: '23:00' } } as never, true, true)).toThrow(/study hours/);
});

test('free time carries study hours past midnight', () => {
  const now = new Date(2026, 8, 27, 21, 50);
  const [today, tomorrow] = freeTime(snapshot([block('22:00–23:30')]), origin, late, now);
  expect(today.free).toEqual(['23:30–02:00']);
  expect(tomorrow.free).toEqual(['08:00–02:00']);
  // Just after midnight, the rest of last night's hours are still open.
  const [early] = freeTime(snapshot([]), origin, late, new Date(2026, 8, 27, 0, 40));
  expect(early.free[0]).toBe('00:45–02:00');
});

// ── through the dashboard ─────────────────────────────────────────────────
const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const at = (n: number, t: string) => { const d = offset(n); const [h, m] = t.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };
const TOMORROW = key(offset(1));
type Row = Record<string, unknown>;

async function setup(page: Page, reply: unknown, studyWindow = { start: '08:00', end: '02:00' }) {
  const db: Record<string, Row[]> = {
    subjects: [{ id: 'phys', user_id: account.id, name: 'Physics 5A', color: '#ab47bc', archived: false }],
    todos: [{ id: 't-hw', user_id: account.id, text: 'Physics HW 4', subject_id: 'phys', status: 'nothing', date: TOMORROW }],
    todo_sessions: [{ id: 's-hw', user_id: account.id, todo_id: 't-hw', date: TOMORROW, start_time: at(1, '20:00'), end_time: at(1, '21:00') }],
    timer_sessions: [],
  };
  const state = { db, prompt: '' };
  await page.addInitScript(([a, w]) => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
    localStorage.setItem('soma_settings', JSON.stringify({ onboardingCompleted: true, theme: 'light', studyWindow: w }));
  }, [account, studyWindow] as const);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light', studyWindow: { start: '08:00', end: '02:00' } } } });
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
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/chat', route => {
    const body = route.request().postDataJSON();
    state.prompt = `${body.systemPrompt}\n${body.context ?? ''}`;
    return route.fulfill({ json: { content: [{ text: JSON.stringify(reply) }] } });
  });
  await page.goto('/dashboard');
  await page.getByLabel('Next seven days').getByRole('button').nth(1).click();
  await expect(page.getByText('Physics HW 4')).toBeVisible();
  return state;
}

test('Soma can plan 11:30 PM to 1:00 AM, and it saves as one block ending the next day', async ({ page }) => {
  const state = await setup(page, { reply: 'Planned.', blocks: [{ title: 'Physics reading 5.1–5.4', subject: 'Physics 5A', date: TOMORROW, start: '23:30', end: '01:00' }] });
  await page.getByLabel('What do you need to work on?').fill('plan 5.1 to 5.4 from 11:30 pm to 1 am');
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect(page.getByRole('log')).toContainText('Planned.');
  await expect(page.getByRole('log')).not.toContainText("Couldn't place");
  expect(state.prompt).toContain('Never split one block at midnight');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0);
  const saved = state.db.todo_sessions.find(s => s.id !== 's-hw')!;
  expect(saved.start_time).toBe(at(1, '23:30'));
  expect(saved.end_time).toBe(at(2, '01:00'));
  await expect(page.getByText('90 min')).toBeVisible();
});

test('the block editor saves an overnight block instead of refusing it', async ({ page }) => {
  const state = await setup(page, { reply: 'ok' });
  await page.getByRole('button', { name: 'Edit: Physics HW 4' }).click();
  await page.getByLabel('Start time').fill('23:00');
  await page.getByLabel('End time').fill('01:30');
  await expect(page.getByText(/Runs past midnight/)).toBeVisible();
  await page.getByRole('button', { name: 'Save block' }).click();
  await expect(page.getByLabel('Block editor')).toHaveCount(0);
  const saved = state.db.todo_sessions.find(s => s.id === 's-hw')!;
  expect(saved.start_time).toBe(at(1, '23:00'));
  expect(saved.end_time).toBe(at(2, '01:30'));
});

test('"I can study till 3" lets that reply go past study hours, and Accept keeps it', async ({ page }) => {
  const late = { reply: 'Tonight only.', studyUntil: '03:00', blocks: [{ title: 'Physics reading 4.2–4.9', subject: 'Physics 5A', date: TOMORROW, start: '23:30', end: '01:00' }] };
  const state = await setup(page, late, { start: '08:00', end: '23:00' });
  await page.getByLabel('What do you need to work on?').fill('i can study till 3');
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect(page.getByRole('log')).toContainText('Tonight only.');
  await expect(page.getByRole('log')).not.toContainText("Couldn't place");
  await expect(page.getByText(/Past your usual study hours/).first()).toBeVisible();
  expect(state.prompt).toContain('"studyHours":"08:00–23:00"');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.todo_sessions.length).toBe(2);
  expect(state.db.todo_sessions.find(s => s.id !== 's-hw')!.end_time).toBe(at(2, '01:00'));
});

test('without the student saying so, study hours still hold', async ({ page }) => {
  await setup(page, { reply: 'Here.', blocks: [{ title: 'Physics reading 4.2–4.9', subject: 'Physics 5A', date: TOMORROW, start: '23:30', end: '01:00' }] }, { start: '08:00', end: '23:00' });
  await page.getByLabel('What do you need to work on?').fill('plan the reading tomorrow night');
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect(page.getByRole('log')).toContainText('outside your study hours');
});

test('late at night, a block Soma dates "today at 1 AM" lands on tonight, not this morning', async ({ page }) => {
  // 11:40 PM today. The model gives the date it's on, and 00:30 today has passed.
  const night = new Date(); night.setHours(23, 40, 0, 0);
  await page.clock.install({ time: night });
  const TODAY = key(offset(0));
  const state = await setup(page, { reply: 'Here.', blocks: [{ title: 'Physics reading 5.1–5.4', subject: 'Physics 5A', date: TODAY, start: '00:30', end: '01:30' }] });
  await page.getByLabel('What do you need to work on?').fill('i can go until 2');
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect(page.getByRole('log')).toContainText('Here.');
  await expect(page.getByRole('log')).not.toContainText('start time has passed');
  await page.getByRole('button', { name: /^Accept all/ }).click();
  await expect.poll(() => state.db.todo_sessions.length).toBe(2);
  expect(state.db.todo_sessions.find(s => s.id !== 's-hw')!.start_time).toBe(at(1, '00:30'));
});
