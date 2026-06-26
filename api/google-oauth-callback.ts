/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';

/**
 * Server-side Google OAuth callback for Drive connections.
 *
 * Flow:
 *   1. Client builds a Google authorization URL with:
 *      - redirect_uri = https://somastudy.app/api/google-oauth-callback
 *      - state        = current Supabase access token (to identify the user)
 *   2. Google redirects here with ?code=…&state=…
 *   3. We exchange the code for tokens server-side, capture the refresh_token,
 *      persist both tokens to Supabase, and redirect back to /settings?source=gdrive.
 *
 * Prerequisites (one-time setup):
 *   - Add https://somastudy.app/api/google-oauth-callback to the list of
 *     authorized redirect URIs in Google Cloud Console (OAuth 2.0 client → Web application).
 *   - Expose VITE_GOOGLE_CLIENT_ID in Vercel (same value as GOOGLE_CLIENT_ID).
 */

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { code, state, error: oauthError } = req.query as Record<string, string | undefined>;

  if (oauthError) {
    console.warn('[google-oauth-callback] Google returned error:', oauthError);
    res.redirect(`/settings?oauth_error=${encodeURIComponent(oauthError)}`);
    return;
  }

  if (!code || !state) {
    res.redirect('/settings?oauth_error=missing_params');
    return;
  }

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const supabaseUrl  = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!clientId || !clientSecret || !supabaseUrl || !serviceKey) {
    console.error('[google-oauth-callback] Missing required env vars');
    res.redirect('/settings?oauth_error=server_misconfigured');
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify the state is a valid Supabase JWT and resolve the user
  const { data: { user }, error: authErr } = await admin.auth.getUser(state);
  if (authErr || !user) {
    console.warn('[google-oauth-callback] Invalid state / JWT:', authErr?.message);
    res.redirect('/settings?oauth_error=invalid_state');
    return;
  }

  // Derive the callback URL from the incoming request host so it works in
  // both production and Vercel preview environments
  const host     = req.headers['host'] as string;
  const protocol = host.startsWith('localhost') ? 'http' : 'https';
  const callbackUrl = `${protocol}://${host}/api/google-oauth-callback`;

  // Exchange the authorization code for access + refresh tokens
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
    console.error('[google-oauth-callback] Token exchange failed:', tokenRes.status, errText);
    res.redirect('/settings?oauth_error=token_exchange_failed');
    return;
  }

  const tokens = await tokenRes.json() as {
    access_token?:  string;
    refresh_token?: string;
    expires_in?:    number;
  };

  if (!tokens.access_token) {
    console.error('[google-oauth-callback] No access_token in Google response');
    res.redirect('/settings?oauth_error=no_access_token');
    return;
  }

  // Persist refresh token into user_tokens table (if Google returned one).
  // Google only issues a refresh token on first authorization or after explicit
  // revocation + re-auth. The prompt:consent param ensures we get one each time.
  if (tokens.refresh_token) {
    const { error: upsertErr } = await admin.from('user_tokens').upsert(
      {
        user_id:       user.id,
        provider:      'google_drive',
        refresh_token: tokens.refresh_token,
        updated_at:    new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    );
    if (upsertErr) {
      console.error('[google-oauth-callback] Failed to upsert refresh token:', upsertErr.message);
    }
  } else {
    console.warn('[google-oauth-callback] Google did not return a refresh_token for user', user.id,
      '— prompt:consent should guarantee one; user may need to revoke access and reconnect.');
  }

  // Store the access token in the settings row so the client can read it on redirect
  const { data: settingsRow } = await admin
    .from('settings')
    .select('data')
    .eq('user_id', user.id)
    .single();
  const existing = (settingsRow?.data ?? {}) as Record<string, unknown>;

  const { error: settingsErr } = await admin.from('settings').upsert({
    user_id: user.id,
    data:    { ...existing, googleDriveToken: tokens.access_token },
  });
  if (settingsErr) {
    console.error('[google-oauth-callback] Failed to store access token in settings:', settingsErr.message);
  }

  // Redirect back to settings — the client will read googleDriveToken from Supabase
  res.redirect('/settings?source=gdrive');
}
