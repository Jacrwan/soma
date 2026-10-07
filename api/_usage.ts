/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';

// What each AI call cost, per user: token counts and dollars only, never the
// text. Added 2026-10-06 when Soma moved to Sonnet 5.5, to see what a student
// really costs against the subscription price instead of estimating it.

/** US dollars per million tokens. Cache writes are the 5-minute kind (1.25x input). */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** Dollars for one call, or null for a model not in the table. */
export function usageCost(model: string, usage: Usage): number | null {
  const price = PRICES[model.replace(/-\d{8}$/, '')];
  if (!price) return null;
  const dollars = (count(usage.input_tokens) * price.input + count(usage.output_tokens) * price.output
    + count(usage.cache_read_input_tokens) * price.cacheRead + count(usage.cache_creation_input_tokens) * price.cacheWrite) / 1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}

export type UsageRow = {
  user_id: string; kind: 'reply' | 'memory' | 'triage'; model: string;
  input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number;
  cost_usd: number | null;
};

export function usageRow(userId: string, kind: UsageRow['kind'], model: string, usage: Usage): UsageRow {
  return {
    user_id: userId, kind, model,
    input_tokens: count(usage.input_tokens), output_tokens: count(usage.output_tokens),
    cache_read_tokens: count(usage.cache_read_input_tokens), cache_write_tokens: count(usage.cache_creation_input_tokens),
    cost_usd: usageCost(model, usage),
  };
}

/** Saves one row to ai_usage. Callers run it detached: it must never hold up or fail a reply. */
export async function recordUsage(userId: string, kind: UsageRow['kind'], model: string, usage: Usage): Promise<void> {
  const row = usageRow(userId, kind, model, usage);
  // Also in the function logs, for a quick look without the database.
  console.log(JSON.stringify({ event: 'ai_usage', kind, model, input: row.input_tokens, output: row.output_tokens, cacheRead: row.cache_read_tokens, cacheWrite: row.cache_write_tokens, cost: row.cost_usd }));
  const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.from('ai_usage').insert(row);
  if (error) console.error(JSON.stringify({ event: 'ai_usage_not_saved', message: error.message }));
}
