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
