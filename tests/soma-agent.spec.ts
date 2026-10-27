import { test, expect, type Page } from '@playwright/test';
import { parseActions, gmailLink, mailtoLink, googleCalendarLink, icsFile } from '../src/lib/agentActions';

/**
 * Soma as an agent (feat/soma-agent): emails and calendar events Soma gets
 * ready for the student to send or add themselves, and the morning brief.
 * Nothing is ever sent or saved by Soma: every action is a link the student
 * opens. The brief is worked out without the AI; only "Plan my day" asks it.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plus = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return key(d); };
const today = plus(0), yesterday = plus(-1);
type Row = Record<string, unknown>;

// ── Actions: checked, and turned into links ─────────────────────────────────

test('actions from the model are checked: known kinds, real addresses, capped', () => {
  const actions = parseActions([
    { kind: 'email', to: 'prof@emory.edu, not-an-address, x@y', subject: 'Extension request', body: 'Dear Professor…' },
    { kind: 'send_money', to: 'a@b.com' },
    { kind: 'email', subject: '', body: 'no subject' },
    { kind: 'calendar', title: 'Midterm 1', date: '2026-11-12', start: '19:00', end: '21:00' },
    { kind: 'calendar', title: 'Bad date', date: 'next week' },
    { kind: 'calendar', title: 'Office hours', date: '2026-11-03', start: '25:00' },
    { kind: 'email', to: '', subject: 'Fourth', body: 'over the cap' },
  ]);
  expect(actions.map(a => a.kind)).toEqual(['email', 'calendar', 'calendar']);
  expect(actions[0]).toMatchObject({ to: 'prof@emory.edu' });
  // A bad time is dropped, not guessed: an all-day event.
  expect(actions[2]).toEqual({ kind: 'calendar', title: 'Office hours', date: '2026-11-03' });
  expect(parseActions('nonsense')).toEqual([]);
});

test('email and calendar links carry the draft, and nothing else', () => {
  const email = { kind: 'email' as const, to: 'prof@emory.edu', subject: 'HW 6 & extension', body: 'Hi,\nCould I have 2 days?' };
  const gmail = new URL(gmailLink(email));
  expect(gmail.origin).toBe('https://mail.google.com');
  expect(Object.fromEntries(gmail.searchParams)).toMatchObject({ view: 'cm', to: 'prof@emory.edu', su: 'HW 6 & extension', body: 'Hi,\nCould I have 2 days?' });
  expect(mailtoLink(email)).toBe('mailto:prof%40emory.edu?subject=HW%206%20%26%20extension&body=Hi%2C%0ACould%20I%20have%202%20days%3F');

  const timed = new URL(googleCalendarLink({ kind: 'calendar', title: 'Midterm 1', date: '2026-11-12', start: '19:00' }));
  expect(timed.searchParams.get('dates')).toBe('20261112T190000/20261112T200000');
  const allDay = new URL(googleCalendarLink({ kind: 'calendar', title: 'Reading day', date: '2026-12-31' }));
  expect(allDay.searchParams.get('dates')).toBe('20261231/20270101');
});

test('an .ics file escapes what it is given, so a title cannot add fields', () => {
  const ics = icsFile({ kind: 'calendar', title: 'Exam\nATTENDEE:mailto:evil@x.com', date: '2026-11-12', start: '19:00', end: '21:00', details: 'Room 201; bring ID, calculator' }, 'test-uid');
  const lines = ics.split('\r\n');
  expect(lines).toContain('SUMMARY:Exam\\nATTENDEE:mailto:evil@x.com');
  expect(lines.some(l => l.startsWith('ATTENDEE'))).toBe(false);
  expect(lines).toContain('DTSTART:20261112T190000');
  expect(lines).toContain('DTEND:20261112T210000');
  expect(lines).toContain('DESCRIPTION:Room 201\\; bring ID\\, calculator');
});

// ── In the app ──────────────────────────────────────────────────────────────

async function setup(page: Page, opts: { todos?: Row[] } = {}) {
  const state = { chats: [] as Row[], tables: {
    subjects: [{ id: 'cs', user_id: account.id, name: 'CS 170', color: '#42a5f5', archived: false }],
    todos: opts.todos ?? [],
    todo_sessions: [], timer_sessions: [], active_timer: [], documents: [],
  } as Record<string, Row[]> };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, walkthroughCompleted: true, theme: 'light' } } });
    if (table === 'chat_sessions') {
      if (req.method() === 'POST') { const b = req.postDataJSON(); state.chats.push(...(Array.isArray(b) ? b : [b])); }
      return route.fulfill({ json: req.method() === 'GET' ? [] : null });
    }
    if (req.method() === 'GET') return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? (state.tables[table] ?? [])[0] ?? null : state.tables[table] ?? [] });
    return route.fulfill({ json: null });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  return state;
}

const reply = {
  reply: 'I drafted an email to your professor and an event for the midterm. Nothing is sent until you do it.',
  blocks: [],
  actions: [
    { kind: 'email', to: 'prof@emory.edu', subject: 'Extension request for HW 6', body: 'Dear Professor,\n\nCould I have two more days?\n\n[Your name]', why: 'you asked for 2 days' },
    { kind: 'calendar', title: 'CS 170 Midterm 1', date: plus(10), start: '19:00', end: '21:00' },
  ],
};

async function aiPageAnswering(page: Page, body: unknown) {
  const sent: Row[] = [];
  await page.route('**/api/chat', route => {
    const b = route.request().postDataJSON() as Row;
    if (b.purpose === 'triage') return route.fulfill({ json: { content: [{ type: 'text', text: '{"route":"plan","docs":false}' }] } });
    sent.push(b);
    return route.fulfill({ json: { content: [{ type: 'text', text: JSON.stringify(body) }] } });
  });
  return sent;
}

test('a reply with actions shows cards that open the student\'s own mail and calendar', async ({ page }) => {
  await setup(page);
  await aiPageAnswering(page, reply);
  await page.goto('/ai');
  await page.getByPlaceholder('Message Soma…').fill('email my professor for 2 more days on HW 6 and put the midterm on my calendar');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  const email = page.getByRole('region', { name: 'Email draft: Extension request for HW 6' });
  await expect(email).toContainText('you send it');
  await expect(email).toContainText('To: prof@emory.edu');
  const gmail = new URL(await email.getByRole('link', { name: 'Open in Gmail' }).getAttribute('href') ?? '');
  expect(gmail.searchParams.get('su')).toBe('Extension request for HW 6');
  await expect(email.getByRole('link', { name: 'Open in Mail' })).toHaveAttribute('href', /^mailto:prof%40emory\.edu\?/);
  await email.getByRole('button', { name: 'Read draft' }).click();
  await expect(email).toContainText('Could I have two more days?');

  const event = page.getByRole('region', { name: 'Calendar event: CS 170 Midterm 1' });
  await expect(event).toContainText('7:00 PM–9:00 PM');
  await expect(event.getByRole('link', { name: 'Add to Google Calendar' })).toHaveAttribute('href', /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  const download = page.waitForEvent('download');
  await event.getByRole('button', { name: 'Download .ics' }).click();
  expect((await download).suggestedFilename()).toBe('CS 170 Midterm 1.ics');
});

test('the brief shows what is due, changed and slipped, with no AI call until Plan my day', async ({ page }) => {
  await setup(page, { todos: [
    { id: 'hw', user_id: account.id, text: 'Homework 6', subject_id: 'cs', status: 'nothing', date: today, due_date: today, kind: 'homework' },
    { id: 'lab', user_id: account.id, text: 'Lab 7', subject_id: 'cs', status: 'nothing', date: plus(1), due_date: plus(1), kind: 'lab' },
    { id: 'read', user_id: account.id, text: 'Read chapter 9', subject_id: 'cs', status: 'nothing', date: yesterday },
    { id: 'old', user_id: account.id, text: 'Finished thing', subject_id: 'cs', status: 'done', date: yesterday },
  ] });
  const sent = await aiPageAnswering(page, { reply: 'Here is your day.', blocks: [] });
  let chatCalls = 0;
  page.on('request', r => { if (r.url().includes('/api/chat')) chatCalls++; });
  await page.goto('/dashboard');

  const brief = page.getByRole('region', { name: /Here’s your day/ });
  await expect(brief).toContainText('Due today');
  await expect(brief).toContainText('Homework 6 (CS 170)');
  await expect(brief).toContainText('Due tomorrow');
  await expect(brief).toContainText('Lab 7 (CS 170)');
  await expect(brief).toContainText('Didn’t happen yesterday');
  await expect(brief).toContainText('Read chapter 9');
  await expect(brief).not.toContainText('Finished thing');
  // Free: the brief is worked out in the browser.
  await page.waitForTimeout(500);
  expect(chatCalls).toBe(0);

  await brief.getByRole('button', { name: 'Plan my day' }).click();
  await expect(page).toHaveURL(/\/ai$/);
  await expect(page.getByText('Here is your day.')).toBeVisible();
  const asked = (sent[0].messages as { content: string }[]).at(-1)!.content;
  expect(asked).toContain('Plan my day.');
  expect(asked).toContain('Due today: Homework 6 (CS 170).');
  expect(asked).toContain("Didn't happen yesterday: Read chapter 9 (CS 170).");
});

test('the brief can be hidden for the day, and shows nothing when there is nothing to say', async ({ page }) => {
  await setup(page, { todos: [{ id: 'hw', user_id: account.id, text: 'Homework 6', subject_id: 'cs', status: 'nothing', date: today, due_date: today, kind: 'homework' }] });
  await page.goto('/dashboard');
  const brief = page.getByRole('region', { name: /Here’s your day/ });
  await expect(brief).toBeVisible();
  await brief.getByRole('button', { name: 'Hide today’s brief' }).click();
  await expect(brief).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: /Here’s your day/ })).toHaveCount(0);
});

test('nothing due, changed or slipped: no brief', async ({ page }) => {
  await setup(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(page.getByRole('region', { name: /Here’s your day/ })).toHaveCount(0);
});

test('drafts asked for on the dashboard are noted there and kept for the AI page', async ({ page }) => {
  const state = await setup(page);
  await aiPageAnswering(page, reply);
  await page.goto('/dashboard');
  await page.getByLabel('What do you need to work on?').fill('email my professor for an extension');
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect(page.getByRole('log')).toContainText('Drafted email: "Extension request for HW 6"');
  await expect(page.getByRole('log')).toContainText('Open the AI page to send or add them.');
  await expect.poll(() => state.chats.length).toBeGreaterThan(0);
  const saved = state.chats.at(-1)!.messages as { role: string; actions?: unknown[] }[];
  expect(saved.find(m => m.role === 'assistant')!.actions).toHaveLength(2);
});
