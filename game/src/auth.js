// The student's Soma sign-in, read from where Soma's Supabase client keeps it
// (localStorage "sb-<project>-auth-token"), refreshed here when it has expired.
// The game has no Supabase client of its own: an access token lasts an hour,
// so a student who opens /game from an old Soma tab would otherwise be signed out.
//
// Refreshing uses Supabase's REST token endpoint with the stored refresh token
// and writes the new session back to the same key, in the same shape, so Soma
// picks it up too. It runs under the same Web Lock name Soma's Supabase client
// uses ("lock:<storage key>"), so the game and an open Soma tab never spend the
// same refresh token twice.

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';
const KEY_PATTERN = /^sb-.+-auth-token$/;
const EARLY_MS = 60_000; // refresh when less than this is left

/** Whether this build knows its Supabase project (false in standalone Epoch). */
export const authConfigured = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

function storage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/**
 * The stored session as it is right now, without refreshing:
 * { key, token, refreshToken, expiresAt (ms, 0 if unknown), userId } or null.
 */
export function readSession() {
  const ls = storage();
  if (!ls) return null;
  try {
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (!key || !KEY_PATTERN.test(key)) continue;
      const data = JSON.parse(ls.getItem(key));
      const s = data?.currentSession || data;
      if (s?.access_token) {
        return { key, token: s.access_token, refreshToken: s.refresh_token || '', expiresAt: (s.expires_at || 0) * 1000, userId: s.user?.id || null };
      }
    }
  } catch { /* no session */ }
  return null;
}

const fresh = (s, minValidMs) => s && (!s.expiresAt || s.expiresAt > Date.now() + minValidMs);

function writeSession(key, session) {
  const ls = storage();
  if (!ls) return;
  try {
    const old = JSON.parse(ls.getItem(key) || 'null');
    const next = { ...(old?.currentSession || old || {}), ...session };
    if (!next.expires_at && session.expires_in) next.expires_at = Math.floor(Date.now() / 1000) + Number(session.expires_in);
    ls.setItem(key, JSON.stringify(old?.currentSession ? { ...old, currentSession: next } : next));
  } catch { /* storage full or blocked: the new token still works for this page */ }
}

async function refreshNow(minValidMs) {
  // Another tab (or Soma) may have refreshed while this one waited for the lock.
  const s = readSession();
  if (!s) return null;
  if (fresh(s, minValidMs)) return s;
  if (!s.refreshToken || !authConfigured()) return null;
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refreshToken }),
    });
  } catch { return null; } // offline: try again next time
  if (!res.ok) return null; // refresh token revoked or used: the student signs in to Soma again
  const session = await res.json().catch(() => null);
  if (!session?.access_token) return null;
  writeSession(s.key, session);
  return readSession() || { key: s.key, token: session.access_token, refreshToken: session.refresh_token || '', expiresAt: (session.expires_at || 0) * 1000, userId: session.user?.id || s.userId };
}

let inflight = null;
function refresh(minValidMs) {
  if (inflight) return inflight;
  const s = readSession();
  const run = () => refreshNow(minValidMs);
  const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
  inflight = (locks && s ? locks.request(`lock:${s.key}`, { signal: AbortSignal.timeout(10_000) }, run).catch(run) : run())
    .catch(() => null)
    .finally(() => { inflight = null; });
  return inflight;
}

/**
 * A usable session: { token, userId, expiresAt }, refreshed first when it has
 * expired or is about to. Null when signed out, or when it can't be refreshed.
 */
export async function getSession({ minValidMs = EARLY_MS } = {}) {
  const s = readSession();
  if (!s) return null;
  const ok = fresh(s, minValidMs) ? s : await refresh(minValidMs);
  return ok ? { token: ok.token, userId: ok.userId, expiresAt: ok.expiresAt } : null;
}

/** The access token (refreshed when needed), or null. */
export async function getAccessToken(opts) {
  return (await getSession(opts))?.token || null;
}

/** { Authorization: 'Bearer …' } when signed in, else {}. */
export async function authHeaders(opts) {
  const token = await getAccessToken(opts);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
