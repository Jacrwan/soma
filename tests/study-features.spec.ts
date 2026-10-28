import { test, expect, type Page } from '@playwright/test';
import { validateChatInput } from '../api/chat';
import { createImportHandler } from '../api/import-schedule';

/**
 * Study features (2026-10-25): exam mode from Deadlines, finding dates in an
 * uploaded syllabus, and what each costs: every call is counted against the
 * student's budget, and a course-site or syllabus read stops when the budget
 * is used. Practice questions were removed on 2026-10-28: Soma organizes and
 * writes no study material, which the first test and the server test guard.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const day = new Date();
const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
const plus = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const iso = (t: string) => new Date(`${date}T${t}:00`).toISOString();
type Row = Record<string, unknown>;

const reading = { id: 'doc1', user_id: account.id, subject_id: 'biology', file_name: 'ch4-cells.pdf', storage_path: 'x', file_type: 'application/pdf', size_bytes: 10, doc_type: 'reading', created_at: new Date().toISOString(), extraction_status: 'done', extracted_text: 'Chapter 4. The mitochondria produce ATP through cellular respiration. Ribosomes build proteins from amino acids.' };
const syllabus = { ...reading, id: 'doc2', file_name: 'BIO-syllabus.pdf', doc_type: 'syllabus', extracted_text: 'BIO 101 schedule. Midterm 1 is on the date below, in lecture. Problem set 3 is due the Friday before.' };

async function setup(page: Page, opts: { docs?: Row[]; todos?: Row[] } = {}) {
  const state = { tables: {
    subjects: [{ id: 'biology', user_id: account.id, name: 'Biology', color: '#66bb6a', archived: false }],
    todos: opts.todos ?? [{ id: 'review', user_id: account.id, text: 'Cell review', subject_id: 'biology', status: 'nothing', date, estimated_minutes: 45 }],
    todo_sessions: [{ id: 's1', user_id: account.id, todo_id: 'review', date, start_time: iso('09:00'), end_time: iso('09:45') }],
    timer_sessions: [], active_timer: [], documents: opts.docs ?? [reading],
  } as Record<string, Row[]> };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, walkthroughCompleted: true, theme: 'light' } } });
    if (req.method() === 'GET') {
      let rows = state.tables[table] ?? [];
      for (const k of ['id', 'todo_id', 'date']) { const f = url.searchParams.get(k); if (f?.startsWith('eq.')) rows = rows.filter(r => String(r[k]) === f.slice(3)); }
      return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
    }
    if (req.method() === 'POST') { const b = req.postDataJSON(); for (const it of (Array.isArray(b) ? b : [b]) as Row[]) { const cur = state.tables[table] ?? []; state.tables[table] = [...cur.filter(r => table === 'active_timer' ? r.user_id !== it.user_id : r.id !== it.id), it]; } }
    return route.fulfill({ json: null });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  return state;
}

test('focus: a block in progress offers no AI-written practice and makes no AI call', async ({ page }) => {
  // Soma organizes; it doesn't write study material (owner's call, 2026-10-28).
  await setup(page);
  let calls = 0;
  await page.route('**/api/chat', route => { calls++; return route.fulfill({ json: { content: [{ type: 'text', text: '{}' }] } }); });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Start focus: Cell review', exact: true }).click();
  const focus = page.getByLabel('Focus timer');
  await expect(focus).toContainText('Cell review');
  await expect(page.getByRole('button', { name: /practice/i })).toHaveCount(0);
  await expect(page.getByRole('region', { name: /practice/i })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(calls).toBe(0);
});

test('exam mode: Plan review on an exam asks Soma for review across the days before', async ({ page }) => {
  await setup(page, { todos: [{ id: 'mt1', user_id: account.id, text: 'Midterm 1', subject_id: 'biology', status: 'nothing', date: plus(6), due_date: plus(6), kind: 'exam' }] });
  const asked: string[] = [];
  await page.route('**/api/chat', route => {
    const body = route.request().postDataJSON() as { purpose?: string; messages: { content: string }[] };
    if (body.purpose === 'triage') return route.fulfill({ json: { content: [{ type: 'text', text: '{"route":"plan","docs":true}' }] } });
    asked.push(body.messages.at(-1)!.content);
    return route.fulfill({ json: { content: [{ type: 'text', text: '{"reply":"Here\'s a review plan.","blocks":[]}' }] } });
  });
  await page.goto('/deadlines');
  await page.getByRole('button', { name: 'Plan review for Midterm 1' }).click();
  await expect(page).toHaveURL(/\/ai$/);
  await expect(page.getByText('Here\'s a review plan.')).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatch(/^Plan my review for "Midterm 1" in Biology, on \w{3}, \w{3} \d+\.$/);
  // Sent once: a reload doesn't send it again.
  await page.reload();
  await page.waitForTimeout(500);
  expect(asked).toHaveLength(1);
});

test('syllabus: Find dates reads the uploaded document through the importer and offers what it found', async ({ page }) => {
  await setup(page, { docs: [syllabus] });
  let sent: Row | undefined;
  await page.route('**/api/import-schedule', route => {
    sent = route.request().postDataJSON() as Row;
    return route.fulfill({ json: { course: 'BIO 101', source: null, truncated: false, items: [
      { title: 'Midterm 1', type: 'exam', due: plus(10), time: '10:00', evidence: 'Midterm 1 is on' },
      { title: 'Problem set 3', type: 'homework', due: plus(7), time: null, evidence: 'Problem set 3 is due' },
    ] } });
  });
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Find dates' }).click();
  const panel = page.getByRole('region', { name: 'Find dates in BIO-syllabus.pdf' });
  await panel.getByRole('button', { name: 'Find deadlines' }).click();
  await expect(panel).toContainText('Midterm 1');
  await expect(panel).toContainText('Problem set 3');
  expect(sent).toMatchObject({ text: syllabus.extracted_text });
});

// ── Cost, on the server ─────────────────────────────────────────────────────

test('the server refuses a study request: Soma writes no study material', async () => {
  expect(validateChatInput({ messages: [{ role: 'user', content: 'Course: Biology' }], systemPrompt: 'Write questions', purpose: 'study' })).toBe('invalid_purpose');
  expect(validateChatInput({ messages: [{ role: 'user', content: 'hi' }], purpose: 'triage' })).toBeNull();
});

test('reading a course site or syllabus stops at the budget, and is counted when it runs', async () => {
  const recorded: unknown[][] = [];
  let modelCalls = 0;
  const make = (used: number) => createImportHandler({
    authorize: async () => ({ ok: true, userId: 'u' }), apiKey: () => 'k', limited: () => false,
    budget: async () => ({ used, available: 4, resetsAt: '', trial: false }) as never,
    record: async (...a: unknown[]) => { recorded.push(a); }, defer: t => { void t; },
    model: async () => { modelCalls++; return { text: '{"course":null,"items":[]}', model: 'claude-sonnet-5-5', usage: { input_tokens: 9000, output_tokens: 300 } }; },
  });
  const out: { status?: number; body?: unknown } = {};
  const res = { status(s: number) { out.status = s; return res; }, json(b: unknown) { out.body = b; return res; }, setHeader() {} };
  const body = { text: 'Midterm 1 is on Nov 12. Homework 4 due Nov 5.', today: '2026-10-25' };
  await make(4.2)({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, res);
  expect(out).toMatchObject({ status: 402, body: { error: 'ai_budget_used' } });
  expect(modelCalls).toBe(0);
  await make(1)({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, res);
  expect(out.status).toBe(200);
  expect(recorded).toHaveLength(1);
  expect(recorded[0].slice(1, 3)).toEqual(['reply', 'claude-sonnet-5-5']);
});
