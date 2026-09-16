import { supabase } from './supabase';
import { GoogleCalendarConnection, GoogleCalendarEvent, GoogleCalendarInfo } from '../types';

export class GoogleCalendarError extends Error {}

async function getSupabaseToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? '';
}

async function post<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = await getSupabaseToken();
  const res = await fetch('/api/google-calendar-connections', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...body }),
  });
  if (res.status === 401) {
    const errBody = await res.json().catch(() => ({})) as { error?: string };
    if (errBody.error === 'google_token_expired') throw new GoogleCalendarError('google_token_expired');
    throw new GoogleCalendarError('auth_required');
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: string };
    throw new GoogleCalendarError(errBody.error || 'request_failed');
  }
  return res.json() as Promise<T>;
}

export async function listConnections(): Promise<GoogleCalendarConnection[]> {
  const { connections } = await post<{ connections: GoogleCalendarConnection[] }>('list');
  return connections;
}

export async function listCalendarsForConnection(connectionId: string): Promise<GoogleCalendarInfo[]> {
  const { calendars } = await post<{ calendars: GoogleCalendarInfo[] }>('list_calendars', { connectionId });
  return calendars;
}

export async function updateSelectedCalendars(connectionId: string, calendars: GoogleCalendarInfo[]): Promise<void> {
  await post('update_selected', { connectionId, calendars });
}

export async function disconnectConnection(connectionId: string): Promise<void> {
  await post('disconnect', { connectionId });
}

// Kicks off the OAuth flow for adding a Google account. Redirects the whole
// page (standard OAuth redirect flow) — nothing to await, the browser leaves.
export async function startConnectFlow(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return;

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!clientId) {
    console.error('[soma] VITE_GOOGLE_CLIENT_ID is not set — cannot initiate Calendar OAuth');
    return;
  }

  const scopes = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' ');

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  `${window.location.origin}/api/google-calendar-oauth-callback`,
    response_type: 'code',
    scope:         scopes,
    access_type:   'offline',
    prompt:        'consent select_account', // force account chooser so adding a 2nd account doesn't silently reuse the 1st
    state:         session.access_token,
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function fetchAggregatedEvents(timeMin: string, timeMax: string): Promise<GoogleCalendarEvent[]> {
  const token = await getSupabaseToken();
  if (!token) return [];
  const res = await fetch('/api/google-calendar-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ timeMin, timeMax }),
  });
  if (!res.ok) throw new GoogleCalendarError('fetch_failed');
  const data = await res.json() as { events: GoogleCalendarEvent[] };
  return data.events;
}
