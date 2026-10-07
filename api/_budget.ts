/// <reference types="node" />
// How much Soma a student can use. Each subscription includes a monthly AI
// budget in dollars, counted from ai_usage; one-time top-ups add to it until
// the next reset. Decided 2026-10-06: shown to students as a percentage, the
// month resets on their billing date, trials get a smaller budget and can't
// buy top-ups, and at the limit only Soma pauses (the rest of the app works).
//
// The prices shown in the app are in src/lib/pricing.ts (TOPUP_PRICE); keep
// TOPUP_PRICE_CENTS and TOPUP_ADDS_USD in step with it.

/** Included each month, in dollars of AI use. One setting: measure, then tune. */
export const MONTHLY_AI_BUDGET_USD = 4;
/** For the whole 7-day trial. */
export const TRIAL_AI_BUDGET_USD = 1.5;
/** A top-up: what it costs and how much AI it adds, until the next reset. */
export const TOPUP_PRICE_CENTS = 299;
export const TOPUP_ADDS_USD = 2;

export type SubscriptionRow = { status: string; trial_start: string | null; current_period_end: string | null } | null;
export type BudgetPeriod = { start: Date; end: Date; allowance: number; trial: boolean };

const addMonths = (d: Date, n: number) => {
  const out = new Date(d);
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + n);
  // Jan 31 + 1 month is the last day of February, not March 3.
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
};

/**
 * The stretch the budget covers. A trial is one stretch, its seven days. A
 * subscription resets every month on its billing date: the semester plan
 * bills every four months, so its months are counted back from the period end.
 * Without a billing date (nothing stored yet), the calendar month.
 */
export function budgetPeriod(sub: SubscriptionRow, now = new Date()): BudgetPeriod {
  const trial = sub?.status === 'trialing' || sub?.status === 'trial_extended';
  const periodEnd = sub?.current_period_end ? new Date(sub.current_period_end) : null;
  if (trial) {
    const start = sub?.trial_start ? new Date(sub.trial_start) : new Date(now.getTime() - 7 * 86_400_000);
    const end = periodEnd && periodEnd > now ? periodEnd : new Date(start.getTime() + 7 * 86_400_000);
    return { start, end, allowance: TRIAL_AI_BUDGET_USD, trial: true };
  }
  if (periodEnd && !Number.isNaN(+periodEnd)) {
    // The monthly anniversaries of the billing date around now, each counted
    // from the billing date itself so the 31st stays the 31st where it can.
    let k = 0;
    while (addMonths(periodEnd, k) > now && k > -120) k--;
    while (addMonths(periodEnd, k + 1) <= now && k < 120) k++;
    return { start: addMonths(periodEnd, k), end: addMonths(periodEnd, k + 1), allowance: MONTHLY_AI_BUDGET_USD, trial: false };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start, end: addMonths(start, 1), allowance: MONTHLY_AI_BUDGET_USD, trial: false };
}

export type BudgetStatus = {
  /** Dollars used this stretch, and what's available (included + top-ups). */
  used: number; available: number;
  /** 0–100, what the student sees. */
  percent: number;
  resetsAt: string; trial: boolean; topups: number;
};

interface AdminLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        gte(column: string, value: string): PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
        maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
      };
    };
  };
}

/**
 * Where a student stands. Null when it can't be told (the usage table isn't
 * there yet, or a read failed): Soma then answers rather than locking a
 * paying student out over a database hiccup.
 */
export async function budgetStatus(admin: AdminLike, userId: string, now = new Date()): Promise<BudgetStatus | null> {
  const { data: sub, error: subError } = await admin.from('subscriptions').select('status, trial_start, current_period_end').eq('user_id', userId).maybeSingle();
  if (subError) return null;
  const period = budgetPeriod(sub as SubscriptionRow, now);
  const since = period.start.toISOString();
  const [usage, topups] = await Promise.all([
    admin.from('ai_usage').select('cost_usd').eq('user_id', userId).gte('created_at', since),
    admin.from('ai_topups').select('amount_usd').eq('user_id', userId).gte('created_at', since),
  ]);
  if (usage.error) { console.error(JSON.stringify({ event: 'ai_budget_unknown', message: usage.error.message })); return null; }
  const sum = (rows: Record<string, unknown>[] | null, key: string) => (rows ?? []).reduce((n, r) => n + (Number(r[key]) || 0), 0);
  const used = sum(usage.data, 'cost_usd');
  // A missing top-ups table only means none were bought.
  const topup = topups.error ? 0 : sum(topups.data, 'amount_usd');
  const available = period.allowance + topup;
  return {
    used: Math.round(used * 10_000) / 10_000, available,
    percent: Math.min(100, Math.round((used / available) * 100)),
    resetsAt: period.end.toISOString(), trial: period.trial, topups: topup,
  };
}
