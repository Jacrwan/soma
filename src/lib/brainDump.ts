import { supabase } from './supabase';

/**
 * The brain dump's lines in the database (brain_dump_migration.sql), so a
 * phone and a laptop show the same list. Before that table exists, loading
 * returns null and saving returns false: the dashboard keeps the list in the
 * browser, as it did before the table.
 */

export type DumpItem = { id: string; text: string };
const TABLE = 'brain_dump_items';

// PGRST205 is PostgREST's "table not in schema cache": the migration hasn't run.
const isMissing = (e: { code?: string; message?: string }) =>
  e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|does not exist|schema cache/i.test(e.message ?? '');

/** The student's lines, oldest first, or null when the table isn't there yet. */
export async function loadDump(userId: string): Promise<DumpItem[] | null> {
  const { data, error } = await supabase.from(TABLE).select('id,text,created_at').eq('user_id', userId).order('created_at', { ascending: true }).limit(200);
  if (error) { if (isMissing(error)) return null; throw new Error('Could not load your brain dump.'); }
  return ((data ?? []) as { id: unknown; text: unknown }[]).map(r => ({ id: String(r.id), text: String(r.text) }));
}

/** Saves new lines in order; false when the table isn't there yet. Saving the same line twice is harmless. */
export async function addDump(userId: string, items: DumpItem[]): Promise<boolean> {
  if (!items.length) return true;
  const base = Date.now();
  const { error } = await supabase.from(TABLE).upsert(
    items.map((i, n) => ({ id: i.id, user_id: userId, text: i.text, created_at: new Date(base + n).toISOString() })),
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) { if (isMissing(error)) return false; throw new Error('Could not save to your brain dump. Please retry.'); }
  return true;
}

/** Takes a line off the list; false when the table isn't there yet. */
export async function removeDump(userId: string, id: string): Promise<boolean> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id).eq('user_id', userId);
  if (error) { if (isMissing(error)) return false; throw new Error('Could not update your brain dump. Please retry.'); }
  return true;
}
