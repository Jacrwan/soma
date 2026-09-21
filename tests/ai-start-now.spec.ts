import { test, expect, type Page } from '@playwright/test';

// "Start this now" was impossible to express: the prompt hands the model
// currentTime to the minute, and validateProposal rejected any start already in
// the past — which a start equal to currentTime becomes within seconds. The
// clock is pinned to mid-afternoon so these cases cannot drift across midnight
// or outside the default 08:00–22:00 study window.
const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const BASE = (() => { const d = new Date(); d.setHours(14, 0, 0, 0); return d; })();
const TODAY = key(BASE);

async function setup(page: Page, replies: unknown[]) {
  const state = { sessionWrites: [] as Record<string, unknown>[] };
  await page.clock.install({ time: BASE });
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
    const rows = table === 'subjects' ? [{ id: 'phys', user_id: account.id, name: 'Physics 5A', color: '#ef5350', archived: false }] : [];
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  let turn = 0;
  await page.route('**/api/chat', route => route.fulfill({ json: { content: [{ text: JSON.stringify(replies[Math.min(turn++, replies.length - 1)]) }] } }));
  return state;
}

const plan = (start: string, end: string) => [{ reply: 'Physics until four.', blocks: [{ title: 'Physics quiz prep', subject: 'Physics 5A', date: TODAY, start, end }] }];
async function ask(page: Page, text: string) {
  await page.getByLabel('What do you need to work on?').fill(text);
  await page.getByRole('button', { name: 'Send to Soma' }).click();
}

test('a block starting at the current minute is placed, not refused', async ({ page }) => {
  await setup(page, plan('14:00', '16:00'));
  await page.goto('/dashboard');
  await ask(page, 'do physics from now until 4');
  await expect(page.getByRole('log')).not.toContainText('start time has passed');
  await expect(page.getByRole('log')).toContainText('Review the proposed blocks');
});

test('a start a few minutes into the past is still placed', async ({ page }) => {
  await setup(page, plan('13:50', '16:00'));
  await page.goto('/dashboard');
  await ask(page, 'physics from now til 4');
  await expect(page.getByRole('log')).not.toContainText('start time has passed');
  await expect(page.getByRole('log')).toContainText('Review the proposed blocks');
});

test('a start well into the past is still refused', async ({ page }) => {
  await setup(page, plan('13:20', '16:00'));
  await page.goto('/dashboard');
  await ask(page, 'physics this afternoon');
  await expect(page.getByRole('log')).toContainText('start time has passed');
});

test('accepting a proposal still works after the grace window has elapsed', async ({ page }) => {
  const state = await setup(page, plan('13:55', '16:00'));
  await page.goto('/dashboard');
  await ask(page, 'physics from now until 4');
  await expect(page.getByRole('log')).toContainText('Review the proposed blocks');

  // The student reads the proposal for half an hour. Its start is now well
  // outside the grace window, but they are deliberately confirming it.
  await page.clock.fastForward('00:30:00');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();

  await expect(page.getByRole('log')).not.toContainText('start time has passed');
  await expect.poll(() => state.sessionWrites.length).toBeGreaterThan(0);
  expect(state.sessionWrites[0].date).toBe(TODAY);
});
