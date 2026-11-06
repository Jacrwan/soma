import { test, expect, type Page } from '@playwright/test';
import { blockTitle, busyDays, capacityOf, examLines, planDays, readStudyList, sittings, weekBlocks, type ExamPlan } from '../src/lib/examPlan';
import type { CourseItem } from '../src/lib/courseItems';
import type { Snapshot } from '../src/components/DashboardV2/liveData';
import type { SomaSettings } from '../src/lib/storage';
import { triaged } from './triage';

/**
 * Exam study plans (2026-11-06). The owner: quizzes Monday to Wednesday make
 * Sunday to Tuesday busy, and Wednesday to Saturday get wasted. Soma makes a
 * concrete list from their materials (worksheets, practice exams by name),
 * they approve it, it's spread over the days before the exam with less on
 * busy days, and a week at a time goes onto the plan to Accept.
 */

// ---------- the logic, without a browser ----------

const settings = { studyWindow: { start: '08:00', end: '23:00' }, chunks: { min: 30 }, theme: 'light', timeFormat: '12h' } as SomaSettings;
const empty = (blocks: Snapshot['blocks'] = []): Snapshot => ({ blocks, subjects: [], todos: [], sessions: [], history: [], calendarError: '', items: [] });
const exam: ExamPlan = { id: 'exam-1', subjectId: 'calc', title: 'Calc midterm', examDate: '2026-11-14' };
const item = (id: string, studyDay: string, minutes: number, extra: Partial<CourseItem> = {}): CourseItem =>
  ({ id, subjectId: 'calc', examId: 'exam-1', label: `Item ${id}`, position: Number(id.replace(/\D/g, '')) || 0, studyDay, minutes, ...extra });

test('the model\'s list is checked: named, sized, deduplicated, linked only to a file it names exactly', () => {
  const docs = [{ id: 'd1', fileName: 'Worksheet 3.pdf' }, { id: 'd2', fileName: 'Practice Midterm A.pdf' }];
  const list = readStudyList('```json\n' + JSON.stringify({ items: [
    { label: 'Worksheet 3', detail: 'problems 1–12: related rates', minutes: 47, source: 'Worksheet 3.pdf' },
    { label: 'worksheet 3', minutes: 30 },                                    // a repeat
    { label: '', minutes: 30 },                                               // no name
    { label: 'Practice midterm A', minutes: 900, source: 'Practice Midterm A' }, // name not exact
    { label: 'Kinematics redo', minutes: 'soon' },
  ] }) + '\n```', docs);
  expect(list).toEqual([
    { label: 'Worksheet 3', detail: 'problems 1–12: related rates', minutes: 45, documentId: 'd1' },
    { label: 'Practice midterm A', minutes: 240 },
    { label: 'Kinematics redo', minutes: 45 },
  ]);
  expect(() => readStudyList('Sure! Here is your plan.', docs)).toThrow(/couldn't make a study list/);
  expect(() => readStudyList('{"items":[]}', docs)).toThrow(/couldn't make a study list/);
});

test('busy days are the day before another exam or quiz and its own day; the exam itself doesn\'t count', () => {
  const busy = busyDays([
    { title: 'Physics quiz 4', due: '2026-11-09', kind: 'quiz' },        // Mon
    { title: 'Chem quiz', due: '2026-11-10T09:00:00Z' },                  // Tue, by its name
    { title: 'Problem set 5', due: '2026-11-11', kind: 'homework' },      // not a test
    { title: 'Calc midterm', due: '2026-11-14', kind: 'exam' },           // this exam
  ], '2026-11-07', '2026-11-13', 'Calc midterm');
  expect([...busy.keys()].sort()).toEqual(['2026-11-08', '2026-11-09', '2026-11-10']);
  expect(busy.get('2026-11-09')).toBe('Physics quiz 4 Mon, Chem quiz Tue');
});

test('the owner\'s week: little on the busy days before quizzes, most on the open days after, in order', () => {
  // Sat Nov 7 … Fri Nov 13, exam Sat Nov 14. Quizzes Mon–Wed make Sun–Tue busy.
  const rooms = [
    { date: '2026-11-07', free: 300 }, { date: '2026-11-08', free: 300, busy: 'Physics quiz Mon' },
    { date: '2026-11-09', free: 240, busy: 'Physics quiz Mon, Chem quiz Tue' }, { date: '2026-11-10', free: 240, busy: 'Chem quiz Tue, Bio quiz Wed' },
    { date: '2026-11-11', free: 360 }, { date: '2026-11-12', free: 360 }, { date: '2026-11-13', free: 300 },
  ];
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, minutes: i === 11 ? 120 : 60 }));
  const plan = planDays(items, rooms);
  const load = (day: string) => items.filter(i => plan.assign.get(i.id) === day).reduce((n, i) => n + i.minutes, 0);
  for (const busy of ['2026-11-08', '2026-11-09', '2026-11-10']) expect(load(busy)).toBeLessThan(load('2026-11-11'));
  expect(load('2026-11-11') + load('2026-11-12')).toBeGreaterThanOrEqual(240);
  // Order is kept: days never go backwards down the list.
  const days = items.map(i => plan.assign.get(i.id)!);
  expect([...days].sort()).toEqual(days);
  // Nothing on the exam day or after, every item has a day.
  expect(days.every(d => d >= '2026-11-07' && d <= '2026-11-13')).toBe(true);
  expect(plan.reason).toMatch(/^Light on Sun, Mon and Tue, with Physics quiz Mon, Chem quiz Tue and Bio quiz Wed\./);
  expect(plan.reason).toMatch(/Most on Wed and Thu/);
  expect(plan.over).toBe(0);
});

test('a list longer than the open time fills every day and says by how much; full days are spread evenly', () => {
  const rooms = [{ date: '2026-11-07', free: 120 }, { date: '2026-11-08', free: 120 }];
  expect(capacityOf(rooms[0])).toBe(60);
  const long = planDays([{ id: 'a', minutes: 120 }, { id: 'b', minutes: 120 }], rooms);
  expect(long.over).toBe(120);
  expect([long.assign.get('a'), long.assign.get('b')]).toEqual(['2026-11-07', '2026-11-08']);
  expect(long.reason).toMatch(/2 hours more than the open time/);
  const full = planDays([{ id: 'a', minutes: 60 }, { id: 'b', minutes: 60 }], [{ date: '2026-11-07', free: 0 }, { date: '2026-11-08', free: 10 }]);
  expect([full.assign.get('a'), full.assign.get('b')]).toEqual(['2026-11-07', '2026-11-08']);
  expect(full.reason).toMatch(/look full/);
});

test('a day\'s items become sittings of up to two hours, titled with what they are', () => {
  const day = [item('i1', 'x', 50), item('i2', 'x', 50), item('i3', 'x', 60), item('i4', 'x', 30)];
  expect(sittings(day).map(g => g.map(i => i.id))).toEqual([['i1', 'i2'], ['i3', 'i4']]);
  expect(blockTitle('Calc midterm', ['Worksheet 3', 'Practice exam A'])).toBe('Calc midterm: Worksheet 3, Practice exam A');
  expect(blockTitle('Calc midterm', ['A', 'B', 'C', 'D'])).toBe('Calc midterm: A, B +2 more');
});

test('this week goes onto the plan: one block per sitting on its day, covering its items; done and planned items stay off', () => {
  const origin = new Date(2026, 10, 7, 0, 0);                 // Sat Nov 7
  const now = new Date(2026, 10, 7, 9, 0);
  const items = [
    item('i1', '2026-11-07', 60), item('i2', '2026-11-07', 45),
    item('i3', '2026-11-08', 30, { doneAt: '2026-11-06T10:00:00Z' }),          // done
    item('i4', '2026-11-09', 40, { todoId: 'planned-todo' }),                  // in a block still ahead
    item('i5', '2026-11-11', 90), item('i6', '2026-11-11', 60),               // two sittings
    item('i7', '2026-11-20', 60),                                              // next week
    item('i8', '2026-11-07', 30, { examId: 'other-exam' }),                    // another exam
  ];
  const ahead = { id: 'b1', title: 'Calc midterm: Item i4', subject: 'Calc', time: '20:00–20:40', minutes: 40, color: 'blue', state: 'Planned', day: 2, todoId: 'planned-todo' } as Snapshot['blocks'][number];
  const { blocks, missing } = weekBlocks(exam, items, empty([ahead]), origin, settings, { name: 'Calc', color: 'blue' }, now);
  expect(missing).toEqual([]);
  expect(blocks.map(b => [b.day, b.title, b.minutes, b.coverIds])).toEqual([
    [0, 'Calc midterm: Item i1, Item i2', 105, ['i1', 'i2']],
    [4, 'Calc midterm: Item i5', 90, ['i5']],
    [4, 'Calc midterm: Item i6', 60, ['i6']],
  ]);
  // The first sitting starts at the next open time; the second that day leaves a break.
  expect(blocks[0].time).toBe('09:00–10:45');
  expect(blocks[1].time).toBe('08:00–09:30');
  expect(blocks[2].time).toBe('09:40–10:40');
  expect(blocks.every(b => b.state === 'Proposal' && b.note === 'Exam plan · Calc midterm · Sat, Nov 14')).toBe(true);
});

test('a day with no open time is reported, not squeezed', () => {
  const origin = new Date(2026, 10, 7, 0, 0);
  const wall = { id: 'w', title: 'Work shift', subject: 'Personal', time: '08:00–23:00', minutes: 900, color: 'gray', state: 'Planned', day: 0, external: true } as Snapshot['blocks'][number];
  const { blocks, missing } = weekBlocks(exam, [item('i1', '2026-11-07', 60)], empty([wall]), origin, settings, { name: 'Calc', color: 'blue' }, new Date(2026, 10, 7, 7, 0));
  expect(blocks).toEqual([]);
  expect(missing).toEqual(['2026-11-07']);
});

test('Soma\'s view of an exam: progress, missed items, this week by day, with short ids', () => {
  const ids = new Map<string, string>([['i1', 'reading-1']]);   // reading lists' ids come first
  const items = [
    item('e1', '2026-11-05', 45, { title: 'problems 1–12' }),
    item('e2', '2026-11-06', 30, { doneAt: '2026-11-06T10:00:00Z' }),
    item('e3', '2026-11-08', 60, { todoId: 't-ahead' }),
    item('e4', '2026-11-08', 60, { todoId: 't-ended' }),
    item('e5', '2026-11-20', 60),
  ];
  const lines = examLines([exam, { ...exam, id: 'old', examDate: '2026-11-01' }], items, [{ id: 'calc', name: 'Calc 1A' }], '2026-11-07', ids, new Set(['t-ahead']));
  expect(lines).toEqual([{
    exam: 'Calc midterm · Calc 1A · Sat 2026-11-14',
    progress: '1 of 5 done',
    missed: ['i2 Item e1 (problems 1–12) · 45m'],
    week: { 'Sun 2026-11-08': ['i3 Item e3 · 60m · planned', 'i4 Item e4 · 60m'] },
  }]);
  expect(ids.get('i2')).toBe('e1');
  expect(ids.get('i4')).toBe('e4');
});

// ---------- in the app ----------

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
    exam_plans: [],
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

const LIST = { items: [
  { label: 'Worksheet 3', detail: 'problems 1–12: related rates', minutes: 60, source: 'Worksheet 3.pdf' },
  { label: 'Limits redo', detail: 'quiz 2 mistakes', minutes: 45 },
  { label: 'Practice midterm A', detail: 'timed, then check answers', minutes: 90, source: 'Practice Midterm A.pdf' },
] };

test('plan an exam: Soma lists from the picked materials, the student edits and approves, and the days are saved with a reason', async ({ page }) => {
  const state = await setup(page, () => LIST);
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Plan an exam' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan an exam' });
  await expect(dialog.getByLabel('Exam')).toHaveValue('t-exam');
  // The syllabus is left out by default; worksheets and practice exams are in.
  await expect(dialog.getByRole('checkbox', { name: 'Worksheet 3.pdf' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Calc syllabus.pdf' })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Make my list' }).click();
  await expect(dialog.getByLabel('Detail for Worksheet 3')).toHaveValue('problems 1–12: related rates');

  const chat = state.chats.at(-1)!;
  expect(chat.context).toContain('FILE "Worksheet 3.pdf"');
  expect(chat.context).toContain('FILE "Practice Midterm A.pdf"');
  expect(chat.context).not.toContain('Calc syllabus.pdf');
  expect(chat.context).toContain('- 2.1 Limits');                    // the reading list
  expect(JSON.stringify(chat.systemPrompt)).toContain('Never vague items');

  // The student's edits are what's saved.
  await dialog.getByLabel('Minutes for Limits redo').fill('30');
  await dialog.getByRole('button', { name: 'Remove Practice midterm A' }).click();
  await dialog.getByRole('button', { name: 'Add an item' }).click();
  await dialog.getByLabel('What').last().fill('Chapter 3 review problems');
  await dialog.getByRole('button', { name: 'Approve list' }).click();
  await expect(dialog).toHaveCount(0);

  expect(state.db.exam_plans).toEqual([expect.objectContaining({ subject_id: 'calc', title: 'Calc midterm', exam_date: dayOff(6), todo_id: 't-exam' })]);
  const examId = state.db.exam_plans[0].id;
  const saved = state.db.course_items.filter(r => r.exam_id === examId).sort((a, b) => Number(a.position) - Number(b.position));
  expect(saved.map(r => [r.label, r.minutes, r.document_id ?? null])).toEqual([['Worksheet 3', 60, 'd-ws'], ['Limits redo', 30, null], ['Chapter 3 review problems', 45, null]]);
  for (const r of saved) { expect(String(r.study_day) >= dayOff(0)).toBe(true); expect(String(r.study_day) < dayOff(6)).toBe(true); }

  // The panel shows it by day; the reading list doesn't pick the items up.
  const panel = page.getByRole('region', { name: 'Exam study plans' });
  await expect(panel.getByText('Calc 1A · ')).toContainText('0 of 3 done');
  await expect(panel.getByRole('checkbox', { name: 'Done: Worksheet 3' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Reading progress' }).getByText('Worksheet 3')).toHaveCount(0);
});

test('this week goes onto the plan as suggestions, and Accept links the items to the block', async ({ page }) => {
  const state = await setup(page, () => ({ reply: 'ok' }), db => {
    db.exam_plans.push({ id: 'exam-1', user_id: account.id, subject_id: 'calc', title: 'Calc midterm', exam_date: dayOff(6), todo_id: 't-exam' });
    db.course_items.push(
      { id: 'e1', user_id: account.id, subject_id: 'calc', exam_id: 'exam-1', label: 'Worksheet 3', title: 'problems 1–12', position: 0, minutes: 60, study_day: dayOff(1), done_at: null, todo_id: null },
      { id: 'e2', user_id: account.id, subject_id: 'calc', exam_id: 'exam-1', label: 'Practice midterm A', position: 1, minutes: 90, study_day: dayOff(2), done_at: null, todo_id: null },
      { id: 'e0', user_id: account.id, subject_id: 'calc', exam_id: 'exam-1', label: 'Limits redo', position: 2, minutes: 30, study_day: dayOff(-1), done_at: null, todo_id: null },
    );
  });
  await page.goto('/documents');
  const panel = page.getByRole('region', { name: 'Exam study plans' });
  await panel.getByRole('button', { name: /Calc midterm/ }).click();
  await expect(panel.getByText('1 from earlier days isn’t done yet.')).toBeVisible();
  await panel.getByRole('button', { name: 'Add this week to my plan' }).click();
  await expect(panel.getByRole('status')).toContainText('2 study blocks are waiting on your plan.');
  await panel.getByRole('link', { name: 'Open the dashboard' }).click();
  // The first block is tomorrow.
  await page.getByRole('button', { name: 'Next day' }).click();
  const card = page.getByText('Calc midterm: Worksheet 3', { exact: true }).first();
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: 'Accept', exact: true }).first().click();
  await expect.poll(() => state.db.todos.find(t => t.text === 'Calc midterm: Worksheet 3')?.id).toBeTruthy();
  const todo = state.db.todos.find(t => t.text === 'Calc midterm: Worksheet 3')!;
  await expect.poll(() => state.db.course_items.find(r => r.id === 'e1')?.todo_id).toBe(todo.id);
  expect(state.db.course_items.find(r => r.id === 'e2')?.todo_id).toBeNull();
});

test('re-plan spreads what\'s left from today; done items keep their day', async ({ page }) => {
  const state = await setup(page, () => ({ reply: 'ok' }), db => {
    db.exam_plans.push({ id: 'exam-1', user_id: account.id, subject_id: 'calc', title: 'Calc midterm', exam_date: dayOff(6), todo_id: 't-exam' });
    db.course_items.push(
      { id: 'e0', user_id: account.id, subject_id: 'calc', exam_id: 'exam-1', label: 'Limits redo', position: 0, minutes: 30, study_day: dayOff(-2), done_at: null, todo_id: null },
      { id: 'e1', user_id: account.id, subject_id: 'calc', exam_id: 'exam-1', label: 'Worksheet 2', position: 1, minutes: 30, study_day: dayOff(-1), done_at: new Date().toISOString(), todo_id: null },
    );
  });
  await page.goto('/documents');
  const panel = page.getByRole('region', { name: 'Exam study plans' });
  await panel.getByRole('button', { name: /Calc midterm/ }).click();
  await panel.getByRole('button', { name: 'Re-plan from today' }).click();
  await expect.poll(() => String(state.db.course_items.find(r => r.id === 'e0')?.study_day) >= dayOff(0)).toBe(true);
  expect(state.db.course_items.find(r => r.id === 'e1')?.study_day).toBe(dayOff(-1));
  await expect(panel.getByText('earlier days')).toHaveCount(0);
});

test('rebuilding a course\'s reading list leaves its exam study items alone', async ({ page }) => {
  const state = await setup(page, body => JSON.stringify(body.systemPrompt).includes('reading guide') ? { items: [{ label: '2.1', title: 'Limits' }, { label: '2.2', title: 'Continuity' }] } : { reply: 'ok' }, db => {
    db.exam_plans.push({ id: 'exam-1', user_id: account.id, subject_id: 'calc', title: 'Calc midterm', exam_date: dayOff(6) });
    db.course_items.push({ id: 'e1', user_id: account.id, subject_id: 'calc', exam_id: 'exam-1', label: 'Worksheet 3', position: 0, minutes: 60, study_day: dayOff(1), done_at: null, todo_id: null });
  });
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Build from a document' }).click();
  const dialog = page.getByRole('dialog', { name: 'Build a reading list' });
  await dialog.getByLabel('Document').selectOption('d-syl');
  await dialog.getByRole('button', { name: 'Find sections' }).click();
  await dialog.getByRole('button', { name: 'Save reading list' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.db.course_items.find(r => r.id === 'e1')).toBeTruthy();
  expect(state.deletes).not.toContain('course_items:e1');
  expect(state.db.course_items.filter(r => !r.exam_id).map(r => r.label).sort()).toEqual(['2.1', '2.2']);
});

test('Soma sees the exam plan and can put a day\'s items in a block that covers them', async ({ page }) => {
  let ids: Record<string, string> = {};
  const state = await setup(page, body => {
    const ctx = JSON.parse(String(body.context).match(/CONTEXT[^:]*: (\{[^\n]*\})/)![1]) as { exams?: { week?: Record<string, string[]> }[] };
    const lines = Object.values(ctx.exams?.[0]?.week ?? {}).flat();
    ids = Object.fromEntries(lines.map(l => [l.split(' ').slice(1).join(' ').split(' (')[0].split(' · ')[0], l.split(' ')[0]]));
    return { reply: 'Planned.', blocks: [{ title: 'Calc midterm: Worksheet 3', subject: 'Calc 1A', date: dayOff(1), minutes: 60, covers: [ids['Worksheet 3'], ids['Worksheet 3']] }] };
  }, db => {
    db.exam_plans.push({ id: 'exam-1', user_id: account.id, subject_id: 'calc', title: 'Calc midterm', exam_date: dayOff(6), todo_id: 't-exam' });
    db.course_items.push({ id: 'e1', user_id: account.id, subject_id: 'calc', exam_id: 'exam-1', label: 'Worksheet 3', title: 'problems 1–12', position: 0, minutes: 60, study_day: dayOff(1), done_at: null, todo_id: null });
  });
  await page.goto('/dashboard');
  await page.getByLabel('What do you need to work on?').fill('plan my week');
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect(page.getByText('Covers Worksheet 3').first()).toBeVisible();
  const chat = state.chats.at(-1)!;
  expect(JSON.stringify(chat.systemPrompt)).toContain('EXAM STUDY PLANS');
  expect(chat.context).toContain('Calc midterm · Calc 1A');
  expect(chat.context).toContain('Worksheet 3 (problems 1–12) · 60m');
  // The reading list stays its own: the exam item isn't in it.
  expect(chat.context).not.toMatch(/"courses":\[[^\]]*Worksheet/);
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.course_items.find(r => r.id === 'e1')?.todo_id).toBeTruthy();
});
