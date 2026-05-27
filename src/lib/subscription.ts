import { useState, useEffect } from 'react';
import { supabase } from './supabase';

export type SubscriptionStatus =
  | 'loading'
  | 'free'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid';

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export function hasAIAccess(status: SubscriptionStatus): boolean {
  return status === 'trialing' || status === 'active';
}

export function useSubscription(): SubscriptionInfo {
  const [info, setInfo] = useState<SubscriptionInfo>({
    status: 'loading',
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        if (!cancelled) setInfo(s => ({ ...s, status: 'free' }));
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
            trialEndsAt: data.trialEndsAt ?? null,
            currentPeriodEnd: data.currentPeriodEnd ?? null,
            cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
          });
        }
      } catch {
        if (!cancelled) setInfo(s => ({ ...s, status: 'free' }));
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return info;
}

export async function startCheckout(plan: 'monthly' | 'yearly' = 'monthly'): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch('/api/create-checkout-session', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ plan }),
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
