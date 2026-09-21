import { test, expect } from '@playwright/test';
import { isAcademicEmail, signClaim, verifyClaim, claimFor, createStudentHandler, verificationEmail } from '../api/_student';
import { priceIdFor, isVerifiedStudent } from '../api/stripe';

const SECRET = 'test-secret';
const USER = '11111111-1111-4111-8111-111111111111';

function res() {
  const out: { status: number; body: unknown; redirect: string | null; headers: Record<string, string> } =
    { status: 200, body: null, redirect: null, headers: {} };
  const api: any = {
    status(code: number) { out.status = code; return api; },
    json(body: unknown) { out.body = body; return api; },
    redirect(code: number, url: string) { out.status = code; out.redirect = url; return api; },
    setHeader(k: string, v: string) { out.headers[k] = v; },
  };
  return { out, api };
}

function handler(over: Partial<Parameters<typeof createStudentHandler>[0]> = {}, sent: { to: string; link: string }[] = []) {
  const marked: { userId: string; email: string }[] = [];
  const h = createStudentHandler({
    secret: () => SECRET,
    appUrl: () => 'https://somastudy.app',
    authorize: async () => ({ ok: true, userId: USER }),
    sendEmail: async (to, message) => { sent.push({ to, link: message.text.match(/https?:\S+/)![0] }); },
    markVerified: async (userId, email) => { marked.push({ userId, email }); },
    limited: () => false,
    ...over,
  });
  return { h, marked, sent };
}

test('only school addresses are accepted', () => {
  for (const ok of ['a@berkeley.edu', 'Student@Mail.Utexas.EDU', 'x@student.ac.uk', 'y@school.edu.au'])
    expect(isAcademicEmail(ok), ok).toBe(true);
  for (const no of ['a@gmail.com', 'a@edu.com', 'a@notedu', 'a@x.education', '', null, 'a b@x.edu', 'a@.edu', `${'x'.repeat(300)}@y.edu`])
    expect(isAcademicEmail(no as unknown), String(no)).toBe(false);
});

test('a verification link cannot be forged, replayed late, or aimed at another account', () => {
  const claim = claimFor(USER, 'a@berkeley.edu');
  const token = signClaim(SECRET, claim);
  expect(verifyClaim(SECRET, token)?.email).toBe('a@berkeley.edu');

  expect(verifyClaim('other-secret', token)).toBeNull();                      // different key
  expect(verifyClaim(SECRET, token.slice(0, -2) + 'xy')).toBeNull();          // tampered signature
  expect(verifyClaim(SECRET, token, Date.now() + 2 * 3_600_000)).toBeNull();  // expired
  expect(verifyClaim(SECRET, 'nonsense')).toBeNull();

  // Re-signing a changed payload with the wrong key is what an attacker can do.
  const forged = signClaim('other-secret', { ...claim, userId: 'someone-else' });
  expect(verifyClaim(SECRET, forged)).toBeNull();
});

test('requesting a link emails it; confirming it records the address', async () => {
  const { h, marked, sent } = handler();
  const a = res();
  await h({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'request', email: 'Me@Berkeley.EDU' } }, a.api);
  expect(a.out.status).toBe(200);
  expect(sent[0].to).toBe('me@berkeley.edu');

  const token = new URL(sent[0].link).searchParams.get('token');
  const b = res();
  await h({ method: 'GET', query: { token } }, b.api);
  expect(b.out.redirect).toBe('https://somastudy.app/pricing?student=verified');
  expect(marked).toEqual([{ userId: USER, email: 'me@berkeley.edu' }]);
});

test('a personal address, a missing token and an unauthenticated request are all refused', async () => {
  const { h, marked } = handler();
  const a = res();
  await h({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'request', email: 'me@gmail.com' } }, a.api);
  expect(a.out.status).toBe(400);
  expect(a.out.body).toEqual({ error: 'not_a_school_email' });

  const b = res();
  await h({ method: 'POST', headers: {}, body: { action: 'request', email: 'me@berkeley.edu' } }, b.api);
  expect(b.out.status).toBe(401);

  const c = res();
  await h({ method: 'GET', query: { token: 'made-up' } }, c.api);
  expect(c.out.redirect).toBe('https://somastudy.app/pricing?student=invalid');
  expect(marked).toEqual([]);
});

test('verification emails are rate limited per account', async () => {
  const { h } = handler({ limited: () => true });
  const a = res();
  await h({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'request', email: 'me@berkeley.edu' } }, a.api);
  expect(a.out.status).toBe(429);
});

test('the email names the address and never carries markup from it', () => {
  const message = verificationEmail('https://somastudy.app/api/student?token=abc', 'me@berkeley.edu');
  expect(message.html).toContain('me@berkeley.edu');
  const nasty = verificationEmail('https://x/?token=a"><script>alert(1)</script>', 'me@berkeley.edu');
  expect(nasty.html).not.toContain('<script>');
});

test('the student price is only used for an account the server has verified', () => {
  const env = {
    STRIPE_PRICE_ID_MONTHLY: 'p_m', STRIPE_PRICE_ID_YEARLY: 'p_y',
    STRIPE_PRICE_ID_STUDENT_MONTHLY: 'p_sm', STRIPE_PRICE_ID_STUDENT_YEARLY: 'p_sy',
  } as NodeJS.ProcessEnv;

  expect(isVerifiedStudent({ app_metadata: { student_verified_at: '2026-09-20T00:00:00Z' } })).toBe(true);
  expect(isVerifiedStudent({ app_metadata: { student: true } })).toBe(false);   // not the server's own mark
  expect(isVerifiedStudent({ app_metadata: {} })).toBe(false);
  expect(isVerifiedStudent(null)).toBe(false);

  expect(priceIdFor('monthly', false, env)).toBe('p_m');
  expect(priceIdFor('annual', false, env)).toBe('p_y');
  expect(priceIdFor('monthly', true, env)).toBe('p_sm');
  expect(priceIdFor('annual', true, env)).toBe('p_sy');

  // With no student price configured, a student still gets the ordinary one.
  const partial = { STRIPE_PRICE_ID_MONTHLY: 'p_m', STRIPE_PRICE_ID_YEARLY: 'p_y' } as NodeJS.ProcessEnv;
  expect(priceIdFor('annual', true, partial)).toBe('p_y');
});
