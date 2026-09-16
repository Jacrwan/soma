/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';

/**
 * Server-side Google OAuth callback for connecting a Google Calendar account.
 * Supports multiple accounts per user — each connection is keyed by
 * (user_id, google_email), so connecting a second Google account adds a new
 * row instead of overwriting the first.
 *
 * Flow:
 *   1. Client builds a Google authorization URL with:
 *      - redirect_uri = https://somastudy.app/api/google-calendar-oauth-callback
 *      - state        = current Supabase access token (to identify the user)
 *      - scope        = calendar.readonly + userinfo.email (to label the connection)
 *   2. Google redirects here with ?code=…&state=…
 *   3. We exchange the code for tokens, look up which Google account this is,
 *      upsert the connection, and redirect back to /settings.
 *
 * Prerequisites (one-time setup):
 *   - Add https://somastudy.app/api/google-calendar-oauth-callback to the
 *     authorized redirect URIs on the existing OAuth 2.0 Web application
 *     client in Google Cloud Console (same client Soma already uses).
 */

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { code, state, error: oauthError } = req.query as Record<string, string | undefined>;

  if (oauthError) {
    console.warn('[gcal-oauth-callback] Google returned error:', oauthError);
    res.redirect(`/settings?gcal_error=${encodeURIComponent(oauthError)}`);
    return;
  }
  if (!code || !state) {
    res.redirect('/settings?gcal_error=missing_params');
    return;
  }

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const supabaseUrl  = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!clientId || !clientSecret || !supabaseUrl || !serviceKey) {
    console.error('[gcal-oauth-callback] Missing required env vars');
    res.redirect('/settings?gcal_error=server_misconfigured');
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: authErr } = await admin.auth.getUser(state);
  if (authErr || !user) {
    console.warn('[gcal-oauth-callback] Invalid state / JWT:', authErr?.message);
    res.redirect('/settings?gcal_error=invalid_state');
    return;
  }

  const host     = req.headers['host'] as string;
  const protocol = host.startsWith('localhost') ? 'http' : 'https';
  const callbackUrl = `${protocol}://${host}/api/google-calendar-oauth-callback`;

  const tokenBody = new URLSearchParams({
    code,
    client_id:     clientId,
    client_secret: clientSecret,
    redirect_uri:  callbackUrl,
    grant_type:    'authorization_code',
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    tokenBody.toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '');
    console.error('[gcal-oauth-callback] Token exchange failed:', tokenRes.status, errText);
    res.redirect('/settings?gcal_error=token_exchange_failed');
    return;
  }

  const tokens = await tokenRes.json() as {
    access_token?:  string;
    refresh_token?: string;
    expires_in?:    number;
  };

  if (!tokens.access_token) {
    console.error('[gcal-oauth-callback] No access_token in Google response');
    res.redirect('/settings?gcal_error=no_access_token');
    return;
  }
  if (!tokens.refresh_token) {
    // prompt=consent (set on the client side) should guarantee one; without
    // it we can't refresh later, so treat this connection attempt as failed.
    console.error('[gcal-oauth-callback] No refresh_token — user must revoke access and reconnect');
    res.redirect('/settings?gcal_error=no_refresh_token');
    return;
  }

  const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userinfoRes.ok) {
    console.error('[gcal-oauth-callback] userinfo fetch failed:', userinfoRes.status);
    res.redirect('/settings?gcal_error=userinfo_failed');
    return;
  }
  const userinfo = await userinfoRes.json() as { email?: string };
  if (!userinfo.email) {
    res.redirect('/settings?gcal_error=no_email');
    return;
  }

  const expiresAtIso = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

  const { error: upsertErr } = await admin.from('google_calendar_connections').upsert(
    {
      user_id:                 user.id,
      google_email:            userinfo.email,
      refresh_token:           tokens.refresh_token,
      access_token:            tokens.access_token,
      access_token_expires_at: expiresAtIso,
    },
    { onConflict: 'user_id,google_email' },
  );
  if (upsertErr) {
    console.error('[gcal-oauth-callback] Failed to upsert connection:', upsertErr.message);
    res.redirect('/settings?gcal_error=save_failed');
    return;
  }

  res.redirect(`/settings?gcal_connected=${encodeURIComponent(userinfo.email)}`);
}
