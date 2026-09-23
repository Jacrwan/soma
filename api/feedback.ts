/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { isRateLimited } from './_rateLimit';

/**
 * Feedback and bug reports.
 *
 * Storing the report is the part that must not fail: a student who takes the
 * trouble to describe a bug should not lose it because a mail provider was
 * down. So the row is written first and the notification is sent afterwards,
 * best effort — a failed send is logged and the request still succeeds.
 *
 * user_id comes from the verified token, never from the body, so a report
 * cannot be filed against someone else's account.
 */

const KINDS = ['bug', 'idea', 'other'] as const;
type Kind = (typeof KINDS)[number];

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const token = (req.headers.authorization as string | undefined)?.replace(/^Bearer /, '');
  if (!token) return res.status(401).json({ error: 'auth_required' });

  if (isRateLimited(req, 'feedback', { windowMs: 60_000, max: 5 })) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'rate_limit' });
  }

  const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'server_not_configured' });
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'auth_required' });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const kind = (KINDS as readonly string[]).includes(String(body.kind)) ? String(body.kind) as Kind : null;
  const message = str(body.message, 4000);
  if (!kind) return res.status(400).json({ error: 'invalid_kind' });
  if (!message) return res.status(400).json({ error: 'empty_message' });

  const row = {
    user_id: user.id,
    kind,
    message,
    page: str(body.page, 300),
    app_version: str(body.appVersion, 80),
    user_agent: str(req.headers['user-agent'], 400),
  };

  const { error } = await admin.from('feedback').insert(row);
  if (error) return res.status(500).json({ error: 'save_failed' });

  // Best effort from here: the report is already safe.
  await notify(row, user.email ?? null).catch(() => { /* logged inside */ });

  return res.status(200).json({ ok: true });
}

async function notify(row: { kind: string; message: string; page: string | null }, email: string | null) {
  const key = process.env.RESEND_API_KEY, to = process.env.FEEDBACK_TO_EMAIL;
  // Not configured yet is a normal state, not an error: reports still land in
  // the table and can be read there.
  if (!key || !to) return;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.FEEDBACK_FROM_EMAIL ?? 'Soma <onboarding@resend.dev>',
        to: [to],
        subject: `Soma ${row.kind}: ${row.message.slice(0, 60)}`,
        text: [
          `Kind: ${row.kind}`,
          `From: ${email ?? 'unknown'}`,
          `Page: ${row.page ?? 'unknown'}`,
          '',
          row.message,
        ].join('\n'),
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) console.error('[feedback] notify failed:', response.status);
  } catch {
    console.error('[feedback] notify failed to send');
  }
}
