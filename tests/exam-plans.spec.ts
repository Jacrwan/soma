import { test, expect, type Page } from '@playwright/test';
import {
  blockTitle, busyDays, byPriority, clampPriority, dayCapacity, draftsFromBraindump, examLines,
  placeBlocks, readStudyList, sittings, type ExamPlan,
} from '../src/lib/examPlan';
import type { CourseItem } from '../src/lib/courseItems';
import type { Snapshot } from '../src/components/DashboardV2/liveData';
import type { SomaSettings } from '../src/lib/storage';
import { triaged } from './triage';

/**
 * Exam prep v1: durable coverage list with 1–5 priority, braindump-first
 * drafting, place ~today/~this week by priority — never after the exam.
 */

const settings = { studyWindow: { start: '08:00', end: '23:00' }, chunks: { min: 30 }, theme: 'light', timeFormat: '12h' } as SomaSettings;
const empty = (blocks: Snapshot['blocks'] = []): Snapshot => ({ blocks, subjects: [], todos: [], sessions: [], history: [], calendarError: '', items: [] });
const exam: ExamPlan = { id: 'exam-1', subjectId: 'calc', title: 'Calc midterm', examDate: '2026-11-14' };
const item = (id: string, minutes: number, extra: Partial<CourseItem> = {}): CourseItem =>
  ({ id, subjectId: 'calc', examId: 'exam-1', label: `Item ${id}`, position: Number(id.replace(/\D/g, '')) || 0, minutes, priority: 3, ...extra });

test('the model\'s list is checked: named, sized, prioritized, linked only to a file it names exactly', () => {
  const docs = [{ id: 'd1', fileName: 'Worksheet 3.pdf' }, { id: 'd2', fileName: 'Practice Midterm A.pdf' }];
  const { items, note } = readStudyList('```json\n' + JSON.stringify({
    note: 'Followed your braindump; confirmed Worksheet 3 from the PDF.',
    items: [
      { label: 'Worksheet 3', detail: 'do problems 1–12 on related rates', minutes: 47, priority: 5, source: 'Worksheet 3.pdf' },
      { label: 'worksheet 3', minutes: 30, priority: 2 },
      { label: '', minutes: 30 },
      { label: 'Practice midterm A', minutes: 900, priority: 9, source: 'Practice Midterm A' },
      { label: 'Kinematics redo', minutes: 'soon', priority: 0 },
    ],
  }) + '\n```', docs);
  expect(items).toEqual([
    { label: 'Worksheet 3', detail: 'do problems 1–12 on related rates', minutes: 45, priority: 5, documentId: 'd1' },
    { label: 'Practice midterm A', minutes: 240, priority: 5 },
    { label: 'Kinematics redo', minutes: 45, priority: 1 },
  ]);
  expect(note).toMatch(/braindump/i);
  expect(clampPriority(99)).toBe(5);
  expect(clampPriority(-1)).toBe(1);
  expect(() => readStudyList('Sure! Here is your plan.', docs)).toThrow(/couldn't make a study list/);
});

test('a braindump becomes editable drafts without an AI call', () => {
  const drafts = draftsFromBraindump('Read Ch 4–5\n- Do Worksheet 3 #1–12\n\nTimed practice midterm A');
  expect(drafts.map(d => d.label)).toEqual(['Read Ch 4–5', 'Do Worksheet 3 #1–12', 'Timed practice midterm A']);
  expect(drafts.every(d => d.priority === 3 && d.minutes === 45)).toBe(true);
});

test('busy days are the day before another exam or quiz and its own day; the exam itself doesn\'t count', () => {
  const busy = busyDays([
    { title: 'Physics quiz 4', due: '2026-11-09', kind: 'quiz' },
    { title: 'Chem quiz', due: '2026-11-10T09:00:00Z' },
    { title: 'Problem set 5', due: '2026-11-11', kind: 'homework' },
    { title: 'Calc midterm', due: '2026-11-14', kind: 'exam' },
  ], '2026-11-07', '2026-11-13', 'Calc midterm');
  expect([...busy.keys()].sort()).toEqual(['2026-11-08', '2026-11-09', '2026-11-10']);
  expect(dayCapacity(300, true)).toBeLessThan(dayCapacity(300, false));
});

test('higher priority items place first; nothing lands on or after the exam', () => {
  const origin = new Date(2026, 10, 7, 0, 0);
  const now = new Date(2026, 10, 7, 9, 0);
  const items = [
    item('i1', 60, { priority: 2, label: 'Stretch' }),
    item('i2', 60, { priority: 5, label: 'Worksheet 3', title: 'do problems 1–12' }),
    item('i3', 45, { priority: 5, label: 'Practice A', doneAt: '2026-11-06T10:00:00Z' }),
    item('i4', 40, { priority: 4, label: 'Redo quiz', todoId: 'planned-todo' }),
    item('i5', 90, { priority: 4, label: 'Ch 4–5', title: 'read momentum' }),
  ];
  const ahead = { id: 'b1', title: 'Calc midterm: Redo quiz', subject: 'Calc', time: '20:00–20:40', minutes: 40, color: 'blue', state: 'Planned', day: 2, todoId: 'planned-todo' } as Snapshot['blocks'][number];
  const { blocks, placed } = placeBlocks(exam, items, empty([ahead]), origin, settings, { name: 'Calc', color: 'blue' }, 'week', new Map(), now);
  expect(blocks[0].title).toBe('Calc midterm: Worksheet 3 — do problems 1–12');
  expect(blocks.some(b => b.title.includes('Stretch'))).toBe(true);
  expect(blocks.findIndex(b => b.title.includes('Worksheet 3'))).toBeLessThan(blocks.findIndex(b => b.title.includes('Stretch')));
  expect(blocks.every(b => b.day < 7)).toBe(true);
  expect([...placed.values()].every(d => d < exam.examDate)).toBe(true);
  expect(blocks.some(b => b.title.includes('Redo quiz'))).toBe(false);
  expect(blocks.some(b => b.title.includes('Practice A'))).toBe(false);
});

test('today horizon never schedules past today, and sittings stay under two hours', () => {
  const origin = new Date(2026, 10, 7, 0, 0);
  const now = new Date(2026, 10, 7, 9, 0);
  const items = [item('i1', 50, { priority: 5 }), item('i2', 50, { priority: 5 }), item('i3', 60, { priority: 4 }), item('i4', 30, { priority: 3 })];
  expect(sittings(items).map(g => g.map(i => i.id))).toEqual([['i1', 'i2'], ['i3', 'i4']]);
  const { blocks } = placeBlocks(exam, items, empty(), origin, settings, { name: 'Calc', color: 'blue' }, 'today', new Map(), now);
  expect(blocks.every(b => b.day === 0)).toBe(true);
  expect(blockTitle('Calc midterm', [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }])).toBe('Calc midterm: A, B +2 more');
});

test('byPriority sorts high first; examLines expose open items with short ids', () => {
  const items = [item('a', 30, { priority: 2, position: 0 }), item('b', 30, { priority: 5, position: 1 }), item('c', 30, { priority: 5, position: 0 })];
  expect([...items].sort(byPriority).map(i => i.id)).toEqual(['c', 'b', 'a']);
  const ids = new Map<string, string>();
  const lines = examLines([exam], items, [{ id: 'calc', name: 'Calc' }], '2026-11-07', ids);
  expect(lines[0].before).toBe('2026-11-13');
  expect(lines[0].open?.[0]).toMatch(/^i1 Item c/);
  expect(ids.get('i1')).toBe('c');
});

// ---------- browser: Documents → Plan an exam ----------

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOff = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return key(d); };
type Row = Record<string, unknown>;
const doc = (id: string, name: string, type: string, text: string) => ({ id, user_id: account.id, subject_id: 'calc', file_name: name, storage_path: `x/${id}`, file_type: 'application/pdf', size_bytes: 10, doc_type: type, created_at: new Date().toISOString(), extraction_status: 'done', extracted_text: text });

function data(): Record<string, Row[]> {
  return {
    subjects: [{ id: 'calc', user_id: account.id, name: 'Calc 1A', color: '#ab47bc', archived: false }],
    todos: [{ id: 't-exam', user_id: account.id, text: 'Calc midterm', subject_id: 'calc', status: 'nothing', date: dayOff(0), due_date: dayOff(6), kind: 'exam' }],
    todo_sessions: [], timer_sessions: [], exam_plans: [],
    documents: [
      doc('d-ws', 'Worksheet 3.pdf', 'assignment', 'Worksheet 3: related rates, problems 1-12'),
      doc('d-pm', 'Practice Midterm A.pdf', 'guide', 'Practice midterm A, 6 questions'),
    ],
    course_items: [],
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
async function setup(page: Page, reply: (body: Chat) => unknown) {
  const db = data();
  const state = { db, chats: [] as Chat[] };
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
      db[table] = rows.filter(r => !gone.includes(r));
      return route.fulfill({ json: gone.map(r => ({ id: r.id })) });
    }
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    const out = matching(rows ?? [], url.searchParams);
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? out[0] ?? null : out });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/memory', r => r.fulfill({ json: { revision: 0, enabled: true, entries: [] } }));
  await page.route('**/api/notes', r => r.fulfill({ json: { notes: [] } }));
  await page.route('**/api/extract-document', r => r.fulfill({ json: {} }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/chat', route => {
    if (triaged(route)) return;
    const body = route.request().postDataJSON() as Chat;
    state.chats.push(body);
    const out = reply(body);
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    return route.fulfill({ json: { content: [{ type: 'text', text }] } });
  });
  return state;
}

test('Documents: braindump + files → approve list with priorities → Add this week', async ({ page }) => {
  const state = await setup(page, () => ({
    note: 'Followed your braindump; confirmed Worksheet 3 from the PDF.',
    items: [
      { label: 'Worksheet 3', detail: 'do problems 1–12', minutes: 45, priority: 5, source: 'Worksheet 3.pdf' },
      { label: 'Practice midterm A', detail: 'timed run', minutes: 90, priority: 4, source: 'Practice Midterm A.pdf' },
    ],
  }));
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Plan an exam' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan an exam' });
  await dialog.locator('textarea').fill('Worksheet 3 problems\nPractice midterm A timed');
  await dialog.getByRole('button', { name: 'Make my study checklist' }).click();
  await expect(dialog.getByText(/Followed your braindump/i)).toBeVisible();
  await expect(dialog.getByRole('row', { name: /Worksheet 3/ }).getByLabel('What')).toHaveValue('Worksheet 3');
  await dialog.getByRole('button', { name: 'Approve checklist' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Exam study plans' })).toBeVisible();
  await expect(page.getByText('Calc midterm').first()).toBeVisible();
  expect(state.db.exam_plans).toHaveLength(1);
  expect(state.db.course_items.map(r => r.priority).sort()).toEqual([4, 5]);
  // Approve opens the plan; if the row is collapsed, expand it.
  const addWeek = page.getByRole('button', { name: 'Add this week to my plan' });
  if (!await addWeek.isVisible()) await page.getByRole('button', { name: /Calc midterm/ }).click();
  await addWeek.click();
  await expect(page.getByText(/waiting on your plan/i)).toBeVisible();
});

test('Soma sees exams in context and EXAM STUDY PLANS in the prompt', async ({ page }) => {
  const state = await setup(page, () => ({ reply: 'Planned from your list.', blocks: [] }));
  state.db.exam_plans.push({ id: 'exam-1', user_id: account.id, subject_id: 'calc', title: 'Calc midterm', exam_date: dayOff(6), todo_id: 't-exam' });
  state.db.course_items.push({ id: 'e1', user_id: account.id, subject_id: 'calc', exam_id: 'exam-1', label: 'Worksheet 3', title: 'do problems 1–12', position: 0, minutes: 45, priority: 5, done_at: null });
  await page.goto('/dashboard');
  await page.getByLabel('What do you need to work on?').fill('plan calc midterm study');
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect.poll(() => state.chats.some(c => typeof c.systemPrompt === 'string' && c.systemPrompt.includes('EXAM STUDY PLANS'))).toBe(true);
  const planChat = state.chats.find(c => typeof c.systemPrompt === 'string' && c.systemPrompt.includes('EXAM STUDY PLANS'));
  expect(JSON.stringify(planChat)).toMatch(/Worksheet 3/);
});
