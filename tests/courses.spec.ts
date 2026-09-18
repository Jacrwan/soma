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

test('a course created from the dashboard block editor uses the chosen colour', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  await page.getByRole('button', { name: /^Add block in gap/ }).first().click();

  await page.getByLabel('Title', { exact: true }).fill('Reading week 3');
  await page.getByLabel('Subject', { exact: true }).fill('World History');
  // The name matches no existing course, so the colour picker appears.
  await page.getByRole('group', { name: 'New course colour' }).getByRole('button', { name: 'Colour #ec407a' }).click();
  await page.getByRole('button', { name: 'Save block', exact: true }).click();

  await expect.poll(() => state.subjects.length).toBe(1);
  expect(state.subjects[0]).toMatchObject({ name: 'World History', color: '#ec407a' });
});
