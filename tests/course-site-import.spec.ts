import { test, expect, type Page } from '@playwright/test';

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return key(d); };
type Row = Record<string, unknown>;

const found = {
  course: 'CS 61A', source: 'https://cs61a.org/fa26/', truncated: false,
  items: [
    { title: 'Lab 2', type: 'lab', due: offset(-3), time: null, evidence: 'Due Wed' },
    { title: 'Lab 3', type: 'lab', due: offset(5), time: null, evidence: 'Due Wed 9/23' },
    { title: 'Homework 3', type: 'homework', due: offset(6), time: '23:59', evidence: 'Due Thu 9/24' },
    { title: 'Hog project', type: 'project', due: offset(12), time: null, evidence: 'Due Oct', unverified: true },
  ],
};

async function setup(page: Page, subjects: Row[] = [], todos: Row[] = []) {
  const state = { subjects: [...subjects], todos: [...todos], requests: [] as Row[] };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    const list = table === 'subjects' ? state.subjects : table === 'todos' ? state.todos : null;
    if (list && req.method() === 'POST') {
      const body = req.postDataJSON();
      for (const row of (Array.isArray(body) ? body : [body]) as Row[]) { const i = list.findIndex(r => r.id === row.id); if (i < 0) list.push(row); else list[i] = row; }
    }
    if (list) return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? list[0] ?? null : list });
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/import-schedule', route => { state.requests.push(route.request().postDataJSON()); return route.fulfill({ json: found }); });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Courses', exact: true }).click();
  await page.getByRole('button', { name: 'Import deadlines from a course website' }).click();
  return state;
}

test('finds deadlines, leaves past ones unticked, and flags unquoted dates', async ({ page }) => {
  const state = await setup(page);
  await page.getByLabel('Course website address').fill('https://cs61a.org');
  await page.getByRole('button', { name: 'Find deadlines' }).click();

  const list = page.getByLabel('Deadlines found');
  await expect(list.getByRole('checkbox')).toHaveCount(4);
  await expect(list.getByRole('listitem').filter({ hasText: 'Lab 2' }).getByRole('checkbox')).not.toBeChecked();
  await expect(list.getByRole('listitem').filter({ hasText: 'Lab 3' }).getByRole('checkbox')).toBeChecked();
  await expect(list.getByRole('listitem').filter({ hasText: 'Hog project' })).toContainText("Couldn't find this date written on the page");
  await expect(page.getByText('1 already-past item is left unticked')).toBeVisible();
  // The page named CS 61A and the student has no such course yet.
  await expect(page.getByLabel('New course name')).toHaveValue('CS 61A');
  expect(state.requests[0]).toMatchObject({ url: 'https://cs61a.org' });
  expect(state.todos).toHaveLength(0);   // nothing saved until Import
});

test('importing creates the course and one task per deadline on its due date', async ({ page }) => {
  const state = await setup(page);
  await page.getByLabel('Course website address').fill('https://cs61a.org');
  await page.getByRole('button', { name: 'Find deadlines' }).click();
  await page.getByRole('button', { name: 'Import 3 deadlines' }).click();

  await expect(page.getByRole('status')).toContainText('Imported 3 new deadlines into CS 61A');
  expect(state.subjects.map(s => s.name)).toEqual(['CS 61A']);
  const byTitle = Object.fromEntries(state.todos.map(t => [t.text, t]));
  expect(Object.keys(byTitle).sort()).toEqual(['Hog project', 'Homework 3', 'Lab 3']);
  expect(byTitle['Homework 3']).toMatchObject({ due_date: offset(6), date: offset(6), subject_id: state.subjects[0].id });
});

test('re-importing updates a changed date instead of duplicating', async ({ page }) => {
  const cs = { id: 'cs', user_id: account.id, name: 'CS 61A', color: '#26c6da', archived: false };
  const state = await setup(page, [cs], [
    { id: 'hw3', user_id: account.id, text: 'Homework 3', status: 'nothing', subject_id: 'cs', due_date: offset(4), date: offset(4) },
    { id: 'lab3', user_id: account.id, text: 'Lab 3', status: 'nothing', subject_id: 'cs', due_date: offset(5), date: offset(5) },
  ]);
  await page.getByLabel('Course website address').fill('https://cs61a.org');
  await page.getByRole('button', { name: 'Find deadlines' }).click();
  await expect(page.getByLabel('Course for these deadlines')).toHaveValue('cs');
  await page.getByRole('button', { name: 'Import 3 deadlines' }).click();

  await expect(page.getByRole('status')).toContainText('Imported 1 new deadline, updated 1');
  expect(state.todos.filter(t => t.text === 'Homework 3')).toHaveLength(1);
  expect(state.todos.find(t => t.text === 'Homework 3')).toMatchObject({ due_date: offset(6), date: offset(6) });
  expect(state.todos.filter(t => t.text === 'Lab 3')).toHaveLength(1);   // same date: untouched
});

test('pasting page text is an alternative for sites behind a login', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: /Paste the page text/ }).click();
  await page.getByLabel('Course page text').fill('Lab 3 | Due Wed 9/23\nHomework 3 | Due Thu 9/24');
  await page.getByRole('button', { name: 'Find deadlines' }).click();
  await expect(page.getByLabel('Deadlines found').getByRole('checkbox')).toHaveCount(4);
  expect(state.requests[0]).toMatchObject({ text: expect.stringContaining('Lab 3') });
  expect(state.requests[0]).not.toHaveProperty('url');
});

test('the receipt shows the destination course and what happened to each deadline', async ({ page }) => {
  const cs = { id: 'cs', user_id: account.id, name: 'CS 61A', color: '#26c6da', archived: false };
  await setup(page, [cs], [
    { id: 'hw3', user_id: account.id, text: 'Homework 3', status: 'nothing', subject_id: 'cs', due_date: offset(4), date: offset(4) },
    { id: 'lab3', user_id: account.id, text: 'Lab 3', status: 'nothing', subject_id: 'cs', due_date: offset(5), date: offset(5) },
  ]);
  await page.getByLabel('Course website address').fill('https://cs61a.org');
  await page.getByRole('button', { name: 'Find deadlines' }).click();
  await page.getByRole('button', { name: 'Import 3 deadlines' }).click();

  const receipt = page.getByRole('status', { name: 'Imported into CS 61A' });
  await expect(receipt).toContainText('Added to CS 61A');
  await expect(receipt.getByRole('listitem').filter({ hasText: 'Hog project' })).toContainText('Added');
  await expect(receipt.getByRole('listitem').filter({ hasText: 'Homework 3' })).toContainText('Date updated');
  await expect(receipt.getByRole('listitem').filter({ hasText: 'Lab 3' })).toContainText('Already there');
});

test('the course list shows the new deadlines on the right course', async ({ page }) => {
  const cs = { id: 'cs', user_id: account.id, name: 'CS 61A', color: '#26c6da', archived: false };
  const phys = { id: 'phys', user_id: account.id, name: 'Physics 5A', color: '#ef5350', archived: false };
  await setup(page, [phys, cs]);
  await page.getByLabel('Course website address').fill('https://cs61a.org');
  await page.getByRole('button', { name: 'Find deadlines' }).click();
  await page.getByRole('button', { name: 'Import 3 deadlines' }).click();
  await expect(page.getByRole('status', { name: 'Imported into CS 61A' })).toBeVisible();

  const rows = page.locator('[class*="courseRow"]');
  await expect(rows.filter({ hasText: 'CS 61A' })).toContainText('3 upcoming deadlines');
  await expect(rows.filter({ hasText: 'Physics 5A' })).not.toContainText('upcoming');
  await expect(rows.filter({ hasText: 'CS 61A' })).toHaveClass(/courseRowFlash/);
});

test("an import whose saves didn't stick is reported as an error, not a success", async ({ page }) => {
  const cs = { id: 'cs', user_id: account.id, name: 'CS 61A', color: '#26c6da', archived: false };
  await setup(page, [cs]);
  // The database accepts the writes but nothing is actually stored.
  await page.route('https://soma-regression.supabase.co/rest/v1/todos*', route => route.fulfill({ json: route.request().method() === 'GET' ? [] : null }));
  await page.getByLabel('Course website address').fill('https://cs61a.org');
  await page.getByRole('button', { name: 'Find deadlines' }).click();
  await page.getByRole('button', { name: 'Import 3 deadlines' }).click();

  await expect(page.getByRole('alert')).toContainText('could be confirmed after saving');
  await expect(page.getByRole('status', { name: /Imported into/ })).toHaveCount(0);
});
