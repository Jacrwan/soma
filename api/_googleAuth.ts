/// <reference types="node" />
import { SupabaseClient } from '@supabase/supabase-js';

export class GoogleTokenExpiredError extends Error {
  constructor() {
    super('google_token_expired');
    this.name = 'GoogleTokenExpiredError';
  }
}

/**
 * Exchanges a stored refresh token for a new Google access token and persists
 * the new access token back to the user's settings row in Supabase.
 *
 * Returns the new access token on success, null if refresh is impossible
 * (missing env vars, no refresh token stored, or Google rejected the exchange).
 */
export async function refreshGoogleToken(
  userId: string,
  admin: SupabaseClient,
  tokenField: 'googleDriveToken' | 'googleToken',
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
  const refreshField = tokenField === 'googleDriveToken'
    ? 'googleDriveRefreshToken'
    : 'googleRefreshToken';
  const refreshToken = settings[refreshField];

  if (!refreshToken || typeof refreshToken !== 'string') {
    console.warn('[googleAuth] No refresh token stored for', refreshField, '— user must reconnect Google');
    return null;
  }

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

  await admin.from('settings').upsert({
    user_id: userId,
    data: { ...settings, [tokenField]: json.access_token },
  });

  return json.access_token;
}
