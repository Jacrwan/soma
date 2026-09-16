/// <reference types="node" />
import { SupabaseClient } from '@supabase/supabase-js';

export class GoogleTokenExpiredError extends Error {
  constructor() {
    super('google_token_expired');
    this.name = 'GoogleTokenExpiredError';
  }
}

/**
 * Exchanges the stored Google Calendar refresh token for a new access token
 * and persists it back to the user's settings row in Supabase. Calendar uses
 * Supabase OAuth, so the refresh token (if any) lives in `settings.googleRefreshToken`.
 */
export async function refreshGoogleToken(
  userId: string,
  admin: SupabaseClient,
): Promise<string | null> {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('[googleAuth] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — cannot refresh token');
    return null;
  }

  const { data: row } = await admin
    .from('settings')
    .select('data')
    .eq('user_id', userId)
    .single();
  const settings = (row?.data ?? {}) as Record<string, unknown>;
  const stored = settings['googleRefreshToken'];
  const refreshToken = typeof stored === 'string' && stored ? stored : null;

  if (!refreshToken) {
    console.warn('[googleAuth] No refresh token found for googleToken — user must reconnect Google');
    return null;
  }

  // ── Exchange refresh token for new access token ───────────────────────────

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
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
    console.error('[googleAuth] Token refresh failed', tokenRes.status, err);
    return null;
  }

  const json = await tokenRes.json() as { access_token?: string };
  if (!json.access_token) return null;

  // Persist the new access token back to settings so the client can use it
  const { data: settingsRow } = await admin
    .from('settings')
    .select('data')
    .eq('user_id', userId)
    .single();
  const latestSettings = (settingsRow?.data ?? {}) as Record<string, unknown>;

  await admin.from('settings').upsert({
    user_id: userId,
    data:    { ...latestSettings, googleToken: json.access_token },
  });

  return json.access_token;
}
