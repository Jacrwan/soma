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
 * For Google Drive (`googleDriveToken`): reads the refresh token from the
 * `user_tokens` table (stored by api/google-oauth-callback.ts), with a
 * fallback to the legacy `settings.googleDriveRefreshToken` field for users
 * who connected before the server-side callback was added.
 *
 * For Google Calendar (`googleToken`): reads from `settings.googleRefreshToken`
 * (Calendar still uses Supabase OAuth, which may or may not have a refresh token).
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

  // ── Resolve the refresh token ─────────────────────────────────────────────

  let refreshToken: string | null = null;

  if (tokenField === 'googleDriveToken') {
    // Primary: dedicated user_tokens table (written by server-side OAuth callback)
    const { data: tokenRow, error: tokenErr } = await admin
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'google_drive')
      .maybeSingle();

    if (tokenErr) {
      console.warn('[googleAuth] user_tokens query error:', tokenErr.message);
    }

    refreshToken = tokenRow?.refresh_token ?? null;

    // Fallback: legacy settings field (users who connected before the callback existed)
    if (!refreshToken) {
      const { data: settingsRow } = await admin
        .from('settings')
        .select('data')
        .eq('user_id', userId)
        .single();
      const settings = (settingsRow?.data ?? {}) as Record<string, unknown>;
      const legacy = settings['googleDriveRefreshToken'];
      if (typeof legacy === 'string' && legacy) {
        console.info('[googleAuth] Using legacy googleDriveRefreshToken from settings for user', userId);
        refreshToken = legacy;
      }
    }
  } else {
    // Calendar: refresh token lives in settings (Supabase OAuth flow)
    const { data: row } = await admin
      .from('settings')
      .select('data')
      .eq('user_id', userId)
      .single();
    const settings = (row?.data ?? {}) as Record<string, unknown>;
    const stored = settings['googleRefreshToken'];
    refreshToken = typeof stored === 'string' && stored ? stored : null;
  }

  if (!refreshToken) {
    console.warn('[googleAuth] No refresh token found for', tokenField,
      '— user must reconnect Google');
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
  const settings = (settingsRow?.data ?? {}) as Record<string, unknown>;

  await admin.from('settings').upsert({
    user_id: userId,
    data:    { ...settings, [tokenField]: json.access_token },
  });

  return json.access_token;
}
