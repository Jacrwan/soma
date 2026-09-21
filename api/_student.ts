/// <reference types="node" />
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * Student verification: a student proves they hold a school address, and the
 * server records it. Only the server can write that record, so the price a
 * student is charged never depends on anything the browser claims.
 *
 * The link sent by email carries its own signature and expiry rather than a
 * row in a table, so verifying needs no storage of its own.
 */

export type StudentClaim = { userId: string; email: string; exp: number };

const MAX_EMAIL = 254;
const LINK_MINUTES = 60;

/**
 * Schools outside the US rarely use .edu: the UK has ac.uk, Australia edu.au,
 * and so on. Accept .edu and the two-part academic domains, and nothing else.
 */
export function isAcademicEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const email = value.trim().toLowerCase();
  if (email.length > MAX_EMAIL || !/^[^\s@,;:<>"'\\]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return false;
  const domain = email.slice(email.indexOf('@') + 1);
  if (domain.includes('..') || domain.startsWith('-')) return false;
  return domain.endsWith('.edu') || /\.(edu|ac)\.[a-z]{2,3}$/.test(domain);
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function sign(secret: string, body: string): string {
  return b64url(createHmac('sha256', secret).update(body).digest());
}

/** A signed, self-expiring proof that this account asked to verify this address. */
export function signClaim(secret: string, claim: StudentClaim): string {
  const body = b64url(Buffer.from(JSON.stringify(claim)));
  return `${body}.${sign(secret, body)}`;
}

export function verifyClaim(secret: string, token: unknown, now = Date.now()): StudentClaim | null {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = sign(secret, body);
  // Compare in constant time, so a wrong signature reveals nothing about the right one.
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claim: StudentClaim;
  try { claim = JSON.parse(unb64url(body).toString()) as StudentClaim; } catch { return null; }
  if (!claim || typeof claim.userId !== 'string' || !isAcademicEmail(claim.email) || typeof claim.exp !== 'number') return null;
  return claim.exp > now ? claim : null;
}

export function claimFor(userId: string, email: string, now = Date.now()): StudentClaim {
  return { userId, email: normaliseEmail(email), exp: now + LINK_MINUTES * 60_000 };
}

const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function verificationEmail(link: string, email: string): { subject: string; html: string; text: string } {
  const safe = escape(link);
  return {
    subject: 'Confirm your school email for student pricing',
    text: `Confirm ${normaliseEmail(email)} to get Soma at the student price: ${link}\n\nThis link works for the next ${LINK_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`,
    html: `<p>Confirm <strong>${escape(normaliseEmail(email))}</strong> to get Soma at the student price.</p>
<p><a href="${safe}">Confirm my school email</a></p>
<p>This link works for the next ${LINK_MINUTES} minutes. If you didn't ask for it, you can ignore this email.</p>`,
  };
}

export type StudentDeps = {
  authorize: (token: string) => Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }>;
  sendEmail: (to: string, message: { subject: string; html: string; text: string }) => Promise<void>;
  markVerified: (userId: string, email: string) => Promise<void>;
  secret: () => string | undefined;
  appUrl: () => string;
  limited?: (key: string) => boolean;
  now?: () => number;
};

const hits = new Map<string, number[]>();
function defaultLimited(key: string) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter(t => now - t < 3_600_000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > 5;            // five verification emails an hour per account
}

/**
 * POST {action:"request", email} sends the link; GET ?token=… confirms it and
 * sends the student back to the pricing page.
 */
export function createStudentHandler(deps: StudentDeps) {
  const now = () => (deps.now ?? Date.now)();
  return async (req: any, res: any) => {
    res.setHeader('Cache-Control', 'no-store');
    const secret = deps.secret();
    if (!secret) return res.status(503).json({ error: 'verification_not_configured' });

    if (req.method === 'GET') {
      const claim = verifyClaim(secret, req.query?.token, now());
      if (!claim) return res.redirect(302, `${deps.appUrl()}/pricing?student=invalid`);
      try { await deps.markVerified(claim.userId, claim.email); }
      catch { return res.redirect(302, `${deps.appUrl()}/pricing?student=error`); }
      return res.redirect(302, `${deps.appUrl()}/pricing?student=verified`);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const header = req.headers?.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return res.status(401).json({ error: 'auth_required' });

    const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) as { action?: unknown; email?: unknown } | undefined;
    if (body?.action !== 'request') return res.status(400).json({ error: 'invalid_request' });
    // Say the same thing for a bad address as for a good one? No: this is the
    // student's own address, and a typo they never hear about is a dead end.
    if (!isAcademicEmail(body.email)) return res.status(400).json({ error: 'not_a_school_email' });

    const auth = await deps.authorize(token);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if ((deps.limited ?? defaultLimited)(auth.userId)) { res.setHeader('Retry-After', '3600'); return res.status(429).json({ error: 'rate_limit' }); }

    const email = normaliseEmail(body.email as string);
    const link = `${deps.appUrl()}/api/stripe?token=${encodeURIComponent(signClaim(secret, claimFor(auth.userId, email, now())))}`;
    try { await deps.sendEmail(email, verificationEmail(link, email)); }
    catch { return res.status(502).json({ error: 'email_failed' }); }
    return res.status(200).json({ sent: true, email });
  };
}

function safeParse(value: string) {
  try { return JSON.parse(value); } catch { return {}; }
}

// ── Runtime wiring ───────────────────────────────────────────────────────────
// Served by api/stripe.ts rather than its own file: this project's hosting plan
// allows twelve serverless functions, and billing is where this belongs anyway.

const APP_URL = 'https://somastudy.app';

function admin() {
  const url = process.env.VITE_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export const studentHandler = createStudentHandler({
  secret: () => process.env.STUDENT_VERIFY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
  appUrl: () => process.env.PUBLIC_APP_URL || APP_URL,

  authorize: async (token: string) => {
    const db = admin();
    if (!db) return { ok: false as const, status: 503, error: 'server_not_configured' };
    const { data: { user }, error } = await db.auth.getUser(token);
    if (error || !user) return { ok: false as const, status: 401, error: 'invalid_token' };
    return { ok: true as const, userId: user.id };
  },

  markVerified: async (userId: string, email: string) => {
    const db = admin();
    if (!db) throw new Error('server_not_configured');
    const { error } = await db.auth.admin.updateUserById(userId, {
      app_metadata: { student_email: email, student_verified_at: new Date().toISOString() },
    });
    if (error) throw new Error(error.message);
  },

  sendEmail: async (to: string, message: { subject: string; html: string; text: string }) => {
    const key = process.env.RESEND_API_KEY ?? '';
    if (!key) throw new Error('email_not_configured');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: process.env.VERIFY_EMAIL_FROM || 'Soma <noreply@somastudy.app>',
        to: [to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    if (!response.ok) throw new Error(`resend_${response.status}`);
  },
});
