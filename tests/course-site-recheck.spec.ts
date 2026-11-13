import { test, expect, type Page } from '@playwright/test';
import { itemsToApply } from '../src/lib/courseSiteMatch';

/**
 * Course websites imported by address are reread every couple of hours
 * (src/lib/courseSites.ts), the way a Canvas feed stays current. Added
 * 2026-11-12: before this, a moved cs61a.org due date never reached Soma.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return key(d); };
type Row = Record<string, unknown>;
const HASH = 'a'.repeat(64);
const cs = { id: 'cs', user_id: account.id, name: 'CS 61A', color: '#26c6da', archived: false };

async function setup(page: Page, opts: { subjects?: Row[]; todos?: Row[]; settings?: Row; api: (body: Row) => Row }) {
  const state = { subjects: [...(opts.subjects ?? [])], todos: [...(opts.todos ?? [])], settings: { onboardingCompleted: true, theme: 'light', ...(opts.settings ?? {}) } as Row, requests: [] as Row[], todoWrites: 0 };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') {
      if (req.method() === 'POST') state.settings = (req.postDataJSON() as { data: Row }).data;
      return route.fulfill({ json: { data: state.settings } });
    }
    const list = table === 'subjects' ? state.subjects : table === 'todos' ? state.todos : null;
    if (list && req.method() === 'POST') {
      if (table === 'todos') state.todoWrites++;
      const body = req.postDataJSON();
      for (const row of (Array.isArray(body) ? body : [body]) as Row[]) { const i = list.findIndex(r => r.id === row.id); if (i < 0) list.push(row); else list[i] = row; }
    }
    if (list) return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? list[0] ?? null : list });
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/import-schedule', route => { const body = route.request().postDataJSON() as Row; state.requests.push(body); return route.fulfill({ json: opts.api(body) }); });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Courses', exact: true }).click();
  return state;
}
const sites = (state: { settings: Row }) => (state.settings.courseSites ?? []) as Row[];
const recheck = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const threeHoursAgo = () => new Date(Date.now() - 3 * 3600_000).toISOString();

test('importing from a web address saves the site, shows it as checked, and Stop forgets it', async ({ page }) => {
  const items = [
    { title: 'Lab 2', type: 'lab', due: offset(-3), time: null, evidence: 'Due Wed' },
    { title: 'Lab 3', type: 'lab', due: offset(5), time: null, evidence: 'Due Wed' },
  ];
  const state = await setup(page, { api: () => ({ course: 'CS 61A', source: 'https://cs61a.org/fa26/', truncated: false, items, pageHash: HASH }) });
  await page.getByRole('button', { name: 'Import deadlines from a course website' }).click();
  await page.getByLabel('Course website address').fill('https://cs61a.org');
  await page.getByRole('button', { name: 'Find deadlines' }).click();
  await page.getByRole('button', { name: 'Import 1 deadline' }).click();
  await expect(page.getByRole('status')).toContainText('reread the site every 2 hours');

  // The address the student typed is saved (it follows cs61a.org to next term),
  // with every item that was found — the unticked past lab included.
  await expect.poll(() => sites(state).length).toBe(1);
  expect(sites(state)[0]).toMatchObject({ url: 'https://cs61a.org', courseId: state.subjects[0].id, pageHash: HASH });
  expect((sites(state)[0].seen as Row[]).map(s => s.title)).toEqual(['Lab 2', 'Lab 3']);

  await page.getByRole('button', { name: 'Close' }).click();
  const list = page.getByLabel('Course websites Soma checks');
  await expect(list).toContainText('cs61a.org');
  await expect(list).toContainText('CS 61A · checked just now');
  await list.getByRole('button', { name: 'Stop checking https://cs61a.org' }).click();
  await expect(list).toHaveCount(0);
  expect(sites(state)).toHaveLength(0);
});

test('pasted text is not saved for re-checking', async ({ page }) => {
  const state = await setup(page, { subjects: [cs], api: () => ({ course: 'CS 61A', source: null, truncated: false, items: [{ title: 'Lab 3', type: 'lab', due: offset(5), time: null, evidence: 'Due Wed' }] }) });
  await page.getByRole('button', { name: 'Import deadlines from a course website' }).click();
  await page.getByRole('button', { name: /Paste the page text/ }).click();
  await page.getByLabel('Course page text').fill('Lab 3 | Due Wed 9/23 and more text here');
  await page.getByRole('button', { name: 'Find deadlines' }).click();
  await page.getByRole('button', { name: 'Import 1 deadline' }).click();
  await expect(page.getByRole('status')).toContainText('Imported');
  await expect(page.getByRole('status')).not.toContainText('reread');
  expect(sites(state)).toHaveLength(0);
});

test('a due re-check moves dates and adds newly posted work, but never re-adds what the student left out', async ({ page }) => {
  const seen = [{ title: 'Lab 3', due: offset(5) }, { title: 'Homework 3', due: offset(4) }, { title: 'Hog project', due: offset(12) }];
  const state = await setup(page, {
    subjects: [cs],
    todos: [
      { id: 'hw3', user_id: account.id, text: 'Homework 3', status: 'nothing', subject_id: 'cs', due_date: offset(4), date: offset(4) },
      { id: 'lab3', user_id: account.id, text: 'Lab 3', status: 'nothing', subject_id: 'cs', due_date: offset(5), date: offset(5) },
    ],
    settings: { courseSites: [{ url: 'https://cs61a.org', courseId: 'cs', checkedAt: threeHoursAgo(), pageHash: HASH, seen }] },
    api: () => ({ course: 'CS 61A', source: 'https://cs61a.org/fa26/', truncated: false, pageHash: 'b'.repeat(64), items: [
      { title: 'Homework 3', type: 'homework', due: offset(6), time: null, evidence: 'x' },     // moved
      { title: 'Lab 3', type: 'lab', due: offset(5), time: null, evidence: 'x' },               // same
      { title: 'Hog project', type: 'project', due: offset(12), time: null, evidence: 'x' },     // left unticked at import
      { title: 'Lab 4', type: 'lab', due: offset(9), time: null, evidence: 'x' },               // newly posted
      { title: 'Lab 5', type: 'lab', due: offset(10), time: null, evidence: '', unverified: true }, // date not on the page
      { title: 'Lab 1', type: 'lab', due: offset(-8), time: null, evidence: 'x' },              // already past
    ] }),
  });
  await recheck(page);
  await expect.poll(() => (sites(state)[0]?.lastChange as Row | undefined)?.added).toBe(1);

  expect(state.requests.at(-1)).toMatchObject({ url: 'https://cs61a.org', known: HASH });
  expect(state.todos.map(t => t.text).sort()).toEqual(['Homework 3', 'Lab 3', 'Lab 4']);
  expect(state.todos.find(t => t.id === 'hw3')).toMatchObject({ due_date: offset(6), date: offset(6) });
  expect(sites(state)[0]).toMatchObject({ pageHash: 'b'.repeat(64), lastChange: { added: 1, updated: 1 } });
  await expect(page.getByLabel('Course websites Soma checks')).toContainText('1 added, 1 moved');
});

test('an unchanged page saves nothing and waits two hours; a fresh check is not repeated', async ({ page }) => {
  const state = await setup(page, {
    subjects: [cs],
    settings: { courseSites: [
      { url: 'https://cs61a.org', courseId: 'cs', checkedAt: threeHoursAgo(), pageHash: HASH, seen: [] },
      { url: 'https://inst.eecs.berkeley.edu/~cs61b', courseId: 'cs', checkedAt: new Date().toISOString(), seen: [] },
    ] },
    api: () => ({ unchanged: true, source: 'https://cs61a.org/fa26/', pageHash: HASH }),
  });
  await recheck(page);
  await expect.poll(() => Date.parse(sites(state)[0].checkedAt as string)).toBeGreaterThan(Date.now() - 60_000);
  expect(state.requests.map(r => r.url)).toEqual(['https://cs61a.org']);
  expect(state.todoWrites).toBe(0);
});

test('a site whose course is gone stops being checked', async ({ page }) => {
  const state = await setup(page, {
    subjects: [cs],
    settings: { courseSites: [{ url: 'https://old.example.edu', courseId: 'deleted-course', checkedAt: threeHoursAgo(), seen: [] }] },
    api: () => ({ unchanged: true }),
  });
  await recheck(page);
  await expect.poll(() => sites(state).length).toBe(0);
  expect(state.requests).toHaveLength(0);
});

test('what a re-check applies, as a rule', () => {
  const today = '2026-11-12';
  const item = (title: string, due: string, extra: Row = {}) => ({ title, type: 'homework', due, time: null, evidence: 'x', ...extra });
  const out = itemsToApply(
    [item('HW 1', '2026-11-20'), item('HW 2', '2026-11-21'), item('HW 3', '2026-11-22'), item('HW 4', '2026-11-01'), item('HW 5', '2026-11-25', { unverified: true }), item('HW 6', '2026-11-26')],
    [{ title: 'HW 2', due: '2026-11-21' }, { title: 'hw 6', due: '2026-11-19' }],
    [{ text: 'HW 3', dueDate: '2026-11-18' }],
    today,
  );
  // HW 1 new; HW 2 seen without a task (deleted or unticked); HW 3 has a task (date move);
  // HW 4 past; HW 5 unquoted; HW 6 seen under other spelling and date.
  expect(out.map(i => i.title)).toEqual(['HW 1', 'HW 3']);
});

test('a re-check sends the course’s imported tasks, applies a renamed item, and keeps the name of one with Focus time', async ({ page }) => {
  const state = await setup(page, {
    subjects: [cs],
    todos: [
      { id: 'cp', user_id: account.id, text: 'Animator (TypeScript) checkpoint', status: 'nothing', subject_id: 'cs', due_date: offset(1), date: offset(1), kind: 'project' },
      { id: 'lab', user_id: account.id, text: 'Lab 9 (TypeScript)', status: 'nothing', subject_id: 'cs', due_date: offset(2), date: offset(2), kind: 'lab' },
    ],
    settings: { courseSites: [{ url: 'https://cs61a.org', courseId: 'cs', checkedAt: threeHoursAgo(), pageHash: HASH, seen: [{ title: 'Animator (TypeScript) checkpoint', due: offset(1) }, { title: 'Lab 9 (TypeScript)', due: offset(2) }] }] },
    api: () => ({ course: 'CS 61A', truncated: false, pageHash: 'c'.repeat(64), items: [
      { title: 'Animator checkpoint 1', type: 'project', due: offset(7), time: null, evidence: 'x', sameAs: 'Animator (TypeScript) checkpoint' },
      { title: 'Lab 9 Web Applications', type: 'lab', due: offset(3), time: null, evidence: 'x', sameAs: 'Lab 9 (TypeScript)' },
    ] }),
  });
  // Registered after setup's catch-all so it takes priority.
  await page.route('https://soma-regression.supabase.co/rest/v1/timer_sessions*', route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: url.searchParams.get('task_text') === 'eq.Lab 9 (TypeScript)' ? [{ id: 's1' }] : [] });
  });
  await recheck(page);
  await expect.poll(() => (sites(state)[0]?.lastChange as Row | undefined)?.updated).toBe(2);
  expect((state.requests.at(-1)!.existing as Row[]).map(e => e.title).sort()).toEqual(['Animator (TypeScript) checkpoint', 'Lab 9 (TypeScript)']);
  expect(state.todos.find(t => t.id === 'cp')).toMatchObject({ text: 'Animator checkpoint 1', due_date: offset(7) });
  expect(state.todos.find(t => t.id === 'lab')).toMatchObject({ text: 'Lab 9 (TypeScript)', due_date: offset(3) });
  expect(state.todos).toHaveLength(2);
});
