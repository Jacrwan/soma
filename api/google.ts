/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { refreshGoogleToken } from './_googleAuth';

export const config = { api: { bodyParser: { sizeLimit: '20kb' } } };

const ALLOWED_ORIGINS = [
  'https://somastudy.app',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173'] : []),
];

function applyCors(req: any, res: any): boolean {
  const origin = req.headers['origin'] as string | undefined;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] as string | undefined;
  const sbToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!sbToken) return res.status(401).json({ error: 'Unauthorized' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Server not configured' });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user }, error: authErr } = await admin.auth.getUser(sbToken);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });
  const userId = user.id;

  let body = req.body as Record<string, unknown> | string | undefined;
  if (typeof body === 'string') {
    try { body = JSON.parse(body) as Record<string, unknown>; } catch { body = {}; }
  }
  body = body ?? {};

  const action = typeof body.action === 'string' ? body.action : '';
  if (!action) return res.status(400).json({ error: 'action required' });

  // ── Refresh the Google Calendar access token ──────────────────────────────
  if (action === 'refresh-token') {
    const { tokenField } = body;
    if (tokenField !== 'googleToken') {
      return res.status(400).json({ error: 'tokenField must be "googleToken"' });
    }
    const newToken = await refreshGoogleToken(userId, admin);
    if (!newToken) return res.status(401).json({ error: 'refresh_failed' });
    return res.status(200).json({ accessToken: newToken });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}
