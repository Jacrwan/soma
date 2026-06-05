import { supabase } from './supabase';
import { storage } from './storage';

async function checkTokenValid(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(
      `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(token)}`,
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function refreshViaServer(
  supabaseToken: string,
  tokenField: 'googleDriveToken' | 'googleToken',
): Promise<string | null> {
  try {
    const res = await fetch('/api/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseToken}`,
      },
      body: JSON.stringify({ action: 'refresh-token', tokenField }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { accessToken?: string };
    return data.accessToken ?? null;
  } catch {
    return null;
  }
}

/**
 * Validates the stored Google access token via tokeninfo. If expired, refreshes
 * it server-side (where the client secret lives), updates client storage, and
 * returns the usable token. Returns null if the token is missing or refresh fails.
 */
export async function ensureFreshGoogleToken(
  tokenField: 'googleDriveToken' | 'googleToken',
): Promise<string | null> {
  const token = tokenField === 'googleDriveToken'
    ? storage.getGoogleDriveToken()
    : storage.getGoogleToken();

  if (!token) return null;

  const valid = await checkTokenValid(token);
  if (valid) return token;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  const fresh = await refreshViaServer(session.access_token, tokenField);
  if (!fresh) return null;

  if (tokenField === 'googleDriveToken') {
    storage.setGoogleDriveToken(fresh);
  } else {
    storage.setGoogleToken(fresh);
  }

  return fresh;
}
