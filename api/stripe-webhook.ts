/// <reference types="node" />
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

type Plan = 'monthly' | 'semester';

/** Which plan a subscription is on: the price Stripe charges, else what checkout recorded. */
export function planOf(
  sub: Stripe.Subscription,
  prices = { monthly: process.env.STRIPE_PRICE_ID_MONTHLY, semester: process.env.STRIPE_PRICE_ID_SEMESTER },
): Plan {
  const price = sub.items?.data?.[0]?.price?.id;
  if (price && price === prices.semester) return 'semester';
  if (price && price === prices.monthly) return 'monthly';
  return sub.metadata?.plan === 'semester' ? 'semester' : 'monthly';
}

const iso = (seconds: unknown) => typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;

// Newer Stripe API versions moved the period end onto the subscription's
// items and an invoice's subscription under `parent`. Events are sent in the
// webhook endpoint's version, which can be newer than this SDK's, so read both.
export function periodEndOf(sub: Stripe.Subscription): string | null {
  return iso((sub as any).current_period_end ?? (sub.items?.data?.[0] as any)?.current_period_end);
}

export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const raw = (invoice as any).subscription ?? (invoice as any).parent?.subscription_details?.subscription;
  if (!raw) return null;
  return typeof raw === 'string' ? raw : raw.id ?? null;
}

/**
 * The row to store for a subscription: Stripe's status as it is, the plan
 * it's charged for, and Stripe's trial start when the row has none (the AI
 * and the one-trial rule read it). Null when the event is about an old
 * subscription that ended after the student subscribed again, so it can't
 * mark the new one canceled.
 */
export function subscriptionRow(
  sub: Stripe.Subscription,
  userId: string,
  existing: { trial_start: string | null; stripe_subscription_id: string | null } | null,
  now = new Date().toISOString(),
): Record<string, unknown> | null {
  const ended = sub.status === 'canceled' || sub.status === 'incomplete_expired';
  if (ended && existing?.stripe_subscription_id && existing.stripe_subscription_id !== sub.id) return null;
  const row: Record<string, unknown> = {
    user_id: userId,
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    stripe_subscription_id: sub.id,
    status: sub.status,
    plan: planOf(sub),
    cancel_at_period_end: sub.cancel_at_period_end,
    updated_at: now,
  };
  // Never blank a known date because a payload left it out.
  const periodEnd = periodEndOf(sub);
  if (periodEnd) row.current_period_end = periodEnd;
  if (!existing?.trial_start && sub.trial_start) row.trial_start = iso(sub.trial_start);
  return row;
}

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
    const { data: existing, error: readError } = await admin
      .from('subscriptions')
      .select('trial_start, stripe_subscription_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (readError) throw new Error(`subscriptions read: ${readError.message}`);
    const row = subscriptionRow(sub, userId, existing);
    if (!row) return;
    const { error } = await admin.from('subscriptions').upsert(row, { onConflict: 'user_id' });
    if (error) throw new Error(`subscriptions write: ${error.message}`);
  }

  // A write that fails answers 500, so Stripe sends the event again. Until
  // 2026-10-21 failures were ignored and the row silently stayed out of date.
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          await upsertSubscription(sub);
        }
        // A paid top-up adds to this month's Soma budget. Stripe can deliver an
        // event twice; the session id is unique, so it's counted once.
        if (session.mode === 'payment' && session.metadata?.kind === 'ai_topup' && session.payment_status === 'paid' && session.metadata.supabase_user_id) {
          const { error } = await admin.from('ai_topups').upsert(
            { user_id: session.metadata.supabase_user_id, stripe_session_id: session.id, amount_usd: Number(session.metadata.adds_usd) || 0 },
            { onConflict: 'stripe_session_id', ignoreDuplicates: true },
          );
          if (error) throw new Error(`ai_topups: ${error.message}`);
        }
        break;
      }

      // Deleted carries status 'canceled'; the same row logic applies.
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await upsertSubscription(event.data.object as Stripe.Subscription);
        break;

      // 3 days before trial ends — good place to send reminder emails in future
      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await resolveUserId(sub);
        if (userId) {
          console.log(`[stripe-webhook] trial_will_end for user ${userId} — sub ${sub.id}`);
          // Mark in DB so the frontend can show a more urgent banner. Only a
          // hint, so a failure here isn't worth Stripe retrying.
          const { error } = await admin.from('subscriptions')
            .update({ trial_will_end_notified: true, updated_at: new Date().toISOString() })
            .eq('user_id', userId);
          if (error) console.error('[stripe-webhook] trial_will_end flag not saved:', error.message);
        }
        break;
      }

      // Stripe's own status, not 'active': the $0 invoice that starts a trial
      // is "paid" too, and used to mark trial students as paying subscribers.
      case 'invoice.payment_succeeded': {
        const id = invoiceSubscriptionId(event.data.object as Stripe.Invoice);
        if (!id) break;
        await upsertSubscription(await stripe.subscriptions.retrieve(id));
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const id = invoiceSubscriptionId(invoice);
        if (!id) break;
        const sub = await stripe.subscriptions.retrieve(id);
        const userId = await resolveUserId(sub);
        if (!userId) break;
        // Only flip to past_due if this isn't the setup invoice during the trial
        // (Stripe sends a $0 invoice at trial start that always "succeeds", but
        //  a failed real charge at trial end means the card declined)
        const isTrialInvoice = invoice.amount_due === 0;
        if (!isTrialInvoice) {
          // Only the subscription on file: an old one can't overwrite a new one.
          const { error } = await admin.from('subscriptions')
            .update({ status: 'past_due', updated_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('stripe_subscription_id', sub.id);
          if (error) throw new Error(`subscriptions write: ${error.message}`);
        }
        break;
      }

      default:
        break;
    }
  } catch (err: any) {
    console.error(`[stripe-webhook] ${event.type} not recorded:`, err?.message);
    return res.status(500).json({ error: 'Not recorded' });
  }

  return res.json({ received: true });
}
