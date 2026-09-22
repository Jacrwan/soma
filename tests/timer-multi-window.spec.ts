import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * The focus timer across two windows.
 *
 * active_timer is the shared record of what is running, but it was read once
 * on mount and never again. A second window kept its own idea of the timer:
 * a session started elsewhere only showed up after a reload, and stopping in
 * one window left the others running — each saving its own row for the same
 * sitting when it was eventually stopped.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const day = new Date();
const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
const iso = (t: string) => new Date(`${date}T${t}:00`).toISOString();

/** One shared backend for every window in the context, as a real account is. */
async function backend(context: BrowserContext) {
  const state = { tables: {
    subjects: [{ id: 'biology', user_id: account.id, name: 'Biology', color: '#66bb6a', archived: false }],
    todos: [{ id: 'review', user_id: account.id, text: 'Cell review', subject_id: 'biology', status: 'nothing', date, estimated_minutes: 45 }],
    todo_sessions: [{ id: 's1', user_id: account.id, todo_id: 'review', date, start_time: iso('09:00'), end_time: iso('09:45') }],
    timer_sessions: [], active_timer: [],
  } as Record<string, Record<string, unknown>[]> };
  await context.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await context.route('https://soma-regression.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (req.method() === 'GET') {
      let rows = state.tables[table] ?? [];
      for (const k of ['id', 'todo_id', 'date']) { const f = url.searchParams.get(k); if (f?.startsWith('eq.')) rows = rows.filter(r => String(r[k]) === f.slice(3)); }
      return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
    }
    if (req.method() === 'POST') { const b = req.postDataJSON(); for (const it of (Array.isArray(b) ? b : [b]) as Record<string, unknown>[]) { const cur = state.tables[table] ?? []; state.tables[table] = [...cur.filter(r => table === 'active_timer' ? r.user_id !== it.user_id : r.id !== it.id), it]; } }
    else if (req.method() === 'DELETE') { const id = url.searchParams.get('id')?.slice(3); state.tables[table] = id ? (state.tables[table] ?? []).filter(r => r.id !== id) : []; }
    return route.fulfill({ json: null });
  });
  await context.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await context.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  return state;
}

const focus = (page: Page) => page.getByLabel('Focus timer');

// Every test here waits on the cross-window poll rather than a click.
test.describe.configure({ timeout: 60_000 });

test('a session started in one window reaches the other without a reload', async ({ context }) => {
  const state = await backend(context);
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto('/dashboard');
  await second.goto('/dashboard');
  await expect(focus(second)).toContainText('Ready when you are');

  await first.getByRole('button', { name: 'Start focus: Cell review', exact: true }).click();
  await expect.poll(() => state.tables.active_timer.length).toBe(1);

  // The other window is told by the shared record, not by being reloaded.
  await second.bringToFront();
  await expect(focus(second)).toContainText('Cell review', { timeout: 25_000 });
});

test('stopping in one window stops the other, and records one session', async ({ context }) => {
  const state = await backend(context);
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto('/dashboard');
  await first.getByRole('button', { name: 'Start focus: Cell review', exact: true }).click();
  await expect.poll(() => state.tables.active_timer.length).toBe(1);

  // The second window picks the running session up, as it would on open.
  await second.goto('/dashboard');
  await expect(focus(second)).toContainText('Cell review');

  await first.bringToFront();
  await first.getByRole('button', { name: /Stop/ }).click();
  await expect.poll(() => state.tables.timer_sessions.length).toBe(1);
  await expect.poll(() => state.tables.active_timer.length).toBe(0);

  // The bug: the second window kept running, and stopping it wrote a second
  // row for the same sitting.
  await second.bringToFront();
  await expect(focus(second)).toContainText('Ready when you are', { timeout: 25_000 });
  await expect(second.getByRole('button', { name: /Stop/ })).toHaveCount(0);
  expect(state.tables.timer_sessions).toHaveLength(1);
});

test('a timer that never reached the account is not cleared as a stop elsewhere', async ({ context }) => {
  const state = await backend(context);
  const page = await context.newPage();
  // A session mirrored locally with no shared row: this device's own, mid-save
  // or saved while offline. It must survive.
  await page.addInitScript(({ startedAt }) => {
    localStorage.setItem('soma_active_timer', JSON.stringify({
      userId: '11111111-1111-4111-8111-111111111111',
      subjectId: 'biology', subjectName: 'Biology', subjectColor: '#66bb6a',
      task: 'Cell review', sessionStartTimeISO: startedAt,
      accumulatedSeconds: 120, isPaused: true, markedAtMs: Date.now(),
    }));
  }, { startedAt: iso('09:00') });

  await page.goto('/dashboard');
  await expect(focus(page)).toContainText('Cell review');
  // Still there after the poll has had its chance to run.
  await page.waitForTimeout(14_000);
  await expect(focus(page)).toContainText('Cell review');
  expect(state.tables.timer_sessions).toHaveLength(0);
});
