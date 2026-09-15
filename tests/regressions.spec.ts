import { test, expect, type Page } from '@playwright/test';

const user = {
  id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com',
  aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z',
  app_metadata: {}, user_metadata: {},
};
const assignments = [{
  id: 123, name: 'Homework', courseId: 456, courseName: 'Biology 101',
  dueAt: '2026-09-20T18:00:00Z', htmlUrl: '', status: 'not_started',
}];

async function setup(page: Page, status = 'active', initialSubjects: Record<string, unknown>[] = [], onboarding = false) {
  const account = { ...user, created_at: onboarding ? new Date().toISOString() : user.created_at };
  const state = { status, failBilling: false, failSubjects: false, subjects: initialSubjects, deletes: 0 };
  await page.addInitScript(({ user }) => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({
      access_token: 'test-token', refresh_token: 'test-refresh', token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user,
    }));
  }, { user: account });
  await page.route('https://soma-regression.supabase.co/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.includes('/auth/v1/')) {
      await route.fulfill({ json: account });
      return;
    }
    const table = url.pathname.split('/').pop();
    if (table === 'subjects') {
      if (req.method() === 'DELETE') { state.deletes++; }
      if (req.method() === 'POST') {
        if (state.failSubjects) {
          await route.fulfill({ status: 500, json: { message: 'Course save failed' } });
          return;
        }
        const rows = req.postDataJSON();
        for (const row of Array.isArray(rows) ? rows : [rows]) {
          const index = state.subjects.findIndex(s => s.id === row.id);
          if (index < 0) state.subjects.push(row);
          else state.subjects[index] = row;
        }
      }
      await route.fulfill({ json: state.subjects });
    } else if (table === 'settings') {
      await route.fulfill({ json: { data: { onboardingCompleted: !onboarding } } });
    } else {
      const single = req.headers().accept?.includes('vnd.pgrst.object');
      await route.fulfill({ json: single ? null : [] });
    }
  });
  await page.route('**/api/stripe', route => route.fulfill({
    status: state.failBilling ? 503 : 200,
    json: state.failBilling ? { error: 'Temporarily unavailable' } : { status: state.status },
  }));
  await page.route('**/api/canvas-ical', route => route.fulfill({ json: { assignments } }));
  return state;
}

async function authRefresh(page: Page) {
  await page.evaluate(async () => {
    // Exercise the real Supabase auth listener with a fresh user object.
    // @ts-expect-error Vite serves this browser-only module at runtime.
    const { supabase } = await import('/src/lib/supabase.ts');
    const { data: { session } } = await supabase.auth.getSession();
    await supabase.auth._notifyAllSubscribers('SIGNED_IN', {
      ...session, user: { ...session.user },
    });
  });
}

for (const entry of ['canvas', 'settings']) {
  test(`connecting Canvas from ${entry} persists courses visible in Day View`, async ({ page }) => {
    const state = await setup(page);
    await page.goto(`/${entry}`);
    if (entry === 'settings') {
      await page.getByRole('button', { name: 'Integrations', exact: true }).click();
      await page.getByRole('button', { name: 'Connect', exact: true }).first().click();
    }
    await page.getByPlaceholder(/https:\/\/.*instructure/).fill('https://school.instructure.com/feed.ics');
    await page.getByRole('button', { name: /^(Connect|Connect Canvas)$/ }).last().click();
    await expect.poll(() => state.subjects.length).toBe(1);
    await page.getByRole('button', { name: 'Day View', exact: true }).click();
    await expect(page.getByText('Biology 101', { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText('Biology 101', { exact: true }).first()).toBeVisible();
    expect(state.subjects).toHaveLength(1);
    expect(state.deletes).toBe(0);
  });
}

test('dismissed payment prompt stays closed after auth refresh and navigation', async ({ page }) => {
  await setup(page, 'free');
  await page.goto('/day-view');
  await page.getByRole('button', { name: /Skip for now/ }).click();
  await authRefresh(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start your free trial' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Day View', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start your free trial' })).toHaveCount(0);
});

test('failed billing lookup never prompts an existing user to pay', async ({ page }) => {
  const state = await setup(page);
  state.failBilling = true;
  await page.goto('/day-view');
  await expect(page.getByRole('button', { name: 'Day View', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: /subscription/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start your free trial' })).toHaveCount(0);
  state.failBilling = false;
  await page.getByRole('button', { name: /Retry/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: /subscription/i })).toHaveCount(0);
});

test('paywall resolving after loading does not crash React', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await setup(page, 'past_due');
  await page.goto('/day-view');
  await expect(page.getByText('Something went wrong.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /payment|billing|resubscribe|update/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test('opening Day View preserves archived and manual subjects', async ({ page }) => {
  const state = await setup(page, 'active', [
    { id: 'archived', name: 'Old course', archived: true, color: '#ef5350' },
    { id: 'manual', name: 'Math', archived: false, color: '#42a5f5' },
  ]);
  await page.goto('/settings');
  await page.evaluate(async assignments => {
    // @ts-expect-error Vite serves this browser-only module at runtime.
    const { storage } = await import('/src/lib/storage.ts');
    await storage.fetchSubjects();
    storage.setCachedIcalAssignments(assignments);
  }, assignments);
  await page.getByRole('button', { name: 'Day View', exact: true }).click();
  await expect(page.getByText('Math', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  expect(state.deletes).toBe(0);
});

test('failed course persistence shows a sync error instead of success', async ({ page }) => {
  const state = await setup(page);
  state.failSubjects = true;
  await page.goto('/canvas');
  await page.getByPlaceholder(/https:\/\/.*instructure/).fill('https://school.instructure.com/feed.ics');
  await page.getByRole('button', { name: /^(Connect|Connect Canvas)$/ }).click();
  await expect(page.getByText(/Course save failed/)).toBeVisible();
  expect(state.subjects).toHaveLength(0);
});

test('repeat Canvas sync preserves renamed, archived and manual courses', async ({ page }) => {
  const existing = [
    { id: 'canvas', canvas_course_id: 456, name: 'My biology', archived: true, source: 'canvas', color: '#ef5350' },
    { id: 'manual', name: 'Math', archived: false, source: 'manual', color: '#42a5f5' },
  ];
  const state = await setup(page, 'active', structuredClone(existing));
  await page.goto('/canvas');
  await page.evaluate(async assignments => {
    // @ts-expect-error Vite serves this browser-only module at runtime.
    const { storage } = await import('/src/lib/storage.ts');
    await Promise.all([storage.syncCanvasSubjects(assignments), storage.syncCanvasSubjects(assignments)]);
  }, assignments);
  expect(state.subjects).toEqual(existing);
  expect(state.deletes).toBe(0);
});

test('paying users keep access through a failed refresh and recover on retry', async ({ page }) => {
  const state = await setup(page, 'active');
  await page.goto('/day-view');
  await expect(page.getByRole('button', { name: 'AI', exact: true }).getByLabel('Premium')).toHaveCount(0);
  state.failBilling = true;
  await authRefresh(page);
  await expect(page.getByRole('alert').filter({ hasText: /subscription/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start your free trial' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'AI', exact: true }).getByLabel('Premium')).toHaveCount(0);
  state.failBilling = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /subscription/i })).toHaveCount(0);
});

test('subscription is refreshed after a free user completes checkout in another tab', async ({ page }) => {
  const state = await setup(page, 'free');
  await page.goto('/day-view');
  await page.getByRole('button', { name: /Skip for now/ }).click();
  state.status = 'active';
  await authRefresh(page);
  await expect(page.getByRole('button', { name: 'AI', exact: true }).getByLabel('Premium')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Start your free trial' })).toHaveCount(0);
});


test('onboarding Canvas sync creates courses in the already mounted Day View', async ({ page }) => {
  const state = await setup(page, 'active', [], true);
  await page.goto('/day-view?onboarding_source=canvas');
  await expect(page.getByRole('heading', { name: 'Connect your tools' })).toBeVisible();
  await page.getByPlaceholder(/https:\/\/.*instructure/).fill('https://school.instructure.com/feed.ics');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.poll(() => state.subjects.length).toBe(1);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start using Soma', exact: true }).click();
  await expect(page.getByText('Biology 101', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start your free trial' })).toHaveCount(0);
});
