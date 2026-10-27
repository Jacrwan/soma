import { test, expect, type Page } from '@playwright/test';

/**
 * The Soma for Canvas extension's hand-off (src/lib/canvasExtension.ts). The
 * extension posts a snapshot of what it read from Canvas to the open Soma
 * tab; the app checks it, saves it under the signed-in student, and merges it
 * into the feed's assignments. The extension itself is simulated here by
 * posting the same message its bridge script posts.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return key(d); };
type Row = Record<string, unknown>;

const BIO = { id: 'bio', name: 'Biology 101', color: '#66bb6a', archived: false, source: 'canvas', canvas_course_id: 456 };
const feed = [{
  id: 123, name: 'Cell structure homework', courseId: 456, courseName: 'Biology 101',
  dueAt: `${offset(1)}T18:00:00Z`, htmlUrl: 'https://school.instructure.com/courses/456/assignments/123', status: 'not_started',
}];

const snapshot = (over: Row = {}) => ({
  v: 1, host: 'school.instructure.com', syncedAt: new Date().toISOString(),
  courses: [{ id: 456, name: 'Biology 101', courseCode: 'BIO 101', currentScore: 88.5, currentGrade: 'B+', weighted: true }],
  groups: [{ id: 9, courseId: 456, name: 'Labs', weight: 30 }],
  assignments: [
    // In the feed, and handed in: it is done.
    { id: 123, courseId: 456, name: 'Cell structure homework', dueAt: `${offset(1)}T18:00:00Z`, htmlUrl: feed[0].htmlUrl, description: 'Label the organelles', pointsPossible: 10, groupId: 9, submittedAt: new Date().toISOString(), workflowState: 'submitted' },
    // Not in the feed: it is added.
    { id: 124, courseId: 456, name: 'Microscope lab report', dueAt: `${offset(3)}T18:00:00Z`, htmlUrl: 'https://school.instructure.com/courses/456/assignments/124', description: '', pointsPossible: 25, groupId: 9, workflowState: 'unsubmitted' },
  ],
  announcements: [],
  ...over,
});

async function setup(page: Page) {
  const saved: Row[] = [];
  const deleted: string[] = [];
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light', canvasIcalUrl: 'https://school.instructure.com/feed.ics' } } });
    if (table === 'subjects') return route.fulfill({ json: [BIO] });
    if (table === 'canvas_snapshots') {
      if (req.method() === 'POST') saved.push(req.postDataJSON() as Row);
      if (req.method() === 'DELETE') deleted.push(url.search);
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/canvas-ical', r => r.fulfill({ json: { assignments: feed } }));
  return { saved, deleted };
}

const fromExtension = (page: Page, snap: unknown) =>
  page.evaluate(s => window.postMessage({ source: 'soma-extension', type: 'canvas_snapshot', snapshot: s }, window.location.origin), snap);

test('a synced submission is done, and work the feed missed is added', async ({ page }) => {
  const { saved } = await setup(page);
  await page.goto('/deadlines');
  await expect(page.getByText('Cell structure homework')).toBeVisible();

  await fromExtension(page, snapshot());

  // Handed in on Canvas: it leaves the active list without the student marking it.
  await expect(page.getByText('Cell structure homework')).toHaveCount(0);
  await expect(page.getByText('Microscope lab report')).toBeVisible();
  // Saved under the signed-in student, never an id from the message.
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].user_id).toBe(account.id);
  expect(saved[0].host).toBe('school.instructure.com');
});

test('a malformed snapshot is ignored', async ({ page }) => {
  const { saved } = await setup(page);
  await page.goto('/deadlines');
  await expect(page.getByText('Cell structure homework')).toBeVisible();

  await fromExtension(page, { ...snapshot(), v: 99 });
  await fromExtension(page, { ...snapshot(), host: 'not a host' });
  await fromExtension(page, 'nonsense');

  await page.waitForTimeout(300);
  expect(saved).toHaveLength(0);
  await expect(page.getByText('Microscope lab report')).toHaveCount(0);
});

test('an older snapshot does not replace a newer one', async ({ page }) => {
  const { saved } = await setup(page);
  await page.goto('/deadlines');
  // Signed in and listening, as when the extension answers the app's hello.
  await expect(page.getByText('Cell structure homework')).toBeVisible();
  await fromExtension(page, snapshot());
  await expect.poll(() => saved.length).toBe(1);

  await fromExtension(page, snapshot({ syncedAt: '2020-01-01T00:00:00Z', assignments: [] }));
  await page.waitForTimeout(300);
  expect(saved).toHaveLength(1);
  await expect(page.getByText('Microscope lab report')).toBeVisible();
});

test('Settings shows the sync and removes it everywhere', async ({ page }) => {
  const { deleted } = await setup(page);
  await page.goto('/deadlines');
  // Signed in and listening, as when the extension answers the app's hello.
  await expect(page.getByText('Cell structure homework')).toBeVisible();
  await fromExtension(page, snapshot());
  await expect(page.getByText('Microscope lab report')).toBeVisible();

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Integrations' }).click();
  await expect(page.getByText(/school\.instructure\.com: 1 courses, 2 assignments/)).toBeVisible();

  page.once('dialog', d => void d.accept());
  await page.getByRole('button', { name: 'Remove synced data' }).click();
  await expect.poll(() => deleted.length).toBe(1);
  expect(deleted[0]).toContain(`user_id=eq.${account.id}`);
  await expect(page.getByText(/Adds assignment details/)).toBeVisible();
});

const gradescope = (over: Row = {}) => ({
  kind: 'gradescope', v: 1, host: 'www.gradescope.com', syncedAt: new Date().toISOString(),
  courses: [{ id: 600001, shortName: 'BIO 101', name: 'Biology', term: 'Fall 2026' }, { id: 600009, shortName: 'ASTRO 10', name: 'Astronomy' }],
  assignments: [
    // The Canvas entry links to Gradescope; Canvas never learns it was handed in.
    { id: 7001, courseId: 600001, name: 'Cell structure homework', dueAt: `${offset(1)}T18:00:00Z`, lateDueAt: null, htmlUrl: 'https://www.gradescope.com/courses/600001/assignments/7001/submissions/1', status: 'submitted', score: null, maxScore: null },
    // Only on Gradescope.
    { id: 7002, courseId: 600001, name: 'Problem set 2', dueAt: `${offset(2)}T18:00:00Z`, lateDueAt: `${offset(4)}T18:00:00Z`, htmlUrl: 'https://www.gradescope.com/courses/600001/assignments/7002', status: 'not_submitted', score: null, maxScore: null },
    // A course Canvas doesn't have.
    { id: 7003, courseId: 600009, name: 'Star chart', dueAt: `${offset(3)}T18:00:00Z`, lateDueAt: null, htmlUrl: 'https://evil.example/x', status: 'not_submitted', score: null, maxScore: null },
  ],
  ...over,
});

test('Gradescope: a linked Canvas entry learns it was handed in, and Gradescope-only work is added', async ({ page }) => {
  const { saved } = await setup(page);
  await page.goto('/deadlines');
  await expect(page.getByText('Cell structure homework')).toBeVisible();

  await page.evaluate(s => window.postMessage({ source: 'soma-extension', type: 'canvas_snapshot', snapshot: s }, window.location.origin), gradescope());

  // Handed in on Gradescope: the Canvas entry is done, and not listed twice.
  await expect(page.getByText('Cell structure homework')).toHaveCount(0);
  // Gradescope-only work joins the Canvas course of the same name, labelled.
  await expect(page.getByText('Problem set 2')).toBeVisible();
  await expect(page.getByText('Biology 101 · Gradescope').first()).toBeVisible();
  await expect(page.getByText('Star chart')).toBeVisible();
  await expect(page.getByText('ASTRO 10 · Gradescope')).toBeVisible();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({ user_id: account.id, host: 'www.gradescope.com' });
});

test('Gradescope: a snapshot claiming another host is refused', async ({ page }) => {
  const { saved } = await setup(page);
  await page.goto('/deadlines');
  await expect(page.getByText('Cell structure homework')).toBeVisible();
  await page.evaluate(s => window.postMessage({ source: 'soma-extension', type: 'canvas_snapshot', snapshot: s }, window.location.origin), gradescope({ host: 'school.instructure.com' }));
  await page.waitForTimeout(300);
  expect(saved).toHaveLength(0);
  await expect(page.getByText('Problem set 2')).toHaveCount(0);
});

test('Sync now in Settings asks the extension and reports how each site went', async ({ page }) => {
  await setup(page);
  await page.goto('/deadlines');
  await expect(page.getByText('Cell structure homework')).toBeVisible();
  await fromExtension(page, snapshot());
  await expect(page.getByText('Microscope lab report')).toBeVisible();

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Integrations' }).click();
  await expect(page.getByText(/school\.instructure\.com: 1 courses/)).toBeVisible();
  // Stand in for the extension's bridge: it says it's here, then answers a sync request.
  await page.evaluate(() => {
    window.addEventListener('message', e => {
      if (e.data?.source === 'soma-app' && e.data.type === 'sync_request') {
        window.postMessage({ source: 'soma-extension', type: 'sync_done', results: [
          { host: 'school.instructure.com', ok: true, error: null },
          { host: 'www.gradescope.com', ok: false, error: 'Sign in to Gradescope, then sync again.' },
        ] }, window.location.origin);
      }
    });
    window.postMessage({ source: 'soma-extension', type: 'present', version: '0.1.0' }, window.location.origin);
  });
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'www.gradescope.com: Sign in to Gradescope' })).toBeVisible();
});

test('the app answers the extension once, not every time it says it is here', async ({ page }) => {
  await setup(page);
  await page.goto('/deadlines');
  await expect(page.getByText('Cell structure homework')).toBeVisible();
  // Stand in for the bridge, which answers every hello with "present". If the
  // app answered each of those with another hello they would ping-pong forever.
  const hellos = await page.evaluate(async () => {
    let n = 0;
    window.addEventListener('message', e => {
      if (e.data?.source !== 'soma-app' || e.data.type !== 'hello') return;
      n++;
      window.postMessage({ source: 'soma-extension', type: 'present', version: '0.1.0' }, window.location.origin);
    });
    window.postMessage({ source: 'soma-extension', type: 'present', version: '0.1.0' }, window.location.origin);
    await new Promise(r => setTimeout(r, 500));
    return n;
  });
  expect(hellos).toBeLessThanOrEqual(1);
});

const webassign = (over: Row = {}) => ({
  kind: 'webassign', v: 1, host: 'www.webassign.net', syncedAt: new Date().toISOString(),
  courses: [{ id: 7700001, name: 'BIO 101, Fall 2026' }],
  assignments: [
    { id: 5001, courseId: 7700001, name: 'HW 7', dueAt: `${offset(1)}T17:00:00Z`, htmlUrl: 'https://www.webassign.net/web/Student/Assignment-Responses/last?dep=5001', status: 'complete', parts: 3, answered: 3, score: null, maxScore: 4 },
    { id: 5002, courseId: 7700001, name: 'Lab Quiz 4', dueAt: `${offset(2)}T21:30:00Z`, htmlUrl: 'https://www.webassign.net/web/Student/Assignment-Responses/last?dep=5002', status: 'in_progress', parts: 3, answered: 1, score: null, maxScore: 4 },
    { id: 5003, courseId: 7700001, name: 'HW 8', dueAt: `${offset(3)}T17:00:00Z`, htmlUrl: 'https://www.webassign.net/web/Student/Assignment-Responses/last?dep=5003', status: 'not_started', parts: 3, answered: 0, score: null, maxScore: 3 },
  ],
  ...over,
});

test('WebAssign: work joins its Canvas course, with how far along it is', async ({ page }) => {
  const { saved } = await setup(page);
  await page.goto('/deadlines');
  await expect(page.getByText('Cell structure homework')).toBeVisible();

  await page.evaluate(s => window.postMessage({ source: 'soma-extension', type: 'canvas_snapshot', snapshot: s }, window.location.origin), webassign());

  await expect(page.getByText('HW 8')).toBeVisible();
  await expect(page.getByText('Biology 101 · WebAssign').first()).toBeVisible();
  // Partly answered shows its progress and is in progress, not "not started".
  await expect(page.getByText('Biology 101 · WebAssign · 1 of 3 parts answered')).toBeVisible();
  await expect(page.getByLabel('Status: Lab Quiz 4')).toHaveValue('in_progress');
  // Every part answered: done, so off the active list.
  await expect(page.getByText('HW 7', { exact: true })).toHaveCount(0);
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({ user_id: account.id, host: 'www.webassign.net' });
});

test('WebAssign: a snapshot claiming another host is refused', async ({ page }) => {
  const { saved } = await setup(page);
  await page.goto('/deadlines');
  await expect(page.getByText('Cell structure homework')).toBeVisible();
  await page.evaluate(s => window.postMessage({ source: 'soma-extension', type: 'canvas_snapshot', snapshot: s }, window.location.origin), webassign({ host: 'www.gradescope.com' }));
  await page.waitForTimeout(300);
  expect(saved).toHaveLength(0);
  await expect(page.getByText('HW 8')).toHaveCount(0);
});

test('What changed on Deadlines: moved dates, new work and grades, newest first; bad entries dropped', async ({ page }) => {
  await setup(page);
  await page.goto('/deadlines');
  await expect(page.getByText('Cell structure homework')).toBeVisible();
  const now = Date.now();
  const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
  await fromExtension(page, snapshot({ changes: [
    { at: ago(1), site: 'canvas', type: 'due_moved', name: 'Microscope lab report', course: 'BIO 101', url: 'https://school.instructure.com/courses/456/assignments/124', assignmentId: 124, from: `${offset(2)}T18:00:00Z`, to: `${offset(3)}T18:00:00Z` },
    { at: ago(5), site: 'canvas', type: 'graded', name: 'Lab 2', course: 'BIO 101', url: 'https://school.instructure.com/courses/456/assignments/90', score: 9, maxScore: 10 },
    { at: ago(30), site: 'canvas', type: 'new', name: 'Field trip form', course: 'BIO 101', url: 'https://evil.example/phish', to: `${offset(5)}T18:00:00Z` },
    // Dropped: not a kind of change, and older than the panel's week.
    { at: ago(2), site: 'canvas', type: 'deleted_everything', name: 'Bogus', course: '', url: '' },
    { at: ago(24 * 9), site: 'canvas', type: 'new', name: 'Last month', course: '', url: '' },
  ] }));

  const panel = page.getByRole('region', { name: 'What changed' });
  await expect(panel).toBeVisible();
  const rows = panel.getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Due date moved');
  await expect(rows.nth(0)).toContainText('Microscope lab report');
  await expect(rows.nth(1)).toContainText('9 / 10');
  await expect(rows.nth(2)).toContainText('Field trip form');
  // A link to another site never survives: that row isn't a link.
  await expect(rows.nth(2).getByRole('link')).toHaveCount(0);
  await expect(rows.nth(0).getByRole('link')).toHaveAttribute('href', 'https://school.instructure.com/courses/456/assignments/124');
  await expect(panel).not.toContainText('Bogus');
  await expect(panel).not.toContainText('Last month');
});

test('What changed stays hidden until there is a change', async ({ page }) => {
  await setup(page);
  await page.goto('/deadlines');
  await expect(page.getByText('Cell structure homework')).toBeVisible();
  await fromExtension(page, snapshot());
  await expect(page.getByText('Microscope lab report')).toBeVisible();
  await expect(page.getByRole('region', { name: 'What changed' })).toHaveCount(0);
});
