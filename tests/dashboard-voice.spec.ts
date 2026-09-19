import { test, expect, type Page } from '@playwright/test';

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };

// A stand-in for the browser's speech recogniser that the test can drive.
const FAKE_RECOGNITION = () => {
  class FakeRecognition {
    continuous = false; interimResults = false; lang = '';
    onresult: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    results: { 0: { transcript: string }; isFinal: boolean; length: number }[] = [];
    start() { (window as any).__rec = this; (window as any).__started = ((window as any).__started ?? 0) + 1; }
    stop() { this.onend?.(); (window as any).__rec = null; }
    abort() { this.stop(); }
    say(text: string, isFinal: boolean) {
      const last = this.results[this.results.length - 1];
      const r = { 0: { transcript: text }, isFinal, length: 1 };
      if (last && !last.isFinal) this.results[this.results.length - 1] = r; else this.results.push(r);
      this.onresult?.({ resultIndex: 0, results: this.results });
    }
    fail(error: string) { this.onerror?.({ error }); this.onend?.(); (window as any).__rec = null; }
  }
  (window as any).webkitSpeechRecognition = FakeRecognition;
  (window as any).SpeechRecognition = FakeRecognition;
};

async function setup(page: Page, opts: { speech?: boolean } = { speech: true }) {
  const state = { chatCalls: 0 };
  if (opts.speech) await page.addInitScript(FAKE_RECOGNITION);
  else await page.addInitScript(() => { delete (window as any).webkitSpeechRecognition; delete (window as any).SpeechRecognition; });
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), t = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (t === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/memory', r => r.fulfill({ json: { revision: 0, enabled: true, entries: [] } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/chat', r => { state.chatCalls++; return r.fulfill({ json: { content: [{ text: JSON.stringify({ reply: 'ok', blocks: [] }) }] } }); });
  await page.goto('/dashboard');
  await expect(page.getByLabel('What do you need to work on?')).toBeVisible();
  return state;
}
const say = (page: Page, text: string, isFinal: boolean) => page.evaluate(([t, f]) => (window as any).__rec.say(t, f), [text, isFinal] as const);

test('dictation fills the box live, adds to typed text, and does not send by itself', async ({ page }) => {
  const state = await setup(page);
  const box = page.getByLabel('What do you need to work on?');
  await box.fill('I have');
  await page.getByRole('button', { name: 'Dictate' }).click();
  await expect(page.getByRole('button', { name: 'Stop dictation' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Listening/)).toBeVisible();

  await say(page, 'a lab report', false);                 // interim words show immediately
  await expect(box).toHaveValue('I have a lab report');
  await say(page, 'a lab report due Friday', true);
  await say(page, ' and a quiz', false);
  await expect(box).toHaveValue('I have a lab report due Friday and a quiz');

  await page.getByRole('button', { name: 'Stop dictation' }).click();
  await expect(page.getByRole('button', { name: 'Dictate' })).toBeVisible();
  expect(state.chatCalls).toBe(0);                          // the student sends it
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect(page.getByRole('log')).toContainText('I have a lab report due Friday and a quiz');
  await expect.poll(() => state.chatCalls).toBe(1);
});

test('sending while dictating stops the microphone', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Dictate' }).click();
  await say(page, 'plan my evening', true);
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect(page.getByRole('button', { name: 'Dictate' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__rec)).toBeNull();
});

test('a blocked microphone explains itself', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Dictate' }).click();
  await page.evaluate(() => (window as any).__rec.fail('not-allowed'));
  await expect(page.getByRole('alert')).toContainText('Microphone access is blocked');
  await expect(page.getByRole('button', { name: 'Dictate' })).toBeVisible();
});

test('browsers without speech recognition show no mic button', async ({ page }) => {
  await setup(page, { speech: false });
  await expect(page.getByRole('button', { name: 'Send to Soma' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dictate' })).toHaveCount(0);
});
