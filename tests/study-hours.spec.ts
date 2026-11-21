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
      return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light', canvasIcalUrl: 'https://bcourses.example/feed.ics', educationLevel: 'college' } } });
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
  // Saving study hours used to replace every setting with this page's copy,
  // which wiped the Canvas feed link and made all Canvas deadlines vanish.
  expect(saved.at(-1)!.data).toMatchObject({ canvasIcalUrl: 'https://bcourses.example/feed.ics', educationLevel: 'college', onboardingCompleted: true });

  // Still off after a reload; turning it on brings the old times back.
  await page.reload();
  await page.getByRole('button', { name: 'Study hours' }).click();
  await expect(limit.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  await limit.getByRole('button', { name: 'On' }).click();
  await expect(page.getByLabel('Earliest start')).toHaveValue('10:00');
  await expect(page.getByLabel('Latest end')).toHaveValue('23:00');
  expect(await local()).toEqual({ start: '10:00', end: '23:00', off: false });
});

// 2026-11-21: "when i change the study time preferences (for example moving
// earliest start from 8am -> 10 am), it should prompt a question whether to
// move scheduled blocks to fit the preference or not." The time saves when the
// box is left, not on every keystroke.
test('changing study hours asks about blocks now outside them, and moves only the ticked ones', async ({ page }) => {
  const now = new Date(2026, 10, 21, 15, 30);
  const day = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const iso = (n: number, t: string) => new Date(`${day(n)}T${t}:00`).toISOString();
  const tables: Record<string, Record<string, unknown>[]> = {
    subjects: [{ id: 'phys', user_id: account.id, name: 'Physics 5A', color: '#ab47bc', archived: false }],
    todos: [
      { id: 'early', user_id: account.id, text: 'Review: Physics lecture from Thu 09-10', subject_id: 'phys', status: 'nothing', date: day(1) },
      { id: 'mine', user_id: account.id, text: 'Gym prep', subject_id: 'phys', status: 'nothing', date: day(1) },
      { id: 'fine', user_id: account.id, text: 'Problem set', subject_id: 'phys', status: 'nothing', date: day(1) },
    ],
    todo_sessions: [
      { id: 's-early', user_id: account.id, todo_id: 'early', date: day(1), start_time: iso(1, '08:15'), end_time: iso(1, '09:15') },
      { id: 's-mine', user_id: account.id, todo_id: 'mine', date: day(1), start_time: iso(1, '09:15'), end_time: iso(1, '09:45') },
      { id: 's-fine', user_id: account.id, todo_id: 'fine', date: day(1), start_time: iso(1, '13:00'), end_time: iso(1, '14:00') },
    ],
  };
  await page.clock.setFixedTime(now);
  await page.addInitScript(([a, pin]) => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
    localStorage.setItem('soma_settings', JSON.stringify({ theme: 'light', studyWindow: { start: '08:00', end: '23:00' } }));
    localStorage.setItem('soma_pinned_blocks', JSON.stringify({ userId: (a as { id: string }).id, keys: [pin] }));
  }, [account, `mine@${day(1)}T09:15`] as const);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (req.method() === 'POST') { const b = req.postDataJSON(); for (const r of (Array.isArray(b) ? b : [b]) as Record<string, unknown>[]) tables[table] = [...(tables[table] ?? []).filter(x => x.id !== r.id), r]; return route.fulfill({ json: null }); }
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? (tables[table] ?? [])[0] ?? null : tables[table] ?? [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Study hours' }).click();
  await page.getByLabel('Earliest start').fill('10:00');
  await page.getByLabel('Latest end').focus();
  const dialog = page.getByRole('dialog', { name: /outside your new study hours/ });
  await expect(dialog).toContainText('Review: Physics lecture from Thu 09-10');
  await expect(dialog).toContainText('you set this time');
  await expect(dialog).not.toContainText('Problem set');
  await expect(dialog.getByRole('checkbox', { name: /Gym prep/ })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Move them' }).click();
  await expect(dialog.getByRole('status')).toContainText('Moved 1 block');
  const start = (id: string) => tables.todo_sessions.find(s => s.id === id)?.start_time;
  expect(start('s-early')).toBe(iso(1, '10:00'));
  expect(start('s-mine')).toBe(iso(1, '09:15'));
  expect(start('s-fine')).toBe(iso(1, '13:00'));
});

test('with nothing outside the new hours there is no question', async ({ page }) => {
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
    localStorage.setItem('soma_settings', JSON.stringify({ theme: 'light', studyWindow: { start: '08:00', end: '23:00' } }));
  }, account);
  let writes = 0;
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (req.method() !== 'GET') { writes++; return route.fulfill({ json: null }); }
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Study hours' }).click();
  await page.getByLabel('Earliest start').fill('10:00');
  await page.getByLabel('Latest end').focus();
  // No blocks outside the hours: no question at all.
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog', { name: /outside your new study hours/ })).toHaveCount(0);
  void writes;
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('soma_settings') ?? '{}').studyWindow.start)).toBe('10:00');
});
