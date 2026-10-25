import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The extension's site readers (extension/canvas.js, extension/gradescope.js)
 * running in a real browser page against synthetic copies of the sites, with
 * chrome.storage and chrome.runtime stubbed. They check what each reader
 * stores, which is what the app then receives.
 */

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const fixture = (name: string) => read(`tests/fixtures/gradescope/${name}`);

type Store = { snapshots?: Record<string, Record<string, unknown>>; status?: Record<string, Record<string, unknown>> };

/** A page at `url` with the reader's scripts injected, as Chrome would. */
async function runReader(page: Page, url: string, scripts: string[], settings: Record<string, unknown> = {}) {
  await page.addInitScript(s => {
    const store: Record<string, unknown> = { settings: s };
    const listeners: ((msg: unknown, sender: unknown, reply: (r: unknown) => void) => boolean)[] = [];
    (window as unknown as { chrome: unknown }).chrome = {
      storage: { local: {
        get: async (k: string | string[]) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter(x => x in store).map(x => [x, store[x]])),
        set: async (o: Record<string, unknown>) => { Object.assign(store, o); },
      } },
      runtime: { onMessage: { addListener: (f: typeof listeners[number]) => listeners.push(f) } },
    };
    (window as unknown as { __store: unknown }).__store = store;
    (window as unknown as { __send: unknown }).__send = (msg: unknown) => new Promise(r => listeners.forEach(f => f(msg, null, r)));
  }, settings);
  await page.goto(url);
  for (const s of scripts) await page.addScriptTag({ content: read(`extension/${s}`) });
}

const stored = (page: Page) => page.evaluate(() => (window as unknown as { __store: Store }).__store);

async function gradescopeSite(page: Page) {
  const fetched: string[] = [];
  await page.route('https://www.gradescope.com/**', route => {
    const url = new URL(route.request().url());
    fetched.push(url.pathname);
    const body = url.pathname === '/' ? fixture('dashboard.html')
      : url.pathname === '/courses/600001' ? fixture('course-physics.html')
      : url.pathname === '/courses/600002' ? '<html><body><p>No assignments yet.</p></body></html>'
      : null;
    return body ? route.fulfill({ contentType: 'text/html', body }) : route.fulfill({ status: 404, body: '' });
  });
  return fetched;
}

test('Gradescope: current student courses, statuses, due and late due dates', async ({ page }) => {
  const fetched = await gradescopeSite(page);
  await runReader(page, 'https://www.gradescope.com/', ['common.js', 'gradescope.js']);
  await expect.poll(async () => !!(await stored(page)).snapshots?.['www.gradescope.com']).toBe(true);

  const snap = (await stored(page)).snapshots!['www.gradescope.com'] as {
    kind: string; courses: { id: number; shortName: string; term: string }[];
    assignments: { id: number; name: string; status: string; score: number | null; maxScore: number | null; dueAt: string; lateDueAt: string | null; htmlUrl: string }[];
  };
  expect(snap.kind).toBe('gradescope');
  // Newest term only, student courses only, never the sidebar menu link.
  expect(snap.courses.map(c => c.shortName)).toEqual(['PHYSICS 7A', 'COMPSCI 61A']);
  expect(snap.courses[0].term).toBe('Fall 2026');
  expect(fetched).not.toContain('/courses/500001');
  expect(fetched).not.toContain('/courses/400001');

  const byId = new Map(snap.assignments.map(a => [a.id, a]));
  expect(byId.get(7001)).toMatchObject({ name: 'Homework 4', status: 'submitted', dueAt: '2026-10-28T06:59:00.000Z', lateDueAt: null });
  // Not handed in yet: the one Soma has to keep in front of the student.
  expect(byId.get(7002)).toMatchObject({ name: 'Homework 5: Momentum', status: 'not_submitted', dueAt: '2026-11-04T07:59:00.000Z', lateDueAt: '2026-11-06T07:59:00.000Z' });
  expect(byId.get(7002)!.htmlUrl).toBe('https://www.gradescope.com/courses/600001/assignments/7002');
  expect(byId.get(7000)).toMatchObject({ status: 'graded', score: 8.5, maxScore: 10 });
});

test('Gradescope: grades off keeps the status but drops the score', async ({ page }) => {
  await gradescopeSite(page);
  await runReader(page, 'https://www.gradescope.com/', ['common.js', 'gradescope.js'], { grades: false });
  await expect.poll(async () => !!(await stored(page)).snapshots?.['www.gradescope.com']).toBe(true);
  const hw3 = ((await stored(page)).snapshots!['www.gradescope.com'].assignments as { id: number; status: string; score: unknown }[]).find(a => a.id === 7000)!;
  expect(hw3).toMatchObject({ status: 'graded', score: null });
});

test('Gradescope: pages it cannot read keep the last good sync', async ({ page }) => {
  await page.route('https://www.gradescope.com/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: fixture('dashboard.html') });
    return route.fulfill({ status: 500, body: '' });
  });
  await runReader(page, 'https://www.gradescope.com/', ['common.js', 'gradescope.js']);
  await expect.poll(async () => (await stored(page)).status?.['www.gradescope.com']?.error ?? null).not.toBeNull();
  expect((await stored(page)).snapshots?.['www.gradescope.com']).toBeUndefined();
});

test('Canvas: reads courses, weights, submissions and announcements', async ({ page }) => {
  const origin = 'https://school.instructure.com';
  const json = (body: unknown, next?: string) => ({ contentType: 'application/json', headers: next ? { Link: `<${origin}${next}>; rel="next"` } : {}, body: JSON.stringify(body) });
  await page.route(`${origin}/**`, route => {
    const url = new URL(route.request().url()), p = url.pathname, q = url.search;
    if (p === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="application" class="ic-app"></div>' });
    if (p === '/api/v1/courses') return route.fulfill(json([{ id: 11, name: 'PHYS 7A', apply_assignment_group_weights: true, enrollments: [{ type: 'student', computed_current_score: 91.2, computed_current_grade: 'A-' }] }]));
    if (p === '/api/v1/courses/11/assignment_groups') return route.fulfill(json([{ id: 5, name: 'Homework', group_weight: 20 }]));
    if (p === '/api/v1/courses/11/assignments' && !q.includes('page=2')) return route.fulfill(json([{ id: 100, name: 'HW 4', due_at: '2099-10-27T06:59:00Z', description: '<p>Problems <b>1-5</b></p>', points_possible: 10, assignment_group_id: 5, submission: { submitted_at: '2026-10-24T01:00:00Z', workflow_state: 'submitted' } }], '/api/v1/courses/11/assignments?page=2'));
    if (p === '/api/v1/courses/11/assignments') return route.fulfill(json([{ id: 101, name: 'HW 5', due_at: null }]));
    if (p === '/api/v1/announcements') return route.fulfill({ contentType: 'application/json', body: 'while(1);' + JSON.stringify([{ id: 1, title: 'Exam room', message: '<p>Room 1</p>', posted_at: '2026-10-24T00:00:00Z', context_code: 'course_11' }]) });
    return route.fulfill({ status: 404, body: '' });
  });
  await runReader(page, `${origin}/`, ['common.js', 'canvas.js']);
  await expect.poll(async () => !!(await stored(page)).snapshots?.['school.instructure.com']).toBe(true);
  const snap = (await stored(page)).snapshots!['school.instructure.com'] as {
    kind: string; courses: { currentGrade: string; weighted: boolean }[]; groups: unknown[];
    assignments: { id: number; description: string; workflowState: string }[]; announcements: { message: string }[];
  };
  expect(snap.kind).toBe('canvas');
  expect(snap.courses[0]).toMatchObject({ currentGrade: 'A-', weighted: true });
  expect(snap.assignments.map(a => a.id)).toEqual([100, 101]);
  expect(snap.assignments[0]).toMatchObject({ description: 'Problems 1-5', workflowState: 'submitted' });
  expect(snap.announcements[0].message).toBe('Room 1');
});

test('Sync now and the popup probe get answers', async ({ page }) => {
  await gradescopeSite(page);
  await runReader(page, 'https://www.gradescope.com/', ['common.js', 'gradescope.js']);
  await expect.poll(async () => !!(await stored(page)).snapshots?.['www.gradescope.com']).toBe(true);
  const reply = await page.evaluate(() => (window as unknown as { __send: (m: unknown) => Promise<unknown> }).__send({ type: 'sync_now' }));
  expect(reply).toMatchObject({ ok: true, courses: 2, assignments: 3 });
  const probe = await page.evaluate(() => (window as unknown as { __send: (m: unknown) => Promise<unknown> }).__send({ type: 'probe' }));
  expect(probe).toMatchObject({ supported: true, host: 'www.gradescope.com' });
});
