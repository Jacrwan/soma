/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { createStudentHandler } from './_student';

/**
 * Student verification endpoint. The verified address is written to the user's
 * app_metadata, which only the service role can change — user_metadata would
 * let a student mark themselves verified from the browser.
 */

const APP_URL = 'https://somastudy.app';

function admin() {
  const url = process.env.VITE_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export default createStudentHandler({
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
