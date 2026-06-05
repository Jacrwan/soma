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
  if (isRateLimited(req, 'create-setup-intent', { max: 10, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const authHeader = req.headers['authorization'] as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  const token = authHeader.slice(7);

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const stripeKey   = process.env.STRIPE_SECRET_KEY ?? '';

  if (!supabaseUrl || !serviceKey || !stripeKey) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // Don't allow a second trial if one is already active or completed
  const { data: existing } = await admin
    .from('subscriptions')
    .select('status, stripe_customer_id, stripe_subscription_id, trial_start')
    .eq('user_id', user.id)
    .single();

  if (existing?.stripe_subscription_id) {
    return res.status(409).json({ error: 'Subscription already exists' });
  }

  const stripe = new Stripe(stripeKey);

  // Reuse existing Stripe customer if we already created one
  let customerId = existing?.stripe_customer_id as string | undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
  }

  // Store the customer ID so create-subscription can use it
  const now = new Date().toISOString();
  await admin.from('subscriptions').upsert(
    {
      user_id: user.id,
      stripe_customer_id: customerId,
      status: existing?.status ?? 'free',
      updated_at: now,
    },
    { onConflict: 'user_id' },
  );

  // SetupIntent collects card now but charges nothing — the subscription will charge after trial
  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    usage: 'off_session',
    payment_method_types: ['card'],
    metadata: { supabase_user_id: user.id },
  });

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString();

  return res.json({
    clientSecret: setupIntent.client_secret,
    customerId,
    trialEndsAt,
  });
}
