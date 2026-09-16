/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { getFreshAccessToken, type CalendarConnectionRow } from './_googleCalendarAuth';
import { isRateLimited } from './_rateLimit';

export const config = { api: { bodyParser: { sizeLimit: '5kb' } }, maxDuration: 60 };

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

interface SelectedCalendar { id: string; summary: string; backgroundColor?: string; primary?: boolean }

async function fetchCalendarEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<any[]> {
  const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime' });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return [];
  const data = await res.json() as { items?: any[] };
  return data.items ?? [];
}

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (isRateLimited(req, 'google-calendar-events', { windowMs: 60_000, max: 30 })) {
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

  const { timeMin, timeMax } = (req.body ?? {}) as { timeMin?: string; timeMax?: string };
  if (!timeMin || !timeMax) return res.status(400).json({ error: 'timeMin and timeMax required' });

  const { data: connections, error: connErr } = await admin
    .from('google_calendar_connections')
    .select('id, user_id, google_email, refresh_token, access_token, access_token_expires_at, selected_calendars')
    .eq('user_id', user.id);
  if (connErr) return res.status(500).json({ error: connErr.message });

  const events: any[] = [];

  await Promise.all((connections ?? []).map(async (row: CalendarConnectionRow & { selected_calendars: SelectedCalendar[] }) => {
    const calendars = row.selected_calendars ?? [];
    if (calendars.length === 0) return;

    const accessToken = await getFreshAccessToken(admin, row);
    if (!accessToken) return; // this account's token is stale; skip it rather than fail the whole request

    await Promise.all(calendars.map(async cal => {
      const items = await fetchCalendarEvents(accessToken, cal.id, timeMin, timeMax);
      for (const item of items) {
        events.push({
          ...item,
          source: {
            connectionId: row.id,
            googleEmail: row.google_email,
            calendarId: cal.id,
            calendarSummary: cal.summary,
            color: cal.backgroundColor,
          },
        });
      }
    }));
  }));

  return res.status(200).json({ events });
}
