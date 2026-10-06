import { test, expect } from '@playwright/test';

// "Make an option in the study hours to just turn it off" (2026-10-06).
const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };

test('study hours can be turned off and back on, keeping the times', async ({ page }) => {
  const saved: Record<string, unknown>[] = [];
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
    if (!localStorage.getItem('soma_settings')) localStorage.setItem('soma_settings', JSON.stringify({ theme: 'light', studyWindow: { start: '10:00', end: '23:00' } }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') {
      if (req.method() === 'POST') saved.push(req.postDataJSON());
      return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    }
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  const local = () => page.evaluate(() => JSON.parse(localStorage.getItem('soma_settings') ?? '{}').studyWindow);

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Study hours' }).click();
  const limit = page.getByRole('group', { name: 'Limit to study hours' });
  await expect(limit.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Earliest start')).toHaveValue('10:00');

  await limit.getByRole('button', { name: 'Off' }).click();
  await expect(page.getByLabel('Earliest start')).toHaveCount(0);
  await expect(page.getByText(/any hour, day or night/)).toBeVisible();
  expect(await local()).toEqual({ start: '10:00', end: '23:00', off: true });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => JSON.stringify(saved.at(-1) ?? {})).toContain('"off":true');

  // Still off after a reload; turning it on brings the old times back.
  await page.reload();
  await page.getByRole('button', { name: 'Study hours' }).click();
  await expect(limit.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  await limit.getByRole('button', { name: 'On' }).click();
  await expect(page.getByLabel('Earliest start')).toHaveValue('10:00');
  await expect(page.getByLabel('Latest end')).toHaveValue('23:00');
  expect(await local()).toEqual({ start: '10:00', end: '23:00', off: false });
});
