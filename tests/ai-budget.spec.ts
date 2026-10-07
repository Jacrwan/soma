import { test, expect } from '@playwright/test';
import { triaged } from './triage';
import { budgetPeriod, budgetStatus, MONTHLY_AI_BUDGET_USD, TRIAL_AI_BUDGET_USD } from '../api/_budget';
import { createChatHandler } from '../api/chat';

// A monthly Soma budget per student, shown as a percentage, reset on the
// billing date, with one-time top-ups (decided 2026-10-06).
const at = (s: string) => new Date(s);

test('a monthly plan resets on its billing date', () => {
  const p = budgetPeriod({ status: 'active', trial_start: null, current_period_end: '2026-10-24T10:00:00Z' }, at('2026-10-06T12:00:00Z'));
  expect([p.start.toISOString(), p.end.toISOString(), p.allowance, p.trial]).toEqual(['2026-09-24T10:00:00.000Z', '2026-10-24T10:00:00.000Z', MONTHLY_AI_BUDGET_USD, false]);
});

test('the 4-month plan still resets every month, on the same day', () => {
  // Billed Sep 24, next bill Jan 24: the budget resets Oct 24, Nov 24, Dec 24.
  const p = budgetPeriod({ status: 'active', trial_start: null, current_period_end: '2027-01-24T10:00:00Z' }, at('2026-11-30T12:00:00Z'));
  expect([p.start.toISOString(), p.end.toISOString()]).toEqual(['2026-11-24T10:00:00.000Z', '2026-12-24T10:00:00.000Z']);
});

test('a billing date on the 31st resets on the last day of shorter months', () => {
  const p = budgetPeriod({ status: 'active', trial_start: null, current_period_end: '2026-03-31T10:00:00Z' }, at('2026-03-05T00:00:00Z'));
  expect([p.start.toISOString(), p.end.toISOString()]).toEqual(['2026-02-28T10:00:00.000Z', '2026-03-31T10:00:00.000Z']);
});

test('a trial gets its own smaller budget for its seven days', () => {
  const p = budgetPeriod({ status: 'trialing', trial_start: '2026-10-01T09:00:00Z', current_period_end: '2026-10-08T09:00:00Z' }, at('2026-10-06T12:00:00Z'));
  expect([p.start.toISOString(), p.end.toISOString(), p.allowance, p.trial]).toEqual(['2026-10-01T09:00:00.000Z', '2026-10-08T09:00:00.000Z', TRIAL_AI_BUDGET_USD, true]);
});

// A stand-in for the Supabase admin client, enough for budgetStatus.
function admin(tables: Record<string, { rows?: Record<string, unknown>[]; row?: Record<string, unknown> | null; error?: string }>) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          gte: async () => ({ data: tables[table]?.rows ?? [], error: tables[table]?.error ? { message: tables[table].error! } : null }),
          maybeSingle: async () => ({ data: tables[table]?.row ?? null, error: tables[table]?.error ? { message: tables[table].error! } : null }),
        }),
      }),
    }),
  };
}

test('spend this month and top-ups add up to a percentage', async () => {
  const s = await budgetStatus(admin({
    subscriptions: { row: { status: 'active', trial_start: null, current_period_end: '2026-10-24T10:00:00Z' } },
    ai_usage: { rows: [{ cost_usd: 1.5 }, { cost_usd: '1.5' }, { cost_usd: 1 }] },
    ai_topups: { rows: [{ amount_usd: 2 }] },
  }), 'u', at('2026-10-06T12:00:00Z'));
  expect(s).toMatchObject({ used: 4, available: MONTHLY_AI_BUDGET_USD + 2, percent: Math.round(4 / (MONTHLY_AI_BUDGET_USD + 2) * 100), topups: 2, trial: false });
});

test('when usage can\'t be read, Soma is not locked', async () => {
  expect(await budgetStatus(admin({ subscriptions: { row: { status: 'active', trial_start: null, current_period_end: null } }, ai_usage: { error: 'relation "ai_usage" does not exist' } }), 'u')).toBeNull();
});

const deps = { apiKey: () => 'k', limited: () => false, memory: async () => '', learn: async () => {}, defer: () => {} };
function res() { const out = { status: 0, body: null as unknown }; const r = { status: (s: number) => { out.status = s; return r; }, json: (b: unknown) => { out.body = b; return r; }, setHeader: () => {}, end: () => r }; return { out, r }; }
const request = { method: 'POST', headers: { authorization: 'Bearer t' }, body: { messages: [{ role: 'user', content: 'hi' }], model: 'sonnet' } };

test('a used-up budget pauses Soma before any model call', async () => {
  let calls = 0; const { out, r } = res();
  await createChatHandler({ ...deps, authorize: async () => ({ ok: true, userId: 'u' }), budget: async () => ({ used: 4.2, available: 4, percent: 100, resetsAt: '2026-10-24T10:00:00Z', trial: false, topups: 0 }), request: async () => { calls++; return Response.json({}); } } as never)(request, r);
  expect(out).toEqual({ status: 402, body: { error: 'ai_budget_used', resetsAt: '2026-10-24T10:00:00Z', trial: false } });
  expect(calls).toBe(0);
});

test('the owner\'s account and an unknown budget are not paused', async () => {
  for (const auth of [{ ok: true, userId: 'owner', unlimited: true }, { ok: true, userId: 'u' }]) {
    let calls = 0; const { out, r } = res();
    await createChatHandler({ ...deps, authorize: async () => auth, budget: async () => (auth.unlimited ? { used: 99, available: 4, percent: 100, resetsAt: '', trial: false, topups: 0 } : null), request: async () => { calls++; return Response.json({ content: [{ type: 'text', text: 'ok' }] }); } } as never)(request, r);
    expect(out.status).toBe(200);
    expect(calls).toBe(1);
  }
});

// ── In the app ──────────────────────────────────────────────────────────────
import { setup } from './event-day';
import type { Page } from '@playwright/test';

async function withBudget(page: Page, budget: Record<string, unknown>) {
  const asked: Record<string, unknown>[] = [];
  await page.route('**/api/stripe', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    asked.push(body);
    if (body.action === 'get-ai-budget') return route.fulfill({ json: budget });
    if (body.action === 'create-topup-session') return route.fulfill({ json: { url: '/dashboard?topup=done' } });
    return route.fulfill({ json: { status: 'active' } });
  });
  return asked;
}

test('the dashboard shows this month\'s Soma and offers a top-up near the limit', async ({ page }) => {
  await setup(page, () => ({ reply: 'ok' }));
  const asked = await withBudget(page, { used: 3.4, available: 4, percent: 85, resetsAt: '2026-10-24T10:00:00Z', trial: false, topups: 0 });
  await page.reload();
  const meter = page.getByLabel('Soma usage');
  await expect(meter).toContainText('Soma this month: 85% used · resets Oct 24');
  await expect(page.getByRole('progressbar', { name: 'Soma this month' })).toHaveAttribute('aria-valuenow', '85');
  await meter.getByRole('button', { name: 'Add more Soma · $2.99' }).click();
  await expect(page).toHaveURL(/topup=done/);
  expect(asked.find(b => b.action === 'create-topup-session')).toMatchObject({ returnPath: '/dashboard' });
});

test('used up, asking Soma pauses and says when it resets; the plan still works', async ({ page }) => {
  await setup(page, () => ({ reply: 'ok' }));
  await withBudget(page, { used: 4.1, available: 4, percent: 100, resetsAt: '2026-10-24T10:00:00Z', trial: false, topups: 0 });
  await page.reload();
  await expect(page.getByLabel('Soma usage')).toContainText('asking is paused until it resets Oct 24');
  await page.getByLabel('What do you need to work on?').fill('plan my day');
  await expect(page.getByRole('button', { name: 'Send to Soma' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Edit plan', exact: true })).toBeEnabled();
});

test('a trial that used its Soma is pointed to subscribing, not a top-up', async ({ page }) => {
  await setup(page, () => ({ reply: 'ok' }));
  await withBudget(page, { used: 1.6, available: 1.5, percent: 100, resetsAt: '2026-10-08T09:00:00Z', trial: true, topups: 0 });
  await page.reload();
  await expect(page.getByLabel('Soma usage')).toContainText('You’ve used your trial’s Soma. Subscribe to keep asking.');
  await expect(page.getByRole('button', { name: /Add more Soma/ })).toHaveCount(0);
});

test('the server pausing mid-chat is explained in the chat', async ({ page }) => {
  await setup(page, () => ({ reply: 'unused' }));
  await withBudget(page, { unknown: true });
  await page.reload();
  await page.route('**/api/chat', route => triaged(route) ? undefined : route.fulfill({ status: 402, json: { error: 'ai_budget_used', resetsAt: '2026-10-24T10:00:00Z', trial: false } }));
  await page.getByLabel('What do you need to work on?').fill('plan my day');
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect(page.getByRole('log')).toContainText('You’ve used your Soma for now.');
});
