/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { isRateLimited } from './_rateLimit';

const TRIAL_MS     = 21 * 86_400_000;
const EXTENSION_MS =  7 * 86_400_000;

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

function computeStatus(row: {
  status: string;
  trial_start: string | null;
  extension_start: string | null;
  stripe_subscription_id?: string | null;
}): string {
  // If there's a Stripe subscription, trust Stripe's status (synced by webhooks)
  if (row.stripe_subscription_id) return row.status;

  // Legacy free trial — no card on file, compute expiry locally
  const now = Date.now();
  if (row.status === 'trialing' && row.trial_start) {
    return now > new Date(row.trial_start).getTime() + TRIAL_MS
      ? 'trial_expired'
      : 'trialing';
  }
  if (row.status === 'trial_extended' && row.extension_start) {
    return now > new Date(row.extension_start).getTime() + EXTENSION_MS
      ? 'trial_extension_expired'
      : 'trial_extended';
  }
  return row.status;
}

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (isRateLimited(req, 'subscription', { max: 30, windowMs: 60_000 })) {
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

  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: sub } = await admin
    .from('subscriptions')
    .select('status, plan, trial_start, extension_start, current_period_end, cancel_at_period_end, stripe_subscription_id')
    .eq('user_id', user.id)
    .single();

  if (!sub) return res.json({ status: 'free' });

  const status = computeStatus(sub);

  // For Stripe-backed trials, trial end comes from current_period_end
  // For legacy free trials (no Stripe sub), compute from trial_start
  const trialEndsAt = sub.stripe_subscription_id
    ? (sub.current_period_end ?? null)
    : (sub.trial_start
        ? new Date(new Date(sub.trial_start).getTime() + TRIAL_MS).toISOString()
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
