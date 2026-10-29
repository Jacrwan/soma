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

type Opts = { subjects?: unknown[]; books?: unknown[]; documents?: unknown[]; saved?: Record<string, unknown>[] };

async function setup(page: Page, opts: Opts = {}) {
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light', canvasIcalUrl: 'https://school.instructure.com/feed.ics' } } });
    if (table === 'subjects') return route.fulfill({ json: opts.subjects ?? [BIO] });
    if (table === 'documents') return route.fulfill({ json: opts.documents ?? [] });
    if (table === 'grade_books') {
      if (req.method() === 'POST') { opts.saved?.push(req.postDataJSON()); return route.fulfill({ status: 201, body: '' }); }
      return route.fulfill({ json: opts.books ?? [] });
    }
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
  await expect(page.getByRole('link', { name: 'Add to Chrome' })).toBeVisible();
  await send(page, canvas);
  await send(page, gradescope);
  await page.getByRole('button', { name: 'Grades' }).click();
  await expect(page).toHaveURL(/\/grades$/);

  // The page is the courses, each with its grade big; no assignments yet.
  const bioCard = page.getByRole('button', { name: /^Biology 101, 2 graded/ });
  await expect(bioCard.getByLabel('Course grade B+, 88.5%')).toBeVisible();
  await expect(page.getByText('Cell structure homework')).toHaveCount(0);
  // The row carries the student's colour for the course.
  await expect(bioCard.locator('[class*="dot"]')).toHaveCSS('background-color', 'rgb(102, 187, 106)');
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

test('Grades: says how to get grades before there are any courses', async ({ page }) => {
  await setup(page, { subjects: [] });
  await page.goto('/grades');
  await expect(page.getByText(/No grades yet/)).toBeVisible();
});

test('Grades: a course with nothing synced still has a row, to add scores to', async ({ page }) => {
  await setup(page);
  await page.goto('/grades');
  await expect(page.getByRole('button', { name: /^Biology 101, no scores yet/ })).toBeVisible();
});

// ── Grade books (2026-10-28): syllabus weights, typed-in scores, stars ────────

const CS = { id: 'cs', name: 'CS 61A Fall 2026', color: '#42a5f5', archived: false, source: 'manual' };
const HW = { id: 'cat-hw', name: 'Homework', weight: 40, covers: 'Weekly homework', drop: 0, match: ['homework', 'hw'] };
const EXAMS = { id: 'cat-ex', name: 'Exams', weight: 60, covers: 'Midterm and final', drop: 0, match: ['midterm', 'final'] };
const bioBook = {
  id: '22222222-2222-4222-8222-222222222222', course_key: 'subject:bio', starred: false, picks: {},
  categories: [HW, EXAMS], scale: [{ letter: 'A', min: 93 }, { letter: 'B', min: 83 }, { letter: 'C', min: 73 }, { letter: 'D', min: 63 }],
  // Typed in from Gradescope; no category chosen, so its name puts it in Exams.
  entries: [{ id: 'e1', name: 'Midterm 1', score: 40, max: 50, categoryId: null, date: '2026-10-15' }],
};

async function openGrades(page: Page) {
  await page.goto('/deadlines');
  await expect(page.getByRole('link', { name: 'Add to Chrome' })).toBeVisible();
  await send(page, canvas);
  await page.getByRole('button', { name: 'Grades' }).click();
  await expect(page).toHaveURL(/\/grades$/);
}

test('Grades: Canvas and typed-in scores make one grade, weighted the way the syllabus says', async ({ page }) => {
  const saved: Record<string, unknown>[] = [];
  await setup(page, { subjects: [BIO, CS], books: [bioBook], saved });
  await openGrades(page);

  // Homework 9/10 = 90% (Canvas) at 40%, Exams 40/50 = 80% (typed in) at 60%: 84%, a B.
  const bio = page.getByRole('button', { name: /^Biology 101, 2 graded/ });
  await expect(bio.getByLabel('Weighted grade B, 84%')).toBeVisible();
  // A course the student keeps in Soma shows even with nothing synced, so scores can be added.
  await expect(page.getByRole('button', { name: /^CS 61A Fall 2026, no scores yet/ })).toBeVisible();

  await bio.click();
  const grading = page.getByRole('region', { name: 'Grading' });
  // Set up, it folds to one line until opened.
  await expect(grading).toContainText('Weights · 2 categories');
  await expect(grading.getByRole('listitem')).toHaveCount(0);
  await grading.getByRole('button', { name: 'Grading' }).click();
  await expect(grading.getByRole('button', { name: 'Grading' })).toHaveAttribute('aria-expanded', 'true');
  await expect(grading.getByRole('listitem').filter({ hasText: 'Homework' })).toContainText('40%');
  await expect(grading.getByRole('listitem').filter({ hasText: 'Homework' })).toContainText('90%');
  await expect(grading.getByRole('listitem').filter({ hasText: 'Exams' })).toContainText('80%');
  await expect(grading).toContainText('Letter grades: A 93+');
  await expect(page.getByText('Canvas shows 88.5%, from its own scores only.')).toBeVisible();
  const scores = page.getByRole('region', { name: 'Scores' });
  await expect(scores.getByRole('listitem').filter({ hasText: 'Midterm 1' })).toContainText('Added by you');
  await expect(scores.getByLabel('Category for Midterm 1')).toHaveValue('cat-ex');

  // Typing in a Gradescope score, in a category picked from the syllabus's.
  await scores.getByRole('button', { name: '+ Add a score' }).click();
  const form = page.getByRole('form', { name: 'Add a score' });
  await form.getByLabel('Assignment').fill('HW 2');
  await form.getByLabel('Score', { exact: true }).fill('5');
  await form.getByLabel('Out of').fill('10');
  await expect(form.getByLabel('Category').locator('option')).toHaveText(['Soma picks', 'Homework', 'Exams', 'Not counted']);
  await form.getByLabel('Category').selectOption('Homework');
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(form).toHaveCount(0);
  const added = saved.at(-1) as { course_key: string; entries: { name: string; categoryId: string }[] };
  expect(added.course_key).toBe('subject:bio');
  expect(added.entries.map(e => [e.name, e.categoryId])).toEqual([['Midterm 1', null], ['HW 2', 'cat-hw']]);
  // Homework is now 14/20 = 70%: 0.4 × 70 + 0.6 × 80 = 76%, a C.
  await expect(page.getByLabel('Weighted grade C, 76%')).toBeVisible();

  // A Canvas score taken out of the grade: Homework 5/10 = 50%, so 68%, a D.
  await scores.getByLabel('Category for Cell structure homework').selectOption('Not counted');
  await expect(page.getByLabel('Weighted grade D, 68%')).toBeVisible();
  expect((saved.at(-1) as { picks: Record<string, string> }).picks).toEqual({ 'canvas:1': 'none' });
  expect((saved.at(-1) as { entries: unknown[] }).entries).toHaveLength(2);
});

test('Grades: starred courses are the only ones shown, the rest one click away', async ({ page }) => {
  const saved: Record<string, unknown>[] = [];
  await setup(page, { subjects: [BIO, CS], saved });
  await openGrades(page);
  await expect(page.getByText('Star the courses you want to see')).toBeVisible();

  await page.getByRole('button', { name: 'Star CS 61A Fall 2026' }).click();
  await expect(page.getByRole('button', { name: 'Unstar CS 61A Fall 2026' })).toHaveAttribute('aria-pressed', 'true');
  expect(saved.at(-1)).toMatchObject({ course_key: 'subject:cs', starred: true });
  await expect(page.getByRole('button', { name: /^Biology 101/ })).toHaveCount(0);

  await page.getByRole('button', { name: '1 other course' }).click();
  await expect(page.getByRole('button', { name: /^Biology 101, 1 graded/ })).toBeVisible();
});

test('Grades: the AI reads the categories from the syllabus, and the student checks them before they count', async ({ page }) => {
  const saved: Record<string, unknown>[] = [];
  const syllabus = { id: 'doc1', subject_id: 'cs', file_name: 'CS 61A syllabus.pdf', storage_path: 'x', file_type: 'application/pdf', size_bytes: 1, doc_type: 'syllabus', created_at: '2026-08-20T00:00:00Z', extraction_status: 'done', extracted_text: 'Grading: Homework 20% (lowest 2 dropped), Projects 30%, Midterm 20%, Final 30%. A 93, B 83.' };
  await setup(page, { subjects: [BIO, CS], documents: [syllabus], saved });
  let prompt = '';
  await page.route('**/api/chat', route => {
    prompt = JSON.stringify(route.request().postDataJSON());
    return route.fulfill({ json: { content: [{ type: 'text', text: JSON.stringify({ categories: [
      { name: 'Homework', weight: 20, covers: 'Weekly homework; lowest 2 dropped', drop: 2, match: ['hw'] },
      { name: 'Projects', weight: 30, covers: 'Hog, Cats, Ants, Scheme', drop: 0, match: ['proj'] },
      { name: 'Midterm', weight: 20, covers: '', drop: 0, match: [] },
      { name: 'Final', weight: 30, covers: '', drop: 0, match: [] },
    ], scale: [{ letter: 'A', min: 93 }, { letter: 'B', min: 83 }] }) }] } });
  });
  await openGrades(page);
  await page.getByRole('button', { name: /^CS 61A Fall 2026/ }).click();

  await page.getByRole('button', { name: 'Read grading from CS 61A syllabus.pdf' }).click();
  // Nothing is saved until the student has looked at it.
  await expect(page.getByLabel('Category 2 name')).toHaveValue('Projects');
  expect(prompt).toContain('lowest 2 dropped');
  expect(saved).toHaveLength(0);
  await expect(page.getByText('Weights add up to 100%')).toBeVisible();
  await page.getByLabel('Category 4 weight in percent').fill('25');
  await expect(page.getByText('Weights add up to 95%')).toBeVisible();
  await page.getByLabel('Category 4 weight in percent').fill('30');
  await page.getByRole('button', { name: 'Save grading' }).click();
  const grading = page.getByRole('region', { name: 'Grading' });
  await expect(grading.getByRole('listitem')).toHaveCount(4);

  const book = saved.at(-1) as { course_key: string; categories: { name: string; weight: number; drop: number }[]; scale: unknown };
  expect(book.course_key).toBe('subject:cs');
  expect(book.categories.map(c => [c.name, c.weight, c.drop])).toEqual([['Homework', 20, 2], ['Projects', 30, 0], ['Midterm', 20, 0], ['Final', 30, 0]]);
  expect(book.scale).toEqual([{ letter: 'A', min: 93 }, { letter: 'B', min: 83 }]);
  await expect(grading.getByRole('listitem').filter({ hasText: 'Homework' })).toContainText('Weekly homework; lowest 2 dropped');
});

test('Grades: a course graded by a total of points adds the points up, with cutoffs in points', async ({ page }) => {
  const csBook = {
    id: '44444444-4444-4444-8444-444444444444', course_key: 'subject:cs', starred: false, picks: {},
    categories: [
      { id: 'hw', name: 'Homework', weight: 0, points: 10, covers: '', drop: 0, match: ['hw'] },
      { id: 'proj', name: 'Projects', weight: 0, points: 100, covers: 'Four projects', drop: 0, match: [] },
      { id: 'mt', name: 'Midterm 1', weight: 0, points: 20, covers: '', drop: 0, match: [] },
      { id: 'fin', name: 'Final', weight: 0, points: 170, covers: '', drop: 0, match: [] },
    ],
    scale: [{ letter: 'A', min: 285 }, { letter: 'B+', min: 260 }, { letter: 'B', min: 250 }],
    entries: [
      { id: 'a', name: 'HW 01', score: 2, max: 2, categoryId: null, date: '2026-09-01' },
      { id: 'b', name: 'Hog', score: 23, max: 25, categoryId: 'proj', date: '2026-09-20' },
      // Scored out of 80 on Gradescope, worth 20 in the course: counts as 15 of 20.
      { id: 'c', name: 'Midterm 1', score: 60, max: 80, categoryId: 'mt', date: '2026-10-01' },
    ],
  };
  await setup(page, { subjects: [BIO, CS], books: [csBook] });
  await openGrades(page);

  // 2 + 23 + 15 = 40 of 47 graded: 85.1%, a pace of 255 of 300, a B.
  const cs = page.getByRole('button', { name: /^CS 61A Fall 2026, 3 graded/ });
  await expect(cs.getByLabel('Grade by points B, 85.1%')).toBeVisible();
  await expect(cs).toContainText('by points');
  await cs.click();
  const grading = page.getByRole('region', { name: 'Grading' });
  await expect(grading).toContainText('Total points · 300 pts · 4 categories');
  await grading.getByRole('button', { name: 'Grading' }).click();
  await expect(grading.getByRole('listitem').filter({ hasText: 'Projects' })).toContainText('100 pts');
  await expect(grading.getByRole('listitem').filter({ hasText: 'Midterm 1' })).toContainText('15 / 20 pts');
  await expect(grading).toContainText('40 of 47 points graded so far, out of 300 in the course.');
  await expect(grading).toContainText('A 285+ pts');
  await expect(page.getByText('40 of 47 points so far')).toBeVisible();

  // Editing keeps the points: no percent weights appear.
  await grading.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('radio', { name: 'Total points' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Category 2 points')).toHaveValue('100');
  await expect(page.getByText('300 points in all')).toBeVisible();
});

test('Grades: a points syllabus is read as points, not turned into percents', async ({ page }) => {
  const saved: Record<string, unknown>[] = [];
  const syllabus = { id: 'doc1', subject_id: 'cs', file_name: 'CS 61A syllabus.pdf', storage_path: 'x', file_type: 'application/pdf', size_bytes: 1, doc_type: 'syllabus', created_at: '2026-08-20T00:00:00Z', extraction_status: 'done', extracted_text: 'Your course grade is computed from 300 points: projects 100, final 75, midterms 20 + 45 + 20 ...' };
  await setup(page, { subjects: [BIO, CS], documents: [syllabus], saved });
  let prompt = '';
  await page.route('**/api/chat', route => {
    prompt = JSON.stringify(route.request().postDataJSON());
    return route.fulfill({ json: { content: [{ type: 'text', text: JSON.stringify({ mode: 'points', categories: [
      { name: 'Projects', points: 100, covers: 'Four projects', drop: 0, match: ['proj'] },
      // A stray percent beside the points is ignored.
      { name: 'Final', points: 75, weight: 25, covers: '', drop: 0, match: ['final'] },
      { name: 'Quizzes', points: 10, covers: 'Best 5 of 8', drop: 3, match: ['quiz'] },
    ], scale: [{ letter: 'A', min: 175 }] }) }] } });
  });
  await openGrades(page);
  await page.getByRole('button', { name: /^CS 61A Fall 2026/ }).click();
  await page.getByRole('button', { name: 'Read grading from CS 61A syllabus.pdf' }).click();

  await expect(page.getByRole('radio', { name: 'Total points' })).toHaveAttribute('aria-checked', 'true');
  expect(prompt).toContain('Never turn points into percents');
  await expect(page.getByLabel('Category 1 points')).toHaveValue('100');
  await expect(page.getByText('185 points in all')).toBeVisible();
  await expect(page.getByLabel('Letter grade cutoffs')).toHaveValue('A 175');
  await page.getByRole('button', { name: 'Save grading' }).click();
  await expect(page.getByRole('region', { name: 'Grading' }).getByRole('listitem')).toHaveCount(3);
  const book = saved.at(-1) as { categories: { name: string; points: number; drop: number }[]; scale: unknown };
  expect(book.categories.map(c => [c.name, c.points, c.drop])).toEqual([['Projects', 100, 0], ['Final', 75, 0], ['Quizzes', 10, 3]]);
  expect(book.scale).toEqual([{ letter: 'A', min: 175 }]);
});

/** A minimal .xlsx: a zip (stored, not compressed) of a shared-strings file and one sheet. */
function xlsx(rows: (string | number)[][]): Buffer {
  const strings: string[] = [];
  const cell = (v: string | number, r: number, c: number) => {
    const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    strings.push(v);
    return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
  };
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const shared = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map(t => `<si><t>${t}</t></si>`).join('')}</sst>`;
  const files = [['xl/worksheets/sheet1.xml', sheet], ['xl/sharedStrings.xml', shared]].map(([name, body]) => ({ name: Buffer.from(name), data: Buffer.from(body) }));
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(f.data.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(f.name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(f.data.length, 20); central.writeUInt32LE(f.data.length, 24); central.writeUInt16LE(f.name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, f.name, f.data); centrals.push(central, f.name);
    offset += 30 + f.name.length + f.data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

test('Grades: scores pasted from a Gradescope course page are checked, then imported', async ({ page }) => {
  const saved: Record<string, unknown>[] = [];
  const csBook = { id: '55555555-5555-4555-8555-555555555555', course_key: 'subject:cs', starred: false, picks: {}, scale: null,
    categories: [{ id: 'hw', name: 'Homework', weight: 0, points: 10, covers: '', drop: 0, match: ['homework', 'hw'] }, { id: 'proj', name: 'Projects', weight: 0, points: 100, covers: '', drop: 0, match: [] }],
    entries: [{ id: 'b', name: 'Hog', score: 23, max: 25, categoryId: 'proj', date: '2026-09-20' }] };
  await setup(page, { subjects: [BIO, CS], books: [csBook], saved });
  await openGrades(page);
  await page.getByRole('button', { name: /^CS 61A Fall 2026/ }).click();
  const scores = page.getByRole('region', { name: 'Scores' });
  await scores.getByRole('button', { name: 'Import spreadsheet' }).click();
  await scores.getByLabel('Pasted rows').fill('Name\tStatus\tReleased\tDue\nHomework 2\t1.5 / 2.0\tSep 08\tSep 12 at 11:59PM\nHog\t25.0 / 25.0\tSep 20\tSep 25 at 11:59PM\nLab 04\tSubmitted\t\tOct 02 at 11:59PM');
  await scores.getByRole('button', { name: 'Read pasted rows' }).click();

  await expect(scores).toContainText('1 new · 1 replace scores you added · 1 with no score yet, left out');
  const preview = scores.getByRole('table');
  await expect(preview.getByRole('row', { name: /Homework 2/ })).toContainText('1.5 / 2');
  await expect(preview.getByRole('row', { name: /Homework 2/ })).toContainText('Homework');
  await expect(preview.getByRole('row', { name: /Hog/ })).toContainText('Replaces yours');
  await expect(preview.getByRole('row', { name: /Hog/ })).toContainText('Projects');
  await expect(preview.getByRole('row', { name: /Lab 04/ })).toContainText('No score yet');
  expect(saved).toHaveLength(0);

  await scores.getByRole('button', { name: 'Import 2 scores' }).click();
  await expect(scores.getByRole('status')).toHaveText('Imported 2 scores from pasted rows.');
  const book = saved.at(-1) as { entries: { id: string; name: string; score: number; max: number; date: string | null }[] };
  expect(book.entries.map(e => [e.id === 'b' ? 'b' : 'new', e.name, e.score, e.max])).toEqual([['b', 'Hog', 25, 25], ['new', 'Homework 2', 1.5, 2]]);
  expect(book.entries[1].date).toMatch(/^\d{4}-09-08$/);
  await expect(scores.getByRole('listitem').filter({ hasText: 'Homework 2' })).toContainText('Added by you');
});

test('Grades: an .xlsx from Google Sheets imports, leaving out what Canvas already shows', async ({ page }) => {
  const saved: Record<string, unknown>[] = [];
  await setup(page, { subjects: [BIO], books: [bioBook], saved });
  await openGrades(page);
  await page.getByRole('button', { name: /^Biology 101/ }).click();
  const scores = page.getByRole('region', { name: 'Scores' });
  await scores.getByRole('button', { name: 'Import spreadsheet' }).click();
  await scores.getByLabel('Spreadsheet file').setInputFiles({
    name: 'Bio grades.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: xlsx([['Assignment', 'Category', 'Score', 'Out of', 'Date'], ['Final exam', 'Exams', 88, 100, 46300], ['Cell structure homework', 'Homework', 9, 10, 46315]]),
  });
  await expect(scores).toContainText('From Bio grades.xlsx.');
  await expect(scores).toContainText('1 new · 1 already synced from Canvas, left out');
  await scores.getByRole('button', { name: 'Import 1 score' }).click();
  await expect(scores.getByRole('status')).toHaveText('Imported 1 score from Bio grades.xlsx.');
  const book = saved.at(-1) as { entries: { name: string; score: number; max: number; categoryId: string | null; date: string }[] };
  expect(book.entries.at(-1)).toMatchObject({ name: 'Final exam', score: 88, max: 100, categoryId: 'cat-ex', date: '2026-10-05' });
});
