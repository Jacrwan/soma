import { useSyncExternalStore } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Plan } from './pricing';

export type SubscriptionStatus =
  | 'loading'
  | 'unavailable'
  | 'free'
  | 'trialing'
  | 'trial_expired'
  | 'trial_extended'
  | 'trial_extension_expired'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid';

export interface SubscriptionInfo {
  error: string | null;
  status: SubscriptionStatus;
  plan: Plan;
  trialStart: string | null;
  trialEndsAt: string | null;
  extensionStart: string | null;
  extensionEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export function hasAIAccess(status: SubscriptionStatus): boolean {
  return status === 'trialing' || status === 'trial_extended' || status === 'active';
}

export const GOOGLE_CALENDAR_LIMIT_FREE = 2;
export const GOOGLE_CALENDAR_LIMIT_PREMIUM = 3;

// Same tiering hasAIAccess uses — trial counts as premium-equivalent while it lasts.
export function getGoogleCalendarLimit(status: SubscriptionStatus): number {
  return hasAIAccess(status) ? GOOGLE_CALENDAR_LIMIT_PREMIUM : GOOGLE_CALENDAR_LIMIT_FREE;
}

const EMPTY: SubscriptionInfo = {
  error: null,
  status: 'loading',
  plan: 'monthly',
  trialStart: null,
  trialEndsAt: null,
  extensionStart: null,
  extensionEndsAt: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

async function stripePost(action: string, token: string, body?: Record<string, unknown>) {
  return fetch('/api/stripe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
}

// Share one subscription snapshot and request across App, navigation and settings.
// Auth events may fire again on tab focus; they must not remount payment UI or
// let a late response from a previous account replace the current account.
let snapshot: SubscriptionInfo = EMPTY;
let accountId: string | null = null;
let revision = 0;
let pending: { key: string; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();
let stopAuth: (() => void) | undefined;

function publish(next: SubscriptionInfo) {
  snapshot = next;
  listeners.forEach(listener => listener());
}

async function loadSubscription(session: Session | null): Promise<void> {
  const nextId = session?.user.id ?? null;
  if (nextId !== accountId) {
    accountId = nextId;
    revision++;
    pending = null;
    publish(EMPTY);
  }
  if (!session) {
    publish({ ...EMPTY, status: 'free' });
    return;
  }
  const key = `${session.user.id}:${session.access_token}`;
  if (pending?.key === key) return pending.promise;
  const requestRevision = ++revision;
  const request = (async () => {
    try {
      const devEmail = import.meta.env.VITE_DEVELOPER_EMAIL as string | undefined;
      const res = devEmail && session.user.email === devEmail
        ? null
        : await fetch('/api/stripe', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get-subscription' }),
          signal: AbortSignal.timeout(10_000),
        });
      if (res && !res.ok) throw new Error('Subscription lookup failed');
      const data = res ? await res.json() : { status: 'active' };
      const statuses: SubscriptionStatus[] = [
        'free', 'trialing', 'trial_expired', 'trial_extended',
        'trial_extension_expired', 'active', 'past_due', 'canceled', 'unpaid',
      ];
      if (!data || !statuses.includes(data.status)) throw new Error('Invalid subscription response');
      if (requestRevision !== revision) return;
      publish({
        status: data.status,
        plan: data.plan === 'semester' ? 'semester' : 'monthly',
        trialStart: data.trialStart ?? null,
        trialEndsAt: data.trialEndsAt ?? null,
        extensionStart: data.extensionStart ?? null,
        extensionEndsAt: data.extensionEndsAt ?? null,
        currentPeriodEnd: data.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
        error: null,
      });
    } catch {
      if (requestRevision !== revision) return;
      publish({
        ...snapshot,
        status: snapshot.status === 'loading' ? 'unavailable' : snapshot.status,
        error: 'Could not verify your subscription. Please try again.',
      });
    }
  })();
  pending = { key, promise: request };
  await request;
  if (requestRevision === revision) pending = null;
}

export async function refreshSubscription(): Promise<void> {
  const before = revision;
  const { data: { session }, error } = await supabase.auth.getSession();
  if (before !== revision) return;
  if (error) {
    publish({ ...snapshot, error: 'Could not verify your subscription. Please try again.' });
    return;
  }
  await loadSubscription(session);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Clear the previous account synchronously, but defer all asynchronous
      // work until Supabase releases its auth lock.
      if ((session?.user.id ?? null) !== accountId) {
        accountId = session?.user.id ?? null;
        revision++;
        pending = null;
        publish(EMPTY);
      }
      clearTimeout(timer);
      timer = setTimeout(() => { void loadSubscription(session); }, 0);
    });
    stopAuth = () => { clearTimeout(timer); subscription.unsubscribe(); };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      stopAuth?.();
      revision++;
      pending = null;
      accountId = null;
      snapshot = EMPTY;
    }
  };
}

export function useSubscription(): SubscriptionInfo {
  return useSyncExternalStore(subscribe, () => snapshot);
}

// ── New trial flow (card upfront via Stripe Elements) ─────────────────────────

export async function createSetupIntent(): Promise<{ clientSecret: string; trialEndsAt: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await stripePost('create-setup-intent', token);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to create setup intent');
  }
  return res.json() as Promise<{ clientSecret: string; trialEndsAt: string }>;
}

export async function createSubscription(
  paymentMethodId: string,
  plan: Plan,
): Promise<{ trialEndsAt: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await stripePost('create-subscription', token, { paymentMethodId, plan });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to create subscription');
  }
  return res.json() as Promise<{ trialEndsAt: string }>;
}

export async function startCheckout(plan: Plan = 'monthly'): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await stripePost('create-checkout-session', token, { plan });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Checkout failed');
  }
  const { url } = await res.json() as { url: string };
  window.location.href = url;
}

export async function openBillingPortal(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await stripePost('create-billing-portal', token);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Portal failed');
  }
  const { url } = await res.json() as { url: string };
  window.location.href = url;
}
