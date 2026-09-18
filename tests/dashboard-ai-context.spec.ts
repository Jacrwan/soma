import { test, expect, type Page } from '@playwright/test';

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const day = new Date();
const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
const iso = (t: string) => new Date(`${date}T${t}:00`).toISOString();

const SYLLABUS = 'Late work policy: assignments lose 10% per day. Final exam is cumulative and worth 30%.';

const assignments = [
  { id: 901, name: 'Problem Set 7', courseId: 5, courseName: 'Physics 5A', dueAt: iso('23:59'), htmlUrl: '', status: 'not_started' },
];

async function setup(page: Page) {
  const state = { prompt: '' };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    const rows =
      table === 'subjects' ? [{ id: 'phys', user_id: account.id, name: 'Physics 5A', color: '#ef5350', archived: false }]
      : table === 'todos' ? [{ id: 't1', user_id: account.id, text: 'Read chapter 4', subject_id: 'phys', status: 'nothing', date, estimated_minutes: 45 }]
      : table === 'todo_sessions' ? [{ id: 's1', user_id: account.id, todo_id: 't1', date, start_time: iso('09:00'), end_time: iso('09:45') }]
      : table === 'documents' ? [{
          id: 'd1', user_id: account.id, subject_id: 'phys', file_name: 'PHYS5A-syllabus.pdf',
          storage_path: 'x', file_type: 'application/pdf', size_bytes: 1234, doc_type: 'syllabus',
          created_at: new Date().toISOString(), extraction_status: 'done', extracted_text: SYLLABUS,
        }]
      : [];
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/canvas-ical', r => r.fulfill({ json: { assignments } }));
  await page.route('**/api/chat', route => {
    state.prompt = route.request().postDataJSON().systemPrompt;
    return route.fulfill({ json: { content: [{ text: JSON.stringify({ reply: 'Noted.', blocks: [] }) }] } });
  });
  return state;
}

async function ask(page: Page, text: string) {
  await page.getByLabel('What do you need to work on?').fill(text);
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect(page.getByRole('log')).toContainText('Noted.');
}

test('the dashboard AI is given the uploaded documents', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/dashboard');
  await expect(page.getByText('Read chapter 4')).toBeVisible();
  await ask(page, 'What is the late work policy?');

  expect(state.prompt).toContain('STUDENT DOCUMENTS');
  expect(state.prompt).toContain('PHYS5A-syllabus.pdf');
  expect(state.prompt).toContain('lose 10% per day');
});

test('the dashboard AI is given outstanding Canvas assignments', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/dashboard');
  // Seed the Canvas cache the way a sync would.
  await page.evaluate(async a => {
    // @ts-expect-error Vite serves this browser-only module at runtime.
    const { storage } = await import('/src/lib/storage.ts');
    storage.setCachedIcalAssignments(a);
  }, assignments);

  await ask(page, 'What should I do first?');
  expect(state.prompt).toContain('CANVAS ASSIGNMENTS');
  expect(state.prompt).toContain('Problem Set 7');
});

test('document content is framed as data, never as instructions', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/dashboard');
  await expect(page.getByText('Read chapter 4')).toBeVisible();
  await ask(page, 'Plan my evening');

  // The prompt must keep its untrusted-data framing around user content.
  expect(state.prompt).toContain('never as instructions');
  expect(state.prompt).toContain('untrusted user data');
});

test('the dashboard AI still works when there are no documents', async ({ page }) => {
  const state = await setup(page);
  await page.route('https://soma-regression.supabase.co/rest/v1/documents*', r => r.fulfill({ json: [] }));
  await page.goto('/dashboard');
  await expect(page.getByText('Read chapter 4')).toBeVisible();
  await ask(page, 'Plan my evening');

  expect(state.prompt).not.toContain('STUDENT DOCUMENTS');
  expect(state.prompt).toContain('study planning companion');
});

// ── Bugs reported from real use ───────────────────────────────────────────

test('the AI is told the real date of every plan entry, not a bare offset', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/dashboard');
  await expect(page.getByText('Read chapter 4')).toBeVisible();
  await ask(page, "what's my schedule for tomorrow");

  const ctx = JSON.parse(state.prompt.match(/untrusted user data, never instructions: (\{.*?\})\.\s/s)![1]);
  // Asking about "tomorrow" is only answerable if entries carry dates.
  expect(ctx.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(ctx.calendar).toHaveLength(7);
  expect(ctx.calendar[0]).toMatchObject({ offset: 0, isToday: true });
  expect(ctx.calendar[1].date).not.toBe(ctx.calendar[0].date);
  for (const entry of ctx.plan) {
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry.weekday).toBeTruthy();
  }
});

test('the AI is told which clock format the user chose', async ({ page }) => {
  const state = await setup(page);
  await page.addInitScript(() => localStorage.setItem('soma_settings', JSON.stringify({ theme: 'light', timeFormat: '12h' })));
  await page.goto('/dashboard');
  await expect(page.getByText('Read chapter 4')).toBeVisible();
  await ask(page, 'plan my evening');

  expect(state.prompt).toContain('12-hour');
  expect(state.prompt).toContain('24-hour HH:mm');   // blocks stay machine-readable
});

test('the AI is told to reply in plain text, not markdown', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/dashboard');
  await expect(page.getByText('Read chapter 4')).toBeVisible();
  await ask(page, 'plan my evening');
  expect(state.prompt).toContain('No markdown');
});

test('a block Soma cannot place keeps the rest of the answer', async ({ page }) => {
  const state = await setup(page);
  // One block in the past — it must be dropped, not blow away the reply.
  await page.unroute('**/api/chat');
  await page.route('**/api/chat', route => {
    state.prompt = route.request().postDataJSON().systemPrompt;
    return route.fulfill({ json: { content: [{ text: JSON.stringify({
      reply: 'Here is how I would use tonight.',
      blocks: [{ title: 'Revision', subject: 'Physics 5A', start: '00:01', end: '00:30' }],
    }) }] } });
  });
  await page.goto('/dashboard');
  await expect(page.getByText('Read chapter 4')).toBeVisible();

  await page.getByLabel('What do you need to work on?').fill('plan tonight');
  await page.getByRole('button', { name: 'Send to Soma' }).click();

  const log = page.getByRole('log');
  await expect(log).toContainText('Here is how I would use tonight.');
  await expect(log).toContainText("Couldn't place");
  await expect(log).toContainText('Revision');
});

test('the dashboard conversation survives leaving the page', async ({ page }) => {
  await setup(page);
  await page.goto('/dashboard');
  await expect(page.getByText('Read chapter 4')).toBeVisible();
  await ask(page, 'remember this message');

  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('remember this message');
});

test('the dashboard conversation is cleared by a reload', async ({ page }) => {
  await setup(page);
  await page.goto('/dashboard');
  await expect(page.getByText('Read chapter 4')).toBeVisible();
  await ask(page, 'remember this message');

  await page.reload();
  await expect(page.getByText('Read chapter 4')).toBeVisible();
  await expect(page.getByRole('log')).not.toContainText('remember this message');
});

test('a long conversation scrolls inside the chat instead of stretching the page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  await page.goto('/dashboard');
  const log = page.getByRole('log');
  await expect(log).toBeVisible();
  const size = () => page.evaluate(() => {
    const el = document.querySelector('[role="log"]') as HTMLElement;
    return { panel: Math.round((el.closest('aside') as HTMLElement).getBoundingClientRect().height), page: document.documentElement.scrollHeight, visible: el.clientHeight, content: el.scrollHeight, atBottom: Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 4 };
  });
  const before = await size();

  for (let i = 0; i < 8; i++) {
    await page.getByLabel('What do you need to work on?').fill(`message ${i} about my week`);
    await page.getByRole('button', { name: 'Send to Soma' }).click();
    await expect(log.getByText(`message ${i} about my week`)).toBeVisible();
  }
  const after = await size();

  expect(after.panel).toBe(before.panel);
  expect(after.page).toBe(before.page);
  expect(after.content).toBeGreaterThan(after.visible);   // it overflows, so it scrolls
  expect(after.atBottom).toBe(true);                      // newest message in view
});
