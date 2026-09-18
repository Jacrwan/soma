import { test, expect, type Page } from '@playwright/test';

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const TODAY = key(offset(0)), TOMORROW = key(offset(1));
const weekdayOf = (n: number) => offset(n).toLocaleDateString('en-US', { weekday: 'long' });

async function setup(page: Page, blocks: Record<string, unknown>[]) {
  const state = { prompt: '', sessionWrites: [] as Record<string, unknown>[] };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (req.method() !== 'GET') {
      if (table === 'todo_sessions' && req.method() === 'POST') { const b = req.postDataJSON(); state.sessionWrites.push(...(Array.isArray(b) ? b : [b])); }
      return route.fulfill({ json: null });
    }
    const rows = table === 'subjects' ? [
      { id: 'lit', user_id: account.id, name: 'COMLIT R1A', color: '#ef5350', archived: false },
      { id: 'cs', user_id: account.id, name: 'CS 61A', color: '#26c6da', archived: false },
    ] : [];
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/chat', route => {
    state.prompt = route.request().postDataJSON().systemPrompt;
    return route.fulfill({ json: { content: [{ text: JSON.stringify({ reply: 'Here is Friday.', blocks }) }] } });
  });
  return state;
}

async function ask(page: Page, text: string) {
  await page.getByLabel('What do you need to work on?').fill(text);
  await page.getByRole('button', { name: 'Send to Soma' }).click();
}

// The reported conversation: "yeah tomorrow; im down to be in the library until like 7".
// Soma's actual suggestion. Pinned to today, these are in the past for most
// of the day — which is exactly how all three were rejected.
test('blocks planned for tomorrow land on tomorrow, not today', async ({ page }) => {
  const state = await setup(page, [
    { title: 'ANALYSIS EXERCISE 1', subject: 'COMLIT R1A', date: TOMORROW, start: '11:00', end: '12:00' },
    { title: 'Hog project review', subject: 'CS 61A', date: TOMORROW, start: '15:00', end: '18:00' },
  ]);
  await page.goto('/dashboard');
  await ask(page, 'yeah tomorrow; im down to be in the library until like 7');

  const log = page.getByRole('log');
  await expect(log).toContainText('Here is Friday.');
  await expect(log).not.toContainText("Couldn't place");
  // The dashboard jumped to tomorrow so the proposals are on screen.
  await expect(page.getByLabel('Next seven days').getByRole('button', { pressed: true })).toContainText(weekdayOf(1).slice(0, 3));
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(2);

  await page.getByRole('button', { name: 'Accept', exact: true }).first().click();
  await expect.poll(() => state.sessionWrites.length).toBeGreaterThan(0);
  expect(state.sessionWrites[0].date).toBe(TOMORROW);
});

test('the prompt asks for a date on every block and forbids "add it yourself"', async ({ page }) => {
  const state = await setup(page, []);
  await page.goto('/dashboard');
  await ask(page, 'plan tomorrow');
  await expect(page.getByRole('log')).toContainText('Here is Friday.');
  expect(state.prompt).toContain('"date":"YYYY-MM-DD"');
  expect(state.prompt).toContain('Never tell the user to add blocks themselves');
  expect(state.prompt).toContain('when the user agrees to times you already described, return those blocks again');
});

test('a block without a date still falls back to the selected day', async ({ page }) => {
  await setup(page, [{ title: 'Late revision', subject: 'CS 61A', start: '13:00', end: '14:00' }]);
  await page.goto('/dashboard');
  await page.getByLabel('Next seven days').getByRole('button').nth(2).click();
  await ask(page, 'plan it');
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(1);
});

test('a date outside the next seven days is rejected with a clear reason', async ({ page }) => {
  await setup(page, [{ title: 'Midterm prep', subject: 'CS 61A', date: key(offset(30)), start: '10:00', end: '11:00' }]);
  await page.goto('/dashboard');
  await ask(page, 'plan next month');
  const log = page.getByRole('log');
  await expect(log).toContainText("Couldn't place");
  await expect(log).toContainText('outside the next seven days');
});

test('today still refuses blocks that already started', async ({ page }) => {
  await setup(page, [{ title: 'Too early', subject: 'CS 61A', date: TODAY, start: '00:00', end: '00:01' }]);
  await page.goto('/dashboard');
  await ask(page, 'plan now');
  await expect(page.getByRole('log')).toContainText('start time has passed');
});
