// Cloud saves for a signed-in Soma student: one row in Supabase's epoch_saves
// table (epoch_saves_migration.sql in Soma), written with the student's own
// session through the REST API. Row-level security keeps each row to its owner.
//
//   loadCloud()      -> { data, updatedAt, version } | null
//   saveCloud(data)  -> queues an upload: at most one every ~20 s, plus one when the page is hidden
//   cloudStatus()    -> 'off' | 'ok' | 'error'
//
// 'off': not signed in to Soma, or a build with no Supabase project (standalone Epoch).
// 'error': the last load or upload failed, or the save was too big to upload.

import { authConfigured, getSession, readSession } from './auth.js';

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';
const TABLE = 'epoch_saves';
const GAP_MS = 20_000; // at most one upload per this long
const MAX_BYTES = 1.5 * 1024 * 1024; // larger saves are not uploaded
const KEEPALIVE_MAX = 60 * 1024; // browsers refuse keepalive bodies over 64 KB

let status = 'ok'; // until a load or upload fails
let pending = null; // the newest save not yet uploaded (a string or an object)
let timer = null;
let lastSent = 0;
let sending = null;

/** 'off' | 'ok' | 'error'. */
export function cloudStatus() {
  if (!authConfigured() || !readSession()) return 'off';
  return status;
}

const restHeaders = (token) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` });

/**
 * The student's cloud save: { data, updatedAt (ms), version } or null when
 * signed out, there is no row yet, or it couldn't be read (cloudStatus() then says 'error').
 */
export async function loadCloud() {
  if (!authConfigured()) { status = 'off'; return null; }
  const s = await getSession();
  if (!s?.userId) { status = s ? 'error' : 'off'; return null; }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=data,version,updated_at&user_id=eq.${encodeURIComponent(s.userId)}&limit=1`, {
      headers: { ...restHeaders(s.token), accept: 'application/json' },
    });
    if (!res.ok) { status = 'error'; return null; }
    const rows = await res.json();
    status = 'ok';
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || row.data == null) return null;
    return { data: row.data, updatedAt: Date.parse(row.updated_at) || 0, version: row.version ?? null };
  } catch {
    status = 'error';
    return null;
  }
}

/** The request body for one save, or null (with status 'error') when it can't or shouldn't go. */
function body(data, userId) {
  let text;
  try { text = typeof data === 'string' ? data : JSON.stringify(data); } catch { return null; }
  if (!text) return null;
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length;
  if (bytes > MAX_BYTES) { status = 'error'; return null; }
  let version = null;
  try { const v = (typeof data === 'string' ? JSON.parse(text) : data)?.v; version = Number.isInteger(v) ? v : null; } catch { status = 'error'; return null; }
  // The save is already JSON: it goes into the body as-is, not parsed and re-encoded.
  return `{"user_id":${JSON.stringify(userId)},"version":${version},"updated_at":${JSON.stringify(new Date().toISOString())},"data":${text}}`;
}

function upload(payload, token, keepalive = false) {
  return fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=user_id`, {
    method: 'POST',
    keepalive,
    headers: { ...restHeaders(token), 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: payload,
  });
}

async function flush() {
  timer = null;
  if (sending) { schedule(); return; }
  const data = pending;
  pending = null;
  if (data == null) return;
  sending = (async () => {
    const s = await getSession();
    if (!s?.userId) { status = s ? 'error' : 'off'; return; }
    const payload = body(data, s.userId);
    if (!payload) return;
    lastSent = Date.now();
    try {
      const res = await upload(payload, s.token);
      status = res.ok ? 'ok' : 'error';
    } catch { status = 'error'; }
  })().finally(() => { sending = null; });
  await sending;
}

function schedule() {
  if (timer || pending == null) return;
  const wait = Math.max(1000, GAP_MS - (Date.now() - lastSent));
  timer = setTimeout(flush, wait);
}

/**
 * Queues the newest save for upload: the game's serialized state (a JSON
 * string) or the state object itself. Safe to call on every local save; only
 * the latest one is sent, at most once every ~20 s. Does nothing when signed out.
 */
export function saveCloud(data) {
  if (!authConfigured() || data == null) return;
  pending = data;
  listen();
  schedule();
}

// When the page is hidden (tab switched, closed, or the phone locks), the
// queued save goes now. Uses the stored token as is: there is no time to
// refresh it. A save over 60 KB can't use keepalive, so it is sent as a
// normal request, which a closing tab may cut off; the 20 s uploads before it
// still stand.
function flushOnHide() {
  if (pending == null || sending) return;
  const s = readSession();
  if (!s?.userId || (s.expiresAt && s.expiresAt < Date.now())) return;
  const payload = body(pending, s.userId);
  pending = null;
  if (timer) { clearTimeout(timer); timer = null; }
  if (!payload) return;
  lastSent = Date.now();
  upload(payload, s.token, (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(payload).length : payload.length) <= KEEPALIVE_MAX)
    .then((res) => { status = res.ok ? 'ok' : 'error'; })
    .catch(() => { status = 'error'; });
}

let listening = false;
function listen() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushOnHide(); });
  window.addEventListener('pagehide', flushOnHide);
}
