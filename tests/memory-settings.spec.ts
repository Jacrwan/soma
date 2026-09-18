import { test, expect, type Page } from '@playwright/test';

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
type Entry = { key: string; content: string; category: string; updatedAt: string; expiresAt: null; source?: string };

async function setup(page: Page, opts: { entries?: Entry[]; unavailable?: boolean } = {}) {
  const state = { enabled: true, entries: [...(opts.entries ?? [])], posts: [] as Record<string, unknown>[] };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/memory', route => {
    if (opts.unavailable) return route.fulfill({ status: 503, json: { error: 'memory_unavailable' } });
    if (route.request().method() === 'POST') {
      const a = route.request().postDataJSON(); state.posts.push(a);
      if (a.action === 'forget') state.entries = state.entries.filter(e => e.key !== a.key);
      if (a.action === 'clear') state.entries = [];
      if (a.action === 'set_enabled') state.enabled = a.enabled;
    }
    return route.fulfill({ json: { revision: state.posts.length, enabled: state.enabled, entries: state.entries } });
  });
  return state;
}

const learned: Entry = { key: 'tuesday-work', content: 'Works at the campus cafe on Tuesdays until 6pm.', category: 'fact', updatedAt: '2026-09-18T10:00:00Z', expiresAt: null, source: 'auto' };
const manual: Entry = { key: 'study-time', content: 'Prefers studying in the morning.', category: 'preference', updatedAt: '2026-09-18T09:00:00Z', expiresAt: null, source: 'manual' };

async function open(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
}

test('lists what Soma has remembered and where it came from', async ({ page }) => {
  await setup(page, { entries: [learned, manual] });
  await open(page);
  const list = page.getByLabel('Saved memories');
  await expect(list).toContainText('Works at the campus cafe on Tuesdays until 6pm.');
  await expect(list).toContainText('Learned');
  await expect(list).toContainText('Saved by you');
});

test('a single memory can be forgotten', async ({ page }) => {
  const state = await setup(page, { entries: [learned, manual] });
  await open(page);
  await page.getByRole('button', { name: /Forget: Works at the campus cafe/ }).click();
  await expect(page.getByLabel('Saved memories')).not.toContainText('campus cafe');
  expect(state.posts).toContainEqual({ action: 'forget', key: 'tuesday-work' });
});

test('forgetting everything asks first', async ({ page }) => {
  const state = await setup(page, { entries: [learned, manual] });
  await open(page);
  await page.getByRole('button', { name: 'Forget everything' }).click();
  expect(state.posts).toHaveLength(0);
  await page.getByRole('button', { name: 'Forget all' }).click();
  await expect(page.getByLabel('Saved memories')).toContainText('Nothing remembered yet');
  expect(state.posts).toContainEqual({ action: 'clear' });
});

test('memory can be paused and resumed', async ({ page }) => {
  const state = await setup(page, { entries: [learned] });
  await open(page);
  await page.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(page.getByText(/Paused\. Soma won't learn/)).toBeVisible();
  expect(state.posts).toContainEqual({ action: 'set_enabled', enabled: false });
});

test('shows a clear message when memory is not switched on', async ({ page }) => {
  await setup(page, { unavailable: true });
  await open(page);
  await expect(page.getByRole('alert')).toContainText('Memory is not available right now');
});
