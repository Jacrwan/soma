import { test, expect, type Page } from '@playwright/test';

const account = {
  id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com',
  aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z',
  app_metadata: {}, user_metadata: {},
};
const day = new Date();
const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
const iso = (t: string) => new Date(`${date}T${t}:00`).toISOString();

const tables: Record<string, Record<string, unknown>[]> = {
  subjects: [{ id: 'biology', user_id: account.id, name: 'Biology', color: '#66bb6a', archived: false }],
  todos: [{ id: 'review', user_id: account.id, text: 'Cell review', subject_id: 'biology', status: 'nothing', date, estimated_minutes: 45 }],
  todo_sessions: [{ id: 'review-slot', user_id: account.id, todo_id: 'review', date, start_time: iso('13:00'), end_time: iso('13:45') }],
  timer_sessions: [], active_timer: [],
};

/** Seed the saved preference before the app boots, as a returning user would have it. */
async function setup(page: Page, timeFormat?: '12h' | '24h') {
  await page.addInitScript(({ account, timeFormat }) => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({
      access_token: 't', refresh_token: 'r', token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: account,
    }));
    if (timeFormat) localStorage.setItem('soma_settings', JSON.stringify({ theme: 'light', timeFormat }));
  }, { account, timeFormat });

  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    const rows = tables[table] ?? [];
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
}

test('the dashboard shows 12-hour times by default', async ({ page }) => {
  await setup(page);
  await page.goto('/dashboard');
  await expect(page.getByText('1:00 PM–1:45 PM')).toBeVisible();
  await expect(page.getByText('13:00–13:45')).toHaveCount(0);
});

test('a saved 24-hour preference is used across the app', async ({ page }) => {
  await setup(page, '24h');
  await page.goto('/dashboard');
  await expect(page.getByText('13:00–13:45')).toBeVisible();
  await expect(page.getByText('1:00 PM–1:45 PM')).toHaveCount(0);
});

test('changing the setting applies without a reload and survives one', async ({ page }) => {
  await setup(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();

  const twentyFour = page.getByRole('button', { name: /^24-hour/ });
  await expect(twentyFour).toHaveAttribute('aria-pressed', 'false');
  await twentyFour.click();
  await expect(twentyFour).toHaveAttribute('aria-pressed', 'true');

  // Navigating in-app (no reload) must already use the new preference.
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByText('13:00–13:45')).toBeVisible();

  await page.reload();
  await expect(page.getByText('13:00–13:45')).toBeVisible();
});

test('switching back to 12-hour takes effect', async ({ page }) => {
  await setup(page, '24h');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: /^12-hour/ }).click();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByText('1:00 PM–1:45 PM')).toBeVisible();
});

test('the preference never changes the stored session times', async ({ page }) => {
  await setup(page, '24h');
  await page.goto('/dashboard');
  await expect(page.getByText('13:00–13:45')).toBeVisible();
  // Planned sessions are persisted as canonical 24-hour values; display is
  // formatting only, so the underlying record must be untouched.
  expect(tables.todo_sessions[0].start_time).toBe(iso('13:00'));
  expect(tables.todo_sessions[0].end_time).toBe(iso('13:45'));
});

test('the block editor still uses 24-hour input values under a 12-hour preference', async ({ page }) => {
  await setup(page, '12h');
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  await page.getByRole('button', { name: 'Edit: Cell review', exact: true }).click();
  // <input type="time"> always carries a 24-hour value regardless of display.
  await expect(page.getByLabel('Start time', { exact: true })).toHaveValue('13:00');
  await expect(page.getByLabel('End time', { exact: true })).toHaveValue('13:45');
});
