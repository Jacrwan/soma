import { test, expect, type Page } from '@playwright/test';

const account = {
  id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com',
  aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z',
  app_metadata: {}, user_metadata: {},
};

type Row = Record<string, unknown>;

async function setup(page: Page, initial: Row[] = []) {
  const state = { subjects: [...initial] as Row[], deletes: 0 };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({
      access_token: 't', refresh_token: 'r', token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a,
    }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (table === 'subjects') {
      if (req.method() === 'DELETE') { state.deletes++; const id = url.searchParams.get('id')?.slice(3); state.subjects = state.subjects.filter(s => s.id !== id); }
      if (req.method() === 'POST') {
        const body = req.postDataJSON();
        for (const row of (Array.isArray(body) ? body : [body]) as Row[]) {
          const i = state.subjects.findIndex(s => s.id === row.id);
          if (i < 0) state.subjects.push(row); else state.subjects[i] = row;
        }
      }
      return route.fulfill({ json: state.subjects });
    }
    const single = req.headers().accept?.includes('vnd.pgrst.object');
    return route.fulfill({ json: single ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  return state;
}

const biology = { id: 'biology', user_id: account.id, name: 'Biology 101', color: '#66bb6a', archived: false, source: 'canvas' };

async function openCourses(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Courses', exact: true }).click();
}

test('active courses are listed with their colour', async ({ page }) => {
  await setup(page, [biology]);
  await openCourses(page);
  await expect(page.getByText('Biology 101', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change colour for Biology 101' })).toBeVisible();
});

test('a course can be added with a chosen colour', async ({ page }) => {
  const state = await setup(page);
  await openCourses(page);
  await page.getByRole('button', { name: '+ Add a course' }).click();
  await page.getByLabel('New course name').fill('Organic Chemistry');
  await page.getByRole('group', { name: 'New course colour' }).getByRole('button', { name: 'Colour #ab47bc' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.getByText('Organic Chemistry', { exact: true })).toBeVisible();
  await expect.poll(() => state.subjects.length).toBe(1);
  expect(state.subjects[0]).toMatchObject({ name: 'Organic Chemistry', color: '#ab47bc', archived: false });
});

test('a duplicate course name is rejected without writing', async ({ page }) => {
  const state = await setup(page, [biology]);
  await openCourses(page);
  await page.getByRole('button', { name: '+ Add a course' }).click();
  await page.getByLabel('New course name').fill('biology 101');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('already have a course with that name');
  expect(state.subjects).toHaveLength(1);
});

test('a course can be renamed and recoloured', async ({ page }) => {
  const state = await setup(page, [biology]);
  await openCourses(page);

  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const field = page.getByLabel('Course name for Biology 101');
  await field.fill('Bio 1A');
  await field.press('Enter');
  await expect(page.getByText('Bio 1A', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Change colour for Bio 1A' }).click();
  await page.getByRole('group', { name: 'Colours for Bio 1A' }).getByRole('button', { name: 'Colour #ffa726' }).click();

  await expect.poll(() => state.subjects[0]).toMatchObject({ name: 'Bio 1A', color: '#ffa726' });
  expect(state.deletes).toBe(0);
});

test('archiving moves a course to the archived list and it can be restored', async ({ page }) => {
  const state = await setup(page, [biology]);
  await openCourses(page);
  await page.getByRole('button', { name: 'Archive', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
  await expect.poll(() => state.subjects[0].archived).toBe(true);

  await page.getByRole('button', { name: 'Restore' }).click();
  await expect.poll(() => state.subjects[0].archived).toBe(false);
  expect(state.deletes).toBe(0);
});

test('a course created from the dashboard block editor gets an unused colour', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  await page.getByRole('button', { name: /^Add block in gap/ }).first().click();

  await page.getByLabel('Title', { exact: true }).fill('Reading week 3');
  await page.getByLabel('Subject', { exact: true }).selectOption({ label: '+ New course…' });
  await page.getByLabel('New course name', { exact: true }).fill('World History');
  await page.getByRole('button', { name: 'Save block', exact: true }).click();

  // Colour is not chosen here any more — it takes the first unused palette
  // colour and is changed in Settings → Courses.
  await expect.poll(() => state.subjects.length).toBe(1);
  expect(state.subjects[0]).toMatchObject({ name: 'World History', color: '#ef5350' });
});

test('editing a task on an archived course keeps it on that course', async ({ page }) => {
  // The dashboard still shows work belonging to an archived course. The subject
  // dropdown is built from active courses, so without the current course being
  // added back in, opening the editor would silently reassign the task.
  const archived = { id: 'chem', user_id: account.id, name: 'Chem 1A', color: '#ef5350', archived: true, source: 'canvas' };
  const state = await setup(page, [archived, { ...biology, id: 'bio' }]);
  const day = new Date();
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const iso = (t: string) => new Date(`${date}T${t}:00`).toISOString();

  await page.route('https://soma-regression.supabase.co/rest/v1/todos*', r => r.fulfill({
    json: [{ id: 't1', user_id: account.id, text: 'Old lab writeup', subject_id: 'chem', status: 'nothing', date, estimated_minutes: 45 }],
  }));
  await page.route('https://soma-regression.supabase.co/rest/v1/todo_sessions*', r => r.fulfill({
    json: [{ id: 's1', user_id: account.id, todo_id: 't1', date, start_time: iso('10:00'), end_time: iso('10:45') }],
  }));

  await page.goto('/dashboard');
  await expect(page.getByText('Old lab writeup')).toBeVisible();
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  await page.getByRole('button', { name: 'Edit: Old lab writeup' }).click();

  // The archived course is preselected and offered, not replaced by an active one.
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Chem 1A');
  await page.getByRole('button', { name: 'Save block', exact: true }).click();

  await expect.poll(() => state.subjects.filter(s => s.name === 'Chem 1A')).toHaveLength(1);
  expect(state.subjects.map(s => s.name).sort()).toEqual(['Biology 101', 'Chem 1A']);
});
