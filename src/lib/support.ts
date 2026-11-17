/**
 * Message the developer (api/_support.ts, referrals_support_migration.sql).
 * A student's messages go through the server, which pings the owner's
 * Discord; the owner (is_soma_owner) reads every conversation and replies
 * straight to the table. Each side marks the other's messages read.
 */
import { supabase } from './supabase';

export type SupportMessage = { id: string; sender: 'user' | 'owner'; body: string; createdAt: string; readAt: string | null };
export type SupportThread = { userId: string; email: string; lastBody: string; lastSender: 'user' | 'owner'; lastAt: string; unread: number };

export const MESSAGE_MAX = 4000;
const TABLE = 'support_messages';

export class SupportNotSetUpError extends Error {
  constructor() { super('Messaging isn’t set up yet.'); }
}
const isMissing = (e: { code?: string; message?: string }) =>
  e.code === 'PGRST205' || e.code === 'PGRST202' || e.code === '42P01' || e.code === '42883' || /could not find the (table|function)|does not exist|schema cache/i.test(e.message ?? '');

const toMessage = (r: Record<string, unknown>): SupportMessage => ({
  id: String(r.id),
  sender: r.sender === 'owner' ? 'owner' : 'user',
  body: String(r.body ?? ''),
  createdAt: String(r.created_at ?? ''),
  readAt: r.read_at ? String(r.read_at) : null,
});

/** Whether this account answers messages. Anything but a clear yes is a no. */
export async function isSupportOwner(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('is_soma_owner');
    return !error && data === true;
  } catch { return false; }
}

export async function loadThread(threadUserId: string): Promise<SupportMessage[]> {
  const { data, error } = await supabase.from(TABLE).select('id,sender,body,created_at,read_at')
    .eq('thread_user_id', threadUserId).order('created_at', { ascending: true }).limit(500);
  if (error) { if (isMissing(error)) throw new SupportNotSetUpError(); throw new Error('Couldn’t load messages.'); }
  return ((data ?? []) as Record<string, unknown>[]).map(toMessage);
}

/** Unread replies for a student (polled while the chat is closed): how many, and the newest, for the preview. */
export async function unreadReplies(userId: string): Promise<{ count: number; latest: SupportMessage | null }> {
  const { data, error } = await supabase.from(TABLE).select('id,sender,body,created_at,read_at')
    .eq('thread_user_id', userId).eq('sender', 'owner').is('read_at', null)
    .order('created_at', { ascending: false }).limit(20);
  if (error) return { count: 0, latest: null };
  const rows = ((data ?? []) as Record<string, unknown>[]).map(toMessage).filter(m => m.sender === 'owner' && !m.readAt);
  return { count: rows.length, latest: rows[0] ?? null };
}

export async function markRead(threadUserId: string): Promise<void> {
  await supabase.rpc('mark_support_read', { p_thread: threadUserId });
}

export async function sendAsStudent(body: string, page: string): Promise<SupportMessage> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Please sign in again.');
  const res = await fetch('/api/stripe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'support-send', body: body.slice(0, MESSAGE_MAX), page }),
  });
  const out = await res.json().catch(() => ({})) as { message?: Record<string, unknown>; error?: string };
  if (out.error === 'not_set_up') throw new SupportNotSetUpError();
  if (res.status === 429) throw new Error('That’s a lot of messages at once. Wait a minute and try again.');
  if (!res.ok || !out.message) throw new Error(out.error ?? 'Couldn’t send. Please try again.');
  return toMessage(out.message);
}

export async function sendAsOwner(threadUserId: string, body: string): Promise<SupportMessage> {
  const { data, error } = await supabase.from(TABLE)
    .insert({ thread_user_id: threadUserId, sender: 'owner', body: body.trim().slice(0, MESSAGE_MAX) })
    .select('id,sender,body,created_at,read_at').single();
  if (error || !data) { if (error && isMissing(error)) throw new SupportNotSetUpError(); throw new Error('Couldn’t send. Please try again.'); }
  return toMessage(data as Record<string, unknown>);
}

export async function loadThreads(): Promise<SupportThread[]> {
  const { data, error } = await supabase.rpc('support_threads');
  if (error) { if (isMissing(error)) throw new SupportNotSetUpError(); throw new Error('Couldn’t load conversations.'); }
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    userId: String(r.thread_user_id),
    email: String(r.email ?? 'Deleted account'),
    lastBody: String(r.last_body ?? ''),
    lastSender: r.last_sender === 'owner' ? 'owner' : 'user',
    lastAt: String(r.last_at ?? ''),
    unread: Number(r.unread) || 0,
  }));
}
