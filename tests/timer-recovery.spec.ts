import { test, expect, type Page } from '@playwright/test';

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const day = new Date();
const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
const iso = (t: string) => new Date(`${date}T${t}:00`).toISOString();

async function setup(page: Page) {
  const state = { tables: {
    subjects: [{ id: 'biology', user_id: account.id, name: 'Biology', color: '#66bb6a', archived: false }],
    todos: [{ id: 'review', user_id: account.id, text: 'Cell review', subject_id: 'biology', status: 'nothing', date, estimated_minutes: 45 }],
    todo_sessions: [{ id: 's1', user_id: account.id, todo_id: 'review', date, start_time: iso('09:00'), end_time: iso('09:45') }],
    timer_sessions: [], active_timer: [],
  } as Record<string, Record<string, unknown>[]> };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', async route => {
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
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  return state;
}

const seconds = (clock: string) => clock.split(':').reduce((a, p) => a * 60 + Number(p), 0);

async function startFocus(page: Page, state: Awaited<ReturnType<typeof setup>>) {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Start focus: Cell review', exact: true }).click();
  await expect(page.getByLabel('Focus timer')).toContainText('Cell review');
  await expect.poll(() => state.tables.active_timer.length).toBe(1);
}

/** The focus timer's own clock — not the wall clock in the page header. */
async function clock(page: Page): Promise<string> {
  const text = await page.getByLabel('Focus timer').innerText();
  return text.match(/\d{1,2}:\d{2}(:\d{2})?/)?.[0] ?? '';
}

test('a running timer survives a reload and keeps counting', async ({ page }) => {
  const state = await setup(page);
  await startFocus(page, state);
  await page.waitForTimeout(2500);

  await page.reload();
  await expect(page.getByLabel('Focus timer')).toContainText('Cell review');
  const first = seconds(await clock(page));
  expect(first).toBeGreaterThanOrEqual(2);

  await page.waitForTimeout(2000);
  expect(seconds(await clock(page))).toBeGreaterThan(first);
});

test('a paused timer survives a reload without gaining time', async ({ page }) => {
  const state = await setup(page);
  await startFocus(page, state);
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = seconds(await clock(page));

  await page.reload();
  await expect(page.getByLabel('Focus timer')).toContainText('Cell review');
  await page.waitForTimeout(2000);
  // Still paused, so the clock must not have advanced across the reload.
  expect(seconds(await clock(page))).toBe(paused);
});

// Both of these reset the timer to 00:00 when recovery depended solely on the
// server record, because every failure was swallowed.
test('the timer survives a reload when the auth call fails', async ({ page }) => {
  const state = await setup(page);
  await startFocus(page, state);
  await page.waitForTimeout(2200);
  await page.route('**/auth/v1/user*', r => r.fulfill({ status: 500, json: { message: 'down' } }));

  await page.reload();
  await expect(page.getByLabel('Focus timer')).toContainText('Cell review');
  expect(seconds(await clock(page))).toBeGreaterThanOrEqual(2);
});

test('the timer survives a reload when the active_timer read fails', async ({ page }) => {
  const state = await setup(page);
  await startFocus(page, state);
  await page.waitForTimeout(2200);
  await page.route('**/rest/v1/active_timer*', r => r.request().method() === 'GET'
    ? r.fulfill({ status: 500, json: { message: 'down' } }) : r.fallback());

  await page.reload();
  await expect(page.getByLabel('Focus timer')).toContainText('Cell review');
  expect(seconds(await clock(page))).toBeGreaterThanOrEqual(2);
});

test('a stopped timer does not come back after a reload', async ({ page }) => {
  const state = await setup(page);
  await startFocus(page, state);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop & save', exact: true }).click();
  await expect(page.getByLabel('Focus timer')).toContainText('Ready when you are');
  expect(state.tables.active_timer).toHaveLength(0);

  await page.reload();
  await expect(page.getByLabel('Focus timer')).toContainText('Ready when you are');
  expect(await page.evaluate(() => localStorage.getItem('soma_active_timer'))).toBeNull();
});

test('a second account on the same device does not inherit the timer', async ({ page }) => {
  const state = await setup(page);
  await startFocus(page, state);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => localStorage.getItem('soma_active_timer'))).not.toBeNull();

  // Same browser, different signed-in user, and no active_timer row for them.
  const other = { ...account, id: '22222222-2222-4222-8222-222222222222' };
  state.tables.active_timer = [];
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, other);
  await page.unroute('https://soma-regression.supabase.co/**');
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: other });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    const rows = table === 'subjects' ? state.tables.subjects : [];
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
  });

  await page.reload();
  await expect(page.getByLabel('Focus timer')).toContainText('Ready when you are');
});

test('the running-timer pill shows on other pages and survives a reload there', async ({ page }) => {
  const state = await setup(page);
  await startFocus(page, state);
  await page.waitForTimeout(2200);

  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  const pill = page.getByRole('complementary', { name: 'Focus timer' });
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('Cell review');

  await page.reload();
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('Cell review');
  expect(seconds((await pill.innerText()).match(/\d{2}:\d{2}:\d{2}/)?.[0] ?? '')).toBeGreaterThanOrEqual(2);

  // Pausing from the pill holds the clock.
  await pill.getByRole('button', { name: 'Pause focus' }).click();
  await expect(pill.getByRole('button', { name: 'Resume focus' })).toBeVisible();

  // Its body is a way back to the dashboard.
  await pill.getByRole('button', { name: /Open the dashboard/ }).click();
  await expect(page.getByLabel('Focus timer')).toContainText('Cell review');
});

test('the pill is not shown on the dashboard, which has its own Focus panel', async ({ page }) => {
  const state = await setup(page);
  await startFocus(page, state);
  await expect(page.getByRole('complementary', { name: 'Focus timer' })).toHaveCount(0);
});

test('the sidebar collapses to icons and the choice is remembered', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Insights', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  // Labels leave the accessibility tree; each button keeps its title.
  await expect(page.getByRole('button', { name: 'Insights', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('soma_nav_collapsed'))).toBe('1');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Insights', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Insights', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('soma_nav_collapsed'))).toBe('0');
  expect(state.tables.subjects).toHaveLength(1);
});
