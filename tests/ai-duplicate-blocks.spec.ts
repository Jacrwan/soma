import { test, expect, type Page } from '@playwright/test';

// The model is instructed never to recreate a block that already exists, and
// does it anyway — the copy then collides with the block it duplicates, which
// the user sees as "overlaps a scheduled session" for work they already have.
const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const at = (n: number, t: string) => { const d = offset(n); const [h, m] = t.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };
const TOMORROW = key(offset(1));
const IN_TWO = key(offset(2));

type Opts = { scheduled?: boolean; unscheduled?: boolean };
async function setup(page: Page, replies: unknown[], opts: Opts = {}) {
  const state = { sessionWrites: [] as Record<string, unknown>[] };
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
    const rows =
      table === 'subjects' ? [{ id: 'calsol', user_id: account.id, name: 'CalSol', color: '#ef5350', archived: false }]
      : table === 'todos' && (opts.scheduled || opts.unscheduled) ? [{ id: 'onb', user_id: account.id, text: 'CalSol Electrical Onboarding', subject_id: 'calsol', status: 'nothing', date: TOMORROW }]
      : table === 'todo_sessions' && opts.scheduled ? [{ id: 'onb-slot', user_id: account.id, todo_id: 'onb', date: TOMORROW, start_time: at(1, '18:00'), end_time: at(1, '20:00') }]
      : [];
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  let turn = 0;
  await page.route('**/api/chat', route => route.fulfill({ json: { content: [{ text: JSON.stringify(replies[Math.min(turn++, replies.length - 1)]) }] } }));
  return state;
}
const reemit = (date: string, start: string, end: string) => [{ reply: 'CalSol then.', blocks: [{ title: 'CalSol Electrical Onboarding', subject: 'CalSol', date, start, end }] }];
async function ask(page: Page, text: string) {
  await page.getByLabel('What do you need to work on?').fill(text);
  await page.getByRole('button', { name: 'Send to Soma' }).click();
}

// Every test waits for the reply to land BEFORE asserting any negative:
// `not.toContainText` is satisfied the instant the text is absent, so asserting
// it first passes while the turn is still in flight, proving nothing.
const settled = async (page: Page) => { await expect(page.getByRole('log')).toContainText('CalSol then.'); };

test('a re-emitted block becomes a move of the existing one, not a colliding copy', async ({ page }) => {
  await setup(page, reemit(TOMORROW, '16:00', '18:00'), { scheduled: true });
  await page.goto('/dashboard');
  await ask(page, 'do calsol from 4 to 6 tomorrow');
  await settled(page);
  await expect(page.getByText('Moves from 6:00 PM\u20138:00 PM')).toBeVisible();
  await expect(page.getByRole('log')).not.toContainText("Couldn't place");
  await expect(page.getByRole('log')).not.toContainText('overlaps a scheduled session');
});

test('re-emitting a block at the time it already occupies adds nothing and is not an error', async ({ page }) => {
  await setup(page, reemit(TOMORROW, '18:00', '20:00'), { scheduled: true });
  await page.goto('/dashboard');
  await ask(page, 'calsol from 6 to 8 tomorrow');
  await settled(page);
  await expect(page.getByRole('log')).not.toContainText("Couldn't place");
  await expect(page.getByRole('log')).not.toContainText('overlaps a scheduled session');
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
});

test('an unscheduled block is scheduled in place rather than duplicated', async ({ page }) => {
  await setup(page, reemit(TOMORROW, '19:00', '20:00'), { unscheduled: true });
  await page.goto('/dashboard');
  await ask(page, 'put calsol onboarding at 7pm tomorrow');
  await settled(page);
  await expect(page.getByText('Moves from unscheduled')).toBeVisible();
  await expect(page.getByRole('log')).not.toContainText("Couldn't place");
});

test('the same title on a different day is a real repeat, not a duplicate', async ({ page }) => {
  await setup(page, reemit(IN_TWO, '18:00', '20:00'), { scheduled: true });
  await page.goto('/dashboard');
  await ask(page, 'do calsol onboarding again the day after tomorrow');
  await settled(page);
  await expect(page.getByRole('log')).toContainText('Review the proposed blocks');
  await expect(page.getByText('Moves from')).toHaveCount(0);
  await expect(page.getByRole('log')).not.toContainText("Couldn't place");
});
