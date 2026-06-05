/// <reference types="node" />
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { isRateLimited } from './_rateLimit';

const TRIAL_DAYS = 21;

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

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (isRateLimited(req, 'create-subscription', { max: 10, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const authHeader = req.headers['authorization'] as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  const token = authHeader.slice(7);

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const stripeKey   = process.env.STRIPE_SECRET_KEY ?? '';
  const monthlyPriceId = process.env.STRIPE_PRICE_ID_MONTHLY ?? '';
  const annualPriceId  = process.env.STRIPE_PRICE_ID_YEARLY ?? '';

  if (!supabaseUrl || !serviceKey || !stripeKey || !monthlyPriceId || !annualPriceId) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  let body = req.body as Record<string, unknown> | string | undefined;
  if (typeof body === 'string') {
    try { body = JSON.parse(body) as Record<string, unknown>; } catch { body = {}; }
  }
  body = body ?? {};

  const paymentMethodId = typeof body.paymentMethodId === 'string' ? body.paymentMethodId : '';
  const plan = body.plan === 'annual' ? 'annual' : 'monthly';

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

  const stripe = new Stripe(stripeKey);
  const customerId = sub.stripe_customer_id as string;

  // Attach the payment method to the customer and set as default
  await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  const trialEnd = Math.floor(Date.now() / 1000) + TRIAL_DAYS * 86_400;
  const priceId = plan === 'annual' ? annualPriceId : monthlyPriceId;

  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
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
