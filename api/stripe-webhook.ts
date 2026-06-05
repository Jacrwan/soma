/// <reference types="node" />
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

async function getRawBody(req: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripeKey     = process.env.STRIPE_SECRET_KEY ?? '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
  const supabaseUrl   = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey    = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!stripeKey || !webhookSecret || !supabaseUrl || !serviceKey) {
    console.error('[stripe-webhook] missing env vars');
    return res.status(500).end();
  }

  const stripe = new Stripe(stripeKey);
  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error('[stripe-webhook] signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  async function resolveUserId(sub: Stripe.Subscription): Promise<string | null> {
    if (sub.metadata?.supabase_user_id) return sub.metadata.supabase_user_id;
    try {
      const customer = await stripe.customers.retrieve(sub.customer as string) as Stripe.Customer;
      return customer.metadata?.supabase_user_id ?? null;
    } catch {
      return null;
    }
  }

  async function upsertSubscription(sub: Stripe.Subscription) {
    const userId = await resolveUserId(sub);
    if (!userId) {
      console.warn('[stripe-webhook] could not resolve supabase_user_id for subscription');
      return;
    }

    // Fetch existing row to preserve free-trial timestamps and detect extension flow
    const { data: existing } = await admin
      .from('subscriptions')
      .select('trial_start, extension_start')
      .eq('user_id', userId)
      .single();

    const hadFreeTrial = !!existing?.trial_start;
    const now = new Date().toISOString();
    const periodEnd = sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null;

    // Map Stripe statuses; preserve extension logic for legacy users
    const storedStatus = hadFreeTrial && sub.status === 'trialing'
      ? 'trial_extended'
      : sub.status; // 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' pass through directly

    const payload: Record<string, unknown> = {
      user_id: userId,
      stripe_customer_id: sub.customer as string,
      stripe_subscription_id: sub.id,
      status: storedStatus,
      plan: 'premium',
      current_period_end: periodEnd,
      cancel_at_period_end: sub.cancel_at_period_end,
      updated_at: now,
    };

    // Always preserve trial_start — never overwrite it with null
    if (existing?.trial_start) payload.trial_start = existing.trial_start;

    // Set extension_start the first time the extension is activated
    if (hadFreeTrial && sub.status === 'trialing' && !existing?.extension_start) {
      payload.extension_start = now;
    } else if (existing?.extension_start) {
      payload.extension_start = existing.extension_start;
    }

    await admin.from('subscriptions').upsert(payload, { onConflict: 'user_id' });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === 'subscription' && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription as string);
        await upsertSubscription(sub);
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await upsertSubscription(event.data.object as Stripe.Subscription);
      break;

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const userId = await resolveUserId(sub);
      if (userId) {
        await admin.from('subscriptions')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('user_id', userId);
      }
      break;
    }

    // 3 days before trial ends — good place to send reminder emails in future
    case 'customer.subscription.trial_will_end': {
      const sub = event.data.object as Stripe.Subscription;
      const userId = await resolveUserId(sub);
      if (userId) {
        console.log(`[stripe-webhook] trial_will_end for user ${userId} — sub ${sub.id}`);
        // Mark in DB so the frontend can show a more urgent banner
        await admin.from('subscriptions')
          .update({ trial_will_end_notified: true, updated_at: new Date().toISOString() })
          .eq('user_id', userId);
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      if (!invoice.subscription) break;
      const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
      const userId = await resolveUserId(sub);
      if (!userId) break;
      const periodEnd = sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;
      await admin.from('subscriptions').upsert(
        {
          user_id: userId,
          status: 'active',
          current_period_end: periodEnd,
          cancel_at_period_end: sub.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      if (!invoice.subscription) break;
      const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
      const userId = await resolveUserId(sub);
      if (!userId) break;
      // Only flip to past_due if this isn't the setup invoice during the trial
      // (Stripe sends a $0 invoice at trial start that always "succeeds", but
      //  a failed real charge at trial end means the card declined)
      const isTrialInvoice = invoice.amount_due === 0;
      if (!isTrialInvoice) {
        await admin.from('subscriptions')
          .update({ status: 'past_due', updated_at: new Date().toISOString() })
          .eq('user_id', userId);
      }
      break;
    }

    default:
      break;
  }

  return res.json({ received: true });
}
