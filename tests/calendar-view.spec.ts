import { test, expect } from '@playwright/test';
import {
  nextAnchors, isTodayVisible, getFirstOfMonth, getSundayOfWeek, addDays, startOfDay,
  type CalendarView, type ViewAnchors,
} from '../src/lib/calendarView';

// Fixed reference point: Thursday 17 September 2026.
const TODAY = new Date(2026, 8, 17);
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const key = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

/** Anchors as they would be while looking at a given view. */
function anchorsFor(view: CalendarView, at: Date): ViewAnchors {
  return {
    month: getFirstOfMonth(at),
    rangeStart: view === 'week' ? getSundayOfWeek(at) : startOfDay(at),
    originMonth: getFirstOfMonth(at),
  };
}

test('isTodayVisible reflects what is on screen', () => {
  expect(isTodayVisible('month', anchorsFor('month', d(2026, 9, 1)), TODAY)).toBe(true);
  expect(isTodayVisible('month', anchorsFor('month', d(2026, 12, 1)), TODAY)).toBe(false);

  // Week of Sun 13 Sep contains Thu 17 Sep.
  expect(isTodayVisible('week', anchorsFor('week', d(2026, 9, 17)), TODAY)).toBe(true);
  expect(isTodayVisible('week', anchorsFor('week', d(2026, 9, 27)), TODAY)).toBe(false);

  // Three days from the 17th includes today; from the 18th it does not.
  expect(isTodayVisible('threeDay', anchorsFor('threeDay', d(2026, 9, 17)), TODAY)).toBe(true);
  expect(isTodayVisible('threeDay', anchorsFor('threeDay', d(2026, 9, 15)), TODAY)).toBe(true);  // 15,16,17
  expect(isTodayVisible('threeDay', anchorsFor('threeDay', d(2026, 9, 18)), TODAY)).toBe(false);
});

// The twelve rows of the switching table.
const cases: Array<{
  name: string; from: CalendarView; to: CalendarView; at: Date;
  expectMonth?: string; expectStart?: string;
}> = [
  // Today visible → anchor on today.
  { name: 'month → week, today on screen',      from: 'month',    to: 'week',     at: d(2026, 9, 1),  expectStart: '2026-09-13' },
  { name: 'month → 3-day, today on screen',     from: 'month',    to: 'threeDay', at: d(2026, 9, 1),  expectStart: '2026-09-17' },
  { name: 'week → 3-day, today on screen',      from: 'week',     to: 'threeDay', at: d(2026, 9, 17), expectStart: '2026-09-17' },
  { name: 'week → month, today on screen',      from: 'week',     to: 'month',    at: d(2026, 9, 17), expectMonth: '2026-09-01' },
  { name: '3-day → week, today on screen',      from: 'threeDay', to: 'week',     at: d(2026, 9, 17), expectStart: '2026-09-13' },
  { name: '3-day → month, today on screen',     from: 'threeDay', to: 'month',    at: d(2026, 9, 17), expectMonth: '2026-09-01' },

  // Today not visible → keep the range being looked at.
  { name: 'month → week, today elsewhere',      from: 'month',    to: 'week',     at: d(2026, 12, 1), expectStart: '2026-11-29' },
  { name: 'month → 3-day, today elsewhere',     from: 'month',    to: 'threeDay', at: d(2026, 12, 1), expectStart: '2026-12-01' },
  { name: 'week → 3-day, today elsewhere',      from: 'week',     to: 'threeDay', at: d(2026, 12, 9), expectStart: '2026-12-06' },
  { name: 'week → month, today elsewhere',      from: 'week',     to: 'month',    at: d(2026, 12, 9), expectMonth: '2026-12-01' },
  { name: '3-day → week, today elsewhere',      from: 'threeDay', to: 'week',     at: d(2026, 12, 9), expectStart: '2026-12-06' },
  { name: '3-day → month, today elsewhere',     from: 'threeDay', to: 'month',    at: d(2026, 12, 9), expectMonth: '2026-12-01' },
];

for (const c of cases) {
  test(`switching: ${c.name}`, () => {
    const next = nextAnchors(c.to, c.from, anchorsFor(c.from, c.at), TODAY);
    if (c.expectStart) expect(key(next.rangeStart)).toBe(c.expectStart);
    if (c.expectMonth) expect(key(next.month)).toBe(c.expectMonth);
  });
}

test('the three-day view starts on today rather than centring it', () => {
  const next = nextAnchors('threeDay', 'month', anchorsFor('month', d(2026, 9, 1)), TODAY);
  expect(key(next.rangeStart)).toBe('2026-09-17');
  expect(key(addDays(next.rangeStart, 2))).toBe('2026-09-19');
});

test('a week straddling two months returns to the month it was opened from', () => {
  // Week of Sun 29 Nov 2026 runs into December.
  const anchors: ViewAnchors = {
    month: getFirstOfMonth(d(2026, 11, 1)),
    rangeStart: getSundayOfWeek(d(2026, 11, 30)),
    originMonth: getFirstOfMonth(d(2026, 11, 1)),
  };
  expect(key(nextAnchors('month', 'week', anchors, TODAY).month)).toBe('2026-11-01');
});

test('switching views repeatedly while on today keeps landing on today', () => {
  let anchors = anchorsFor('month', d(2026, 9, 1));
  anchors = nextAnchors('week', 'month', anchors, TODAY);
  expect(key(anchors.rangeStart)).toBe('2026-09-13');
  anchors = nextAnchors('threeDay', 'week', anchors, TODAY);
  expect(key(anchors.rangeStart)).toBe('2026-09-17');
  anchors = nextAnchors('month', 'threeDay', anchors, TODAY);
  expect(key(anchors.month)).toBe('2026-09-01');
  anchors = nextAnchors('week', 'month', anchors, TODAY);
  expect(key(anchors.rangeStart)).toBe('2026-09-13');
});

// ── In the browser ────────────────────────────────────────────────────────

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };

async function openCalendar(page: import('@playwright/test').Page) {
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (table === 'subjects') return route.fulfill({ json: [{ id: 'bio', user_id: account.id, name: 'Biology', color: '#66bb6a', archived: false }] });
    const single = req.headers().accept?.includes('vnd.pgrst.object');
    return route.fulfill({ json: single ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/google-calendar-connections', r => r.fulfill({ json: { connections: [] } }));
  await page.goto('/calendar');
}

/** The day-number cells across the timed grid's header. */
function dayHeaders(page: import('@playwright/test').Page) {
  return page.locator('[class*="weekViewDayHeader"]');
}

test('the three-day view shows today first and steps three days at a time', async ({ page }) => {
  await openCalendar(page);
  await page.getByRole('button', { name: '3 days', exact: true }).click();

  await expect(dayHeaders(page)).toHaveCount(3);
  const today = new Date();
  await expect(dayHeaders(page).first()).toContainText(String(today.getDate()));

  await page.getByRole('button', { name: 'Next three days' }).click();
  const plus3 = new Date(today); plus3.setDate(plus3.getDate() + 3);
  await expect(dayHeaders(page).first()).toContainText(String(plus3.getDate()));

  await page.getByRole('button', { name: 'Previous three days' }).click();
  await expect(dayHeaders(page).first()).toContainText(String(today.getDate()));
});

test('switching views while today is on screen always lands on today', async ({ page }) => {
  await openCalendar(page);
  const today = new Date();

  // Month opens on the current month, so today is visible throughout.
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await expect(dayHeaders(page)).toHaveCount(7);
  await expect(page.locator('[class*="weekViewDayNumToday"]')).toBeVisible();

  await page.getByRole('button', { name: '3 days', exact: true }).click();
  await expect(dayHeaders(page)).toHaveCount(3);
  await expect(dayHeaders(page).first()).toContainText(String(today.getDate()));

  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await expect(page.locator('[class*="weekViewDayNumToday"]')).toBeVisible();
});

test('browsing to another month and switching keeps that month, not today', async ({ page }) => {
  await openCalendar(page);
  const title = page.locator('[class*="navTitle"]');
  const startTitle = await title.innerText();

  // Three months forward: today is no longer on screen.
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next month' }).click();
  const awayTitle = await title.innerText();
  expect(awayTitle).not.toBe(startTitle);

  await page.getByRole('button', { name: '3 days', exact: true }).click();
  await expect(dayHeaders(page)).toHaveCount(3);
  // Anchored on the 1st of that month, not today.
  await expect(dayHeaders(page).first()).toContainText('1');
  await expect(page.locator('[class*="weekViewDayNumToday"]')).toHaveCount(0);
});

test('the three-day view has no horizontal overflow at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openCalendar(page);
  await page.getByRole('button', { name: '3 days', exact: true }).click();
  await expect(dayHeaders(page)).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
