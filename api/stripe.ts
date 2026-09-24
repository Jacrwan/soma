/// <reference types="node" />
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { isRateLimited } from './_rateLimit';
import { TRIAL_DAYS, EXTENSION_MS, trialLengthMs } from './_trial';

const ALLOWED_ORIGINS = [
  'https://somastudy.app',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173'] : []),
];

function applyCors(req: any, res: any): boolean {
  const origin = req.headers['origin'] as string | undefined;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

function origin(req: any): string {
  const raw = req.headers['origin'] as string | undefined;
  return raw && ALLOWED_ORIGINS.includes(raw) ? raw : 'https://somastudy.app';
}

function computeStatus(row: {
  status: string;
  trial_start: string | null;
  extension_start: string | null;
  stripe_subscription_id?: string | null;
}): string {
  if (row.stripe_subscription_id) return row.status;
  const now = Date.now();
  if (row.status === 'trialing' && row.trial_start) {
    return now > new Date(row.trial_start).getTime() + trialLengthMs(row.trial_start) ? 'trial_expired' : 'trialing';
  }
  if (row.status === 'trial_extended' && row.extension_start) {
    return now > new Date(row.extension_start).getTime() + EXTENSION_MS ? 'trial_extension_expired' : 'trial_extended';
  }
  return row.status;
}

// ── Action handlers ───────────────────────────────────────────────────────────

export async function getSubscription(user: any, admin: any, res: any) {
  const { data: sub, error } = await admin
    .from('subscriptions')
    .select('status, plan, trial_start, extension_start, current_period_end, cancel_at_period_end, stripe_subscription_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return res.status(503).json({ error: 'Could not verify subscription. Please try again.' });
  if (!sub) return res.json({ status: 'free' });

  const status = computeStatus(sub);

  const trialEndsAt = sub.stripe_subscription_id
    ? (sub.current_period_end ?? null)
    : (sub.trial_start
        ? new Date(new Date(sub.trial_start).getTime() + trialLengthMs(sub.trial_start)).toISOString()
        : null);

  const extensionEndsAt = sub.extension_start
    ? new Date(new Date(sub.extension_start).getTime() + EXTENSION_MS).toISOString()
    : null;

  return res.json({
    status,
    plan: sub.plan ?? 'monthly',
    trialStart: sub.trial_start,
    trialEndsAt,
    extensionStart: sub.extension_start,
    extensionEndsAt,
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}

async function createSetupIntent(user: any, admin: any, stripe: Stripe, res: any) {
  const { data: existing } = await admin
    .from('subscriptions')
    .select('status, stripe_customer_id, stripe_subscription_id')
    .eq('user_id', user.id)
    .single();

  if (existing?.stripe_subscription_id) {
    return res.status(409).json({ error: 'Subscription already exists' });
  }

  let customerId = existing?.stripe_customer_id as string | undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
  }

  const now = new Date().toISOString();
  await admin.from('subscriptions').upsert(
    { user_id: user.id, stripe_customer_id: customerId, status: existing?.status ?? 'free', updated_at: now },
    { onConflict: 'user_id' },
  );

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    usage: 'off_session',
    payment_method_types: ['card'],
    metadata: { supabase_user_id: user.id },
  });

  return res.json({
    clientSecret: setupIntent.client_secret,
    customerId,
    trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString(),
  });
}

async function createSubscription(user: any, admin: any, stripe: Stripe, body: Record<string, unknown>, res: any) {
  const monthlyPriceId  = process.env.STRIPE_PRICE_ID_MONTHLY ?? '';
  const semesterPriceId = process.env.STRIPE_PRICE_ID_SEMESTER ?? '';
  if (!monthlyPriceId || !semesterPriceId) return res.status(500).json({ error: 'Price IDs not configured' });

  const paymentMethodId = typeof body.paymentMethodId === 'string' ? body.paymentMethodId : '';
  const plan = body.plan === 'semester' ? 'semester' : 'monthly';
  if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId required' });

  const { data: sub } = await admin
    .from('subscriptions')
    .select('stripe_customer_id, stripe_subscription_id')
    .eq('user_id', user.id)
    .single();

  if (!sub?.stripe_customer_id) {
    return res.status(409).json({ error: 'No Stripe customer found — call create-setup-intent first' });
  }
  if (sub.stripe_subscription_id) {
    return res.status(409).json({ error: 'Subscription already exists' });
  }

  const customerId = sub.stripe_customer_id as string;
  await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  const trialEnd = Math.floor(Date.now() / 1000) + TRIAL_DAYS * 86_400;
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: plan === 'semester' ? semesterPriceId : monthlyPriceId }],
    trial_end: trialEnd,
    default_payment_method: paymentMethodId,
    metadata: { supabase_user_id: user.id, plan },
  });

  const now = new Date().toISOString();
  const trialEndsAt = new Date(trialEnd * 1000).toISOString();
  await admin.from('subscriptions').upsert(
    {
      user_id: user.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      status: 'trialing',
      plan,
      trial_start: now,
      current_period_end: trialEndsAt,
      cancel_at_period_end: false,
      updated_at: now,
    },
    { onConflict: 'user_id' },
  );

  return res.json({ success: true, subscriptionId: subscription.id, trialEndsAt });
}

async function createCheckoutSession(user: any, admin: any, stripe: Stripe, body: Record<string, unknown>, req: any, res: any) {
  const plan = body.plan === 'semester' ? 'semester' : 'monthly';
  const priceId = plan === 'semester'
    ? process.env.STRIPE_PRICE_ID_SEMESTER ?? ''
    : process.env.STRIPE_PRICE_ID_MONTHLY ?? '';
  if (!priceId) return res.status(500).json({ error: 'Price ID not configured' });

  const { data: sub } = await admin
    .from('subscriptions')
    .select('status, trial_start, extension_start, stripe_customer_id, stripe_subscription_id')
    .eq('user_id', user.id)
    .single();

  if (sub?.stripe_subscription_id) return res.status(409).json({ error: 'Already subscribed' });
  if (sub?.status === 'active')     return res.status(409).json({ error: 'Already subscribed' });

  const hasFreeTrial  = !!sub?.trial_start;
  const trialExpired  = hasFreeTrial && Date.now() > new Date(sub.trial_start).getTime() + trialLengthMs(sub.trial_start);

  // One free trial per account. Someone whose trial has ended pays from day one.
  if (hasFreeTrial && !trialExpired) return res.status(409).json({ error: 'Free trial has not ended yet' });
  const trialDays = hasFreeTrial ? 0 : TRIAL_DAYS;

  let customerId = sub?.stripe_customer_id as string | undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    const now = new Date().toISOString();
    await admin.from('subscriptions').upsert(
      { user_id: user.id, stripe_customer_id: customerId, status: sub?.status ?? 'free', updated_at: now },
      { onConflict: 'user_id' },
    );
  }

  const org = origin(req);
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_collection: 'always',
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
      metadata: { supabase_user_id: user.id, plan },
    },
    success_url: `${org}/day-view?subscription=started`,
    cancel_url: `${org}/pricing`,
  });

  return res.json({ url: session.url });
}

async function createBillingPortal(user: any, admin: any, stripe: Stripe, req: any, res: any) {
  const { data: sub } = await admin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single();

  if (!sub?.stripe_customer_id) return res.status(404).json({ error: 'No subscription found' });

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${origin(req)}/settings`,
    });
    return res.json({ url: portalSession.url });
  } catch (err: any) {
    console.error('[stripe] billing portal error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Failed to open billing portal' });
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  'get-subscription':         { max: 30, windowMs: 60_000 },
  'create-setup-intent':      { max: 10, windowMs: 60_000 },
  'create-subscription':      { max: 10, windowMs: 60_000 },
  'create-checkout-session':  { max: 5,  windowMs: 60_000 },
  'create-billing-portal':    { max: 5,  windowMs: 60_000 },
};

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body as Record<string, unknown> | string | undefined;
  if (typeof body === 'string') {
    try { body = JSON.parse(body) as Record<string, unknown>; } catch { body = {}; }
  }
  body = body ?? {};

  const action = typeof body.action === 'string' ? body.action : '';
  if (!action) return res.status(400).json({ error: 'action required' });

  const rateLimit = RATE_LIMITS[action];
  if (!rateLimit) return res.status(400).json({ error: `Unknown action: ${action}` });
  if (isRateLimited(req, `stripe:${action}`, rateLimit)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const authHeader = req.headers['authorization'] as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  const token = authHeader.slice(7);

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Server not configured' });

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  if (action === 'get-subscription') return getSubscription(user, admin, res);

  const stripeKey = process.env.STRIPE_SECRET_KEY ?? '';
  if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured' });
  const stripe = new Stripe(stripeKey);

  if (action === 'create-setup-intent')     return createSetupIntent(user, admin, stripe, res);
  if (action === 'create-subscription')     return createSubscription(user, admin, stripe, body, res);
  if (action === 'create-checkout-session') return createCheckoutSession(user, admin, stripe, body, req, res);
  if (action === 'create-billing-portal')   return createBillingPortal(user, admin, stripe, req, res);

  return res.status(400).json({ error: `Unknown action: ${action}` });
}
