/**
 * Invite friends (api/_referrals.ts). A visit to somastudy.app/?ref=<code>
 * keeps the code on this browser; once a new account signs in here, the
 * server counts it for the friend who shared the link. Old accounts never
 * claim: only sign-ups count.
 */
import type { Session } from '@supabase/supabase-js';

const KEY = 'soma_ref';
const KEEP_MS = 30 * 86_400_000;
const NEW_ACCOUNT_MS = 7 * 86_400_000;

export type ReferralReward = { grantedAt: string; status: 'pending' | 'applied' | 'not_needed'; how: string | null; endsAt: string | null };
export type ReferralStatus = {
  code: string;
  counted: number;
  needed: number;
  waitUntil: string | null;
  windowDays: number;
  totalFriends: number;
  rewards: ReferralReward[];
};

export class ReferralsNotSetUpError extends Error {
  constructor() { super('Invites aren’t set up yet.'); }
}

/** Friends who must sign up within 2 months for a free week: api/_referrals.ts FRIENDS_NEEDED. */
export const FRIENDS_NEEDED = 5;

export const inviteLink = (code: string) => `https://somastudy.app/?ref=${code}`;

/** Keeps a ?ref= code from the address, for the sign-up that follows. */
export function captureRef(search: string = window.location.search): void {
  const code = new URLSearchParams(search).get('ref')?.trim().toLowerCase();
  if (!code || !/^[a-z0-9]{6,16}$/.test(code)) return;
  try { localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() })); } catch { /* private mode */ }
}

function pendingCode(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw) as { code?: string; at?: number };
    if (!code || !at || Date.now() - at > KEEP_MS) { localStorage.removeItem(KEY); return null; }
    return code;
  } catch { return null; }
}

let claiming = false;
/** Called on sign-in. Sends the kept code once, for a new account. */
export async function claimPendingRef(session: Session | null): Promise<void> {
  const code = pendingCode();
  if (!code || !session || claiming) return;
  const created = Date.parse(session.user.created_at ?? '');
  if (!Number.isFinite(created) || Date.now() - created > NEW_ACCOUNT_MS) {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    return;
  }
  claiming = true;
  try {
    const res = await fetch('/api/stripe', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'referral-claim', code }),
    });
    // Kept only when it might work later: an unconfirmed email, or a hiccup.
    const data = await res.json().catch(() => ({})) as { result?: string };
    if (!['unconfirmed', 'retry', 'not_set_up'].includes(data.result ?? 'retry')) localStorage.removeItem(KEY);
  } catch { /* try again next sign-in */ } finally { claiming = false; }
}

export async function loadReferralStatus(): Promise<ReferralStatus> {
  const { supabase } = await import('./supabase');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Please sign in again.');
  const res = await fetch('/api/stripe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'referral-status' }),
  });
  const body = await res.json().catch(() => ({})) as Partial<ReferralStatus> & { error?: string };
  if (body.error === 'not_set_up') throw new ReferralsNotSetUpError();
  if (!res.ok || !body.code) throw new Error(body.error ?? 'Couldn’t load your invite link. Please retry.');
  return body as ReferralStatus;
}
