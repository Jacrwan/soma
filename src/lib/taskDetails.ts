import type { Todo } from '../types';

/**
 * Task details (task_details_migration.sql, 2026-11-15): the student's own
 * deadline, the days to work on it, how many sittings, and named steps that
 * replace generic sittings. Kept here so every place that reads a todo row
 * reads them the same way.
 */

export type TaskStep = { id: string; title: string; minutes: number; done?: boolean };

const steps = (v: unknown): TaskStep[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(s => s && typeof s.id === 'string' && typeof s.title === 'string')
    .map(s => ({ id: s.id as string, title: s.title as string, minutes: Math.max(5, Math.round(Number(s.minutes) || 30)), ...(s.done ? { done: true } : {}) }));
  return out.length ? out : undefined;
};

/** The details on a todos row; keys only for what's set, so saving an untouched todo never sends them. */
export function detailsFromRow(r: Record<string, unknown>): Pick<Todo, 'myDue' | 'workFrom' | 'workUntil' | 'sittingCount' | 'steps'> {
  const s = steps(r.steps);
  return {
    ...(typeof r.my_due === 'string' && r.my_due ? { myDue: r.my_due } : {}),
    ...(typeof r.work_from === 'string' && r.work_from ? { workFrom: r.work_from.slice(0, 10) } : {}),
    ...(typeof r.work_until === 'string' && r.work_until ? { workUntil: r.work_until.slice(0, 10) } : {}),
    ...(typeof r.sitting_count === 'number' && r.sitting_count > 0 ? { sittingCount: r.sitting_count } : {}),
    ...(s ? { steps: s } : {}),
  };
}

/** Columns for the details present on the todo (null clears one). */
export function detailsToRow(t: Todo): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ('myDue' in t) out.my_due = t.myDue ?? null;
  if ('workFrom' in t) out.work_from = t.workFrom ?? null;
  if ('workUntil' in t) out.work_until = t.workUntil ?? null;
  if ('sittingCount' in t) out.sitting_count = t.sittingCount ?? null;
  if ('steps' in t) out.steps = t.steps?.length ? t.steps : null;
  return out;
}

export const DETAILS_MISSING = /my_due|work_from|work_until|sitting_count|steps|step_id/;
export const DETAILS_MESSAGE = 'Run task_details_migration.sql in Supabase to save task details.';

/** The deadline Soma works to: yours when you set one, else the posted one. */
export const deadlineOf = (t: Pick<Todo, 'myDue' | 'dueDate'>) => t.myDue || t.dueDate;

/**
 * A length as typed: "45", "45 min", "1h", "1h 30m", "1.5h", "1:30". A bare
 * number is minutes. null when it can't be read.
 */
export function parseLength(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  let m: RegExpExecArray | null;
  let minutes: number | null = null;
  if ((m = /^(\d{1,2}):([0-5]\d)$/.exec(t))) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)(?:\s*(\d+)\s*(?:m|min|mins|minutes)?)?$/.exec(t))) minutes = Number(m[1]) * 60 + Number(m[2] ?? 0);
  else if ((m = /^(\d+)\s*(?:m|min|mins|minute|minutes)?$/.exec(t))) minutes = Number(m[1]);
  if (minutes === null || !Number.isFinite(minutes)) return null;
  return Math.min(1440, Math.max(5, Math.round(minutes)));
}

