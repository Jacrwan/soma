/// <reference types="node" />
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const TRIAL_MS = 21 * 86_400_000; // 21 days in ms

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

  const authHeader = req.headers['authorization'] as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  const token = authHeader.slice(7);

  const supabaseUrl    = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey     = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const stripeKey      = process.env.STRIPE_SECRET_KEY ?? '';
  const priceId        = process.env.STRIPE_PRICE_ID_MONTHLY ?? '';

  if (!supabaseUrl || !serviceKey || !stripeKey || !priceId) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: sub } = await admin
    .from('subscriptions')
    .select('status, trial_start, extension_start, stripe_customer_id')
    .eq('user_id', user.id)
    .single();

  // Must have completed a free trial first
  if (!sub?.trial_start) {
    return res.status(409).json({ error: 'Start your free trial first' });
  }

  // One extension per user, ever
  if (sub.extension_start) {
    return res.status(409).json({ error: 'Already extended' });
  }

  // Block if already on an active paid subscription
  if (sub.status === 'active') {
    return res.status(409).json({ error: 'Already subscribed' });
  }

  // Free trial must have actually expired
  if (Date.now() < new Date(sub.trial_start).getTime() + TRIAL_MS) {
    return res.status(409).json({ error: 'Free trial has not ended yet' });
  }

  const stripe = new Stripe(stripeKey);
  const rawOrigin = req.headers['origin'] as string | undefined;
  const origin = rawOrigin && ALLOWED_ORIGINS.includes(rawOrigin) ? rawOrigin : 'https://somastudy.app';

  let customerId = sub?.stripe_customer_id as string | undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_collection: 'always',
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 7,
      metadata: { supabase_user_id: user.id },
    },
    success_url: `${origin}/settings?subscription=extended`,
    cancel_url: `${origin}/pricing`,
  });

  return res.json({ url: session.url });
}
