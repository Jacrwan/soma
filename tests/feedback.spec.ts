import { test, expect, type Page } from '@playwright/test';

/**
 * Feedback and bug reports.
 *
 * Until now the only route was a mailto: link on the Contact page, which
 * loses anything a student cannot be bothered to write in their own mail
 * client. The report is stored first and any notification sent afterwards,
 * so a mail provider being down cannot lose it.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };

async function setup(page: Page, { status = 200 } = {}) {
  const sent: Record<string, unknown>[] = [];
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/feedback', route => {
    sent.push(route.request().postDataJSON());
    return status === 200
      ? route.fulfill({ json: { ok: true } })
      : route.fulfill({ status, json: { error: status === 429 ? 'rate_limit' : 'save_failed' } });
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  return sent;
}

test('a bug report carries where it came from', async ({ page }) => {
  const sent = await setup(page);
  await page.getByLabel(/What happened/).fill('The focus timer stayed at zero.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByRole('status')).toContainText('Thank you');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ kind: 'bug', message: 'The focus timer stayed at zero.', page: '/settings' });
  // Stamped so a report says which build it came from.
  expect(String(sent[0].appVersion)).toMatch(/^\d+\.\d+\.\d+$/);
});

test('the prompt follows what kind of report it is', async ({ page }) => {
  await setup(page);
  await expect(page.getByLabel(/What happened/)).toBeVisible();
  await page.getByLabel('What is this?').selectOption('idea');
  await expect(page.getByLabel(/What would you like to say/)).toBeVisible();
});

test('what gets sent is stated, not buried', async ({ page }) => {
  await setup(page);
  // A student should know a report carries more than what they typed.
  await expect(page.getByText(/the page you are on, your account email, and your browser version/i)).toBeVisible();
  await expect(page.getByText(/not your coursework, notes, or documents/i)).toBeVisible();
});

test('an empty report cannot be sent', async ({ page }) => {
  const sent = await setup(page);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.getByLabel(/What happened/).fill('   ');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  expect(sent).toHaveLength(0);
});

test('a failed send says so and keeps what was written', async ({ page }) => {
  await setup(page, { status: 500 });
  await page.getByLabel(/What happened/).fill('Something broke.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('could not be sent');
  // Losing the text would be the worst possible answer to a failed report.
  await expect(page.getByLabel(/What happened/)).toHaveValue('Something broke.');
});

test('being rate limited is explained rather than shrugged at', async ({ page }) => {
  await setup(page, { status: 429 });
  await page.getByLabel(/What happened/).fill('Again.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/lot of reports in one minute/);
});
