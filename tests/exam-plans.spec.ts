import { test, expect, type Page } from '@playwright/test';
import {
  blockTitle, busyDays, historyEstimates, byPriority, clampPriority, dayCapacity, draftsFromBraindump, examLines,
  placeBlocks, readStudyList,  type ExamPlan,
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
    { label: 'Practice midterm A', minutes: 600, priority: 5 },
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
  const { blocks } = placeBlocks(exam, items, empty(), origin, settings, { name: 'Calc', color: 'blue' }, 'today', new Map(), now);
  expect(blocks.every(b => b.day === 0 && b.coverIds?.length === 1)).toBe(true);
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
      return route.fulfill({ json: table === 'documents' ? b : null });
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

test('a failed upload leaves the rest of the batch selected and retries only the missing file', async ({ page }) => {
  const state = await setup(page, () => ({ items: [{ label: 'Review notes', minutes: 45, priority: 3 }] }));
  let failUpload = true;
  await page.route('**/storage/v1/object/documents/**', route => {
    if (failUpload && route.request().url().endsWith('retry.txt')) {
      return route.fulfill({ status: 400, json: { message: 'Upload interrupted' } });
    }
    return route.fulfill({ json: {} });
  });
  let releaseFirst!: () => void;
  const firstRead = new Promise<void>(resolve => { releaseFirst = resolve; });
  let failRead = true;
  await page.route('**/api/extract-document', async route => {
    const row = state.db.documents.find(d => d.id === route.request().postDataJSON().documentId)!;
    if (row.file_name === 'first.txt') await firstRead;
    if (row.file_name === 'later.txt' && failRead) return route.fulfill({ status: 429, json: {} });
    Object.assign(row, { extraction_status: 'done', extracted_text: 'Course notes' });
    return route.fulfill({ json: { status: 'done' } });
  });
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Plan an exam' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan an exam' });
  await dialog.locator('input[type=file]').setInputFiles(['first.txt', 'retry.txt', 'last.txt'].map(name =>
    ({ name, mimeType: 'text/plain', buffer: Buffer.from('Notes') })));
  const count = dialog.getByRole('status');
  await expect(count).toContainText('1 / 3 files uploaded');
  await dialog.getByLabel('Worksheet 3.pdf').uncheck();
  await dialog.getByRole('button', { name: 'browse' }).evaluate(button => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['More notes'], 'later.txt', { type: 'text/plain' }));
    button.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
  });
  await expect(count).toContainText('1 / 4 files uploaded');
  await expect(dialog.getByRole('button', { name: 'Make my study checklist' })).toBeDisabled();
  releaseFirst();
  await expect(count).toHaveText('3 / 4 files uploaded');
  await expect(dialog.getByLabel('last.txt', { exact: true })).toBeChecked();
  await expect(dialog.getByLabel('first.txt', { exact: true })).toBeChecked();
  await expect(dialog.getByLabel('Worksheet 3.pdf')).not.toBeChecked();
  failUpload = false;
  await dialog.getByRole('button', { name: 'Retry upload of retry.txt' }).click();
  await expect(count).toHaveText('4 / 4 files uploaded');
  await expect(dialog.getByLabel('retry.txt', { exact: true })).toBeChecked();
  failRead = false;
  await dialog.getByRole('button', { name: 'Retry reading later.txt' }).click();
  await expect(dialog.getByLabel('later.txt', { exact: true })).toBeChecked();
  await expect(count).toHaveText('4 / 4 files uploaded');
  expect(state.db.documents.filter(d => String(d.file_name).endsWith('.txt'))).toHaveLength(4);
  await dialog.getByRole('button', { name: 'Make my study checklist' }).click();
  await dialog.getByRole('button', { name: 'Continue to checklist' }).click();
  await expect(dialog.getByRole('button', { name: 'Approve checklist' })).toBeVisible();
  const request = JSON.stringify(state.chats);
  for (const name of ['first.txt', 'retry.txt', 'last.txt', 'later.txt']) expect(request).toContain(name);
});

test('remove selected files updates the batch and checklist while preserving the document library', async ({ page }) => {
  const state = await setup(page, () => ({ items: [{ label: 'Review worksheet', minutes: 45, priority: 3 }] }));
  const started: string[] = [];
  let finishUpload!: () => void;
  const uploading = new Promise<void>(resolve => { finishUpload = resolve; });
  await page.route('**/storage/v1/object/documents/**', async route => {
    const url = route.request().url();
    started.push(url);
    if (url.endsWith('failed.txt')) return route.fulfill({ status: 400, json: { message: 'Upload interrupted' } });
    if (url.endsWith('in-flight.txt')) await uploading;
    return route.fulfill({ json: {} });
  });
  await page.route('**/api/extract-document', route => {
    const row = state.db.documents.find(d => d.id === route.request().postDataJSON().documentId)!;
    Object.assign(row, { extracted_text: 'Course notes', extraction_status: 'done' });
    return route.fulfill({ json: { status: 'done' } });
  });
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Plan an exam' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan an exam' });
  const removeFiles = dialog.getByRole('button', { name: 'Remove files', exact: true });
  await removeFiles.click();
  await dialog.getByLabel('Select Worksheet 3.pdf for removal').check();
  await dialog.getByRole('button', { name: 'Cancel removal' }).click();
  await expect(dialog.getByLabel('Worksheet 3.pdf', { exact: true })).toBeChecked();

  const names = ['keep.txt', 'saved.txt', 'failed.txt', 'in-flight.txt', 'queued.txt'];
  await dialog.locator('input[type=file]').setInputFiles(names.map(name => ({ name, mimeType: 'text/plain', buffer: Buffer.from(name) })));
  await expect.poll(() => started.some(url => url.endsWith('in-flight.txt'))).toBe(true);
  await removeFiles.click();
  const removed = ['saved.txt', 'failed.txt', 'in-flight.txt', 'queued.txt', 'Practice Midterm A.pdf'];
  for (const name of removed) await dialog.getByLabel(`Select ${name} for removal`, { exact: true }).check();
  await dialog.getByRole('button', { name: 'Remove selected (5)', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('1 / 1');
  finishUpload();
  await expect(dialog.getByRole('button', { name: 'Make my study checklist' })).toBeEnabled();
  await expect(dialog.getByLabel('keep.txt', { exact: true })).toBeChecked();
  expect(started.some(url => url.endsWith('queued.txt'))).toBe(false);
  expect(state.db.documents.map(d => d.file_name)).toEqual(expect.arrayContaining(['saved.txt', 'in-flight.txt', 'Practice Midterm A.pdf']));
  for (const name of removed) await expect(dialog.getByText(name, { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Make my study checklist' }).click();
  await dialog.getByRole('button', { name: 'Continue to checklist' }).click();
  await expect(dialog.getByRole('button', { name: 'Approve checklist' })).toBeVisible();
  const request = JSON.stringify(state.chats);
  expect(request).toContain('keep.txt');
  expect(request).toContain('Worksheet 3.pdf');
  for (const name of removed) expect(request).not.toContain(name);
});

test('manual exam fields align, fit the viewport, and keep actions reachable', async ({ page }, testInfo) => {
  await setup(page, () => ({}));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Plan an exam' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan an exam' });
  await dialog.getByRole('combobox').first().selectOption('other');
  await expect(dialog.getByRole('combobox', { name: /^Course/ })).toHaveValue('calc');
  const controls = [dialog.getByLabel('Name', { exact: true }), dialog.getByRole('combobox', { name: /^Course/ }), dialog.getByLabel('Date', { exact: true }), dialog.getByLabel('Time (optional)', { exact: true })];
  const boxes = await Promise.all(controls.map(control => control.boundingBox()));
  expect(Math.max(...boxes.map(b => b!.y)) - Math.min(...boxes.map(b => b!.y))).toBeLessThan(2);
  expect(Math.max(...boxes.map(b => b!.height)) - Math.min(...boxes.map(b => b!.height))).toBeLessThan(2);
  await page.screenshot({ path: testInfo.outputPath('exam-desktop.png'), animations: 'disabled' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: testInfo.outputPath('exam-dark.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 700 });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).scrollIntoViewIfNeeded();
  const modal = (await dialog.boundingBox())!;
  expect(modal.x).toBeGreaterThanOrEqual(0);
  expect(modal.x + modal.width).toBeLessThanOrEqual(390);
  expect(modal.y).toBeGreaterThanOrEqual(0);
  expect(modal.y + modal.height).toBeLessThanOrEqual(700);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('exam-phone.png'), animations: 'disabled' });
});

test('an empty course cache reloads from the account, with retry preserving exam details', async ({ page }) => {
  const state = await setup(page, () => ({}));
  let available = false;
  await page.route('https://soma-regression.supabase.co/rest/v1/subjects**', route => route.fulfill(
    available ? { json: state.db.subjects } : { status: 400, json: { message: 'Could not load courses' } },
  ));
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Plan an exam' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan an exam' });
  await dialog.getByRole('combobox').first().selectOption('other');
  await dialog.getByLabel('Name', { exact: true }).fill('Midterm 2');
  await dialog.getByLabel('Date', { exact: true }).fill(dayOff(6));
  await expect(dialog.getByText('Couldn’t load your courses.')).toBeVisible();
  available = true;
  await dialog.getByRole('button', { name: 'Retry courses' }).click();
  await expect(dialog.getByRole('combobox', { name: /^Course/ })).toHaveValue('calc');
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Midterm 2');
  await expect(dialog.getByLabel('Date', { exact: true })).toHaveValue(dayOff(6));
  await expect(dialog.getByRole('button', { name: 'Make my study checklist' })).toBeEnabled();
});

test('course loading is distinct from an account with no active courses', async ({ page }) => {
  const state = await setup(page, () => ({}));
  state.db.subjects = [];
  await page.goto('/documents');
  await expect(page.getByRole('button', { name: 'Plan an exam' })).toBeEnabled();
  const release: (() => Promise<void>)[] = [];
  await page.route('https://soma-regression.supabase.co/rest/v1/subjects**', route => {
    release.push(() => route.fulfill({ json: [] }));
  });
  await page.getByRole('button', { name: 'Plan an exam' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan an exam' });
  await dialog.getByRole('combobox').first().selectOption('other');
  await expect(dialog.getByRole('status')).toHaveText('Loading your courses…');
  await expect(dialog.getByRole('combobox', { name: /^Course/ })).toBeDisabled();
  await expect.poll(() => release.length).toBeGreaterThan(0);
  await Promise.all(release.map(respond => respond()));
  await expect(dialog.getByRole('status')).toContainText('No active courses.');
  await expect(dialog.getByRole('link', { name: 'Settings → Courses' })).toHaveAttribute('href', '/settings');
  await expect(dialog.getByRole('button', { name: 'Make my study checklist' })).toBeDisabled();
});

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
  await dialog.getByRole('button', { name: 'Continue to checklist' }).click();
  await dialog.getByText('How Soma built this checklist').click();
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
  await expect(page.getByRole('button', { name: /^Calc midterm/ })).toHaveAttribute('aria-expanded','true');
  await addWeek.click();
  await expect(page.getByText(/waiting on your plan/i)).toBeVisible();
});

test('Soma sees exams in context only when the message is about an exam', async ({ page }) => {
  const state = await setup(page, () => ({ reply: 'Planned from your list.', blocks: [] }));
  state.db.exam_plans.push({ id: 'exam-1', user_id: account.id, subject_id: 'calc', title: 'Calc midterm', exam_date: dayOff(6), todo_id: 't-exam' });
  state.db.course_items.push({ id: 'e1', user_id: account.id, subject_id: 'calc', exam_id: 'exam-1', label: 'Worksheet 3', title: 'do problems 1–12', position: 0, minutes: 45, priority: 5, done_at: null });
  await page.goto('/dashboard');
  await page.getByLabel('What do you need to work on?').fill('plan calc midterm study');
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect.poll(() => state.chats.some(c => typeof c.systemPrompt === 'string' && c.systemPrompt.includes('coverage list'))).toBe(true);
  const planChat = state.chats.find(c => typeof c.systemPrompt === 'string' && /"exams"|Worksheet 3/.test(JSON.stringify(c)));
  expect(JSON.stringify(planChat)).toMatch(/Worksheet 3/);
});

// 2026-11-10: the priority control was five pills (and before that a slider
// holding five buttons, six Tab stops a row). Now one slider: a track that
// fills to a knob, one Tab stop, clicked or dragged anywhere, arrow keys.
test('the priority control is one slider: one Tab stop, 24px tall, click or keys', async ({ page }) => {
  await setup(page, () => ({ note: 'From your braindump.', items: [{ label: 'Worksheet 3', detail: 'do problems 1–12', minutes: 45, priority: 4 }] }));
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Plan an exam' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan an exam' });
  await dialog.locator('textarea').fill('Worksheet 3');
  await dialog.getByRole('button', { name: 'Make my study checklist' }).click();
  await dialog.getByRole('button', { name: 'Continue to checklist' }).click();
  const bar = dialog.getByRole('row', { name: /Worksheet 3/ }).getByRole('slider');
  await expect(bar).toHaveAttribute('aria-valuenow', '4');
  await expect(bar).toHaveAttribute('tabindex', '0');
  await expect(bar.locator('button, [tabindex]:not([role=slider])')).toHaveCount(0);
  const box = (await bar.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(24);
  await bar.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(bar).toHaveAttribute('aria-valuenow', '3');
  await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
  await expect(bar).toHaveAttribute('aria-valuenow', '5');
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
  await expect(bar).toHaveAttribute('aria-valuenow', '1');
});

// 2026-11-10: names broke mid-phrase ("Reading pass 1: Ch 7, / 9") and the
// bars sat at different spots depending on the length beside them.
test('checklist rows: the detail sits under the name, and every bar lines up', async ({ page }) => {
  const state = await setup(page, () => ({ reply: 'ok' }));
  state.db.exam_plans.push({ id: 'exam-1', user_id: account.id, subject_id: 'calc', title: 'Calc midterm', exam_date: dayOff(6) });
  state.db.course_items.push(
    { id: 'i1', user_id: account.id, subject_id: 'calc', exam_id: 'exam-1', label: 'Reading pass 1: Ch 7, 9', title: 'read Ch 7.1–7.9 and 9.1–9.4', position: 0, minutes: 100, priority: 4 },
    { id: 'i2', user_id: account.id, subject_id: 'calc', exam_id: 'exam-1', label: 'Past final 1', title: 'timed', position: 1, minutes: 90, priority: 5 },
  );
  await page.goto('/documents');
  const plan = page.getByRole('button', { name: /Calc midterm/ });
  if (await plan.getAttribute('aria-expanded') !== 'true') await plan.click();
  const name = page.getByText('Reading pass 1: Ch 7, 9', { exact: true });
  const detail = page.getByText('read Ch 7.1–7.9 and 9.1–9.4');
  const [n, d] = [(await name.boundingBox())!, (await detail.boundingBox())!];
  expect(n.height).toBeLessThan(24);            // one line
  expect(d.y).toBeGreaterThanOrEqual(n.y + n.height - 1); // under it
  const xs = await page.getByRole('slider').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().x)));
  expect(new Set(xs).size).toBe(1);
});

// 2026-11-10: Rebuild opened with an empty braindump.
test('Rebuild starts from the braindump saved with the exam', async ({ page }) => {
  await setup(page, () => ({ note: 'From your braindump.', items: [{ label: 'Worksheet 3', minutes: 45, priority: 4 }] }));
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Plan an exam' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan an exam' });
  await dialog.locator('textarea').fill('Worksheet 3 problems\nPractice midterm A timed');
  await dialog.getByRole('button', { name: 'Make my study checklist' }).click();
  await dialog.getByRole('button', { name: 'Continue to checklist' }).click();
  await dialog.getByRole('button', { name: 'Approve checklist' }).click();
  await expect(dialog).toHaveCount(0);
  const rebuild = page.getByRole('button', { name: 'Rebuild list' });
  if (!await rebuild.isVisible()) await page.getByRole('button', { name: /Calc midterm/ }).click();
  await rebuild.click();
  await expect(page.getByRole('dialog', { name: /Rebuild the list for Calc midterm/ }).getByRole('textbox', { name: /Braindump/ })).toHaveValue('Worksheet 3 problems\nPractice midterm A timed');
});

// 2026-11-10: "Past finals 1–3: 180 min", when one practice midterm takes the
// student two to five hours. Lengths come from their own timed work where it
// is the same kind; the rest stay guesses, and the note says which.
test('lengths come from the student\'s timed practice exams, one item per exam', () => {
  const s = (subject: string, task: string, minutes: number) => ({ subject_id: subject, task_text: task, duration_seconds: minutes * 60 });
  const sessions = [
    s('phys', 'Physics 5A: practice midterm 1', 200), s('phys', 'Physics 5A: practice midterm 1', 109), // 309 over two sittings
    s('phys', 'Physics 5A: practice midterm 2', 132),
    s('phys', 'Physics 5A: past midterms', 96),
    s('phys', 'Review: Physics 5A midterm', 10),               // a review, not an exam
    s('phys', 'Physics 5A: discussion section review, weeks 3-6', 64),
    s('cs', 'CS 61A: past midterms 1–2', 346),                 // another course
  ];
  const { drafts, basis } = historyEstimates([
    { label: 'Past finals 1–3', detail: 'timed, closed-book', minutes: 180, priority: 5 },
    { label: 'Weekly quizzes, weeks 1-7', detail: 're-solve without notes', minutes: 105, priority: 4 },
    { label: 'Reading pass 1: Ch 1–3', detail: 'read Ch 1.1–1.11', minutes: 120, priority: 4 },
  ], sessions, 'phys', 'PHYSICS 5A');
  expect(drafts.map(d => [d.label, d.minutes])).toEqual([
    ['Past final 1', 130], ['Past final 2', 130], ['Past final 3', 130],
    ['Weekly quizzes, weeks 1-7', 110],
    ['Reading pass 1: Ch 1–3', 120],
  ]);
  expect(drafts[0]).toMatchObject({ detail: 'timed, closed-book', priority: 5 });
  expect(basis).toContain('logged time');
  expect(drafts[0].estimateBasis).toContain('practice exam');
  expect(drafts[3].estimateBasis).toContain('7 × 16 min per week');
  expect(drafts[4].estimateBasis).toContain('No comparable');
  // No timed work like it: the drafted lengths stand, and say so.
  expect(historyEstimates([{ label: 'Past finals 1–3', minutes: 180, priority: 5 }], [], 'phys').basis).toMatch(/^Lengths are guesses/);
});

test('reading ranges, assignments and worksheets use the amount of comparable work actually timed', () => {
  const timed = (title: string, minutes: number, subject = 'phys') =>
    ({ subject_id: subject, task_text: title, duration_seconds: minutes * 60 });
  const sessions = [
    timed('Physics reading: 4.1–4.3', 40), timed('Physics reading: 4.1–4.3', 20),
    timed('Physics reading: 7.2', 20), timed('Reading Ch 4', 10, 'other'),
    timed('HW 7', 80), timed('HW 8', 120), timed('Worksheet 2', 35),
    timed('Physics discussion review, weeks 2–4', 90),
  ];
  const item = (label: string, detail = '') => ({ label, detail, minutes: 120, priority: 4 });
  const sections = Array.from({ length: 5 }, (_, c) => Array.from({ length: 7 }, (_, i) => `${c + 1}.${i + 1}`)).flat();
  const result = historyEstimates([
    item('Reading Guide round 1', 'read KK Ch 1–5 sections in the reading guide (1.1–5.7)'),
    item('Reading Guide round 2', 'read KK 7.1–7.9 and 9.1–9.4'),
    item('Reading Guide round 3', 'read KK 10.1–10.5, 11.1–11.4 and 6.2–6.4'),
    item('HW1–HW3', 'redo the problems on HW 1–3'),
    item('Weeks 6–8 worksheets', 'redo Week 6–8 worksheets and Monday–Thursday quizzes'),
    item('Worksheet 3'), item('Unlogged activity'),
  ], sessions, 'phys', 'Physics', sections).drafts;
  const round1 = result.filter(d => d.label.startsWith('Reading Guide round 1'));
  expect(round1.reduce((n, d) => n + d.minutes, 0)).toEqual(700);
  expect(round1[0].estimateBasis).toContain('35 × 20 min per section');
  expect(result.slice(round1.length).map(d => d.minutes)).toEqual([260, 240, 300, 90, 35, 120]);
  expect(result.at(-1)?.estimateBasis).toContain('No comparable');
  const chapterLogs = [timed('Read Chapter 6', 75), timed('Read Ch. 7–8', 150)];
  expect(historyEstimates([item('Read chapters 1–5')], chapterLogs, 'phys').drafts[0].minutes).toBe(375);
});

test('Plan Exam displays the logged reading pace and saves the full five-chapter estimate', async ({ page }) => {
  const state = await setup(page, () => ({ items: [{ label: 'Reading Guide round 1', detail: 'read KK Ch 1–5', minutes: 120, priority: 4 }] }));
  state.db.timer_sessions.push(...[40, 50].map((minutes, i) => ({
    id: `timer-ch4-${i}`, user_id: account.id, subject_id: 'calc', task_text: 'Read chapter 4',
    date: dayOff(-i-1), duration_seconds: minutes * 60,
  })));
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Plan an exam' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan an exam' });
  await dialog.getByRole('button', { name: 'Make my study checklist' }).click();
  await dialog.getByRole('button', { name: 'Continue to checklist' }).click();
  const lengths = dialog.getByRole('spinbutton', {name:/Minutes for Reading Guide/});
  await expect(lengths).toHaveCount(5);
  expect(await lengths.evaluateAll(inputs=>inputs.map(el=>(el as HTMLInputElement).value))).toEqual(Array(5).fill('90'));
  await expect(dialog.getByText(/1 × 90 min per chapter/).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Approve checklist' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.db.course_items.reduce((m,row)=>m+Number(row.minutes),0)).toBe(450);
});

test('braindump estimates use reading-list sections linked to the actual timed task', async ({ page }) => {
  const state = await setup(page, () => ({}));
  state.db.todos.push({ id: 'assigned', user_id: account.id, subject_id: 'calc', text: 'Calc 1A: Momentum' });
  for (const [i, label] of ['4.1', '4.2'].entries()) {
    state.db.course_items.push({ id: label, user_id: account.id, subject_id: 'calc', label, position: i, todo_id: 'assigned' });
    state.db.timer_sessions.push({ id: `reading-${i}`, user_id: account.id, subject_id: 'calc', task_text: 'Calc 1A: Momentum',
      date: dayOff(-i-1), duration_seconds: 40 * 60 });
  }
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Plan an exam' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan an exam' });
  await dialog.getByRole('textbox', { name: /Braindump/ }).fill('Read KK 12.1–12.11');
  await dialog.getByRole('button', { name: 'Use braindump as-is' }).click();
  await dialog.getByRole('button', { name: 'Continue to checklist' }).click();
  const lengths = dialog.getByRole('spinbutton',{name:/Minutes for Read KK/});
  await expect(lengths).toHaveCount(11);
  await expect(lengths.first()).toHaveValue('40');
  await expect(dialog.getByText(/1 × 40 min per section/).first()).toBeVisible();
});

test('timing preserves the difference between the exact chapters under review', () => {
  const logged = (title:string,minutes:number)=>({subject_id:'phys',task_text:title,duration_seconds:minutes*60});
  const {drafts} = historyEstimates(['5.1–5.12','6.1–6.2'].map(range=>({label:'Textbook review',detail:`Read ${range}`,minutes:45,priority:3})),
    [logged('Read 5.1–5.12',600),logged('Read 6.1–6.2',30)],'phys');
  expect(drafts.map(d=>d.minutes)).toEqual([600,30]);
});

test('calibrated sections become separate sittings with confidence, capacity and milestones', async({page},info)=>{
  const state=await setup(page,()=>({items:[{label:'KK reading',detail:'Read 5.1–5.15',minutes:120,priority:3}]}));
  await page.goto('/documents');
  await page.getByRole('button',{name:'Plan an exam'}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Make my study checklist'}).click();
  await dialog.getByLabel('Minutes per section').fill('30');
  await dialog.screenshot({path:info.outputPath('confidence.png')});
  await dialog.getByRole('button',{name:'Continue to checklist'}).click();
  await expect(dialog.getByText('7h 30m needed')).toBeVisible();
  await expect(dialog.getByRole('row')).toHaveCount(8);
  await dialog.getByRole('button',{name:'Back to confidence'}).click();
  await dialog.getByRole('button',{name:'Shaky',exact:true}).click();
  await dialog.getByRole('button',{name:'Continue to checklist'}).click();
  await expect(dialog.getByText('9h needed')).toBeVisible();
  await dialog.getByLabel('Daily study budget in minutes').fill('30');
  await expect(dialog.getByText(/over capacity/)).toBeVisible();
  await page.setViewportSize({width:390,height:760});
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
  await dialog.screenshot({path:info.outputPath('review-phone-dark.png')});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await dialog.getByLabel('Planning horizon').selectOption('later');
  await dialog.getByRole('button',{name:'Approve checklist'}).click();
  await expect(dialog).toHaveCount(0);
  expect(state.db.course_items).toHaveLength(15);
  expect(state.db.course_items.every(i=>i.priority===4 && String(i.due_date)<dayOff(6))).toBe(true);
  expect(state.db.course_items.reduce((sum,i)=>sum+Number(i.minutes),0)).toEqual(540);
});

test('missed sittings offer a move before the exam and wait for the student', async({page})=>{
  const state=await setup(page,()=>({}));
  state.db.exam_plans.push({id:'e',user_id:account.id,subject_id:'calc',title:'Calc midterm',exam_date:dayOff(6)});
  const date=dayOff(-1);
  state.db.todos.push({id:'read',user_id:account.id,text:'Read chapter 3',date,subject_id:'calc',status:'nothing'});
  state.db.todo_sessions.push({id:'slot',user_id:account.id,todo_id:'read',date,start_time:new Date(date+'T10:00:00').toISOString(),end_time:new Date(date+'T11:00:00').toISOString()});
  state.db.course_items.push({id:'item',user_id:account.id,subject_id:'calc',exam_id:'e',label:'Read chapter 3',todo_id:'read',position:0,minutes:60,priority:4});
  await page.goto('/documents');
  await page.getByRole('button',{name:/Calc midterm/}).click();
  await expect(page.getByText('Missed · Read chapter 3')).toBeVisible();
  const before=JSON.stringify(state.db.todo_sessions);
  await page.getByRole('button',{name:'Pick another time'}).click();
  const options=page.getByLabel('Choose time for Read chapter 3');
  expect(await options.locator('option').count()).toBeGreaterThan(2);
  expect(JSON.stringify(state.db.todo_sessions)).toBe(before);
  await options.selectOption({index:2});
  await expect(page.getByText(/Moved to/)).toBeVisible();
  expect(state.db.todo_sessions).toHaveLength(1);
  expect(state.db.todo_sessions[0].date).not.toBe(date);
  expect(String(state.db.todo_sessions[0].date) < dayOff(6)).toBe(true);
});

test('the last timed paper has the protected day and exam sittings are independently scheduled', () => {
  const start = '2026-11-07', origin = new Date(start+'T08:00:00');
  const examDate='2026-11-13';
  const plan={...exam,examDate};
  const rows = [
    item('a',60,{label:'Read 5.1–5.2',due:'2026-11-10',priority:5}),
    item('b',60,{label:'Read 5.3–5.4',due:'2026-11-10',priority:3}),
    item('c',60,{label:'HW 3',due:'2026-11-11',priority:4}),
    item('d',120,{label:'Timed midterm',due:'2026-11-12',priority:2}),
  ];
  const result=placeBlocks(plan,rows,empty(),origin,{...settings,examPrep:{[plan.id]:{daily:180,start,confidence:{}}}},
    {name:'Calc',color:'blue'},'week',new Map(),origin);
  expect(result.missing).toBe(0);
  expect(result.placed.get('d')).toBe('2026-11-12');
  expect(result.placed.get('c')).toBe('2026-11-11');
  expect(result.blocks.every(b=>b.coverIds?.length===1)).toBe(true);
});

test('an accepted sitting can start the real Focus timer from the exam agenda',async({page},info)=>{
  const state=await setup(page,()=>({}));
  const date=dayOff(0);
  await page.clock.setFixedTime(new Date(date+'T09:00:00'));
  state.db.exam_plans.push({id:'e',user_id:account.id,subject_id:'calc',title:'Calc midterm',exam_date:dayOff(5)});
  state.db.todos.push({id:'read',user_id:account.id,text:'Read 5.1–5.2',date,subject_id:'calc',status:'nothing'});
  state.db.todo_sessions.push({id:'slot',user_id:account.id,todo_id:'read',date,start_time:new Date(date+'T09:00:00').toISOString(),end_time:new Date(date+'T10:00:00').toISOString()});
  state.db.course_items.push({id:'item',user_id:account.id,subject_id:'calc',exam_id:'e',label:'Read 5.1–5.2',todo_id:'read',position:0,minutes:60,priority:4});
  await page.goto('/documents');
  await page.getByRole('button',{name:/Calc midterm/}).click();
  const agenda=page.getByRole('region',{name:'Exam agenda'});
  await expect(agenda.getByRole('button',{name:'Start Focus'})).toBeVisible();
  await agenda.screenshot({path:info.outputPath('today-agenda.png')});
  await agenda.getByRole('button',{name:'Start Focus'}).click();
  await expect(agenda.getByRole('button',{name:'Focus running'})).toBeDisabled();
});
