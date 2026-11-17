// How long the free trial lasts. Every function that decides whether a trial
// has run out reads it from here, so they can't disagree.
//
// The trial went from 21 days to 7 on 2026-09-24. Anyone who started before
// then keeps the 21 days they were promised.

export const TRIAL_DAYS = 7;
export const EXTENSION_MS = 7 * 86_400_000;

const LEGACY_TRIAL_DAYS = 21;
const SHORT_TRIAL_FROM = Date.parse('2026-09-24T22:00:00Z');

export function trialLengthMs(trialStart: string | null | undefined): number {
  const started = trialStart ? Date.parse(trialStart) : NaN;
  const days = Number.isFinite(started) && started < SHORT_TRIAL_FROM ? LEGACY_TRIAL_DAYS : TRIAL_DAYS;
  return days * 86_400_000;
}

export type StatusRow = {
  status: string;
  trial_start: string | null;
  extension_start: string | null;
  stripe_subscription_id?: string | null;
  free_week_until?: string | null;
};

/**
 * A paying student's free week from inviting friends (api/_referrals.ts)
 * moves their next charge later, which Stripe runs as a trial. Until that
 * date they're still a subscriber to Soma: same status, AI budget, top-ups.
 */
export function paidFreeWeek(row: Pick<StatusRow, 'status' | 'free_week_until'> & { stripe_subscription_id?: string | null }, now = Date.now()): boolean {
  if (!row.stripe_subscription_id || row.status !== 'trialing' || !row.free_week_until) return false;
  const until = Date.parse(row.free_week_until);
  return Number.isFinite(until) && now <= until + 86_400_000;
}

/**
 * The one status every check uses: the AI, Settings, the calendar limit.
 * A row with a Stripe subscription has Stripe's own status: Stripe ends its
 * trials and the webhook copies the result. Until 2026-10-21 the AI timed
 * those trials from trial_start, which Checkout trials never had, so it
 * refused students Settings showed as on a free trial. Only a trial without
 * a Stripe subscription is timed here, and a missing or bad start date
 * counts as ended, so it can't grant access forever.
 */
export function computeStatus(row: StatusRow, now = Date.now()): string {
  if (row.stripe_subscription_id) return paidFreeWeek(row, now) ? 'active' : row.status;
  if (row.status === 'trialing' || row.status === 'trial_extended') {
    const extended = row.status === 'trial_extended';
    const start = Date.parse((extended ? row.extension_start : row.trial_start) ?? '');
    const length = extended ? EXTENSION_MS : trialLengthMs(row.trial_start);
    if (!Number.isFinite(start) || now >= start + length) return extended ? 'trial_extension_expired' : 'trial_expired';
  }
  return row.status;
}
