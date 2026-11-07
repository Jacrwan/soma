import { test, expect, type Page } from '@playwright/test';
import { triaged } from './triage';

/**
 * Kept from exam study plans (built and taken out 2026-11-06):
 * - a Soma study block named after an exam task ("Calc midterm: Worksheet 3")
 *   is new work, never that exam task moved into the study slot;
 * - rows left in course_items by exam study plans (they have an exam_id)
 *   aren't reading-list sections, and rebuilding a reading list leaves them be.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOff = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return key(d); };
type Row = Record<string, unknown>;
const doc = (id: string, name: string, type: string, text: string) => ({ id, user_id: account.id, subject_id: 'calc', file_name: name, storage_path: `x/${id}`, file_type: 'application/pdf', size_bytes: 10, doc_type: type, created_at: new Date().toISOString(), extraction_status: 'done', extracted_text: text });

function data(): Record<string, Row[]> {
  return {
    subjects: [{ id: 'calc', user_id: account.id, name: 'Calc 1A', color: '#ab47bc', archived: false }],
    todos: [{ id: 't-exam', user_id: account.id, text: 'Calc midterm', subject_id: 'calc', status: 'nothing', date: dayOff(0), due_date: dayOff(6), kind: 'exam' }],
    todo_sessions: [], timer_sessions: [],
    documents: [
      doc('d-ws', 'Worksheet 3.pdf', 'assignment', 'Worksheet 3: related rates, problems 1-12'),
      doc('d-pm', 'Practice Midterm A.pdf', 'guide', 'Practice midterm A, 6 questions'),
      doc('d-syl', 'Calc syllabus.pdf', 'syllabus', 'Midterm covers chapters 2-3. Reading: 2.1 Limits, 2.2 Continuity'),
    ],
    course_items: [{ id: 'r1', user_id: account.id, subject_id: 'calc', label: '2.1', title: 'Limits', position: 0, done_at: null, todo_id: null }],

  };
}

function matching(rows: Row[], params: URLSearchParams) {
  return rows.filter(r => [...params].every(([k, v]) => {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map(x => x.replace(/"/g, '')).includes(String(r[k]));
    return true;
  }));
}

type Chat = { purpose?: string; systemPrompt?: unknown; context?: string; messages: { content: string }[] };
async function setup(page: Page, reply: (body: Chat) => unknown, edit?: (db: Record<string, Row[]>) => void) {
  const db = data();
  edit?.(db);
  const state = { db, chats: [] as Chat[], deletes: [] as string[] };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (url.pathname.includes('/storage/v1/')) return route.fulfill({ json: {} });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light', studyWindow: { start: '08:00', end: '23:00' } } } });
    const rows = db[table];
    if (req.method() === 'POST' && rows) {
      const b = req.postDataJSON();
      for (const r of (Array.isArray(b) ? b : [b]) as Row[]) { const i = rows.findIndex(x => x.id === r.id); if (i < 0) rows.push(r); else rows[i] = { ...rows[i], ...r }; }
      return route.fulfill({ json: null });
    }
    if (req.method() === 'PATCH' && rows) {
      for (const r of matching(rows, url.searchParams)) Object.assign(r, req.postDataJSON());
      return route.fulfill({ json: null });
    }
    if (req.method() === 'DELETE' && rows) {
      const gone = matching(rows, url.searchParams);
      state.deletes.push(...gone.map(r => `${table}:${r.id}`));
      db[table] = rows.filter(r => !gone.includes(r));
      return route.fulfill({ json: gone.map(r => ({ id: r.id })) });
    }
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    const out = matching(rows ?? [], url.searchParams);
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? out[0] ?? null : out });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/memory', r => r.fulfill({ json: { revision: 0, enabled: true, entries: [] } }));
  await page.route('**/api/extract-document', r => r.fulfill({ json: {} }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/chat', route => { if (triaged(route)) return;
    const body = route.request().postDataJSON() as Chat;
    state.chats.push(body);
    return route.fulfill({ json: { content: [{ text: JSON.stringify(reply(body)) }] } });
  });
  return state;
}


test('a study block named after an exam task is new work; the exam task stays where it is', async ({ page }) => {
  const state = await setup(page, () => ({ reply: 'Planned.', blocks: [{ title: 'Calc midterm: Worksheet 3', subject: 'Calc 1A', date: dayOff(1), minutes: 60 }] }));
  await page.goto('/dashboard');
  await page.getByLabel('What do you need to work on?').fill('plan my week');
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.todos.some(r => r.text === 'Calc midterm: Worksheet 3')).toBe(true);
  const exam = state.db.todos.find(r => r.id === 't-exam')!;
  expect(exam.text).toBe('Calc midterm');
  expect(exam.date).toBe(dayOff(0));
  expect(exam.time ?? null).toBeNull();
});

test('leftover exam study rows aren\'t reading sections, and a reading-list rebuild leaves them be', async ({ page }) => {
  const state = await setup(page, body => JSON.stringify(body.systemPrompt).includes('reading guide') ? { items: [{ label: '2.1', title: 'Limits' }, { label: '2.2', title: 'Continuity' }] } : { reply: 'ok' }, db => {
    db.course_items.push({ id: 'e1', user_id: account.id, subject_id: 'calc', exam_id: 'exam-1', label: 'Worksheet 3', position: 0, minutes: 60, study_day: dayOff(1), done_at: null, todo_id: null });
  });
  await page.goto('/documents');
  await expect(page.getByText('Limits').first()).toBeVisible();
  await expect(page.getByText('Worksheet 3', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Build from a document' }).click();
  const dialog = page.getByRole('dialog', { name: 'Build a reading list' });
  await dialog.getByLabel('Document').selectOption('d-syl');
  await dialog.getByRole('button', { name: 'Find sections' }).click();
  await dialog.getByRole('button', { name: 'Save reading list' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.deletes).not.toContain('course_items:e1');
  expect(state.db.course_items.filter(r => !r.exam_id).map(r => r.label).sort()).toEqual(['2.1', '2.2']);
});
