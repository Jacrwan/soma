/// <reference types="node" />
// Invite friends (referrals_support_migration.sql). A student shares
// somastudy.app/?ref=<code>; a friend who signs up with it counts for them.
//
// The rule, decided by the owner 2026-11-17: 3 new friends within 2 months
// earn one free week, and at most one free week every 2 months, so 6 friends
// at once is still one week. Friends who signed up before the last free week
// never count again.
//
// The free week, by where the student is:
//   * a Stripe trial: the trial runs 7 days longer;
//   * a paying Stripe subscription: the next charge moves 7 days later.
//     Stripe runs that as a trial, so subscriptions.free_week_until keeps
//     them a subscriber in Soma meanwhile (_trial.ts paidFreeWeek);
//   * a trial without a card: it starts 7 days later;
//   * an account given free access by hand: nothing to add (not_needed);
//   * anything else (no plan, ended): saved as pending, and their next
//     checkout adds 7 trial days per pending week.
//
// Lives inside api/stripe.ts as actions: the project is at Vercel's
// 12-function limit.

import type Stripe from 'stripe';
import { computeStatus, paidFreeWeek, trialLengthMs, EXTENSION_MS } from './_trial';

export const FRIENDS_NEEDED = 3;
export const WINDOW_DAYS = 60;
export const FREE_WEEK_DAYS = 7;
const DAY = 86_400_000;
const WINDOW_MS = WINDOW_DAYS * DAY;
const WEEK_MS = FREE_WEEK_DAYS * DAY;
/** A friend's account must be this new to count: it's for sign-ups, not old accounts. */
export const NEW_ACCOUNT_MS = 7 * DAY;

export type Progress = {
  /** Friends counting toward the next free week. */
  counted: number;
  needed: number;
  /** When the 2-month wait after the last free week ends, if it hasn't yet. */
  waitUntil: string | null;
  due: boolean;
};

/**
 * Friends count when they signed up in the last 2 months and after the last
 * free week. A free week is due at 3, once 2 months have passed since the last.
 */
export function referralProgress(friendTimes: number[], lastRewardAt: number | null, now = Date.now()): Progress {
  const from = Math.max(now - WINDOW_MS, lastRewardAt ?? -Infinity);
  const counted = friendTimes.filter(t => t > from && t <= now).length;
  const waitEnds = lastRewardAt === null ? null : lastRewardAt + WINDOW_MS;
  const waiting = waitEnds !== null && now < waitEnds;
  return {
    counted: Math.min(counted, FRIENDS_NEEDED),
    needed: FRIENDS_NEEDED,
    waitUntil: waiting ? new Date(waitEnds).toISOString() : null,
    due: !waiting && counted >= FRIENDS_NEEDED,
  };
}

const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
export function newCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)];
  return out;
}
export const isCode = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]{6,16}$/.test(v);

export type SubRow = {
  status: string;
  trial_start: string | null;
  extension_start: string | null;
  stripe_subscription_id: string | null;
  free_week_until?: string | null;
} | null;

type StripeSubLike = Pick<Stripe.Subscription, 'status'> & { trial_end?: number | null; current_period_end?: number; items?: any };

export type RewardPlan =
  | { kind: 'stripe_trial'; trialEnd: number; paid: boolean }
  | { kind: 'shift'; field: 'trial_start' | 'extension_start'; value: string }
  | { kind: 'not_needed' }
  | { kind: 'bank' };

const periodEnd = (s: StripeSubLike): number | null =>
  (s as any).current_period_end ?? s.items?.data?.[0]?.current_period_end ?? null;

/** How a free week is given to this student (see the top of this file). */
export function planReward(row: SubRow, stripeSub: StripeSubLike | null, now = Date.now()): RewardPlan {
  if (!row) return { kind: 'bank' };
  if (row.stripe_subscription_id) {
    if (!stripeSub) return { kind: 'bank' };
    const nowS = Math.floor(now / 1000);
    if (stripeSub.status === 'trialing') {
      // A paying student already in a free week stays one.
      const paid = paidFreeWeek(row, now);
      const end = Math.max(stripeSub.trial_end ?? nowS, nowS);
      return { kind: 'stripe_trial', trialEnd: end + FREE_WEEK_DAYS * 86_400, paid };
    }
    if (stripeSub.status === 'active') {
      const end = Math.max(periodEnd(stripeSub) ?? nowS, nowS);
      return { kind: 'stripe_trial', trialEnd: end + FREE_WEEK_DAYS * 86_400, paid: true };
    }
    return { kind: 'bank' };
  }
  const status = computeStatus(row, now);
  const shift = (iso: string | null) => new Date(Date.parse(iso ?? '') + WEEK_MS).toISOString();
  if (status === 'trialing') return { kind: 'shift', field: 'trial_start', value: shift(row.trial_start) };
  if (status === 'trial_extended') return { kind: 'shift', field: 'extension_start', value: shift(row.extension_start) };
  if (status === 'active') return { kind: 'not_needed' };
  return { kind: 'bank' };
}

type Admin = any;

/** Gives one earned week its way, and records how. A failure leaves it pending. */
export async function applyReward(admin: Admin, stripe: Stripe | null, userId: string, rewardId: string, now = Date.now()): Promise<void> {
  const { data: row, error } = await admin.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
  if (error) return;
  let stripeSub: StripeSubLike | null = null;
  if (row?.stripe_subscription_id && stripe) {
    try { stripeSub = await stripe.subscriptions.retrieve(row.stripe_subscription_id); } catch { return; }
  } else if (row?.stripe_subscription_id) return;
  const plan = planReward(row, stripeSub, now);
  const done = (how: string, endsAt: string | null, status = 'applied') => admin.from('referral_rewards')
    .update({ status, how, ends_at: endsAt, applied_at: new Date(now).toISOString() }).eq('id', rewardId);

  if (plan.kind === 'bank') return;
  if (plan.kind === 'not_needed') { await done('already_free', null, 'not_needed'); return; }
  if (plan.kind === 'shift') {
    const { error: e } = await admin.from('subscriptions').update({ [plan.field]: plan.value, updated_at: new Date(now).toISOString() }).eq('user_id', userId);
    const length = plan.field === 'trial_start' ? trialLengthMs(plan.value) : EXTENSION_MS;
    if (!e) await done('trial_longer', new Date(Date.parse(plan.value) + length).toISOString());
    return;
  }
  // Stripe: a trial longer, or the next charge later. No proration: the time
  // already paid for stays theirs, and the week comes after it.
  const endIso = new Date(plan.trialEnd * 1000).toISOString();
  if (plan.paid) {
    // Saved before Stripe's webhook arrives, so Soma never sees a payer as on trial.
    const { error: e } = await admin.from('subscriptions').update({ free_week_until: endIso }).eq('user_id', userId);
    if (e) return;
  }
  try {
    await stripe!.subscriptions.update(row.stripe_subscription_id, { trial_end: plan.trialEnd, proration_behavior: 'none' });
  } catch (err: any) {
    console.error('[referrals] free week not given:', err?.message);
    return;
  }
  await done(plan.paid ? 'next_charge_later' : 'trial_longer', endIso);
}

/** Grants a free week when one is due. Returns whether it did. */
export async function grantIfDue(admin: Admin, stripe: Stripe | null, userId: string, now = Date.now()): Promise<boolean> {
  const [friends, rewards] = await Promise.all([
    admin.from('referrals').select('created_at').eq('referrer_user_id', userId),
    admin.from('referral_rewards').select('id, granted_at').eq('user_id', userId).order('granted_at', { ascending: false }).limit(1),
  ]);
  if (friends.error || rewards.error) return false;
  const last = rewards.data?.[0] ? Date.parse(rewards.data[0].granted_at) : null;
  const progress = referralProgress((friends.data ?? []).map((f: any) => Date.parse(f.created_at)), last, now);
  if (!progress.due) return false;
  const { data: reward, error } = await admin.from('referral_rewards')
    .insert({ user_id: userId, granted_at: new Date(now).toISOString(), status: 'pending' }).select('id').single();
  if (error || !reward) return false;
  // Two sign-ups at the same moment could both grant; keep the first.
  const { data: recent } = await admin.from('referral_rewards').select('id, granted_at')
    .eq('user_id', userId).gte('granted_at', new Date(now - WINDOW_MS).toISOString()).order('granted_at', { ascending: true });
  if ((recent?.length ?? 0) > 1 && recent[0].id !== reward.id) {
    await admin.from('referral_rewards').delete().eq('id', reward.id);
    return false;
  }
  await applyReward(admin, stripe, userId, reward.id, now);
  return true;
}

const notSetUp = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01' || /schema cache|does not exist/i.test(e.message ?? ''));

/** A friend's new account claims the code it signed up with. */
export async function claimReferral(admin: Admin, stripe: Stripe | null, user: { id: string; created_at?: string; email_confirmed_at?: string | null }, code: unknown, now = Date.now()) {
  if (!isCode(code)) return { status: 400, body: { result: 'unknown' } };
  const created = Date.parse(user.created_at ?? '');
  if (!Number.isFinite(created) || now - created > NEW_ACCOUNT_MS) return { status: 200, body: { result: 'not_new' } };
  if (!user.email_confirmed_at) return { status: 409, body: { result: 'unconfirmed' } };
  const { data: owner, error } = await admin.from('referral_codes').select('user_id').eq('code', code).maybeSingle();
  if (notSetUp(error)) return { status: 503, body: { result: 'not_set_up' } };
  if (error) return { status: 503, body: { result: 'retry' } };
  if (!owner) return { status: 200, body: { result: 'unknown' } };
  if (owner.user_id === user.id) return { status: 200, body: { result: 'self' } };
  const { error: insertError } = await admin.from('referrals')
    .insert({ referred_user_id: user.id, referrer_user_id: owner.user_id, created_at: new Date(now).toISOString() });
  if (insertError) {
    if (insertError.code === '23505') return { status: 200, body: { result: 'already' } };
    return { status: 503, body: { result: 'retry' } };
  }
  try { await grantIfDue(admin, stripe, owner.user_id, now); } catch (err: any) { console.error('[referrals] grant:', err?.message); }
  return { status: 200, body: { result: 'counted' } };
}

/** The invite card: the student's link, progress and free weeks. */
export async function referralStatus(admin: Admin, stripe: Stripe | null, userId: string, now = Date.now()) {
  let { data: codeRow, error } = await admin.from('referral_codes').select('code').eq('user_id', userId).maybeSingle();
  if (notSetUp(error)) return { status: 503, body: { error: 'not_set_up' } };
  if (error) return { status: 503, body: { error: 'Couldn’t load your invite link.' } };
  if (!codeRow) {
    for (let i = 0; i < 5 && !codeRow; i++) {
      const code = newCode();
      const { error: e } = await admin.from('referral_codes').insert({ user_id: userId, code });
      if (!e) codeRow = { code };
      else if (e.code === '23505') {
        // Either the code was taken or another tab made this student's first.
        const again = await admin.from('referral_codes').select('code').eq('user_id', userId).maybeSingle();
        if (again.data) codeRow = again.data;
      } else return { status: 503, body: { error: 'Couldn’t make your invite link.' } };
    }
    if (!codeRow) return { status: 503, body: { error: 'Couldn’t make your invite link.' } };
  }

  // A wait may have ended since the third friend joined; and a pending week
  // may now have somewhere to go.
  try {
    await grantIfDue(admin, stripe, userId, now);
    const { data: pending } = await admin.from('referral_rewards').select('id').eq('user_id', userId).eq('status', 'pending');
    for (const r of pending ?? []) await applyReward(admin, stripe, userId, r.id, now);
  } catch (err: any) { console.error('[referrals] status grant:', err?.message); }

  const [friends, rewards] = await Promise.all([
    admin.from('referrals').select('created_at').eq('referrer_user_id', userId),
    admin.from('referral_rewards').select('granted_at, status, how, ends_at').eq('user_id', userId).order('granted_at', { ascending: false }).limit(20),
  ]);
  const times = (friends.data ?? []).map((f: any) => Date.parse(f.created_at));
  const last = rewards.data?.[0] ? Date.parse(rewards.data[0].granted_at) : null;
  const progress = referralProgress(times, last, now);
  return {
    status: 200,
    body: {
      code: codeRow.code,
      ...progress,
      windowDays: WINDOW_DAYS,
      totalFriends: times.length,
      rewards: (rewards.data ?? []).map((r: any) => ({ grantedAt: r.granted_at, status: r.status, how: r.how, endsAt: r.ends_at })),
    },
  };
}
