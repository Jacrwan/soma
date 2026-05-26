import { createClient } from '@supabase/supabase-js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify token and resolve uid
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const uid = user.id;

  // Delete user rows from all tables (best-effort; ignore missing-table errors)
  for (const table of ['todos', 'schedule_blocks', 'elapsed_time', 'settings', 'ai_memory']) {
    await admin.from(table).delete().eq('user_id', uid);
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) {
    console.error('[delete-account] deleteUser failed:', delErr.message);
    return res.status(500).json({ error: 'Request failed' });
  }

  return res.status(200).json({ success: true });
}
