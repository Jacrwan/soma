import { test, expect, type Page } from '@playwright/test';
import { readHabits, toggleDay, weekDays, doneThisWeek, habitLines, habitId, dayKey } from '../src/lib/habits';
import { setup, ask } from './event-day';

// Habits (2026-11-05), in place of a weekly routine: "a habit thing ... as
// like a widget thing for the gym and eat healthy type of stuff". A weekly
// target, not a streak: "Gym, 6 a week" leaves Sunday off. Kept in settings.
// Soma knows them and this week's count, and never makes blocks for them.

// A Wednesday, so the week has days behind it and ahead of it.
const WED = new Date('2026-11-04T15:00:00');

test('habits from settings are checked, and only ten weeks of check-offs are kept', () => {
  const h = readHabits({
    items: [
      { id: 'gym', title: '  Gym  ', perWeek: 6 },
      { id: 'eat-healthy', title: 'Eat healthy', perWeek: 7 },
      { id: 'gym', title: 'Duplicate id', perWeek: 3 },
      { id: 'BAD ID', title: 'Bad', perWeek: 3 },
      { id: 'zero', title: 'Zero', perWeek: 0 },
    ],
    done: { gym: ['2026-11-03', '2026-11-03', '2026-08-01', '2026-11-09', 'yesterday'], ghost: ['2026-11-03'] },
  }, WED);
  expect(h.items).toEqual([{ id: 'gym', title: 'Gym', perWeek: 6 }, { id: 'eat-healthy', title: 'Eat healthy', perWeek: 7 }]);
  // No repeats, nothing older than ten weeks, nothing in the future, nothing for a habit that's gone.
  expect(h.done).toEqual({ gym: ['2026-11-03'], 'eat-healthy': [] });
  expect(readHabits('nonsense')).toEqual({ items: [], done: {} });
  expect(habitId('Gym', h.items)).toBe('gym-2');
});

test('a week runs Monday to Sunday; a day can be checked and unchecked, never in the future', () => {
  expect(weekDays(WED)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  let h = readHabits({ items: [{ id: 'gym', title: 'Gym', perWeek: 6 }], done: { gym: ['2026-11-01'] } }, WED);
  h = toggleDay(h, 'gym', '2026-11-02', WED);
  h = toggleDay(h, 'gym', '2026-11-04', WED);
  h = toggleDay(h, 'gym', '2026-11-06', WED);
  h = toggleDay(h, 'nope', '2026-11-04', WED);
  // Last Sunday doesn't count for this week.
  expect(doneThisWeek(h, 'gym', WED)).toBe(2);
  expect(habitLines(h, WED)).toEqual(['Gym · 6 a week · 2 so far this week · done today']);
  h = toggleDay(h, 'gym', '2026-11-04', WED);
  expect(habitLines(h, WED)).toEqual(['Gym · 6 a week · 1 so far this week · not yet today']);
});

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };

/** The dashboard with the Habits widget on it; settings live in `server`. */
async function dashboard(page: Page, server: Record<string, unknown>) {
  const posts: Record<string, unknown>[] = [];
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') {
      if (req.method() === 'POST') { const b = req.postDataJSON(); posts.push(b.data); Object.assign(server, b.data); return route.fulfill({ json: null }); }
      return route.fulfill({ json: { data: server } });
    }
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/memory', r => r.fulfill({ json: { revision: 0, enabled: true, entries: [] } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.goto('/dashboard');
  return posts;
}
const withWidget = { onboardingCompleted: true, theme: 'light', walkthroughCompleted: true, canvasIcalUrl: 'https://example.instructure.com/feed.ics', dashboardLayout: [{ id: 'plan', size: 'xl', x: 0, y: 0 }, { id: 'habits', size: 'small', x: 2, y: 0 }] };

test('the Habits widget: add a habit, check off today, fix another day, and it saves without touching other settings', async ({ page }) => {
  const server: Record<string, unknown> = { ...withWidget };
  const posts = await dashboard(page, server);
  const widget = page.getByRole('region', { name: 'Habits' });
  await expect(widget).toContainText('Things you want to keep up');
  await widget.getByLabel('Habit name').fill('Gym');
  await widget.getByLabel('Times a week').selectOption('6');
  await widget.getByRole('button', { name: 'Add' }).click();
  await expect(widget.getByLabel('0 of 6 this week')).toBeVisible();
  await widget.getByRole('button', { name: 'Gym: done today' }).click();
  await expect(widget.getByRole('button', { name: 'Gym: done today' })).toHaveAttribute('aria-pressed', 'true');
  await expect(widget.getByLabel('1 of 6 this week')).toBeVisible();
  const today = dayKey(new Date());
  await expect.poll(() => (posts.at(-1)?.habits as { done?: Record<string, string[]> } | undefined)?.done?.gym).toEqual([today]);
  expect(posts.at(-1)).toMatchObject({ canvasIcalUrl: 'https://example.instructure.com/feed.ics', habits: { items: [{ id: 'gym', title: 'Gym', perWeek: 6 }], done: { gym: [today] } } });
  // Tomorrow can't be checked yet (unless today is Sunday, the week's last day).
  const days = widget.getByRole('group', { name: 'Gym this week' }).getByRole('button');
  await expect(days).toHaveCount(7);
  const index = (new Date().getDay() + 6) % 7;
  if (index < 6) await expect(days.nth(index + 1)).toBeDisabled();
  await widget.getByRole('button', { name: 'Edit' }).click();
  await widget.getByRole('button', { name: 'Remove Gym' }).click();
  await expect(widget).toContainText('Things you want to keep up');
  await expect.poll(() => posts.at(-1)?.habits).toEqual({ items: [], done: {} });
});

test('habits checked on another device show here, and a failed save puts the check back', async ({ page }) => {
  const today = dayKey(new Date());
  const server: Record<string, unknown> = { ...withWidget, habits: { items: [{ id: 'eat-healthy', title: 'Eat healthy', perWeek: 7 }], done: { 'eat-healthy': [today] } } };
  await dashboard(page, server);
  const widget = page.getByRole('region', { name: 'Habits' });
  await expect(widget.getByRole('button', { name: 'Eat healthy: done today' })).toHaveAttribute('aria-pressed', 'true');
  await page.route('https://soma-regression.supabase.co/rest/v1/settings**', route => route.request().method() === 'POST' ? route.fulfill({ status: 500, json: { message: 'down' } }) : route.fulfill({ json: { data: server } }));
  await widget.getByRole('button', { name: 'Eat healthy: done today' }).click();
  await expect(widget.getByRole('alert')).toContainText("Couldn't save");
  await expect(widget.getByRole('button', { name: 'Eat healthy: done today' })).toHaveAttribute('aria-pressed', 'true');
});

test('Habits is in the Add widgets tray, and the plain demo dashboard has no Habits widget', async ({ page }) => {
  const { WIDGETS } = await import('../src/lib/dashboardLayout');
  expect(WIDGETS.find(w => w.id === 'habits')).toMatchObject({ name: 'Habits', size: 'small' });
  await page.goto('/dashboard-v2');
  await expect(page.getByRole('region', { name: 'Habits' })).toHaveCount(0);
});

test('Soma sees habits and this week\'s count, and is told never to make blocks for them', async ({ page }) => {
  let seen: Record<string, unknown> | undefined, system = '';
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'soma_settings') { const o = JSON.parse(v); if (o.habits === undefined) v = JSON.stringify({ ...o, habits: { items: [{ id: 'gym', title: 'Gym', perWeek: 6 }], done: { gym: [] } } }); }
      return write.call(this, k, v);
    };
  });
  await setup(page, (ctx, body) => { seen = ctx as unknown as Record<string, unknown>; system = JSON.stringify(body.systemPrompt); return { reply: 'ok' }; });
  await ask(page, 'how is my week going');
  await expect(page.getByRole('log')).toContainText('ok');
  expect(seen!.habits).toEqual(['Gym · 6 a week · 0 so far this week · not yet today']);
  expect(system).toContain('HABITS:');
  expect(system).toContain('never make blocks or tasks for them');
});
