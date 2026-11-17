/// <reference types="node" />
// Message the developer (referrals_support_migration.sql). A student's
// message is saved here, with the service role, and then posted to the
// owner's Discord channel (DISCORD_SUPPORT_WEBHOOK_URL in Vercel) so it
// reaches their phone. A Discord failure never loses the message: it's
// saved first, and the owner's inbox in the app shows it either way.
// Replies are written by the owner straight from the app (RLS).
//
// Lives inside api/stripe.ts as an action: the project is at Vercel's
// 12-function limit.

export const MESSAGE_MAX = 4000;
const APP = 'https://somastudy.app';

const notSetUp = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01' || /schema cache|does not exist/i.test(e.message ?? ''));

/** The Discord post. Mentions are switched off so a message can't ping @everyone. */
export function discordPayload(email: string, body: string, page: string | null, threadUserId: string) {
  const clip = body.length > 1500 ? `${body.slice(0, 1500)}…` : body;
  const lines = [
    `**New message from ${email || 'a student'}**${page ? ` · on ${page}` : ''}`,
    clip.split('\n').map(l => `> ${l}`).join('\n'),
    `Reply: ${APP}/dashboard?support=${threadUserId}`,
  ];
  return { content: lines.join('\n').slice(0, 1990), allowed_mentions: { parse: [] as string[] } };
}

export async function sendSupportMessage(
  admin: any,
  user: { id: string; email?: string | null },
  raw: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  webhook = process.env.DISCORD_SUPPORT_WEBHOOK_URL ?? '',
) {
  const body = typeof raw.body === 'string' ? raw.body.trim().slice(0, MESSAGE_MAX) : '';
  if (!body) return { status: 400, body: { error: 'Write a message first.' } };
  const page = typeof raw.page === 'string' && /^\/[\w\-/]{0,199}$/.test(raw.page) ? raw.page : null;

  const { data, error } = await admin.from('support_messages')
    .insert({ thread_user_id: user.id, sender: 'user', body, page })
    .select('id, sender, body, created_at, read_at').single();
  if (notSetUp(error)) return { status: 503, body: { error: 'not_set_up' } };
  if (error || !data) return { status: 503, body: { error: 'Couldn’t send. Please try again.' } };

  if (/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhook)) {
    try {
      const r = await fetchImpl(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discordPayload(user.email ?? '', body, page, user.id)),
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) console.error('[support] Discord answered', r.status);
    } catch (err: any) {
      console.error('[support] Discord not reached:', err?.message);
    }
  } else if (webhook) {
    console.error('[support] DISCORD_SUPPORT_WEBHOOK_URL isn’t a Discord webhook address');
  }
  return { status: 200, body: { message: data } };
}
