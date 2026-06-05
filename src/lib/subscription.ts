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
        const res = await fetch('/api/subscription', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('failed');
        const data = await res.json();
        if (!cancelled) {
          setInfo({
            status: (data.status as SubscriptionStatus) ?? 'free',
            plan: (data.plan === 'annual' ? 'annual' : 'monthly'),
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

export async function startTrial(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch('/api/start-trial', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to start trial');
  }
}

// ── New trial flow (card upfront) ────────────────────────────────────────────

export async function createSetupIntent(): Promise<{ clientSecret: string; trialEndsAt: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch('/api/create-setup-intent', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
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

  const res = await fetch('/api/create-subscription', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentMethodId, plan }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to create subscription');
  }
  return res.json() as Promise<{ trialEndsAt: string }>;
}

// Extension checkout — called after the 21-day free trial expires.
// Always monthly ($4.99/mo) with a 7-day free extension.
export async function startCheckout(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch('/api/create-checkout-session', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

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

  const res = await fetch('/api/create-billing-portal-session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error('Portal failed');
  const { url } = await res.json() as { url: string };
  window.location.href = url;
}
