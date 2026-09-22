import { test, expect, type Page } from '@playwright/test';

/**
 * The Deadlines page (formerly Canvas). It used to render nothing but a
 * "Connect Canvas" card whenever the feed was not connected, which hid the
 * deadlines a student had imported from a course site — the very students the
 * import exists for. It also listed Canvas assignments only, so imported and
 * hand-written work never appeared next to them.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return key(d); };
type Row = Record<string, unknown>;

const CS61A = { id: 'cs61a', name: 'CS 61A', color: '#42a5f5', archived: false, source: 'manual' };
const BIO = { id: 'bio', name: 'Biology 101', color: '#66bb6a', archived: false, source: 'canvas', canvas_course_id: 456 };

/** A Canvas assignment due tomorrow, so it lands in a predictable group. */
const canvasAssignments = [{
  id: 123, name: 'Cell structure homework', courseId: 456, courseName: 'Biology 101',
  dueAt: `${offset(1)}T18:00:00Z`, htmlUrl: 'https://school.instructure.com/a/123', status: 'not_started',
}];

async function setup(page: Page, { subjects = [] as Row[], todos = [] as Row[], canvas = false } = {}) {
  const state = { subjects: [...subjects], todos: [...todos] };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light', ...(canvas ? { canvasIcalUrl: 'https://school.instructure.com/feed.ics' } : {}) } } });
    const list = table === 'subjects' ? state.subjects : table === 'todos' ? state.todos : null;
    if (list && req.method() === 'POST') {
      const body = req.postDataJSON();
      for (const row of (Array.isArray(body) ? body : [body]) as Row[]) { const i = list.findIndex(r => r.id === row.id); if (i < 0) list.push(row); else list[i] = row; }
    }
    if (list) return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? list[0] ?? null : list });
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/canvas-ical', r => r.fulfill({ json: { assignments: canvasAssignments } }));
  return state;
}

/** One imported deadline, exactly as CourseSiteImport saves it. */
const importedTask = (over: Row = {}) => ({
  id: 'task-lab3', text: 'Lab 3', status: 'nothing', subject_id: 'cs61a',
  due_date: offset(2), date: offset(2), ...over,
});

test('imported deadlines show even when Canvas was never connected', async ({ page }) => {
  await setup(page, { subjects: [CS61A], todos: [importedTask()] });
  await page.goto('/deadlines');

  // The bug: this used to be the "Connect Canvas" card and nothing else.
  await expect(page.getByText('Lab 3')).toBeVisible();
  await expect(page.getByPlaceholder(/instructure/)).toHaveCount(0);
  // The connection is still offered, just not in the way.
  await expect(page.getByRole('link', { name: 'Connect Canvas' })).toBeVisible();
});

test('the setup card still shows when there is genuinely nothing due', async ({ page }) => {
  await setup(page);
  await page.goto('/deadlines');
  await expect(page.getByPlaceholder(/instructure/)).toBeVisible();
});

test('Canvas assignments and imported deadlines share one list', async ({ page }) => {
  await setup(page, { subjects: [BIO, CS61A], todos: [importedTask()], canvas: true });
  await page.goto('/deadlines');

  await expect(page.getByText('Cell structure homework')).toBeVisible();
  await expect(page.getByText('Lab 3')).toBeVisible();
  // Grouped by day, so the Canvas item (tomorrow) sorts before the task (+2).
  await expect(page.getByText('Tomorrow', { exact: false }).first()).toBeVisible();
});

test('a task with no course still appears rather than being dropped', async ({ page }) => {
  await setup(page, { todos: [importedTask({ id: 'loose', text: 'Read chapter 6', subject_id: null })] });
  await page.goto('/deadlines');
  await expect(page.getByText('Read chapter 6')).toBeVisible();
  await expect(page.getByText('No course', { exact: true }).last()).toBeVisible();
});

test('marking an imported deadline done writes through to the task', async ({ page }) => {
  const state = await setup(page, { subjects: [CS61A], todos: [importedTask()] });
  await page.goto('/deadlines');

  await page.getByLabel('Status: Lab 3').selectOption('done');
  await expect.poll(() => (state.todos[0] as Row).status).toBe('done');

  // Done work leaves the active list and is reachable under the Done filter.
  await expect(page.getByText('Lab 3')).toHaveCount(0);
  await page.getByLabel('Filter by status').selectOption('done');
  await expect(page.getByText('Lab 3')).toBeVisible();
});

test('the course filter covers imported courses, not just Canvas ones', async ({ page }) => {
  await setup(page, { subjects: [BIO, CS61A], todos: [importedTask()], canvas: true });
  await page.goto('/deadlines');

  await page.getByLabel('Filter by course').selectOption('CS 61A');
  await expect(page.getByText('Lab 3')).toBeVisible();
  await expect(page.getByText('Cell structure homework')).toHaveCount(0);
});

test('the old /canvas link still lands on the page', async ({ page }) => {
  await setup(page, { subjects: [CS61A], todos: [importedTask()] });
  await page.goto('/canvas');
  await expect(page.getByText('Lab 3')).toBeVisible();
});
