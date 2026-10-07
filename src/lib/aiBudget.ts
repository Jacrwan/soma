import { useEffect, useState } from 'react';

/**
 * How much of this month's Soma a student has used (api/_budget.ts). Shown as
 * a percentage; at 100% asking Soma pauses until the reset or a top-up, and
 * the rest of the app keeps working.
 */
export type AiBudget =
  | { used: number; available: number; percent: number; resetsAt: string; trial: boolean; topups: number }
  | { unlimited: true }
  | { unknown: true };

/** Sent after each Soma reply and a top-up, so every meter refreshes. */
export const BUDGET_CHANGED = 'soma_ai_budget_changed';

async function post(action: string, body: Record<string, unknown> = {}) {
  // Loaded on first use: the demo dashboard shows the chat without the client.
  const { supabase } = await import('./supabase');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('auth_required');
  const res = await fetch('/api/stripe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? 'Could not reach billing. Please retry.');
  return data;
}

export async function fetchAiBudget(): Promise<AiBudget> {
  return post('get-ai-budget') as Promise<AiBudget>;
}

/** Off to Stripe Checkout; back on `returnPath` with ?topup=done. */
export async function buyTopup(returnPath: '/dashboard' | '/ai' | '/settings') {
  const { url } = await post('create-topup-session', { returnPath });
  if (typeof url !== 'string') throw new Error('Could not start the top-up. Please retry.');
  window.location.assign(url);
}

/** The student's budget, kept fresh after replies and top-ups. Null while loading or on error. */
export function useAiBudget(enabled = true): AiBudget | null {
  const [budget, setBudget] = useState<AiBudget | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => { fetchAiBudget().then(b => { if (alive) setBudget(b); }).catch(() => { if (alive) setBudget(null); }); };
    load();
    // Back from Stripe: the webhook may land a moment after the redirect.
    const back = new URLSearchParams(window.location.search).get('topup') === 'done';
    const retry = back ? window.setTimeout(load, 4000) : 0;
    window.addEventListener(BUDGET_CHANGED, load);
    window.addEventListener('focus', load);
    return () => { alive = false; window.clearTimeout(retry); window.removeEventListener(BUDGET_CHANGED, load); window.removeEventListener('focus', load); };
  }, [enabled]);
  return budget;
}

/** Whether asking Soma is paused: the budget is known and used up. */
export const budgetUsedUp = (b: AiBudget | null) => !!b && 'percent' in b && b.used >= b.available;
