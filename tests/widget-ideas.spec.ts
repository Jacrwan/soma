import { test, expect, type Page } from '@playwright/test';

/**
 * Widget ideas (src/components/DashboardV2/WidgetIdeas.tsx,
 * widget_requests_migration.sql): a student suggests a widget from Customize
 * and sees what was decided; the owner reviews every idea from "Widget ideas"
 * beside Customize. Who the owner is comes from the database (is_soma_owner).
 */

const account = { id: '44444444-4444-4444-8444-444444444444', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
type Row = Record<string, unknown>;

async function setup(page: Page, o: { owner?: boolean; ideas?: Row[]; missing?: boolean } = {}) {
  const state = { ideas: [...(o.ideas ?? [])], inserts: [] as Row[], updates: [] as { id: string; body: Row }[] };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (url.pathname.endsWith('/rpc/is_soma_owner')) return route.fulfill({ json: o.owner === true });
    if (table === 'settings') {
      if (req.method() !== 'GET') return route.fulfill({ json: null });
      return route.fulfill({ json: { data: { theme: 'light', onboardingCompleted: true, walkthroughCompleted: true } } });
    }
    if (table === 'widget_requests') {
      if (o.missing) return route.fulfill({ status: 404, json: { code: 'PGRST205', message: 'Could not find the table public.widget_requests in the schema cache' } });
      if (req.method() === 'POST') {
        const body = req.postDataJSON() as Row;
        state.inserts.push(body);
        const row = { id: `i${state.inserts.length}`, status: 'new', owner_note: null, created_at: new Date().toISOString(), ...body };
        state.ideas.unshift(row);
        return route.fulfill({ json: row });
      }
      if (req.method() === 'PATCH') {
        const id = url.searchParams.get('id')!.slice(3);
        state.updates.push({ id, body: req.postDataJSON() as Row });
        return route.fulfill({ json: null });
      }
      const mine = url.searchParams.get('user_id');
      return route.fulfill({ json: mine ? state.ideas.filter(r => `eq.${r.user_id}` === mine) : state.ideas });
    }
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  return state;
}

const idea = (id: string, title: string, status: string, extra: Row = {}) =>
  ({ id, user_id: account.id, title, details: '', status, owner_note: null, created_at: '2026-10-29T12:00:00Z', ...extra });

test('a student suggests a widget from Customize and sees it waiting, with past decisions and notes', async ({ page }) => {
  const state = await setup(page, { ideas: [idea('old', 'Water tracker', 'declined', { owner_note: 'Out of scope for a study app.' })] });
  await page.goto('/dashboard');
  // Only the owner sees the review button.
  await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Widget ideas/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Missing a widget? Suggest one' }).click();
  const dialog = page.getByRole('dialog', { name: 'Suggest a widget' });
  await expect(dialog.getByText('Water tracker')).toBeVisible();
  await expect(dialog.getByText('Not planned')).toBeVisible();
  await expect(dialog.getByText('Out of scope for a study app.')).toBeVisible();

  await expect(dialog.getByRole('button', { name: 'Send idea' })).toBeDisabled();
  await dialog.getByLabel('What should it show?').fill('Exam countdown');
  await dialog.getByLabel(/How would you use it/).fill('Days left until each exam, so I start reviewing in time.');
  await dialog.getByRole('button', { name: 'Send idea' }).click();

  await expect(dialog.getByText('Sent. Thanks for the idea.')).toBeVisible();
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Exam countdown' })).toContainText('Waiting for review');
  expect(state.inserts).toEqual([{ user_id: account.id, title: 'Exam countdown', details: 'Days left until each exam, so I start reviewing in time.' }]);
  await expect(dialog.getByLabel('What should it show?')).toHaveValue('');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('the owner sees how many ideas are waiting and decides them, with a note', async ({ page }) => {
  const state = await setup(page, { owner: true, ideas: [
    idea('a', 'Exam countdown', 'new', { details: 'Days left until each exam.' }),
    idea('b', 'Weekly goal ring', 'new'),
    idea('c', 'Pomodoro stats', 'planned'),
    idea('d', 'Water tracker', 'declined'),
  ] });
  await page.goto('/dashboard');
  const button = page.getByRole('button', { name: /Widget ideas/ });
  await expect(button).toContainText('2');
  await button.click();

  const dialog = page.getByRole('dialog', { name: 'Widget ideas' });
  await expect(dialog.getByText('2 waiting for your decision.')).toBeVisible();
  const countdown = dialog.getByRole('listitem').filter({ hasText: 'Exam countdown' });
  await expect(countdown).toContainText('Days left until each exam.');
  await countdown.getByPlaceholder('Note to the student (optional)').fill('Coming next week.');
  await countdown.getByRole('button', { name: 'Build it' }).click();
  await expect(countdown).toContainText('Will be built');
  await expect(dialog.getByText('1 waiting for your decision.')).toBeVisible();
  expect(state.updates[0]).toMatchObject({ id: 'a', body: { status: 'planned', owner_note: 'Coming next week.' } });

  await dialog.getByRole('listitem').filter({ hasText: 'Weekly goal ring' }).getByRole('button', { name: 'Not planned' }).click();
  await expect.poll(() => state.updates.length).toBe(2);
  expect(state.updates[1]).toMatchObject({ id: 'b', body: { status: 'declined', owner_note: null } });

  await dialog.getByRole('listitem').filter({ hasText: 'Pomodoro stats' }).getByRole('button', { name: 'Mark built' }).click();
  await expect.poll(() => state.updates.length).toBe(3);
  expect(state.updates[2]).toMatchObject({ id: 'c', body: { status: 'built' } });

  // Decided ideas fold away, and a declined one can be reconsidered.
  await dialog.getByRole('button', { name: '3 decided ideas' }).click();
  await dialog.getByRole('listitem').filter({ hasText: 'Water tracker' }).getByRole('button', { name: 'Reconsider' }).click();
  await expect.poll(() => state.updates.length).toBe(4);
  expect(state.updates[3]).toMatchObject({ id: 'd', body: { status: 'new', decided_at: null } });

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(button).toContainText('1');
});

test('before the migration runs, the student is told widget ideas aren’t set up yet', async ({ page }) => {
  await setup(page, { missing: true });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Missing a widget? Suggest one' }).click();
  const dialog = page.getByRole('dialog', { name: 'Suggest a widget' });
  await expect(dialog.getByRole('alert')).toContainText('aren’t set up yet');
});
