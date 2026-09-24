// Every price Soma shows comes from here. Stripe charges whatever the price IDs
// in STRIPE_PRICE_ID_MONTHLY / STRIPE_PRICE_ID_SEMESTER say, so change both
// together. tests/pricing-consistency.spec.ts fails on any price typed by hand.

export type Plan = 'monthly' | 'semester';

export const MONTHLY_PRICE = '$10.99';
export const SEMESTER_PRICE = '$28.99';          // billed every 4 months
export const SEMESTER_PER_MONTH = '$7.25';        // 28.99 / 4
export const SEMESTER_SAVINGS = '34%';            // vs 4 × 10.99 = 43.96

// Must match TRIAL_DAYS in api/_trial.ts, which decides when access ends.
export const TRIAL_DAYS = 7;
