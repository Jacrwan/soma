import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Chrome Web Store screenshots (1280×800) of Soma for Canvas: the real popup
 * and Soma's own pages, with made-up coursework, set on Soma's colours with a
 * headline each. Not a regression test, so it only runs when asked:
 *
 *   STORE_SHOTS=1 npx playwright test tests/store-screenshots.spec.ts
 *
 * Images land in extension/store/.
 */

test.skip(!process.env.STORE_SHOTS, 'store screenshots run only with STORE_SHOTS=1');
test.use({ deviceScaleFactor: 2 });

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'extension', 'store');
const HOUR = 3600 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
/** A realistic deadline: `days` from today at a round clock time. */
const dueOn = (days: number, hour: number, minute = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, minute, 0, 0); return d.toISOString(); };

const BIO = 'BIO 101: Cell Biology - Fall 2026', CHEM = 'CHEM 110: General Chemistry - Fall 2026', ENG = 'ENG 201: Writing and Rhetoric - Fall 2026';
const PHYS = 'PHYS 7A: Mechanics - Fall 2026', MATH = 'MATH 221: Linear Algebra - Fall 2026', HIST = 'HIST 101: World History - Fall 2026';
const graded = (id: number, courseId: number, name: string, days: number, score: number, max: number) => ({
  id, courseId, name, dueAt: dueOn(days, 23, 59), htmlUrl: `https://school.instructure.com/a/${id}`, workflowState: 'graded', pointsPossible: max, score, grade: String(score),
});
const open = (id: number, courseId: number, name: string, days: number, hour: number, minute = 0, points = 20) => ({
  id, courseId, name, dueAt: dueOn(days, hour, minute), htmlUrl: `https://school.instructure.com/a/${id}`, workflowState: 'unsubmitted', pointsPossible: points,
});

const snapshots = () => ({
  'school.instructure.com': {
    kind: 'canvas', host: 'school.instructure.com', syncedAt: at(-0.2),
    courses: [
      { id: 1, name: BIO, courseCode: 'BIO 101', currentScore: 92.4, currentGrade: 'A-', weighted: false },
      { id: 2, name: CHEM, courseCode: 'CHEM 110', currentScore: 88.1, currentGrade: 'B+', weighted: false },
      { id: 3, name: ENG, courseCode: 'ENG 201', currentScore: 95.3, currentGrade: 'A', weighted: false },
      { id: 4, name: PHYS, courseCode: 'PHYS 7A', currentScore: 85.6, currentGrade: 'B', weighted: false },
      { id: 5, name: MATH, courseCode: 'MATH 221', currentScore: 90.2, currentGrade: 'A-', weighted: false },
      { id: 6, name: HIST, courseCode: 'HIST 101', currentScore: 78.9, currentGrade: 'C+', weighted: false },
    ],
    groups: [], announcements: [],
    assignments: [
      open(10, 1, 'Microscope lab report', 1, 23, 59, 25),
      open(11, 1, 'Quiz 3: Mitosis', 2, 13, 0),
      open(12, 2, 'Problem set 5', 3, 17, 0, 30),
      open(13, 3, 'Essay draft 2', 4, 23, 59, 50),
      graded(20, 1, 'Cell structure homework', -12, 9, 10), graded(21, 1, 'Lab 2: Osmosis', -9, 23, 25), graded(22, 1, 'Quiz 2: Membranes', -6, 18, 20),
      graded(23, 1, 'Homework 4', -3, 18, 20), graded(24, 1, 'Midterm exam', -20, 88, 100),
      graded(30, 2, 'Problem set 3', -10, 27, 30), graded(31, 2, 'Problem set 4', -4, 24, 30), graded(32, 2, 'Lab report 1', -14, 21, 25),
      graded(40, 3, 'Essay 1', -15, 47, 50), graded(41, 3, 'Reading response 3', -7, 10, 10),
      graded(50, 4, 'Homework 5', -5, 17, 20), graded(51, 4, 'Lab 3', -11, 21, 25),
      graded(60, 5, 'Homework 6', -4, 20, 20), graded(61, 5, 'Quiz: Matrix inverses', -9, 8, 10), graded(62, 5, 'Homework 5', -11, 18, 20),
      graded(70, 6, 'Reading quiz 4', -6, 7, 10), graded(71, 6, 'Source analysis', -13, 39, 50),
    ],
    changes: [
      { at: at(-1), site: 'canvas', type: 'due_moved', name: 'Microscope lab report', course: 'BIO 101', url: '', from: dueOn(0, 23, 59), to: dueOn(1, 23, 59) },
      { at: at(-3), site: 'canvas', type: 'graded', name: 'Homework 4', course: 'BIO 101', url: '', score: 18, maxScore: 20 },
      { at: at(-6), site: 'canvas', type: 'announcement', name: 'Midterm moved to Room 201', course: 'BIO 101', url: '' },
    ],
  },
});

const status = () => Object.fromEntries(Object.entries(snapshots()).map(([h, s]) => [h, { syncedAt: s.syncedAt, attemptedAt: s.syncedAt, deliveredAt: s.syncedAt, error: null, courses: s.courses.length, assignments: s.assignments.length }]));

/** The real popup, as a picture. */
async function popupImage(page: Page): Promise<Buffer> {
  await page.setViewportSize({ width: 400, height: 900 });
  await page.route('https://extension.test/**', route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html';
    let body = fs.readFileSync(path.join(root, 'extension', file), 'utf8');
    // The store build reads Canvas only (extension/build-release.mjs): show its words.
    if (file === 'popup.html') body = body.replace('Open Canvas, Gradescope or WebAssign once', 'Open Canvas once').replace('Canvas, Gradescope and WebAssign are read in this browser', 'Canvas is read in this browser');
    return route.fulfill({ contentType: type, body });
  });
  await page.addInitScript(data => {
    const store: Record<string, unknown> = data;
    (window as unknown as { chrome: unknown }).chrome = {
      storage: { local: { get: async (k: string | string[]) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter(x => x in store).map(x => [x, store[x]])), set: async () => {}, remove: async () => {} } },
      tabs: { query: async () => [], create: () => {}, sendMessage: () => {} },
      runtime: { sendMessage: async () => [], lastError: undefined },
      permissions: { request: async () => false },
      scripting: {},
    };
  }, { snapshots: snapshots(), status: status(), settings: {} });
  await page.goto('https://extension.test/popup.html');
  await expect(page.getByText('Quiz 3: Mitosis')).toBeVisible();
  const box = (await page.locator('body').boundingBox())!;
  const synced = (await page.getByRole('button', { name: 'Sync everything now' }).boundingBox())!;
  return page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: synced.y + synced.height + 22 - box.y } });
}

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };

/** A page of Soma, signed in with the made-up coursework, as a picture. */
async function appImage(page: Page, route: string, ready: (p: Page) => Promise<void>): Promise<Buffer> {
  const subjects = [
    { id: 'bio', name: BIO, color: '#66bb6a', archived: false, source: 'canvas', canvas_course_id: 1 },
    { id: 'chem', name: CHEM, color: '#42a5f5', archived: false, source: 'canvas', canvas_course_id: 2 },
    { id: 'eng', name: ENG, color: '#ab47bc', archived: false, source: 'canvas', canvas_course_id: 3 },
    { id: 'phys', name: PHYS, color: '#ffa726', archived: false, source: 'canvas', canvas_course_id: 4 },
    { id: 'math', name: MATH, color: '#26c6da', archived: false, source: 'canvas', canvas_course_id: 5 },
    { id: 'hist', name: HIST, color: '#8d6e63', archived: false, source: 'canvas', canvas_course_id: 6 },
  ];
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', r => {
    const req = r.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return r.fulfill({ json: account });
    if (table === 'settings') return r.fulfill({ json: { data: { onboardingCompleted: true, walkthroughCompleted: true, theme: 'light', canvasIcalUrl: 'https://school.instructure.com/feed.ics' } } });
    if (table === 'subjects') return r.fulfill({ json: subjects });
    return r.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  const feed = [[10, 1, BIO, 'Microscope lab report', 1, 23, 59], [11, 1, BIO, 'Quiz 3: Mitosis', 2, 13, 0], [12, 2, CHEM, 'Problem set 5', 3, 17, 0], [13, 3, ENG, 'Essay draft 2', 4, 23, 59]] as const;
  await page.route('**/api/canvas-ical', r => r.fulfill({ json: { assignments: feed.map(([id, courseId, courseName, name, d, h, m]) => (
    { id, name, courseId, courseName, dueAt: dueOn(d, h, m), htmlUrl: `https://school.instructure.com/a/${id}`, status: 'not_started' })) } }));
  await page.goto('/deadlines');
  await expect(page.getByText('Microscope lab report').first()).toBeVisible();
  for (const s of Object.values(snapshots())) {
    await page.evaluate(snap => window.postMessage({ source: 'soma-extension', type: 'canvas_snapshot', snapshot: { v: 1, ...snap } }, window.location.origin), s);
  }
  await expect(page.getByRole('region', { name: 'What changed' })).toBeVisible();
  if (route !== '/deadlines') await page.getByRole('button', { name: route === '/grades' ? 'Grades' : 'Deadlines' }).click();
  await ready(page);
  await page.waitForTimeout(300);
  return page.screenshot();
}

const logo = fs.readFileSync(path.join(root, 'public', 'favicon.png')).toString('base64');
const data = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

/** One store image: Soma's look, a headline, and the picture. */
async function compose(page: Page, file: string, headline: string, sub: string, image: Buffer, layout: 'side' | 'below') {
  await page.setViewportSize({ width: 1280, height: 800 });
  const shot = layout === 'side'
    ? 'right: 96px; top: 50%; transform: translateY(-50%); height: 600px; border-radius: 14px;'
    : 'left: 80px; top: 282px; width: 1120px; border-radius: 14px 14px 0 0; border-bottom: none;';
  await page.setContent(`<!doctype html><meta charset="utf-8">
    <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&display=swap" rel="stylesheet">
    <style>
      * { box-sizing: border-box; margin: 0; }
      html, body { width: 1280px; height: 800px; overflow: hidden; }
      body { position: relative; font-family: 'DM Sans', sans-serif; color: oklch(22% .008 265); background: oklch(96.5% .008 270); }
      .brand { position: absolute; left: 80px; top: 56px; display: flex; align-items: center; gap: 12px; font-size: 26px; font-weight: 700; letter-spacing: -0.8px; }
      .brand img { width: 40px; height: 40px; border-radius: 10px; }
      h1 { position: absolute; left: 80px; top: ${layout === 'side' ? '210px' : '128px'}; width: ${layout === 'side' ? '520px' : '980px'}; font-size: ${layout === 'side' ? '56px' : '52px'}; line-height: 1.04; letter-spacing: -2px; font-weight: 700; }
      p { position: absolute; left: 80px; top: ${layout === 'side' ? '352px' : '200px'}; width: 520px; font-size: 21px; line-height: 1.45; color: oklch(43% .008 265); }
      .shot { position: absolute; ${shot} border: 1px solid oklch(88% .01 270); box-shadow: 0 24px 60px oklch(30% .06 270 / .22); background: white; }
    </style>
    <div class="brand"><img src="data:image/png;base64,${logo}" alt="">soma</div>
    <h1>${headline}</h1><p>${sub}</p>
    <img class="shot" src="${data(image)}" alt="">`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, file) });
}

test('store screenshots, on Soma\'s look', async ({ browser }) => {
  fs.mkdirSync(out, { recursive: true });
  const newPage = async (dsf: number) => (await browser.newContext({ deviceScaleFactor: dsf, baseURL: 'http://127.0.0.1:5179' })).newPage();

  const popup = await popupImage(await newPage(2));
  const deadlines = await appImage(await newPage(2), '/deadlines', async p => { await expect(p.getByText('Quiz 3: Mitosis').first()).toBeVisible(); });
  const grades = await appImage(await newPage(2), '/grades', async p => { await expect(p.getByText('A-').first()).toBeVisible(); });

  const c = await newPage(1);
  await compose(c, 'screenshot-1-popup.png', 'Know what’s due,<br>and what changed.', 'Soma for Canvas keeps your deadlines in one place and tells you when a date moves or a grade lands.', popup, 'side');
  await compose(c, 'screenshot-2-deadlines.png', 'Your Canvas deadlines, in your study plan.', 'Everything due, what you’ve handed in, and what changed, right in Soma.', deadlines, 'below');
  await compose(c, 'screenshot-3-grades.png', 'Every grade, course by course.', 'See each course’s grade, then open it for the score on every assignment.', grades, 'below');
});

