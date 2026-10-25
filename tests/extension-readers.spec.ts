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

test('the background sync can run a reader by origin, away from the site\'s own tab', async ({ page }) => {
  // offscreen.js calls self.somaReaders[kind](origin); here from a page on another site.
  await gradescopeSite(page);
  await page.route('https://soma.test/**', r => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.route('https://www.gradescope.com/**', async route => {
    const url = new URL(route.request().url());
    const body = url.pathname === '/' ? fixture('dashboard.html') : url.pathname === '/courses/600001' ? fixture('course-physics.html') : '<html></html>';
    await route.fulfill({ contentType: 'text/html', body, headers: { 'Access-Control-Allow-Origin': 'https://soma.test', 'Access-Control-Allow-Credentials': 'true' } });
  });
  await runReader(page, 'https://soma.test/', ['common.js', 'gradescope.js']);
  const snap = await page.evaluate(async () => {
    const readers = (self as unknown as { somaReaders: Record<string, (o: string) => (s: { grades: boolean }) => Promise<{ kind: string; assignments: unknown[] }>> }).somaReaders;
    return readers.gradescope('https://www.gradescope.com')({ grades: true });
  });
  expect(snap.kind).toBe('gradescope');
  expect(snap.assignments).toHaveLength(3);
  // Not on Gradescope, so it didn't start a sync of its own.
  expect((await stored(page)).snapshots).toBeUndefined();
});

test('a bridge cut off by an extension reload goes quiet instead of throwing', async ({ page }) => {
  // After a reload, every chrome.* call in a tab's old copy of the script throws.
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://somastudy.app/**', r => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.addInitScript(() => {
    let dead = false;
    const gone = () => { if (dead) throw new Error('Extension context invalidated.'); };
    (window as unknown as { __kill: () => void }).__kill = () => { dead = true; };
    (window as unknown as { chrome: unknown }).chrome = {
      runtime: {
        get id() { gone(); return 'ext'; },
        getManifest: () => ({ version: '0.1.0' }),
        sendMessage: () => { gone(); return Promise.resolve([]); },
      },
      storage: {
        local: { get: async () => { gone(); return {}; }, set: async () => { gone(); }, remove: async () => { gone(); } },
        onChanged: { addListener: () => {} },
      },
    };
  });
  await page.goto('https://somastudy.app/');
  await page.addScriptTag({ content: read('extension/bridge.js') });
  await page.evaluate(() => (window as unknown as { __kill: () => void }).__kill());
  await page.evaluate(() => {
    for (const type of ['hello', 'sync_request', 'forget']) window.postMessage({ source: 'soma-app', type }, window.location.origin);
  });
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

async function webassignSite(page: Page, { signedOut = false } = {}) {
  const fetched: string[] = [];
  await page.route('https://www.webassign.net/**', route => {
    const url = new URL(route.request().url());
    fetched.push(url.pathname + url.search);
    if (signedOut) return route.fulfill({ contentType: 'text/html', body: '<html><body><form><input type="password"></form></body></html>' });
    const dep = url.searchParams.get('dep');
    const body = url.pathname === '/v4cgi/student.pl' ? read('tests/fixtures/webassign/home.html')
      : url.pathname === '/web/Student/Assignment-Responses/last' && dep ? read(`tests/fixtures/webassign/assignment-${dep}.html`)
      : '<html><body></body></html>';
    return route.fulfill({ contentType: 'text/html', body });
  });
  return fetched;
}

test('WebAssign: current assignments, due times, and how far along each is', async ({ page }) => {
  const fetched = await webassignSite(page);
  await runReader(page, 'https://www.webassign.net/v4cgi/student.pl', ['common.js', 'webassign.js']);
  await expect.poll(async () => !!(await stored(page)).snapshots?.['www.webassign.net']).toBe(true);
  const snap = (await stored(page)).snapshots!['www.webassign.net'] as {
    kind: string; courses: { id: number; name: string }[];
    assignments: { id: number; name: string; dueAt: string; status: string; parts: number; answered: number; score: number | null; maxScore: number | null; htmlUrl: string }[];
  };
  expect(snap.kind).toBe('webassign');
  // Course from the page title, id from the class's context id.
  expect(snap.courses).toEqual([{ id: 7700001, name: 'BIO 101, Fall 2026' }]);
  const byId = new Map(snap.assignments.map(a => [a.id, a]));
  // Due times are epoch seconds in the page's data.
  expect(byId.get(5001)).toMatchObject({ name: 'HW 7, due 10/26 1pm', dueAt: '2026-10-26T17:00:00.000Z', status: 'complete', parts: 3, answered: 3, score: 3.5, maxScore: 4 });
  expect(byId.get(5002)).toMatchObject({ status: 'in_progress', parts: 3, answered: 1 });
  expect(byId.get(5003)).toMatchObject({ status: 'not_started', answered: 0, score: null });
  expect(byId.get(5003)!.htmlUrl).toBe('https://www.webassign.net/web/Student/Assignment-Responses/last?dep=5003');
  // Past assignments are only ids on the home page: never fetched.
  expect(fetched.some(f => /dep=400[12]/.test(f))).toBe(false);
});

test('WebAssign: grades off keeps progress but drops the score', async ({ page }) => {
  await webassignSite(page);
  await runReader(page, 'https://www.webassign.net/v4cgi/student.pl', ['common.js', 'webassign.js'], { grades: false });
  await expect.poll(async () => !!(await stored(page)).snapshots?.['www.webassign.net']).toBe(true);
  const hw7 = ((await stored(page)).snapshots!['www.webassign.net'].assignments as { id: number; status: string; score: unknown }[]).find(a => a.id === 5001)!;
  expect(hw7).toMatchObject({ status: 'complete', score: null });
});

test('WebAssign: signed out records it and keeps the last sync', async ({ page }) => {
  await webassignSite(page, { signedOut: true });
  // A page that isn't a sign-in form, so the reader starts; its fetches hit the sign-in page.
  await page.route('https://www.webassign.net/web/Student/Home', r => r.fulfill({ contentType: 'text/html', body: '<div id="js-student-myAssignmentsWrapper"></div>' }));
  await runReader(page, 'https://www.webassign.net/web/Student/Home', ['common.js', 'webassign.js']);
  await expect.poll(async () => (await stored(page)).status?.['www.webassign.net']?.error ?? null).toBe('Sign in to WebAssign, then sync again.');
  expect((await stored(page)).snapshots?.['www.webassign.net']).toBeUndefined();
});
