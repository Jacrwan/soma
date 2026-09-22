import { test, expect, type Page } from '@playwright/test';

/**
 * Loading states for the three pages that wait on the network.
 *
 * Each skeleton stands in for the page it becomes, so the layout settles
 * rather than snapping from a line of text. The bars are decoration: a
 * screen reader hears one polite status instead of a list of empty boxes,
 * which is also what these tests wait on.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const day = new Date();
const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

/** Holds the named tables open until released, so the skeleton can be seen. */
async function setup(page: Page, stall: string[] = []) {
  // One-shot: once released, later requests pass straight through. Holding
  // them too would hang a refetch the page makes after loading.
  let released = false;
  const waiting: (() => void)[] = [];
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    // The stall goes first, or a table answered above could never be held.
    if (stall.includes(table) && req.method() === 'GET' && !released) {
      await new Promise<void>(resolve => waiting.push(resolve));
    }
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (table === 'subjects') return route.fulfill({ json: [{ id: 'bio', user_id: account.id, name: 'Biology', color: '#66bb6a', archived: false }] });
    if (table === 'todos') return route.fulfill({ json: [{ id: 't1', user_id: account.id, text: 'Lab 3', subject_id: 'bio', status: 'nothing', date, due_date: date, kind: 'lab' }] });
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/google-calendar-connections', r => r.fulfill({ json: { connections: [] } }));
  return { release: async () => { released = true; for (const w of waiting.splice(0)) w(); } };
}

const skeleton = (page: Page) => page.getByTestId('skeleton');

// These hold requests open on purpose, so they are slower than a test that
// only clicks, and slower again when several run at once.
test.describe.configure({ timeout: 45_000 });

test('the dashboard shows its shape while the plan loads', async ({ page }) => {
  const gate = await setup(page, ['todos']);
  await page.goto('/dashboard');

  await expect(skeleton(page)).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Loading your plan…');
  // Decoration, not content: the bars are not announced one by one.
  await expect(skeleton(page)).toHaveAttribute('aria-hidden', 'true');

  await gate.release();
  await expect(skeleton(page)).toHaveCount(0);
  await expect(page.getByLabel('Focus timer')).toBeVisible();
});

test('deadlines shows its shape while tasks load', async ({ page }) => {
  const gate = await setup(page, ['todos']);
  await page.goto('/deadlines');

  await expect(skeleton(page)).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Loading your deadlines…');

  await gate.release();
  await expect(page.getByText('Lab 3')).toBeVisible();
  await expect(skeleton(page)).toHaveCount(0);
});

test('deadlines does not flash Connect Canvas at a student who has deadlines', async ({ page }) => {
  const gate = await setup(page, ['todos']);
  await page.goto('/deadlines');

  // The prompt used to appear the moment the page rendered, because no task
  // had arrived yet to say otherwise.
  await expect(skeleton(page)).toBeVisible();
  await expect(page.getByPlaceholder(/instructure/)).toHaveCount(0);

  await gate.release();
  await expect(page.getByText('Lab 3')).toBeVisible();
  await expect(page.getByPlaceholder(/instructure/)).toHaveCount(0);
});

test('no notice about the account is shown before the account answers', async ({ page }) => {
  const gate = await setup(page, ['todos']);
  await page.goto('/deadlines');

  // Both of these describe what the student has, and neither is knowable yet.
  await expect(skeleton(page)).toBeVisible();
  await expect(page.getByText(/Connect Canvas/)).toHaveCount(0);
  await expect(page.getByText(/not sorted into/)).toHaveCount(0);
  await gate.release();
  await expect(page.getByText('Lab 3')).toBeVisible();
});

test('the documents skeleton does not run off the side', async ({ page }) => {
  const gate = await setup(page, ['documents']);
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/documents');
  await expect(skeleton(page)).toBeVisible();

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await gate.release();
});

test('documents shows its shape while files load', async ({ page }) => {
  const gate = await setup(page, ['documents']);
  await page.goto('/documents');

  await expect(skeleton(page)).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Loading documents…');

  await gate.release();
  await expect(skeleton(page)).toHaveCount(0);
});

test('insights announces loading once, not one box at a time', async ({ page }) => {
  const gate = await setup(page, ['timer_sessions']);
  await page.goto('/insights');

  await expect(skeleton(page)).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Loading your insights…');
  await expect(skeleton(page)).toHaveAttribute('aria-hidden', 'true');
  await gate.release();
});

test('the AI page announces loading the same way', async ({ page }) => {
  const gate = await setup(page, ['chat_sessions']);
  await page.route('**/api/stripe', async r => { await new Promise(res => setTimeout(res, 1200)); return r.fulfill({ json: { status: 'active' } }); });
  await page.goto('/ai');

  await expect(skeleton(page)).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Loading Soma…');
  await gate.release();
});

test('settings does not offer Connect to an account already connected', async ({ page }) => {
  const gate = await setup(page, ['settings']);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Integrations', exact: true }).click();

  // Scoped to the Canvas row: Google Calendar has a Connect button of its own.
  const canvas = page.getByTestId('canvas-connection');
  await expect(canvas).toBeVisible();
  // The row waits rather than guessing, which is what stopped it flashing
  // "Connect" at a student whose Canvas is already set up.
  await expect(canvas.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);

  await gate.release();
  // Once the answer is in, the row commits to it.
  await expect(canvas.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
});

test('the calendar keeps its grid and says what is still arriving', async ({ page }) => {
  const gate = await setup(page, ['timer_sessions']);
  await page.goto('/calendar');

  // The grid is real structure, so it is not replaced by placeholder blocks.
  await expect(page.getByRole('status')).toContainText(/Loading your study time|Syncing/);
  await expect(skeleton(page)).toHaveCount(0);
  await gate.release();
});

test('skeletons hold still when motion is not wanted', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const gate = await setup(page, ['todos']);
  await page.goto('/deadlines');

  const bar = skeleton(page).locator('div').first();
  await expect(bar).toBeVisible();
  expect(await bar.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await gate.release();
});
