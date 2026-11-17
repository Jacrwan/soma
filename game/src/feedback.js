// Beta feedback, straight into Soma's Supabase (table epoch_feedback, see
// epoch_feedback_migration.sql in Soma). Signed-in students send it as
// themselves; guests send it without a name. Students can only add rows.
import { getSession } from './auth.js';

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';

/** Sends feedback. Returns true when it was saved. */
export async function sendFeedback({ text, mood = null, context = {} }) {
  const body = String(text || '').trim().slice(0, 4000);
  if (!body || !SUPABASE_URL || !SUPABASE_KEY) return false;
  const s = await getSession().catch(() => null);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/epoch_feedback`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${s?.token || SUPABASE_KEY}`, 'content-type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: s?.userId || null, body, mood, context: JSON.stringify(context).slice(0, 2000) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
