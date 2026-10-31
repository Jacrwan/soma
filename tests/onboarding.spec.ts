import { test, expect, type Page } from '@playwright/test';

/**
 * Sign-up (src/components/Onboarding/OnboardingFlow.tsx): age, education,
 * Canvas through the extension, Google Calendar, the free trial, then the
 * dashboard. And the extension's hand-off for a new account: the extension
 * belongs to the browser, so whatever Canvas it holds waits for the student's
 * yes instead of filling the new account (src/lib/canvasExtension.ts).
 */

const now = new Date().toISOString();
const account = { id: '22222222-2222-4222-8222-222222222222', email: 'new@example.com', aud: 'authenticated', role: 'authenticated', created_at: now, app_metadata: {}, user_metadata: { full_name: 'New Student' } };
type Row = Record<string, unknown>;

const snapshot = (host = 'bcourses.berkeley.edu') => ({
  v: 1, host, syncedAt: new Date().toISOString(),
  courses: [{ id: 61, name: 'CS 61A Fall 2026', courseCode: 'CS 61A', weighted: false }],
  groups: [],
  assignments: [{ id: 1, courseId: 61, name: 'Hog project', dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), htmlUrl: `https://${host}/courses/61/assignments/1`, description: '', pointsPossible: 25, groupId: null, workflowState: 'unsubmitted' }],
  announcements: [],
});

interface Options {
  /** Where sign-up picks up, as if the page had reloaded partway. */
  progress?: Row;
  settings?: Row;
  /** Hosts this account already has in canvas_snapshots. */
  connected?: string[];
  subscription?: Row;
  calendars?: Row[];
  createdAt?: string;
}

async function setup(page: Page, o: Options = {}) {
  const saved: Row[] = [];
  const deleted: string[] = [];
  const user = { ...account, created_at: o.createdAt ?? now };
  await page.addInitScript(({ a, progress }) => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
    if (progress && !sessionStorage.getItem('soma_ob_seeded')) {
      sessionStorage.setItem('soma_ob_progress', JSON.stringify(progress));
      sessionStorage.setItem('soma_ob_seeded', '1');
    }
  }, { a: user, progress: o.progress ?? null });
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: user });
    if (table === 'settings') {
      if (req.method() !== 'GET') return route.fulfill({ json: null });
      return route.fulfill({ json: { data: { theme: 'light', ...(o.settings ?? {}) } } });
    }
    if (table === 'canvas_snapshots') {
      if (req.method() === 'POST') saved.push(req.postDataJSON() as Row);
      if (req.method() === 'DELETE') deleted.push(url.search);
      return route.fulfill({ json: req.method() === 'GET' ? (o.connected ?? []).map(host => ({ host, payload: null })) : [] });
    }
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: o.subscription ?? { status: 'free' } }));
  await page.route('**/api/google-calendar-connections', r => {
    const body = r.request().postDataJSON() as { action?: string };
    if (body.action === 'list') return r.fulfill({ json: { connections: o.calendars ?? [] } });
    if (body.action === 'list_calendars') return r.fulfill({ json: { calendars: [{ id: 'main', summary: 'Me', primary: true }, { id: 'hol', summary: 'Holidays' }] } });
    return r.fulfill({ json: { ok: true } });
  });
  return { saved, deleted };
}

const extensionSays = (page: Page, msg: Row) =>
  page.evaluate(m => window.postMessage({ source: 'soma-extension', ...m }, window.location.origin), msg);

const onCanvasStep = { step: 3, birthday: '2006-05-01', education: 'college' };

test('a new account does not take the Canvas the extension already has until the student says yes', async ({ page }) => {
  const { saved } = await setup(page, { progress: onCanvasStep });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Bring in Canvas' })).toBeVisible();

  await extensionSays(page, { type: 'present', version: '1.4.0' });
  await extensionSays(page, { type: 'canvas_snapshot', snapshot: snapshot() });

  await expect(page.getByText(/already has Canvas from/)).toContainText('bcourses.berkeley.edu');
  await page.waitForTimeout(300);
  expect(saved).toHaveLength(0);
  await expect(page.getByText('You’re connected')).toHaveCount(0);

  await page.getByRole('button', { name: 'Yes, use it' }).click();
  await expect(page.getByText('You’re connected')).toBeVisible();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({ user_id: account.id, host: 'bcourses.berkeley.edu' });
});

test('another account’s Canvas left in this browser does not show for a new sign-in', async ({ page }) => {
  await page.addInitScript(s => {
    if (sessionStorage.getItem('soma_left_over')) return;
    sessionStorage.setItem('soma_left_over', '1');
    localStorage.setItem('soma_local_owner', '99999999-9999-4999-8999-999999999999');
    localStorage.setItem('soma_canvas_deep_sync', JSON.stringify({ [s.host]: s }));
  }, snapshot('djusd.instructure.com'));
  await setup(page, { progress: onCanvasStep });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Bring in Canvas' })).toBeVisible();
  await expect(page.getByText('Add Soma for Canvas to Chrome')).toBeVisible();
  await expect(page.getByText(/djusd\.instructure\.com/)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('soma_canvas_deep_sync'))).toBeNull();
});

test('the walkthrough video is whole: the sign-up card starts at the top on a short window', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await setup(page, { progress: onCanvasStep });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Bring in Canvas' })).toBeVisible();
  const logo = await page.getByText('Soma', { exact: true }).first().boundingBox();
  expect(logo!.y).toBeGreaterThanOrEqual(0);
  // Nothing is above the scroll start.
  expect(await page.evaluate(() => {
    const overlay = document.querySelector('[class*="overlay"]')!;
    return overlay.firstElementChild!.getBoundingClientRect().top - overlay.getBoundingClientRect().top;
  })).toBeGreaterThanOrEqual(0);
});

test('Google Calendar and the free trial come after Canvas, and each can be skipped', async ({ page }) => {
  await setup(page, { progress: onCanvasStep });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Skip for now' }).click();

  await expect(page.getByRole('heading', { name: 'Add your Google Calendar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Google Calendar' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();

  await expect(page.getByRole('heading', { name: /Try everything free/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start free trial' })).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();

  await expect(page.getByRole('heading', { name: /You're all set/ })).toBeVisible();
});

test('a connected Google account shows, and its main calendar is picked for the student', async ({ page }) => {
  const picked: Row[] = [];
  await setup(page, { progress: { ...onCanvasStep, step: 4 }, calendars: [{ id: 'c1', googleEmail: 'new@gmail.com', selectedCalendars: [], createdAt: now }] });
  await page.route('**/api/google-calendar-connections', async r => {
    const body = r.request().postDataJSON() as { action?: string };
    if (body.action === 'update_selected') picked.push(body as Row);
    await r.fallback();
  });
  await page.goto('/settings');
  await expect(page.getByText('new@gmail.com')).toBeVisible();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await expect.poll(() => picked.length).toBe(1);
  expect(picked[0]).toMatchObject({ connectionId: 'c1', calendars: [{ id: 'main', primary: true }] });
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: /Try everything free/ })).toBeVisible();
});

test('the trial step is skipped for an account that already had a trial', async ({ page }) => {
  await setup(page, { progress: { ...onCanvasStep, step: 4 }, subscription: { status: 'trialing', trial_start: now } });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('heading', { name: /You're all set/ })).toBeVisible();
});

test('sign-up picks up after leaving for Google, even past the five minutes a new account gets', async ({ page }) => {
  await setup(page, { progress: { ...onCanvasStep, step: 4 }, createdAt: '2026-01-01T00:00:00Z' });
  await page.goto('/settings?gcal_connected=new%40gmail.com');
  await expect(page.getByRole('heading', { name: 'Add your Google Calendar' })).toBeVisible();
});

test('a free account is not asked to start a trial every time it opens Soma', async ({ page }) => {
  await setup(page, { settings: { onboardingCompleted: true, walkthroughCompleted: true }, createdAt: '2026-01-01T00:00:00Z' });
  await page.goto('/dashboard');
  await page.waitForTimeout(800);
  await expect(page.getByText('Start your free trial')).toHaveCount(0);
});

test('Settings disconnects one Canvas site, and it can be connected again', async ({ page }) => {
  const { saved, deleted } = await setup(page, { settings: { onboardingCompleted: true, walkthroughCompleted: true }, connected: ['bcourses.berkeley.edu'], createdAt: '2026-01-01T00:00:00Z' });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Integrations' }).click();
  // Signed in and listening, as when the extension answers the app's hello.
  await expect(page.getByRole('link', { name: 'Add to Chrome' })).toBeVisible();
  await extensionSays(page, { type: 'present', version: '1.4.0' });
  await extensionSays(page, { type: 'canvas_snapshot', snapshot: snapshot() });
  await expect(page.getByText('bcourses.berkeley.edu')).toBeVisible();
  await expect.poll(() => saved.length).toBe(1);

  page.once('dialog', d => void d.accept());
  await page.getByRole('button', { name: 'Disconnect' }).first().click();
  await expect.poll(() => deleted.length).toBe(1);
  expect(deleted[0]).toContain(`user_id=eq.${account.id}`);
  expect(deleted[0]).toContain('host=eq.bcourses.berkeley.edu');
  await expect(page.getByText('In this browser, not on this account')).toBeVisible();

  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.poll(() => saved.length).toBe(2);
  await expect(page.getByText('In this browser, not on this account')).toHaveCount(0);
});
