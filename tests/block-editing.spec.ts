import { test, expect, type Page } from '@playwright/test';

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const day = new Date();
const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
const yday = (() => { const d = new Date(day); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const iso = (t: string) => new Date(`${date}T${t}:00`).toISOString();

const gcalEvent = { id: 'oh', summary: 'Physics 5A OH', start: { dateTime: iso('11:00') }, end: { dateTime: iso('12:30') }, source: { connectionId: 'c', calendarId: 'k' } };

async function setup(page: Page, opts: { history?: boolean } = {}) {
  const history = opts.history ? [
    { id: 'h1', user_id: account.id, subject_id: 'bio', task_text: 'Cell review', duration_seconds: 1500, date },
    { id: 'h2', user_id: account.id, subject_id: 'bio', task_text: 'Cell review', duration_seconds: 2700, date: yday },
  ] : [];
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    const rows =
      table === 'subjects' ? [{ id: 'bio', user_id: account.id, name: 'Biology', color: '#66bb6a', archived: false }]
      : table === 'todos' ? [{ id: 't1', user_id: account.id, text: 'Cell review', subject_id: 'bio', status: 'nothing', date, estimated_minutes: 45 }]
      : table === 'todo_sessions' ? [{ id: 's1', user_id: account.id, todo_id: 't1', date, start_time: iso('09:00'), end_time: iso('09:45') }]
      : table === 'timer_sessions' ? history
      : [];
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [gcalEvent], incomplete: false } }));
}

test('clicking a block opens its editor without entering edit mode', async ({ page }) => {
  await setup(page);
  await page.goto('/dashboard');
  await expect(page.getByText('Cell review')).toBeVisible();
  // Edit mode is off — the gap "add" controls are not showing.
  await expect(page.getByRole('button', { name: /^Add block in gap/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Edit: Cell review' }).click();
  await expect(page.getByLabel('Block editor', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Cell review');
});

test('an imported Google event is not clickable to edit', async ({ page }) => {
  await setup(page);
  await page.goto('/dashboard');
  await expect(page.getByText('Physics 5A OH')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit: Physics 5A OH' })).toHaveCount(0);
});

test('a block being timed cannot be opened until focus stops', async ({ page }) => {
  await setup(page);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Start focus: Cell review' }).click();
  await expect(page.getByLabel('Focus timer')).toContainText('Cell review');
  await expect(page.getByRole('button', { name: 'Edit: Cell review' })).toHaveCount(0);
});

test('the editor lists past focus sessions for the task', async ({ page }) => {
  await setup(page, { history: true });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Edit: Cell review' }).click();

  const log = page.getByLabel('Past focus sessions');
  await expect(log).toBeVisible();
  await expect(log).toContainText('25 min');   // 1500s today
  await expect(log).toContainText('45 min');   // 2700s yesterday
  await expect(log).toContainText('70 minutes recorded');
});

test('a task with no recorded focus offers to add one rather than listing sessions', async ({ page }) => {
  await setup(page);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Edit: Cell review' }).click();
  await expect(page.getByLabel('Block editor', { exact: true })).toBeVisible();
  // The section now renders empty so a session can be entered by hand when the
  // timer was never started; it must not imply any time was recorded.
  const log = page.getByLabel('Past focus sessions');
  await expect(log).toBeVisible();
  await expect(log).toContainText('No study time recorded on this task yet.');
  await expect(log).not.toContainText('minutes recorded on this task.');
  await expect(log.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Forgot to start the timer/ })).toBeVisible();
});
