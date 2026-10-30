import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_LAYOUT, placeAt, readLayout } from '../src/lib/dashboardLayout';

/**
 * The dashboard as widgets (2026-10-30): Today's plan, This week, Focus, Ask
 * Soma, Brain dump, Up next, Due soon and Study this week, each at a preset
 * size. Customize adds, hides, resizes and moves them, to any spot on the
 * grid; Done saves the layout in the student's settings, so it follows them
 * to every device.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const now = new Date(2026, 9, 29, 9, 0);                       // Thu, Oct 29, 9 AM
const dateOf = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (offset: number, time: string) => new Date(`${dateOf(offset)}T${time}:00`).toISOString();
const todo = (id: string, text: string, off: number) => ({ id, user_id: account.id, text, subject_id: 'math', status: 'nothing', date: dateOf(off), estimated_minutes: 60 });
const session = (id: string, todoId: string, off: number, a: string, b: string) => ({ id, user_id: account.id, todo_id: todoId, date: dateOf(off), start_time: at(off, a), end_time: at(off, b) });

async function setup(page: Page, opts: { layout?: unknown; failSettingsSave?: boolean } = {}) {
  const state = {
    settings: { onboardingCompleted: true, theme: 'light', ...(opts.layout !== undefined ? { dashboardLayout: opts.layout } : {}) } as Record<string, unknown>,
    saves: [] as Record<string, unknown>[],
    tables: {
      subjects: [{ id: 'math', user_id: account.id, name: 'MATH 221', color: '#42a5f5', archived: false }],
      todos: [todo('ps', 'Problem set 5', 0), todo('rd', 'Reading 4.4', 1)],
      todo_sessions: [session('s1', 'ps', 0, '10:00', '11:00'), session('s2', 'rd', 1, '09:00', '10:00')],
      timer_sessions: [{ id: 'l1', user_id: account.id, subject_id: 'math', task_text: 'Problem set 4', duration_seconds: 45 * 60, date: dateOf(-1), start_time: at(-1, '15:00'), end_time: at(-1, '15:45') }],
      active_timer: [], brain_dump_items: [],
    } as Record<string, Record<string, unknown>[]>,
  };
  await page.clock.setFixedTime(now);
  await page.addInitScript(account => { localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 'test-token', refresh_token: 'test-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: account })); }, account);
  await page.route('https://soma-regression.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') {
      if (req.method() === 'GET') return route.fulfill({ json: { data: state.settings } });
      if (opts.failSettingsSave) return route.fulfill({ status: 500, json: { message: 'boom' } });
      const body = req.postDataJSON() as { data: Record<string, unknown> };
      state.saves.push(body.data); state.settings = body.data;
      return route.fulfill({ json: null });
    }
    if (req.method() === 'GET') {
      let rows = state.tables[table] ?? [];
      for (const key of ['id', 'todo_id', 'date']) { const filter = url.searchParams.get(key); if (filter?.startsWith('eq.')) rows = rows.filter(r => String(r[key]) === filter.slice(3)); }
      return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
    }
    return route.fulfill({ json: null });
  });
  await page.route('**/api/stripe', route => route.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', route => route.fulfill({ json: { events: [], incomplete: false } }));
  return state;
}

const widgetIds = (page: Page) => page.locator('[data-widget]').evaluateAll(els => els.map(e => e.getAttribute('data-widget')));

test('a new student sees the default widgets: the plan, Ask Soma, Focus, Brain dump, Up next and Due soon', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Today’s plan' })).toBeVisible();
  expect(await widgetIds(page)).toEqual(DEFAULT_LAYOUT.map(w => w.id));
  const next = page.locator('[data-widget=next]');
  await expect(next).toContainText('10:00 AM');
  await expect(next).toContainText('Problem set 5');
  await expect(next.getByRole('button', { name: 'Start focus: Problem set 5' })).toBeVisible();
  // Today's plan sits beside Ask Soma, as the two columns did.
  const plan = (await page.locator('[data-widget=plan]').boundingBox())!, ask = (await page.locator('[data-widget=ask]').boundingBox())!;
  expect(ask.x).toBeGreaterThan(plan.x + plan.width - 1);
  expect(Math.abs(ask.y - plan.y)).toBeLessThan(2);
});

test('Customize: hide, add, resize and move widgets; nothing is saved until Done, then it stays after a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await setup(page);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Customize' }).click();
  // The widgets can't be used while arranging them.
  await expect(page.locator('[data-widget=plan] > [inert]')).toHaveCount(1);
  expect(await page.locator('[data-widget] > [inert]').count()).toBe(DEFAULT_LAYOUT.length);
  await expect(page.getByRole('button', { name: 'Move Today’s plan left' })).toBeDisabled();

  // Without Ask Soma, the widgets under it rise into its space.
  await page.getByRole('button', { name: 'Hide Ask Soma' }).click();
  await page.getByRole('button', { name: 'Add Study this week' }).click();
  // Brain dump made wide pushes Up next down; moved right, Up next rises into the free spot.
  await page.getByRole('combobox', { name: 'Size of Brain dump' }).selectOption({ label: 'Wide' });
  await page.getByRole('button', { name: 'Move Up next right' }).click();
  expect(state.saves).toHaveLength(0);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible();
  const saved = [
    { id: 'plan', size: 'xl', x: 0, y: 0 }, { id: 'focus', size: 'small', x: 2, y: 0 }, { id: 'due', size: 'small', x: 2, y: 1 },
    { id: 'stats', size: 'small', x: 2, y: 2 }, { id: 'dump', size: 'wide', x: 0, y: 3 }, { id: 'next', size: 'small', x: 2, y: 3 },
  ];
  expect(state.saves.at(-1)?.dashboardLayout).toEqual(saved);
  // Saving the layout keeps every other setting.
  expect(state.saves.at(-1)?.onboardingCompleted).toBe(true);
  expect(await widgetIds(page)).toEqual(saved.map(w => w.id));
  await expect(page.getByRole('heading', { name: 'Ask Soma' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Study this week' })).toBeVisible();
  expect(await widgetIds(page)).toEqual(saved.map(w => w.id));
  const next = (await page.locator('[data-widget=next]').boundingBox())!, stats = (await page.locator('[data-widget=stats]').boundingBox())!;
  expect(Math.abs(next.x - stats.x)).toBeLessThan(2);
  expect(next.y).toBeGreaterThan(stats.y + stats.height - 1);
});

test('a widget can be dragged to any spot: Focus goes right under Ask Soma', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Saved before widgets had a spot: Focus took the first free one, under the plan.
  const state = await setup(page, { layout: [{ id: 'plan', size: 'large' }, { id: 'ask', size: 'tall' }, { id: 'focus', size: 'small' }] });
  await page.goto('/dashboard');
  const box = (id: string) => page.locator(`[data-widget=${id}]`).boundingBox().then(b => b!);
  expect(Math.abs((await box('focus')).x - (await box('plan')).x)).toBeLessThan(2);

  await page.getByRole('button', { name: 'Customize' }).click();
  const grid = page.locator('[data-widget=plan]').locator('..');
  const gridBox = (await grid.boundingBox())!, ask = await box('ask');
  await page.locator('[data-widget=focus]').dragTo(grid, { sourcePosition: { x: 40, y: 120 }, targetPosition: { x: ask.x - gridBox.x + ask.width / 2, y: ask.y - gridBox.y + ask.height + 60 } });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect.poll(() => state.saves.at(-1)?.dashboardLayout).toEqual([
    { id: 'plan', size: 'large', x: 0, y: 0 }, { id: 'ask', size: 'tall', x: 2, y: 0 }, { id: 'focus', size: 'small', x: 2, y: 2 },
  ]);
  const focus = await box('focus'), after = await box('ask');
  expect(Math.abs(focus.x - after.x)).toBeLessThan(2);
  expect(focus.y).toBeGreaterThan(after.y + after.height - 1);
});

test('a widget can be made taller or shorter with the handle on its bottom edge', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // The plan two rows tall beside Ask Soma, with Focus under Ask: the plan stops short of Focus's bottom.
  const state = await setup(page, { layout: [{ id: 'plan', size: 'large', x: 0, y: 0 }, { id: 'ask', size: 'tall', x: 2, y: 0 }, { id: 'focus', size: 'small', x: 2, y: 2 }] });
  await page.goto('/dashboard');
  const box = (id: string) => page.locator(`[data-widget=${id}]`).boundingBox().then(b => b!);
  expect((await box('plan')).y + (await box('plan')).height).toBeLessThan((await box('focus')).y);

  await page.getByRole('button', { name: 'Customize' }).click();
  const handle = page.getByRole('button', { name: /^Height of Today’s plan: 2 rows/ });
  const h = (await handle.boundingBox())!, rowStep = (await box('focus')).y - (await box('ask')).y - (await box('ask')).height + (await box('focus')).height;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + rowStep * 0.6, { steps: 5 });
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + rowStep, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: /^Height of Today’s plan: 3 rows/ })).toBeVisible();
  // The keyboard works too: Focus a row taller, then back.
  const focusHandle = page.getByRole('button', { name: /^Height of Focus timer: 1 row/ });
  await focusHandle.press('ArrowDown');
  await expect(page.getByRole('button', { name: /^Height of Focus timer: 2 rows/ })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect.poll(() => state.saves.at(-1)?.dashboardLayout).toEqual([
    { id: 'plan', size: 'large', x: 0, y: 0, rows: 3 }, { id: 'ask', size: 'tall', x: 2, y: 0 }, { id: 'focus', size: 'small', x: 2, y: 2 },
  ]);
  // The plan now reaches the bottom of Focus.
  const plan = await box('plan'), focus = await box('focus');
  expect(Math.abs(plan.y + plan.height - (focus.y + focus.height))).toBeLessThan(2);
});

test('Cancel puts the dashboard back; Reset brings the default layout', async ({ page }) => {
  const state = await setup(page, { layout: [{ id: 'plan', size: 'full' }, { id: 'stats', size: 'wide' }] });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Study this week' })).toBeVisible();
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Hide Study this week' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await widgetIds(page)).toEqual(['plan', 'stats']);
  expect(state.saves).toHaveLength(0);

  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect.poll(() => state.saves.at(-1)?.dashboardLayout).toEqual(DEFAULT_LAYOUT);
  expect(await widgetIds(page)).toEqual(DEFAULT_LAYOUT.map(w => w.id));
});

test('a layout that couldn’t be saved says so and stays open to try again', async ({ page }) => {
  await setup(page, { failSettingsSave: true });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Hide Due soon' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Couldn’t save your dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
});

test('This week opens a day in Today’s plan; Study this week totals the last seven days', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, { layout: [{ id: 'plan', size: 'xl' }, { id: 'calendar', size: 'large' }, { id: 'stats', size: 'small' }] });
  await page.goto('/dashboard');
  const week = page.locator('[data-widget=calendar]');
  await week.getByRole('button', { name: /^Friday, Oct 30: 1 block/ }).click();
  await expect(page.locator('[data-widget=plan]').getByText('Reading 4.4')).toBeVisible();
  await expect(page.locator('[data-widget=stats]')).toContainText('45 min');
});

test('the block editor opens beside Today’s plan', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Edit: Problem set 5' }).click();
  await expect(page.locator('[data-widget=panel]').getByRole('region', { name: 'Block editor' })).toBeVisible();
  const plan = (await page.locator('[data-widget=plan]').boundingBox())!, panel = (await page.locator('[data-widget=panel]').boundingBox())!;
  expect(panel.x).toBeGreaterThan(plan.x + plan.width - 1);
});

test('a stored layout is checked: unknown widgets, bad sizes, bad spots, overlaps and repeats are fixed', () => {
  expect(readLayout([{ id: 'plan', size: 'tiny' }, { id: 'evil', size: 'small' }, { id: 'focus', size: 'tall' }, { id: 'focus', size: 'small' }, 'x', null]))
    .toEqual([{ id: 'plan', size: 'xl', x: 0, y: 0 }, { id: 'focus', size: 'tall', x: 2, y: 0 }]);
  expect(readLayout('nope')).toEqual(DEFAULT_LAYOUT);
  expect(readLayout(undefined)).toEqual(DEFAULT_LAYOUT);
  expect(readLayout([])).toEqual([]);
  // Overlapping widgets are pushed apart; a spot off the grid is replaced by the first free one.
  expect(readLayout([{ id: 'plan', size: 'xl', x: 0, y: 0 }, { id: 'focus', size: 'small', x: 1, y: 1 }, { id: 'calendar', size: 'large', x: 2, y: 0 }]))
    .toEqual([{ id: 'plan', size: 'xl', x: 0, y: 0 }, { id: 'focus', size: 'small', x: 1, y: 3 }, { id: 'calendar', size: 'large', x: 0, y: 4 }]);
  // Widgets left with a gap above them rise into it.
  expect(readLayout([{ id: 'focus', size: 'small', x: 1, y: 5 }])).toEqual([{ id: 'focus', size: 'small', x: 1, y: 0 }]);
});

test('placing a widget: same-size widgets swap, moving down goes under, anything else moves out of the way', () => {
  expect(placeAt(DEFAULT_LAYOUT, 'dump', 1, 3).filter(w => ['dump', 'next'].includes(w.id)))
    .toEqual([{ id: 'next', size: 'small', x: 0, y: 3 }, { id: 'dump', size: 'small', x: 1, y: 3 }]);
  const column = readLayout([{ id: 'focus', size: 'small', x: 2, y: 0 }, { id: 'ask', size: 'tall', x: 2, y: 1 }]);
  expect(placeAt(column, 'focus', 2, 1)).toEqual([{ id: 'ask', size: 'tall', x: 2, y: 0 }, { id: 'focus', size: 'small', x: 2, y: 2 }]);
  expect(placeAt(placeAt(column, 'focus', 2, 1), 'focus', 2, 1)).toEqual([{ id: 'focus', size: 'small', x: 2, y: 0 }, { id: 'ask', size: 'tall', x: 2, y: 1 }]);
  // A widget can't hang off the grid, and with nothing under it, moving down changes nothing.
  expect(placeAt(DEFAULT_LAYOUT, 'plan', 2, 0)).toEqual(placeAt(DEFAULT_LAYOUT, 'plan', 1, 0));
  expect(placeAt(DEFAULT_LAYOUT, 'due', 2, 4)).toEqual(DEFAULT_LAYOUT);
});

test('a widget’s height stays in its range, a new size starts at that size’s height, and bad stored heights are dropped', () => {
  const taller = placeAt(DEFAULT_LAYOUT, 'ask', 2, 0, { rows: 4 });
  expect(taller.find(w => w.id === 'ask')).toEqual({ id: 'ask', size: 'tall', x: 2, y: 0, rows: 4 });
  expect(taller.find(w => w.id === 'focus')).toMatchObject({ x: 2, y: 4 });            // pushed down under it
  expect(placeAt(DEFAULT_LAYOUT, 'ask', 2, 0, { rows: 99 }).find(w => w.id === 'ask')?.rows).toBe(6);
  expect(placeAt(DEFAULT_LAYOUT, 'ask', 2, 0, { rows: 2 }).find(w => w.id === 'ask')).toEqual({ id: 'ask', size: 'tall', x: 2, y: 0 });
  expect(placeAt(taller, 'ask', 1, 0, { size: 'large' }).find(w => w.id === 'ask')).toEqual({ id: 'ask', size: 'large', x: 1, y: 0 });
  expect(readLayout([{ id: 'plan', size: 'xl', x: 0, y: 0, rows: 'tall' }, { id: 'next', size: 'small', x: 2, y: 0, rows: 9 }]))
    .toEqual([{ id: 'plan', size: 'xl', x: 0, y: 0 }, { id: 'next', size: 'small', x: 2, y: 0, rows: 2 }]);
});
