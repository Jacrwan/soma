import { test, expect, type Page } from '@playwright/test';
import { referralProgress, planReward, claimReferral, grantIfDue, FRIENDS_NEEDED } from '../api/_referrals';
import { discordPayload, sendSupportMessage } from '../api/_support';
import { computeStatus } from '../api/_trial';

// Invite friends and Message the developer, 2026-11-17. The owner's rule:
// 5 new friends within 2 months earn one free week, at most one every 2
// months (10 friends at once is still one week). A paying student's week moves
// their next charge later; Soma must still treat them as a subscriber.

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-17T12:00:00Z');

type Row = Record<string, any>;
/** An in-memory stand-in for the service-role Supabase client: enough of the query chain for these files. */
function memoryAdmin(tables: Record<string, Row[]>) {
  let n = 0;
  const from = (name: string) => {
    tables[name] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | null = null;
    let order: { col: string; asc: boolean } | null = null;
    let limit = Infinity;
    const rows = () => {
      let out = tables[name].filter(r => filters.every(f => f(r)));
      if (order) out = [...out].sort((a, b) => (a[order!.col] < b[order!.col] ? -1 : 1) * (order!.asc ? 1 : -1));
      return out.slice(0, limit);
    };
    const run = () => {
      if (op === 'insert') {
        const row = { id: `id-${++n}`, ...payload };
        const key = name === 'referrals' ? 'referred_user_id' : name === 'referral_codes' ? 'user_id' : null;
        if (key && tables[name].some(r => r[key] === row[key])) return { data: null, error: { code: '23505', message: 'duplicate' } };
        tables[name].push(row);
        return { data: [row], error: null };
      }
      if (op === 'update') { rows().forEach(r => Object.assign(r, payload)); return { data: null, error: null }; }
      if (op === 'delete') { const gone = new Set(rows()); tables[name] = tables[name].filter(r => !gone.has(r)); return { data: null, error: null }; }
      return { data: rows(), error: null };
    };
    const q: any = {
      select: () => q,
      insert: (row: Row) => { op = 'insert'; payload = row; return q; },
      update: (row: Row) => { op = 'update'; payload = row; return q; },
      delete: () => { op = 'delete'; return q; },
      eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return q; },
      in: (c: string, v: unknown[]) => { filters.push(r => v.includes(r[c])); return q; },
      gte: (c: string, v: string) => { filters.push(r => r[c] >= v); return q; },
      order: (col: string, o: { ascending: boolean }) => { order = { col, asc: o.ascending }; return q; },
      limit: (k: number) => { limit = k; return q; },
      maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      single: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error ?? (r.data?.[0] ? null : { message: 'none' }) }; },
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  };
  return { from };
}

test('5 friends within 2 months earn one free week; 10 at once is still one', () => {
  const ago = (d: number) => NOW - d * DAY;
  const days = (...d: number[]) => d.map(ago);
  expect(referralProgress(days(50, 30, 10, 3), null, NOW)).toMatchObject({ counted: 4, due: false });
  expect(referralProgress(days(50, 30, 10, 3, 1), null, NOW)).toMatchObject({ counted: 5, due: true });
  // Older than 2 months doesn't count.
  expect(referralProgress(days(70, 30, 10, 3, 1), null, NOW)).toMatchObject({ counted: 4, due: false });
  // A week given 5 days ago: friends 6–10 of the same burst wait out the 2 months, and by then they're too old.
  const burst = Array.from({ length: 10 }, () => ago(6));
  const waiting = referralProgress(burst, ago(5), NOW);
  expect(waiting).toMatchObject({ due: false, waitUntil: new Date(ago(5) + 60 * DAY).toISOString() });
  expect(referralProgress(burst, ago(5), ago(5) + 61 * DAY).due).toBe(false);
  // After the wait, 5 new friends earn the next one.
  const later = ago(5) + 61 * DAY;
  const fresh = [1, 1, 2, 3, 4].map(d => later - d * DAY);
  expect(referralProgress([...burst, ...fresh], ago(5), later)).toMatchObject({ counted: 5, due: true });
  expect(FRIENDS_NEEDED).toBe(5);
});

test('the free week: a paying student’s next charge moves 7 days later; a trial runs longer', () => {
  const s = (sec: number) => Math.floor(sec / 1000);
  const paying = { status: 'active', trial_start: null, extension_start: null, stripe_subscription_id: 'sub_1' };
  const periodEnd = s(NOW + 20 * DAY);
  expect(planReward(paying, { status: 'active', items: { data: [{ current_period_end: periodEnd }] } } as never, NOW))
    .toEqual({ kind: 'stripe_trial', trialEnd: periodEnd + 7 * 86_400, paid: true });
  const trial = { ...paying, status: 'trialing' };
  expect(planReward(trial, { status: 'trialing', trial_end: s(NOW + 3 * DAY) } as never, NOW))
    .toEqual({ kind: 'stripe_trial', trialEnd: s(NOW + 3 * DAY) + 7 * 86_400, paid: false });
  // A card-free trial starts a week later.
  const cardFree = { status: 'trialing', trial_start: new Date(NOW - 2 * DAY).toISOString(), extension_start: null, stripe_subscription_id: null };
  expect(planReward(cardFree, null, NOW)).toEqual({ kind: 'shift', field: 'trial_start', value: new Date(NOW + 5 * DAY).toISOString() });
  // Free by hand: nothing to add. No plan, or a canceled one: saved for the next checkout.
  expect(planReward({ ...cardFree, status: 'active' }, null, NOW)).toEqual({ kind: 'not_needed' });
  expect(planReward(null, null, NOW)).toEqual({ kind: 'bank' });
  expect(planReward(paying, { status: 'canceled' } as never, NOW)).toEqual({ kind: 'bank' });
});

test('a paying student in their free week is still a subscriber', () => {
  const row = { status: 'trialing', trial_start: '2026-01-01T00:00:00Z', extension_start: null, stripe_subscription_id: 'sub_1', free_week_until: new Date(NOW + 30 * DAY).toISOString() };
  expect(computeStatus(row, NOW)).toBe('active');
  // A real Stripe trial is still a trial.
  expect(computeStatus({ ...row, free_week_until: null }, NOW)).toBe('trialing');
});

test('only a new account counts, once, and never for itself', async () => {
  const tables: Record<string, Row[]> = { referral_codes: [{ user_id: 'alice', code: 'abcd2345' }], referrals: [], referral_rewards: [], subscriptions: [] };
  const admin = memoryAdmin(tables);
  const fresh = (id: string) => ({ id, created_at: new Date(NOW - DAY).toISOString(), email_confirmed_at: new Date(NOW - DAY).toISOString() });
  expect((await claimReferral(admin, null, { ...fresh('old'), created_at: '2025-01-01T00:00:00Z' }, 'abcd2345', NOW)).body.result).toBe('not_new');
  expect((await claimReferral(admin, null, { ...fresh('unconf'), email_confirmed_at: null }, 'abcd2345', NOW)).body.result).toBe('unconfirmed');
  expect((await claimReferral(admin, null, fresh('alice'), 'abcd2345', NOW)).body.result).toBe('self');
  expect((await claimReferral(admin, null, fresh('bob'), 'zzzz9999', NOW)).body.result).toBe('unknown');
  expect((await claimReferral(admin, null, fresh('bob'), 'abcd2345', NOW)).body.result).toBe('counted');
  expect((await claimReferral(admin, null, fresh('bob'), 'abcd2345', NOW)).body.result).toBe('already');
  expect(tables.referrals).toHaveLength(1);
  expect(tables.referral_rewards).toHaveLength(0);
});

test('the fifth friend grants one week; the sixth through tenth don’t', async () => {
  const tables: Record<string, Row[]> = {
    referral_codes: [{ user_id: 'alice', code: 'abcd2345' }], referrals: [], referral_rewards: [],
    // Alice's card-free trial started two days ago.
    subscriptions: [{ user_id: 'alice', status: 'trialing', trial_start: new Date(NOW - 2 * DAY).toISOString(), extension_start: null, stripe_subscription_id: null }],
  };
  const admin = memoryAdmin(tables);
  for (const id of ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']) {
    await claimReferral(admin, null, { id, created_at: new Date(NOW - DAY).toISOString(), email_confirmed_at: 'yes' }, 'abcd2345', NOW);
  }
  expect(tables.referrals).toHaveLength(10);
  expect(tables.referral_rewards).toHaveLength(1);
  expect(tables.referral_rewards[0]).toMatchObject({ status: 'applied', how: 'trial_longer' });
  expect(tables.subscriptions[0].trial_start).toBe(new Date(NOW + 5 * DAY).toISOString());
  // Opening the invite card later doesn't add another.
  expect(await grantIfDue(admin, null, 'alice', NOW + 10 * DAY)).toBe(false);
});

test('a message to the developer is saved first, and a Discord failure doesn’t lose it', async () => {
  const tables: Record<string, Row[]> = { support_messages: [] };
  const admin = memoryAdmin(tables);
  const posts: { url: string; body: any }[] = [];
  const ok = (async (url: string, init: any) => { posts.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 204 }; }) as never;
  const hook = 'https://discord.com/api/webhooks/1/abc';
  const out = await sendSupportMessage(admin, { id: 'stu', email: 'stu@ucla.edu' }, { body: '  The timer froze @everyone ', page: '/tasks' }, ok, hook);
  expect(out.status).toBe(200);
  expect(tables.support_messages[0]).toMatchObject({ thread_user_id: 'stu', sender: 'user', body: 'The timer froze @everyone', page: '/tasks' });
  expect(posts[0].url).toBe(hook);
  expect(posts[0].body.allowed_mentions).toEqual({ parse: [] });
  expect(posts[0].body.content).toContain('stu@ucla.edu');
  expect(posts[0].body.content).toContain('/dashboard?support=stu');

  const down = (async () => { throw new Error('offline'); }) as never;
  expect((await sendSupportMessage(admin, { id: 'stu' }, { body: 'again' }, down, hook)).status).toBe(200);
  expect(tables.support_messages).toHaveLength(2);
  // An empty message, or a made-up page, isn't sent as-is.
  expect((await sendSupportMessage(admin, { id: 'stu' }, { body: '   ' }, ok, hook)).status).toBe(400);
  await sendSupportMessage(admin, { id: 'stu' }, { body: 'x', page: 'javascript:alert(1)' }, ok, hook);
  expect(tables.support_messages[2].page).toBeNull();
  expect(discordPayload('a@b.c', 'y'.repeat(3000), null, 'id').content.length).toBeLessThan(2000);
});

// ── In the app ────────────────────────────────────────────────────────────

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', email_confirmed_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };

async function signIn(page: Page, opts: { owner?: boolean; user?: typeof account; messages?: Row[]; threads?: Row[]; status?: string } = {}) {
  const user = opts.user ?? account;
  const state = { messages: opts.messages ?? [], api: [] as Row[], read: 0 };
  await page.addInitScript(u => { localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 'test-token', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: u })); }, user);
  await page.route('https://soma-regression.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: user });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, walkthroughCompleted: true, theme: 'light' } } });
    if (table === 'is_soma_owner') return route.fulfill({ json: !!opts.owner });
    if (table === 'mark_support_read') { state.read++; state.messages.forEach(m => { if (m.sender === (opts.owner ? 'user' : 'owner')) m.read_at = 'now'; }); return route.fulfill({ json: null }); }
    if (table === 'support_threads') return route.fulfill({ json: opts.threads ?? [] });
    if (table === 'support_messages') {
      if (req.method() === 'POST') {
        const row = { id: `m${state.messages.length + 1}`, created_at: new Date().toISOString(), read_at: null, ...req.postDataJSON() };
        state.messages.push(row);
        return route.fulfill({ json: row });
      }
      if (req.method() === 'HEAD') {
        const unread = state.messages.filter(m => m.sender === 'owner' && !m.read_at).length;
        return route.fulfill({ status: 200, headers: { 'content-range': `*/${unread}`, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, body: '' });
      }
      return route.fulfill({ json: state.messages });
    }
    return route.fulfill({ json: req.method() === 'GET' ? [] : null });
  });
  await page.route('**/api/stripe', async route => {
    const body = route.request().postDataJSON();
    state.api.push(body);
    if (body.action === 'support-send') {
      const row = { id: `m${state.messages.length + 1}`, thread_user_id: user.id, sender: 'user', body: body.body, created_at: new Date().toISOString(), read_at: null };
      state.messages.push(row);
      return route.fulfill({ json: { message: row } });
    }
    if (body.action === 'referral-status') return route.fulfill({ json: { code: 'abcd2345', counted: 2, needed: 5, waitUntil: null, windowDays: 60, totalFriends: 2, rewards: [] } });
    if (body.action === 'referral-claim') return route.fulfill({ json: { result: 'counted' } });
    return route.fulfill({ json: { status: opts.status ?? 'active' } });
  });
  await page.route('**/api/google-calendar-events', route => route.fulfill({ json: { events: [], incomplete: false } }));
  return state;
}

test('a student messages the developer from any page and sees the reply', async ({ page }) => {
  const state = await signIn(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Message the developer' }).click();
  const chat = page.getByRole('dialog', { name: 'Message the developer' });
  await chat.getByRole('textbox', { name: 'Message' }).fill('The calendar won’t load');
  await chat.getByRole('textbox', { name: 'Message' }).press('Enter');
  // Sent: the box empties and the message shows as a bubble.
  await expect(chat.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  await expect(chat.locator('p', { hasText: 'The calendar won’t load' })).toBeVisible();
  expect(state.api.find(a => a.action === 'support-send')).toMatchObject({ body: 'The calendar won’t load', page: '/tasks' });
  // An automatic reply says it was sent and when to expect an answer; it isn't saved.
  const auto = chat.getByText(/your message was sent.*within 48 hours/);
  await expect(auto).toBeVisible();
  expect(state.messages.filter(m => m.sender === 'owner')).toHaveLength(0);

  // The owner replies; the open chat picks it up and marks it read.
  state.messages.push({ id: 'r1', sender: 'owner', body: 'Fixed, try again!', created_at: new Date().toISOString(), read_at: null });
  await expect(chat.getByText('Fixed, try again!')).toBeVisible({ timeout: 12_000 });
  // Answered: the automatic reply goes away.
  await expect(auto).toHaveCount(0);
  await expect.poll(() => state.read).toBeGreaterThan(0);
});

test('an unread reply shows on the closed bubble, with a preview that opens the chat', async ({ page }) => {
  await signIn(page, { messages: [{ id: 'r1', sender: 'owner', body: 'Hi! The fix is live now.', created_at: new Date().toISOString(), read_at: null }] });
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Messages, 1 unread' })).toBeVisible({ timeout: 8_000 });
  const preview = page.getByRole('status').filter({ hasText: 'The developer replied' });
  await expect(preview).toContainText('Hi! The fix is live now.');
  await preview.getByRole('button', { name: /The developer replied/ }).click();
  await expect(page.getByRole('dialog', { name: 'Message the developer' }).getByText('Hi! The fix is live now.')).toBeVisible();
  // Read: the badge and the preview are gone once the chat closes.
  await page.getByRole('button', { name: 'Close messages' }).first().click();
  await expect(page.getByRole('button', { name: 'Message the developer' })).toBeVisible();
  await expect(preview).toHaveCount(0);
});

test('closing the reply preview keeps it closed; the badge stays until it’s read', async ({ page }) => {
  await signIn(page, { messages: [{ id: 'r1', sender: 'owner', body: 'Sure thing', created_at: new Date().toISOString(), read_at: null }] });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Hide reply preview' }).click({ timeout: 8_000 });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Messages, 1 unread' })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText('The developer replied')).toHaveCount(0);
});

test('the owner’s bubble is an inbox; ?support=<id> opens that conversation and replies go to it', async ({ page }) => {
  const stu = '22222222-2222-4222-8222-222222222222';
  const state = await signIn(page, {
    owner: true,
    threads: [{ thread_user_id: stu, email: 'stu@ucla.edu', last_body: 'Bug on Grades', last_sender: 'user', last_at: new Date().toISOString(), unread: 1 }],
    messages: [{ id: 'm1', thread_user_id: stu, sender: 'user', body: 'Bug on Grades', created_at: new Date().toISOString(), read_at: null }],
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: /^Messages/ }).click();
  const inbox = page.getByRole('dialog', { name: 'Messages' });
  await expect(inbox.getByText('stu@ucla.edu')).toBeVisible();

  await page.goto(`/settings?support=${stu}`);
  const thread = page.getByRole('dialog', { name: 'stu@ucla.edu' });
  await expect(thread.getByText('Bug on Grades')).toBeVisible();
  await thread.getByRole('textbox', { name: 'Reply' }).fill('Thanks, on it');
  await thread.getByRole('button', { name: 'Send' }).click();
  await expect(thread.getByRole('textbox', { name: 'Reply' })).toHaveValue('');
  await expect(thread.locator('p', { hasText: 'Thanks, on it' })).toBeVisible();
  expect(state.messages.at(-1)).toMatchObject({ thread_user_id: stu, sender: 'owner', body: 'Thanks, on it' });
});

test('Settings → Invite friends shows the link and progress', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings?section=invite');
  await expect(page.getByRole('textbox', { name: 'Your invite link' })).toHaveValue('https://somastudy.app/?ref=abcd2345');
  await expect(page.getByText('2 of 5 friends in the last 2 months.')).toBeVisible();
});

test('a new account that came from an invite link claims it once', async ({ page }) => {
  const newUser = { ...account, id: '33333333-3333-4333-8333-333333333333', created_at: new Date().toISOString() };
  // The visit with ?ref= happens before sign-in.
  await page.goto('/?ref=abcd2345');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('soma_ref'))).toContain('abcd2345');
  const state = await signIn(page, { user: newUser });
  await page.goto('/settings');
  await expect.poll(() => state.api.filter(a => a.action === 'referral-claim')).toEqual([{ action: 'referral-claim', code: 'abcd2345' }]);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('soma_ref'))).toBeNull();
});

test('students not paying see the invite popup once a day; subscribers never do', async ({ page }) => {
  await signIn(page, { status: 'trialing' });
  await page.goto('/tasks');
  const popup = page.getByRole('dialog', { name: 'Get a free week of Soma' });
  await expect(popup).toBeVisible({ timeout: 5_000 });
  await expect(popup.getByRole('textbox', { name: 'Your invite link' })).toHaveValue('https://somastudy.app/?ref=abcd2345');
  await popup.getByRole('button', { name: 'Maybe later' }).click();
  await expect(popup).toHaveCount(0);
  // The same day, again: not shown.
  await page.reload();
  await page.waitForTimeout(2_500);
  await expect(popup).toHaveCount(0);
  // Tomorrow it comes back.
  await page.evaluate(id => localStorage.setItem(`soma_invite_nudge_${id}`, 'Mon Jan 01 2001'), account.id);
  await page.reload();
  await expect(popup).toBeVisible({ timeout: 5_000 });
});

test('a subscriber gets no invite popup', async ({ page }) => {
  await signIn(page, { status: 'active' });
  await page.goto('/tasks');
  await page.waitForTimeout(2_500);
  await expect(page.getByRole('dialog', { name: 'Get a free week of Soma' })).toHaveCount(0);
});

test('an account made today gets no invite popup (sign-up showed the link)', async ({ page }) => {
  await signIn(page, { status: 'free', user: { ...account, created_at: new Date().toISOString() } });
  await page.goto('/tasks');
  await page.waitForTimeout(2_500);
  await expect(page.getByRole('dialog', { name: 'Get a free week of Soma' })).toHaveCount(0);
});
