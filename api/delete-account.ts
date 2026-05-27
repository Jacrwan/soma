/// <reference types="node" />
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  const token = authHeader.slice(7);

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const stripeKey   = process.env.STRIPE_SECRET_KEY ?? '';
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const uid = user.id;

  // Cancel active Stripe subscription before deleting (prevent ghost billing)
  if (stripeKey) {
    try {
      const { data: sub } = await admin
        .from('subscriptions')
        .select('stripe_subscription_id, status')
        .eq('user_id', uid)
        .single();

      if (sub?.stripe_subscription_id && (sub.status === 'trialing' || sub.status === 'active')) {
        const stripe = new Stripe(stripeKey);
        await stripe.subscriptions.cancel(sub.stripe_subscription_id);
      }
    } catch {
      // Non-fatal: proceed with account deletion even if Stripe cancel fails
    }
  }

  // Delete user rows from all tables
  for (const table of ['todos', 'schedule_blocks', 'elapsed_time', 'settings', 'ai_memory', 'subscriptions', 'timer_sessions', 'active_timer', 'time_blocks']) {
    await admin.from(table).delete().eq('user_id', uid);
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) {
    console.error('[delete-account] deleteUser failed:', delErr.message);
    return res.status(500).json({ error: 'Request failed' });
  }

  return res.status(200).json({ success: true });
}
