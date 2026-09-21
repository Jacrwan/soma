/**
 * What Soma Premium costs, in one place.
 *
 * Every screen that quotes a price reads it from here. Prices used to be typed
 * out separately on six screens, and three of them were left behind when the
 * price changed — so a student could be quoted one price while starting a trial
 * and charged another.
 *
 * These are display prices. What Stripe actually charges comes from the price
 * IDs in the server's environment; changing a number here does not change a
 * charge. The two must be kept in step by hand.
 */

export type Interval = 'monthly' | 'annual';
export type Tier = 'base' | 'student';

export const PRICES: Record<Tier, Record<Interval, number>> = {
  base:    { monthly: 15.99, annual: 160 },
  student: { monthly: 10.99, annual: 90 },
};

/** "$15.99", "$160" — whole amounts keep no trailing zeros. */
export function money(amount: number): string {
  return `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

export function price(tier: Tier, interval: Interval): string {
  return money(PRICES[tier][interval]);
}

/** An annual price as what it works out to each month: "$13.33". */
export function perMonth(tier: Tier): string {
  return `$${(PRICES[tier].annual / 12).toFixed(2)}`;
}

/** Whole-percent saving of one price against another, for badges: 17. */
export function savingsPercent(from: number, to: number): number {
  return Math.round((1 - to / from) * 100);
}

/** Paying yearly instead of monthly, within the same tier. */
export function annualSavings(tier: Tier): number {
  return savingsPercent(PRICES[tier].monthly * 12, PRICES[tier].annual);
}

/** What a verified student saves against the ordinary price. */
export function studentSavings(interval: Interval): number {
  return savingsPercent(PRICES.base[interval], PRICES.student[interval]);
}
