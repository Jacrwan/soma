import { test, expect, type Page } from '@playwright/test';
import { price, studentSavings } from '../src/lib/pricing';

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };

async function visit(page: Page, { student }: { student: boolean }) {
  const requests: Record<string, unknown>[] = [];
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    if (route.request().url().includes('/auth/v1/')) return route.fulfill({ json: account });
    return route.fulfill({ json: [] });
  });
  await page.route('**/api/stripe', route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body?.action === 'verify-student') { requests.push(body); return route.fulfill({ json: { sent: true } }); }
    return route.fulfill({ json: { status: 'free', student } });
  });
  await page.goto('/pricing');
  return requests;
}

test('an unverified account sees the ordinary price and is offered the student rate', async ({ page }) => {
  await visit(page, { student: false });
  await expect(page.getByText(price('base', 'monthly')).first()).toBeVisible();
  await expect(page.getByText(price('student', 'monthly'), { exact: false }).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`Students save ${studentSavings('annual')}%`))).toBeVisible();
});

test('a verified account is quoted the student price', async ({ page }) => {
  await visit(page, { student: true });
  await expect(page.getByText(price('student', 'monthly')).first()).toBeVisible();
  await expect(page.getByText('Student price applied', { exact: false })).toBeVisible();
  await expect(page.getByLabel('School email address')).toHaveCount(0);
});

test('asking for a link sends the address to the server and says where to look', async ({ page }) => {
  const requests = await visit(page, { student: false });
  await page.getByLabel('School email address').fill('me@berkeley.edu');
  await page.getByRole('button', { name: 'Send link' }).click();
  await expect(page.getByRole('status')).toContainText('me@berkeley.edu');
  expect(requests).toEqual([{ action: 'verify-student', email: 'me@berkeley.edu' }]);
});

test('a personal address is refused with an explanation, and nothing is unlocked', async ({ page }) => {
  await visit(page, { student: false });
  await page.unroute('**/api/stripe');
  await page.route('**/api/stripe', route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body?.action === 'verify-student') return route.fulfill({ status: 400, json: { error: 'not_a_school_email' } });
    return route.fulfill({ json: { status: 'free', student: false } });
  });
  await page.getByLabel('School email address').fill('me@gmail.com');
  await page.getByRole('button', { name: 'Send link' }).click();
  await expect(page.getByRole('status')).toContainText('does not look like a school email');
  await expect(page.getByText('Student price applied', { exact: false })).toHaveCount(0);
});

test('returning from the emailed link confirms it, and a stale link says so', async ({ page }) => {
  await visit(page, { student: false });
  await page.goto('/pricing?student=verified');
  await expect(page.getByRole('status')).toContainText('school email is confirmed');
  await expect(page).toHaveURL(/\/pricing$/);        // the token is not left in the address bar

  await page.goto('/pricing?student=invalid');
  await expect(page.getByRole('status')).toContainText('expired');
});
