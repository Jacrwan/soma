/// <reference types="node" />

export interface CalendarConnectionRow {
  id: string;
  user_id: string;
  google_email: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
}

// Returns a usable access token for this connection, refreshing (and
// persisting the refresh) if the cached one is missing or about to expire.
export async function getFreshAccessToken(admin: any, connection: CalendarConnectionRow): Promise<string | null> {
  const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0;
  const stillValid = connection.access_token && expiresAt - Date.now() > 60_000; // 1 min safety margin
  if (stillValid) return connection.access_token;

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('[googleCalendarAuth] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set');
    return null;
  }

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: connection.refresh_token,
    client_id:     clientId,
    client_secret: clientSecret,
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text().catch(() => '');
    console.error('[googleCalendarAuth] refresh failed', connection.google_email, tokenRes.status, err);
    return null;
  }

  const json = await tokenRes.json() as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;

  const expiresAtIso = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();
  await admin.from('google_calendar_connections').update({
    access_token: json.access_token,
    access_token_expires_at: expiresAtIso,
  }).eq('id', connection.id);

  return json.access_token;
}
