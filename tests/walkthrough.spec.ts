import { test, expect, type Page } from '@playwright/test';

/**
 * The tour (src/components/Onboarding/Walkthrough.tsx): after sign-up, and from
 * Settings → Appearance → Replay tour, it visits every page in sidebar order
 * and spotlights a real part of each. Parts the student can hide (dashboard
 * widgets, the brief) are passed over when they aren't there.
 */

const account = { id: '33333333-3333-4333-8333-333333333333', email: 'tour@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: { full_name: 'Tour Student' } };
type Row = Record<string, unknown>;

async function setup(page: Page, settings: Row = {}) {
  const saved: Row[] = [];
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') {
      if (req.method() !== 'GET') { saved.push(req.postDataJSON() as Row); return route.fulfill({ json: null }); }
      return route.fulfill({ json: { data: { theme: 'light', onboardingCompleted: true, walkthroughCompleted: true, ...settings } } });
    }
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'free' } }));
  await page.route('**/api/google-calendar-connections', r => r.fulfill({ json: { connections: [] } }));
  return { saved };
}

const card = (page: Page) => page.getByRole('dialog');
const spotlight = (page: Page) => page.locator('[class*="spotlight"]');

/** Click Next until the last stop, noting each stop's page and title. */
async function walk(page: Page) {
  const seen: { path: string; title: string; lit: boolean }[] = [];
  for (let i = 0; i < 30; i++) {
    await expect(card(page)).toBeVisible();
    const title = (await page.locator('#walkthrough-title').textContent())!;
    const lit = await spotlight(page).isVisible();
    seen.push({ path: new URL(page.url()).pathname, title, lit });
    const next = card(page).getByRole('button', { name: /Show me around|Next|Start studying/ });
    if ((await next.textContent()) === 'Start studying') break;
    await next.click();
    // Wait for the next card to settle (it hides while its element is found).
    await expect(page.locator('#walkthrough-title')).not.toHaveText(title);
  }
  return seen;
}

test('the tour walks through every page and spotlights each one', async ({ page }) => {
  const { saved } = await setup(page);
  await page.goto('/dashboard?walkthrough');
  await expect(card(page)).toContainText('Welcome to Soma');

  const seen = await walk(page);
  const pages = [...new Set(seen.map(s => s.path))];
  expect(pages).toEqual(['/dashboard', '/deadlines', '/grades', '/documents', '/calendar', '/ai', '/insights', '/settings']);

  // Each page's stop is lit, on that page's own part or its sidebar item.
  const byTitle = Object.fromEntries(seen.map(s => [s.title, s]));
  for (const title of ['Today’s plan', 'Ask Soma', 'Brain dump', 'Due soon', 'Make it yours', 'Everything that’s due', 'Grades', 'Documents', 'Calendar', 'The full Soma chat', 'Insights', 'Settings']) {
    expect(byTitle[title], title).toBeTruthy();
    expect(byTitle[title].lit, `${title} is spotlit`).toBe(true);
  }
  // The last stop is back on the dashboard.
  expect(seen.at(-1)).toMatchObject({ path: '/dashboard', title: 'Ready when you are' });

  await card(page).getByRole('button', { name: 'Start studying' }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect.poll(() => saved.some(s => JSON.stringify(s).includes('"walkthroughCompleted":true'))).toBe(true);
});

test('the tour passes over a widget the student has hidden, going forward and back', async ({ page }) => {
  // No brain dump on this dashboard.
  await setup(page, { dashboardLayout: [{ id: 'plan', size: 'xl', x: 0, y: 0 }, { id: 'ask', size: 'tall', x: 2, y: 0 }, { id: 'focus', size: 'small', x: 2, y: 2 }, { id: 'due', size: 'small', x: 1, y: 3 }] });
  await page.goto('/dashboard?walkthrough');
  const seen = await walk(page);
  expect(seen.map(s => s.title)).not.toContain('Brain dump');
  expect(seen.map(s => s.title)).toContain('Due soon');
});

test('Back returns to the previous page, and Skip tour ends it on the dashboard', async ({ page }) => {
  await setup(page);
  await page.goto('/dashboard?walkthrough');
  // Arrow keys move through the tour too.
  for (let i = 0; i < 30; i++) {
    if ((await page.locator('#walkthrough-title').textContent()) === 'Everything that’s due') break;
    const before = await page.locator('#walkthrough-title').textContent();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#walkthrough-title')).not.toHaveText(before!);
  }
  await expect(page).toHaveURL(/\/deadlines$/);
  await page.keyboard.press('ArrowRight');
  await expect(card(page)).toContainText('Grades');
  await expect(page).toHaveURL(/\/grades$/);

  await card(page).getByRole('button', { name: 'Back' }).click();
  await expect(card(page)).toContainText('Everything that’s due');
  await expect(page).toHaveURL(/\/deadlines$/);

  await card(page).getByRole('button', { name: 'Skip tour' }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard$/);
});
