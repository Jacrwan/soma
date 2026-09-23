import { test, expect, type Page } from '@playwright/test';

const account = {
  id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com',
  aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z',
  app_metadata: {}, user_metadata: {},
};
const today = new Date();
const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const session = {
  id: 'session-1', date, subject_id: 'biology', subject_name: 'Biology',
  task_text: 'Homework', start_time: `${date}T12:00:00`, duration_seconds: 3600,
};

async function setup(page: Page) {
  let unblock: () => void = () => {};
  const state = {
    requests: 0, fail: false, sessions: [session], gate: Promise.resolve(),
    hold() { state.gate = new Promise<void>(resolve => { unblock = resolve; }); },
    release() { unblock(); state.gate = Promise.resolve(); },
  };
  await page.addInitScript(account => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({
      access_token: 'test-token', refresh_token: 'test-refresh', token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: account,
    }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.includes('/auth/v1/')) {
      await route.fulfill({ json: account });
      return;
    }
    const table = url.pathname.split('/').pop();
    if (table === 'timer_sessions') {
      if (req.method() === 'POST') {
        state.sessions.push(req.postDataJSON());
        await route.fulfill({ json: null });
        return;
      }
      state.requests++;
      await state.gate;
      if (state.fail) {
        await route.fulfill({ status: 500, json: { message: 'Database temporarily unavailable' } });
        return;
      }
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 1000);
      await route.fulfill({ json: state.sessions.slice(offset, offset + limit) });
    } else if (table === 'subjects') {
      await route.fulfill({ json: [{ id: 'biology', name: 'Biology', color: '#42a5f5', archived: false }] });
    } else if (table === 'todos') {
      await route.fulfill({ json: [{ id: 'homework', text: 'Homework', subject_id: 'biology', estimated_minutes: 30 }] });
    } else if (table === 'settings') {
      await route.fulfill({ json: { data: { onboardingCompleted: true } } });
    } else {
      await route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
    }
  });
  await page.route('**/api/stripe', route => route.fulfill({ json: { status: 'active' } }));
  return state;
}

const summary = (page: Page) => page.getByLabel('Insights summary');

test('first load stays in loading state until study data arrives', async ({ page }) => {
  const state = await setup(page);
  state.hold();
  try {
    await page.goto('/insights');
    await expect.poll(() => state.requests).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: 'No study data yet' })).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Loading your insights…');
    state.release();
    await expect(summary(page)).toContainText('1h');
    expect(state.requests).toBe(1);
  } finally { state.release(); }
});

test('returning to Insights immediately reuses cached data without refetching', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/insights');
  await expect(summary(page)).toContainText('1h');
  const requests = state.requests;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  state.hold();
  try {
    await page.getByRole('button', { name: 'Insights', exact: true }).click();
    await expect(summary(page)).toContainText('1h');
    await expect(page.getByRole('heading', { name: 'No study data yet' })).toHaveCount(0);
    expect(state.requests).toBe(requests);
  } finally { state.release(); }
});

test('a failed load is an error with retry, not an empty account', async ({ page }) => {
  const state = await setup(page);
  state.fail = true;
  await page.goto('/insights');
  await expect(page.getByRole('alert')).toContainText('Could not load insights');
  await expect(page.getByRole('heading', { name: 'No study data yet' })).toHaveCount(0);
  state.fail = false;
  await page.getByRole('button', { name: 'Retry insights', exact: true }).click();
  await expect(summary(page)).toContainText('1h');
});

test('week and month navigation calculate from the loaded data without more queries', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/insights');
  await expect(summary(page)).toContainText('1h');
  const requests = state.requests;
  await page.getByRole('button', { name: 'Previous week', exact: true }).click();
  await expect(summary(page)).toContainText('0m');
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(summary(page)).toContainText('1h');
  await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  expect(state.requests).toBe(requests);
});

test('saved study time invalidates the cache even while Insights is unmounted', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/insights');
  await expect(summary(page)).toContainText('1h');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.evaluate(async ({ date }) => {
    // @ts-expect-error Browser-only module served by Vite.
    const { storage } = await import('/src/lib/storage.ts');
    await storage.saveTimerSession({
      id: 'session-2', subjectId: 'biology', task: 'Revision',
      startTime: `${date}T13:00:00Z`, endTime: `${date}T14:00:00Z`, durationSeconds: 3600,
    }, 'Biology');
  }, { date });
  state.hold();
  try {
    await page.getByRole('button', { name: 'Insights', exact: true }).click();
    await expect(summary(page)).toContainText('1h');
    state.release();
    await expect(summary(page)).toContainText('2h');
  } finally { state.release(); }
});

test('session history is paginated rather than silently capped at 1000 rows', async ({ page }) => {
  const state = await setup(page);
  state.sessions = Array.from({ length: 1001 }, (_, i) => ({ ...session, id: `session-${i}`, duration_seconds: 60 }));
  await page.goto('/insights');
  await expect(summary(page)).toContainText('16h 41m');
  expect(state.requests).toBe(2);
});

test('confirmed empty accounts show the empty message only after loading', async ({ page }) => {
  const state = await setup(page);
  state.sessions = [];
  await page.goto('/insights');
  await expect(page.getByRole('heading', { name: 'No study data yet' })).toBeVisible();
});

test('failed background refresh keeps previously loaded charts visible', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/insights');
  await expect(summary(page)).toContainText('1h');
  state.fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event('soma_insights_changed')));
  await expect(page.getByRole('alert')).toContainText('Could not load insights');
  await expect(summary(page)).toContainText('1h');
  await expect(page.getByRole('heading', { name: 'No study data yet' })).toHaveCount(0);
  state.fail = false;
  await page.getByRole('button', { name: 'Retry insights', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('changing accounts never displays the previous account cached data', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/insights');
  await expect(summary(page)).toContainText('1h');
  state.sessions = [];
  state.hold();
  try {
    await page.evaluate(async () => {
      // @ts-expect-error Browser-only module served by Vite.
      const { supabase } = await import('/src/lib/supabase.ts');
      const { data: { session } } = await supabase.auth.getSession();
      await supabase.auth._notifyAllSubscribers('SIGNED_IN', {
        ...session, user: { ...session.user, id: '22222222-2222-4222-8222-222222222222' },
      });
    });
    await expect(page.getByRole('status')).toContainText('Loading your insights…');
    await expect(summary(page)).toHaveCount(0);
    state.release();
    await expect(page.getByRole('heading', { name: 'No study data yet' })).toBeVisible();
  } finally { state.release(); }
});

test('expired cache renders immediately while refreshing in the background', async ({ page }) => {
  const state = await setup(page);
  await page.clock.install();
  await page.goto('/insights');
  await expect(summary(page)).toContainText('1h');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.clock.fastForward(31_000);
  state.sessions.push({ ...session, id: 'new-session' });
  state.hold();
  try {
    await page.getByRole('button', { name: 'Insights', exact: true }).click();
    await expect(summary(page)).toContainText('1h');
    state.release();
    await expect(summary(page)).toContainText('2h');
  } finally { state.release(); }
});

test('consolidated data preserves the calculations for every chart', async ({ page }) => {
  await setup(page);
  await page.goto('/insights');
  await expect(summary(page)).toContainText('1h');
  const metrics = await page.evaluate(async () => {
    // @ts-expect-error Browser-only module served by Vite.
    const { summarizeInsights } = await import('/src/lib/insights.ts');
    return summarizeInsights({
      subjects: [{ id: 'biology', name: 'Renamed biology', color: '#42a5f5', archived: true }],
      todos: [20, 40, 60].map((minutes, i) => ({ id: String(i), text: `Task ${i}`, subject_id: 'biology', estimated_minutes: minutes })),
      sessions: [30, 50, 60].map((minutes, i) => ({
        id: String(i), date: i === 2 ? '2026-09-14' : '2026-09-13',
        subject_id: 'biology', subject_name: 'Old name', task_text: `Task ${i}`,
        start_time: `2026-09-14T${String(i + 9).padStart(2, '0')}:00:00`, duration_seconds: minutes * 60,
      })),
    }, 0, 0, new Date(2026, 8, 14));
  });
  expect(metrics.weekly.map((day: { minutes: number }) => day.minutes)).toEqual([0, 0, 0, 0, 0, 80, 60]);
  expect(metrics.breakdown).toEqual([{ subjectName: 'Renamed biology', color: '#42a5f5', minutes: 140 }]);
  expect(metrics.estimated.map((row: { actual: number }) => row.actual)).toEqual([30, 50, 60]);
  expect(metrics.streak).toBe(2);
  expect(metrics.heatmapMinutesMap).toEqual({ 13: 80, 14: 60 });
  expect(metrics.peakHoursData).toEqual({ 9: 30, 10: 50, 11: 60 });
  expect(metrics.subjectPacingData).toEqual({ biology: 47 });
  expect(metrics.timeAccuracyData).toEqual({ biology: { avgDeltaMinutes: 7, sampleCount: 3 } });
});

/**
 * The calendar shaded days by how long was studied and never said what a
 * shade meant, so a darker square was a guess.
 */
test('the calendar says what each shade is worth', async ({ page }) => {
  await setup(page);
  await page.goto('/insights');
  await expect(summary(page)).toBeVisible();

  // Every step of the scale the cells use, labelled with the most time that
  // still lands on it.
  for (const label of ['0', '2h', '4h', '6h', '6h+']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText('Less', { exact: true })).toBeVisible();
  await expect(page.getByText('More', { exact: true })).toBeVisible();
});
