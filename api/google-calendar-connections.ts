/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { getFreshAccessToken, type CalendarConnectionRow } from './_googleCalendarAuth';
import { isRateLimited } from './_rateLimit';

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

function toClientConnection(row: any) {
  return {
    id: row.id,
    googleEmail: row.google_email,
    selectedCalendars: row.selected_calendars ?? [],
    createdAt: row.created_at,
  };
}

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (isRateLimited(req, 'google-calendar-connections', { windowMs: 60_000, max: 40 })) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const authHeader = req.headers['authorization'] as string | undefined;
  const sbToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!sbToken) return res.status(401).json({ error: 'Unauthorized' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Server not configured' });

  const admin: any = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user }, error: authErr } = await admin.auth.getUser(sbToken);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : '';

  async function loadOwnedConnection(connectionId: unknown): Promise<CalendarConnectionRow | null> {
    if (typeof connectionId !== 'string' || !connectionId) return null;
    const { data, error } = await admin
      .from('google_calendar_connections')
      .select('id, user_id, google_email, refresh_token, access_token, access_token_expires_at')
      .eq('id', connectionId)
      .single();
    if (error || !data || data.user_id !== user.id) return null;
    return data as CalendarConnectionRow;
  }

  if (action === 'list') {
    const { data, error } = await admin
      .from('google_calendar_connections')
      .select('id, google_email, selected_calendars, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ connections: (data ?? []).map(toClientConnection) });
  }

  if (action === 'list_calendars') {
    const connection = await loadOwnedConnection(body.connectionId);
    if (!connection) return res.status(404).json({ error: 'not_found' });

    const accessToken = await getFreshAccessToken(admin, connection);
    if (!accessToken) return res.status(401).json({ error: 'google_token_expired' });

    const calRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (calRes.status === 401) return res.status(401).json({ error: 'google_token_expired' });
    if (!calRes.ok) return res.status(502).json({ error: 'google_error' });

    const data = await calRes.json() as {
      items?: { id: string; summary?: string; backgroundColor?: string; primary?: boolean }[];
    };
    const calendars = (data.items ?? []).map(c => ({
      id: c.id,
      summary: c.summary ?? c.id,
      backgroundColor: c.backgroundColor,
      primary: !!c.primary,
    }));
    return res.status(200).json({ calendars });
  }

  if (action === 'update_selected') {
    const connection = await loadOwnedConnection(body.connectionId);
    if (!connection) return res.status(404).json({ error: 'not_found' });
    const calendars = Array.isArray(body.calendars) ? body.calendars : null;
    if (!calendars) return res.status(400).json({ error: 'calendars required' });

    const { error } = await admin
      .from('google_calendar_connections')
      .update({ selected_calendars: calendars })
      .eq('id', connection.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (action === 'disconnect') {
    const connection = await loadOwnedConnection(body.connectionId);
    if (!connection) return res.status(404).json({ error: 'not_found' });
    const { error } = await admin.from('google_calendar_connections').delete().eq('id', connection.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}
