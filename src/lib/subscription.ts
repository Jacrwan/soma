import { useState, useEffect } from 'react';
import { supabase } from './supabase';

export type SubscriptionStatus =
  | 'loading'
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
  status: SubscriptionStatus;
  plan: 'monthly' | 'annual';
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

const EMPTY: SubscriptionInfo = {
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

export function useSubscription(): SubscriptionInfo {
  const [info, setInfo] = useState<SubscriptionInfo>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        if (!cancelled) setInfo({ ...EMPTY, status: 'free' });
        return;
      }

      const devEmail = import.meta.env.VITE_DEVELOPER_EMAIL as string | undefined;
      if (devEmail && session.user?.email === devEmail) {
        if (!cancelled) setInfo({ ...EMPTY, status: 'active' });
        return;
      }

      try {
        const res = await stripePost('get-subscription', token);
        if (!res.ok) throw new Error('failed');
        const data = await res.json();
        if (!cancelled) {
          setInfo({
            status: (data.status as SubscriptionStatus) ?? 'free',
            plan: data.plan === 'annual' ? 'annual' : 'monthly',
            trialStart: data.trialStart ?? null,
            trialEndsAt: data.trialEndsAt ?? null,
            extensionStart: data.extensionStart ?? null,
            extensionEndsAt: data.extensionEndsAt ?? null,
            currentPeriodEnd: data.currentPeriodEnd ?? null,
            cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
          });
        }
      } catch {
        if (!cancelled) setInfo({ ...EMPTY, status: 'free' });
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return info;
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
  plan: 'monthly' | 'annual',
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

// Legacy extension checkout — used after an old card-free trial expires
export async function startCheckout(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await stripePost('create-checkout-session', token);
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
