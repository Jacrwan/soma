import { test, expect, type Page } from '@playwright/test';
import type Stripe from 'stripe';
import { computeStatus } from '../api/_trial';
import { authorizeChat } from '../api/chat';
import { getSubscription, createCheckoutSession } from '../api/stripe';
import { subscriptionRow, invoiceSubscriptionId, planOf } from '../api/stripe-webhook';

// Billing audit, 2026-10-21. Checkout trials were refused by the AI (no
// trial_start), the $0 trial invoice marked trials as paying, canceled
// students could never subscribe again, and a failed billing check offered
// payers a free trial.

const NOW = Date.parse('2026-10-21T12:00:00Z');
const day = 86_400_000;

function fakeResponse() {
  const out = { code: 200, body: undefined as unknown };
  const res = {
    status: (value: number) => { out.code = value; return res; },
    json: (value: unknown) => { out.body = value; return res; },
  };
  return { res, out };
}

function fakeAdmin(row: Record<string, unknown> | null, error: { message: string } | null = null) {
  const query = {
    select: () => query, eq: () => query,
    maybeSingle: async () => ({ data: row, error }),
    single: async () => ({ data: row, error }),
    upsert: async () => ({ error: null }),
  };
  return { from: () => query };
}

function stripeSub(over: Partial<Record<string, unknown>> = {}): Stripe.Subscription {
  return {
    id: 'sub_new', customer: 'cus_1', status: 'trialing', cancel_at_period_end: false,
    trial_start: Math.floor(NOW / 1000), metadata: { plan: 'monthly' },
    items: { data: [{ price: { id: 'price_semester' }, current_period_end: Math.floor((NOW + 7 * day) / 1000) }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

test('a Stripe trial has access whether or not trial_start was saved', () => {
  const row = { status: 'trialing', trial_start: null, extension_start: null };
  expect(computeStatus({ ...row, stripe_subscription_id: 'sub_1' }, NOW)).toBe('trialing');
  // Without a Stripe subscription a trial still needs a real start date.
  expect(computeStatus(row, NOW)).toBe('trial_expired');
  expect(computeStatus({ ...row, trial_start: new Date(NOW - 8 * day).toISOString() }, NOW)).toBe('trial_expired');
  expect(computeStatus({ ...row, trial_start: new Date(NOW - 2 * day).toISOString() }, NOW)).toBe('trialing');
  expect(computeStatus({ status: 'trial_extended', trial_start: null, extension_start: new Date(NOW - 8 * day).toISOString() }, NOW)).toBe('trial_extension_expired');
  // Stripe's word stands for a subscription that ended, too.
  expect(computeStatus({ status: 'canceled', trial_start: null, extension_start: null, stripe_subscription_id: 'sub_1' }, NOW)).toBe('canceled');
});

test('the AI lets a Checkout trial in, and Settings says the same', async () => {
  const row = { status: 'trialing', trial_start: null, extension_start: null, stripe_subscription_id: 'sub_1', current_period_end: '2026-10-28T12:00:00Z' };
  const admin = { ...fakeAdmin(row), auth: { getUser: async () => ({ data: { user: { id: 'u', email: 'student@test.com' } }, error: null }) } };
  expect(await authorizeChat(admin as never, 'token')).toMatchObject({ ok: true });
  const { res, out } = fakeResponse();
  await getSubscription({ id: 'u' }, fakeAdmin(row), res);
  expect(out.body).toMatchObject({ status: 'trialing', trialEndsAt: '2026-10-28T12:00:00Z' });
});

test('the webhook stores Stripe\'s status, the plan charged, and the trial start', () => {
  const prices = { monthly: 'price_monthly', semester: 'price_semester' };
  expect(planOf(stripeSub(), prices)).toBe('semester');
  expect(planOf(stripeSub({ items: { data: [{ price: { id: 'price_monthly' } }] } }), prices)).toBe('monthly');
  expect(planOf(stripeSub({ items: { data: [] }, metadata: { plan: 'semester' } }), prices)).toBe('semester');

  const row = subscriptionRow(stripeSub(), 'u', null, 'now')!;
  expect(row).toMatchObject({
    status: 'trialing', stripe_subscription_id: 'sub_new',
    trial_start: new Date(NOW).toISOString(),
    current_period_end: new Date(NOW + 7 * day).toISOString(),
  });
  // Not 'trial_extended', not 'premium'.
  expect(row.plan === 'monthly' || row.plan === 'semester').toBe(true);

  // A trial start already on file is kept.
  expect(subscriptionRow(stripeSub(), 'u', { trial_start: '2026-09-01T00:00:00Z', stripe_subscription_id: null })).not.toHaveProperty('trial_start');
  // A payload without a period end doesn't blank the stored one.
  expect(subscriptionRow(stripeSub({ items: { data: [] } }), 'u', null)).not.toHaveProperty('current_period_end');
});

test('an old canceled subscription cannot overwrite the one a student came back with', () => {
  const existing = { trial_start: null, stripe_subscription_id: 'sub_new' };
  expect(subscriptionRow(stripeSub({ id: 'sub_old', status: 'canceled' }), 'u', existing)).toBeNull();
  expect(subscriptionRow(stripeSub({ id: 'sub_new', status: 'canceled' }), 'u', existing)).toMatchObject({ status: 'canceled' });
});

test('invoices name their subscription in both Stripe payload shapes', () => {
  expect(invoiceSubscriptionId({ subscription: 'sub_1' } as never)).toBe('sub_1');
  expect(invoiceSubscriptionId({ parent: { subscription_details: { subscription: 'sub_2' } } } as never)).toBe('sub_2');
  expect(invoiceSubscriptionId({ subscription: { id: 'sub_3' } } as never)).toBe('sub_3');
  expect(invoiceSubscriptionId({} as never)).toBeNull();
});

test.describe('checkout', () => {
  test.beforeAll(() => {
    process.env.STRIPE_PRICE_ID_MONTHLY = 'price_monthly';
    process.env.STRIPE_PRICE_ID_SEMESTER = 'price_semester';
  });

  function fakeStripe(previousStatus: string | null) {
    const sessions: Record<string, any>[] = [];
    const stripe = {
      subscriptions: {
        retrieve: async () => {
          if (!previousStatus) throw Object.assign(new Error('gone'), { code: 'resource_missing' });
          return { status: previousStatus };
        },
      },
      customers: { create: async () => ({ id: 'cus_new' }) },
      checkout: { sessions: { create: async (args: Record<string, any>) => { sessions.push(args); return { url: 'https://checkout.stripe.test' }; } } },
    };
    return { stripe, sessions };
  }
  const req = { headers: { origin: 'https://somastudy.app' } };

  test('a canceled student can subscribe again, charged today with no second trial', async () => {
    const { stripe, sessions } = fakeStripe('canceled');
    const { res, out } = fakeResponse();
    await createCheckoutSession({ id: 'u' }, fakeAdmin({ status: 'canceled', trial_start: '2026-10-15T00:00:00Z', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_old' }), stripe as never, { plan: 'semester' }, req, res);
    expect(out.body).toEqual({ url: 'https://checkout.stripe.test' });
    expect(sessions[0].customer).toBe('cus_1');
    expect(sessions[0].line_items).toEqual([{ price: 'price_semester', quantity: 1 }]);
    expect(sessions[0].subscription_data).not.toHaveProperty('trial_period_days');
  });

  test('a subscription Stripe still bills is never doubled', async () => {
    const { stripe, sessions } = fakeStripe('past_due');
    const { res, out } = fakeResponse();
    await createCheckoutSession({ id: 'u' }, fakeAdmin({ status: 'canceled', trial_start: null, stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_old' }), stripe as never, {}, req, res);
    expect(out.code).toBe(409);
    expect(sessions).toHaveLength(0);
  });

  test('a failed lookup is not treated as a new student', async () => {
    const { stripe, sessions } = fakeStripe(null);
    const { res, out } = fakeResponse();
    await createCheckoutSession({ id: 'u' }, fakeAdmin(null, { message: 'Database unavailable' }), stripe as never, {}, req, res);
    expect(out.code).toBe(503);
    expect(sessions).toHaveLength(0);
  });

  test('a new student gets the 7-day trial on the monthly price', async () => {
    const { stripe, sessions } = fakeStripe(null);
    const { res } = fakeResponse();
    await createCheckoutSession({ id: 'u', email: 's@test.com' }, fakeAdmin(null), stripe as never, {}, req, res);
    expect(sessions[0].line_items).toEqual([{ price: 'price_monthly', quantity: 1 }]);
    expect(sessions[0].subscription_data.trial_period_days).toBe(7);
  });
});

// ── Screens ─────────────────────────────────────────────────────────────────

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };

async function signedIn(page: Page, stripe: { status: number; json: unknown }) {
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ status: stripe.status, json: stripe.json }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/google-calendar-connections', r => r.fulfill({ json: { connections: [] } }));
}

test('when billing can\'t be checked, the AI tab offers a retry, not a trial or a price', async ({ page }) => {
  await signedIn(page, { status: 503, json: { error: 'Could not verify subscription. Please try again.' } });
  await page.goto('/ai');
  await expect(page.getByRole('heading', { name: "Couldn't check your subscription" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByText(/free trial/i)).toHaveCount(0);
  await expect(page.getByText(/\$\d/)).toHaveCount(0);
});

test('a canceled student is offered a subscription on Pricing, not a free trial', async ({ page }) => {
  await signedIn(page, { status: 200, json: { status: 'canceled' } });
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Subscribe' })).toBeVisible();
  await expect(page.getByText(/day free trial/i)).toHaveCount(0);
});
