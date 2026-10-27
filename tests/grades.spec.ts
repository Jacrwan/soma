import { test, expect, type Page } from '@playwright/test';

/**
 * The Grades page (src/lib/grades.ts, components/Grades): a card per course
 * with its grade and each score, from what the Soma for Canvas extension
 * synced. The extension is simulated by posting the message its bridge posts.
 * All data here is made up.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const BIO = { id: 'bio', name: 'Biology 101', color: '#66bb6a', archived: false, source: 'canvas', canvas_course_id: 456 };

const FEED = { id: 123, name: 'Reading response', courseId: 456, courseName: 'Biology 101', dueAt: '2099-01-01T18:00:00Z', htmlUrl: 'https://school.instructure.com/courses/456/assignments/123', status: 'not_started' };

async function setup(page: Page) {
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light', canvasIcalUrl: 'https://school.instructure.com/feed.ics' } } });
    if (table === 'subjects') return route.fulfill({ json: [BIO] });
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/canvas-ical', r => r.fulfill({ json: { assignments: [FEED] } }));
}

const send = (page: Page, snap: unknown) =>
  page.evaluate(s => window.postMessage({ source: 'soma-extension', type: 'canvas_snapshot', snapshot: s }, window.location.origin), snap);

const canvas = {
  v: 1, host: 'school.instructure.com', syncedAt: new Date().toISOString(),
  courses: [
    { id: 456, name: 'Biology 101', courseCode: 'BIO 101', currentScore: 88.5, currentGrade: 'B+', weighted: false },
    { id: 457, name: 'Empty Seminar', courseCode: 'SEM 1', currentScore: null, currentGrade: null, weighted: false },
  ],
  groups: [],
  assignments: [
    { id: 1, courseId: 456, name: 'Cell structure homework', dueAt: '2026-10-20T18:00:00Z', htmlUrl: 'https://school.instructure.com/courses/456/assignments/1', description: '', pointsPossible: 10, groupId: null, workflowState: 'graded', score: 9, grade: '9', missing: false, late: false, excused: false },
    { id: 2, courseId: 456, name: 'Microscope lab report', dueAt: '2026-10-27T18:00:00Z', htmlUrl: 'https://school.instructure.com/courses/456/assignments/2', description: '', pointsPossible: 25, groupId: null, workflowState: 'unsubmitted', score: null, grade: null, missing: false, late: false, excused: false },
    { id: 3, courseId: 456, name: 'Excused quiz', dueAt: '2026-10-10T18:00:00Z', htmlUrl: 'https://school.instructure.com/courses/456/assignments/3', description: '', pointsPossible: 5, groupId: null, workflowState: 'graded', score: 0, grade: '0', missing: false, late: false, excused: true },
  ],
  announcements: [],
};

const gradescope = {
  kind: 'gradescope', v: 1, host: 'www.gradescope.com', syncedAt: new Date().toISOString(),
  courses: [{ id: 600001, shortName: 'BIO 101', name: 'Biology', term: 'Fall 2026' }, { id: 600009, shortName: 'ASTRO 10', name: 'Astronomy' }],
  assignments: [
    // Linked from Canvas, which already shows its score: one row, not two.
    { id: 7001, courseId: 600001, name: 'Cell structure homework', dueAt: '2026-10-20T18:00:00Z', lateDueAt: null, htmlUrl: 'https://www.gradescope.com/courses/600001/assignments/7001', status: 'graded', score: 9, maxScore: 10 },
    { id: 7002, courseId: 600001, name: 'Problem set 2', dueAt: '2026-10-22T18:00:00Z', lateDueAt: null, htmlUrl: 'https://www.gradescope.com/courses/600001/assignments/7002', status: 'graded', score: 18, maxScore: 20 },
    { id: 7004, courseId: 600001, name: 'Problem set 3', dueAt: '2026-10-29T18:00:00Z', lateDueAt: null, htmlUrl: 'https://www.gradescope.com/courses/600001/assignments/7004', status: 'submitted', score: null, maxScore: null },
    { id: 7003, courseId: 600009, name: 'Star chart', dueAt: '2026-10-21T18:00:00Z', lateDueAt: null, htmlUrl: 'https://www.gradescope.com/courses/600009/assignments/7003', status: 'graded', score: 7.5, maxScore: 10 },
  ],
};

test('Grades: a card per course with its grade and each score, Canvas and Gradescope together', async ({ page }) => {
  await setup(page);
  await page.goto('/deadlines');
  // The app listens for the extension once it has loaded the student's work.
  await expect(page.getByText('Reading response')).toBeVisible();
  await send(page, canvas);
  await send(page, gradescope);
  await page.getByRole('button', { name: 'Grades' }).click();
  await expect(page).toHaveURL(/\/grades$/);

  // The page is the courses, each with its grade big; no assignments yet.
  const bioCard = page.getByRole('button', { name: /^Biology 101, 2 graded/ });
  await expect(bioCard.getByLabel('Course grade B+, 88.5%')).toBeVisible();
  await expect(page.getByText('Cell structure homework')).toHaveCount(0);
  // Nothing to show: no card.
  await expect(page.getByRole('button', { name: /Empty Seminar/ })).toHaveCount(0);

  // Opening a course lists the score on each graded assignment.
  await bioCard.click();
  await expect(page.getByRole('heading', { name: 'Biology 101' })).toBeVisible();
  await expect(page.getByLabel('Course grade B+, 88.5%')).toBeVisible();
  const items = page.getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.filter({ hasText: 'Cell structure homework' })).toContainText('9 / 10');
  await expect(items.filter({ hasText: 'Cell structure homework' })).toContainText('90%');
  // Gradescope work joins the Canvas course of the same number, tagged.
  const ps2 = items.filter({ hasText: 'Problem set 2' });
  await expect(ps2).toContainText('18 / 20');
  await expect(ps2).toContainText('Gradescope');
  // Not graded, or excused: not a score.
  await expect(page.getByText('Microscope lab report')).toHaveCount(0);
  await expect(page.getByText('Problem set 3')).toHaveCount(0);
  await expect(page.getByText('Excused quiz')).toHaveCount(0);

  // A Gradescope course Canvas doesn't have: its own card, headlined by its average.
  await page.getByRole('button', { name: '← All courses' }).click();
  const astro = page.getByRole('button', { name: /^Astronomy, 1 graded/ });
  await expect(astro.getByLabel('Average 75%')).toBeVisible();
});

test('Grades: says how to get grades before anything has synced', async ({ page }) => {
  await setup(page);
  await page.goto('/grades');
  await expect(page.getByText(/No grades yet/)).toBeVisible();
});
