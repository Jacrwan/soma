import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Chrome Web Store screenshots (1280×800) of Soma for Canvas: the real popup
 * and Soma's Deadlines page, with made-up coursework. Not a regression test,
 * so it only runs when asked:
 *
 *   STORE_SHOTS=1 npx playwright test tests/store-screenshots.spec.ts
 *
 * Images land in extension/store/.
 */

test.skip(!process.env.STORE_SHOTS, 'store screenshots run only with STORE_SHOTS=1');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'extension', 'store');
const HOUR = 3600 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
/** A realistic deadline: `days` from today at a round clock time. */
const dueOn = (days: number, hour: number, minute = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, minute, 0, 0); return d.toISOString(); };

const snapshots = () => ({
  'school.instructure.com': {
    kind: 'canvas', host: 'school.instructure.com', syncedAt: at(-0.2),
    courses: [{ id: 1, name: 'BIO 101: Cell Biology - Fall 2026', courseCode: 'BIO 101' }],
    assignments: [
      { id: 11, courseId: 1, name: 'Quiz 3: Mitosis', dueAt: dueOn(2, 13, 0), htmlUrl: 'https://school.instructure.com/a/11', workflowState: 'unsubmitted', pointsPossible: 20 },
      { id: 10, courseId: 1, name: 'Microscope lab report', dueAt: dueOn(1, 23, 59), htmlUrl: 'https://school.instructure.com/a/10', workflowState: 'unsubmitted', submissionTypes: ['online_upload'] },
    ],
    changes: [
      { at: at(-3), site: 'canvas', type: 'graded', name: 'Homework 4', course: 'BIO 101', url: '', score: 18, maxScore: 20 },
      { at: at(-1), site: 'canvas', type: 'due_moved', name: 'Microscope lab report', course: 'BIO 101', url: '', from: dueOn(0, 23, 59), to: dueOn(1, 23, 59) },
      { at: at(-6), site: 'canvas', type: 'announcement', name: 'Midterm moved to Room 201', course: 'BIO 101', url: '' },
    ],
  },
});

const status = () => Object.fromEntries(Object.entries(snapshots()).map(([h, s]) => [h, { syncedAt: s.syncedAt, attemptedAt: s.syncedAt, deliveredAt: s.syncedAt, error: null, courses: s.courses.length, assignments: s.assignments.length }]));

async function popupShot(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('https://extension.test/**', route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html';
    return route.fulfill({ contentType: type, body: fs.readFileSync(path.join(root, 'extension', file)) });
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
  // The popup is 320px wide: shown at 2× on a quiet backdrop, as it looks over a page.
  await page.addStyleTag({ content: `
    html { background: #ecebf6; min-height: 100%; }
    body { zoom: 2; margin: 22px auto 0; border-radius: 12px; box-shadow: 0 10px 30px rgb(30 30 60 / .18); }
  ` });
  await page.screenshot({ path: path.join(out, 'screenshot-1-popup.png') });
}

test('store screenshot: the popup', async ({ page }) => {
  fs.mkdirSync(out, { recursive: true });
  await popupShot(page);
});

test('store screenshot: Soma Deadlines with synced work', async ({ page }) => {
  fs.mkdirSync(out, { recursive: true });
  const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
  const subjects = [
    { id: 'bio', name: 'BIO 101: Cell Biology - Fall 2026', color: '#66bb6a', archived: false, source: 'canvas', canvas_course_id: 1 },
  ];
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, walkthroughCompleted: true, theme: 'light', canvasIcalUrl: 'https://school.instructure.com/feed.ics' } } });
    if (table === 'subjects') return route.fulfill({ json: subjects });
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/canvas-ical', r => r.fulfill({ json: { assignments: [
    { id: 10, name: 'Microscope lab report', courseId: 1, courseName: 'BIO 101: Cell Biology - Fall 2026', dueAt: dueOn(1, 23, 59), htmlUrl: 'https://school.instructure.com/a/10', status: 'not_started' },
    { id: 11, name: 'Quiz 3: Mitosis', courseId: 1, courseName: 'BIO 101: Cell Biology - Fall 2026', dueAt: dueOn(2, 13, 0), htmlUrl: 'https://school.instructure.com/a/11', status: 'not_started' },
  ] } }));
  await page.goto('/deadlines');
  await expect(page.getByText('Microscope lab report').first()).toBeVisible();
  for (const s of Object.values(snapshots())) {
    await page.evaluate(snap => window.postMessage({ source: 'soma-extension', type: 'canvas_snapshot', snapshot: { v: 1, ...snap } }, window.location.origin), s);
  }
  await expect(page.getByRole('region', { name: 'What changed' })).toBeVisible();
  await expect(page.getByText('Quiz 3: Mitosis').first()).toBeVisible();
  await page.screenshot({ path: path.join(out, 'screenshot-2-deadlines.png') });
});
