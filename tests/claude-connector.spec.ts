import { test, expect, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'fs';
import { createConnectorHandler, authorizeConnector } from '../api/_mcp';
import { supabaseDb, TOOLS, type ConnectorDb } from '../api/_connector';
import { zonedToUtc, studyWindowOf, zoneFitsHistory, openSlots, firstFit, clockAt, type Busy } from '../api/_placement';
import { googleEvents, type CalendarRead } from '../api/_connectorCalendar';
import * as importSchedule from '../api/import-schedule';

// The Claude connector (2026-10-11): a student adds Soma to Claude, which can
// then read their plan and add tasks and reading-list sections. "i cant give
// soma the entire pdf doc of a texbook, but i can give it to claude … and even
// ask claude what problems to solve from the textbook". Claude picks what,
// which day and how long; Soma picks the clock time ("make soma auto-place
// clock times for tasks claude adds"). Claude never marks work done or deletes
// anything.

type Row = Record<string, unknown>;
const ME = 'student-1', OTHER = 'student-2';
const NOW = new Date('2026-10-12T19:00:00Z');   // Mon Oct 12, noon in Los Angeles

function tables(): Record<string, Row[]> {
  return {
    subjects: [
      { id: 'phys', user_id: ME, name: 'Physics 5A', archived: false },
      { id: 'math', user_id: ME, name: 'Math 53', archived: false },
      { id: 'old', user_id: ME, name: 'Chem 1A', archived: true },
      { id: 'theirs', user_id: OTHER, name: 'History 7B', archived: false },
    ],
    todos: [
      { id: 't1', user_id: ME, text: 'Physics reading: 4.1–4.2', subject_id: 'phys', status: 'nothing', date: '2026-10-12', estimated_minutes: 60 },
      { id: 't2', user_id: ME, text: 'Math 53 homework 14.3', subject_id: 'math', status: 'done', date: '2026-10-11', due_date: '2026-10-13' },
      { id: 't3', user_id: ME, text: 'Problem set 6', subject_id: 'phys', status: 'nothing', date: '2026-10-13', due_date: '2026-10-16', kind: 'homework', estimated_minutes: 90 },
      { id: 't9', user_id: OTHER, text: 'Their essay', subject_id: 'theirs', status: 'nothing', date: '2026-10-12' },
    ],
    todo_sessions: [{ id: 's1', user_id: ME, todo_id: 't1', date: '2026-10-12', start_time: '2026-10-12T23:00:00', end_time: '2026-10-13T00:00:00Z' }],
    timer_sessions: [
      { id: 'f1', user_id: ME, subject_id: 'math', task_text: 'Math 53 homework 14.3', date: '2026-10-11', start_time: '2026-10-12T02:00:00Z', end_time: '2026-10-12T02:45:00Z', duration_seconds: 2700 },
      { id: 'f9', user_id: OTHER, subject_id: 'theirs', task_text: 'Their essay', date: '2026-10-11', start_time: '2026-10-12T02:00:00Z', end_time: '2026-10-12T03:00:00Z', duration_seconds: 3600 },
    ],
    course_items: [
      { id: 'i1', user_id: ME, subject_id: 'phys', label: '4.1', title: 'Momentum', position: 0, done_at: '2026-10-10T05:00:00Z', todo_id: null },
      { id: 'i2', user_id: ME, subject_id: 'phys', label: '4.2', title: 'Impulse', position: 1, done_at: null, todo_id: 't1' },
      { id: 'i3', user_id: ME, subject_id: 'phys', label: '4.3', title: null, position: 2, done_at: null, todo_id: null },
      { id: 'i4', user_id: ME, subject_id: 'phys', label: '4.4', title: null, position: 3, done_at: null, todo_id: null },
    ],
    settings: [{ user_id: ME, data: { studyWindow: { start: '08:00', end: '23:00' }, theme: 'light' } }],
    documents: [
      { id: '11111111-1111-4111-8111-111111111111', user_id: ME, subject_id: 'phys', file_name: 'Physics syllabus.pdf', doc_type: 'syllabus', extraction_status: 'done', extracted_text: 'Week 7: momentum. '.repeat(3000), created_at: '2026-09-01T00:00:00Z' },
      { id: '22222222-2222-4222-8222-222222222222', user_id: OTHER, subject_id: 'theirs', file_name: 'Their notes.pdf', doc_type: 'other', extraction_status: 'done', extracted_text: 'private', created_at: '2026-09-01T00:00:00Z' },
    ],
  };
}

/** An in-memory database that scopes by student the way the real one does. */
function memoryDb(data = tables()): ConnectorDb & { data: Record<string, Row[]>; writes: string[] } {
  const writes: string[] = [];
  return {
    data, writes,
    select: async (table, userId, opts) => (data[table] ?? []).filter(r => r.user_id === userId && (!opts?.id || r.id === opts.id)).map(r => ({ ...r })),
    insert: async (table, userId, rows) => { writes.push(table); (data[table] ??= []).push(...rows.map(r => ({ ...r, user_id: userId }))); },
    upsert: async (table, userId, rows) => { writes.push(table); for (const r of rows) { const i = data[table].findIndex(x => x.id === r.id && x.user_id === userId); if (i < 0) data[table].push({ ...r, user_id: userId }); else data[table][i] = { ...r, user_id: userId }; } },
    update: async (table, userId, ids, values) => { writes.push(table); for (const r of data[table]) if (r.user_id === userId && ids.includes(String(r.id))) Object.assign(r, values); },
  };
}

/** A calendar holding these busy stretches (or these events). */
const cal = (busy: (Busy | { title: string; start: number; end: number; allDay?: boolean })[] = [], complete = true, connected = true): CalendarRead => ({ events: busy.map(b => Array.isArray(b) ? { title: 'Busy', start: b[0], end: b[1] } : b), complete, connected });

function response() {
  const result = { status: 200, body: undefined as unknown, headers: {} as Record<string, string>, ended: false };
  const res = { status: (s: number) => { result.status = s; return res; }, json: (v: unknown) => { result.body = v; return res; }, setHeader: (k: string, v: string) => { result.headers[k] = v; }, end: () => { result.ended = true; } };
  return { result, res };
}
type Options = { db?: ConnectorDb; authorize?: () => Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }>; limited?: () => boolean; calendar?: (...args: unknown[]) => Promise<CalendarRead> };
async function post(body: unknown, opts: Options = {}, headers: Record<string, string> = { authorization: 'Bearer token', host: 'somastudy.app' }, method = 'POST') {
  const { result, res } = response();
  const db = opts.db ?? memoryDb();
  await createConnectorHandler({ authorize: opts.authorize ?? (async () => ({ ok: true, userId: ME })), db: () => db, limited: opts.limited ?? (() => false), calendar: opts.calendar ?? (async () => cal()), now: () => NOW, authServer: () => 'https://soma.supabase.co/auth/v1' })({ method, headers, body, query: { connector: 'mcp' } }, res);
  return result;
}
/** Call one tool and read its JSON result (or its error text). */
async function tool(name: string, args: Row = {}, opts: Options = {}) {
  const r = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, opts);
  const result = (r.body as { result: { content: { text: string }[]; isError?: boolean } }).result;
  return { isError: !!result.isError, text: result.content[0].text, data: (result.isError ? null : JSON.parse(result.content[0].text)) as any };
}

// ── Signing in ──────────────────────────────────────────────────────────────

test('a request without a token is told where to sign in', async () => {
  const r = await post({ jsonrpc: '2.0', id: 1, method: 'initialize' }, {}, { host: 'somastudy.app' });
  expect(r.status).toBe(401);
  expect(r.headers['WWW-Authenticate']).toBe('Bearer resource_metadata="https://somastudy.app/.well-known/oauth-protected-resource/api/mcp"');
  // Even a GET, which some clients send first.
  expect((await post(undefined, {}, { host: 'somastudy.app' }, 'GET')).status).toBe(401);
});

test('a token Soma does not accept is refused before anything is read', async () => {
  const db = memoryDb(); let reads = 0;
  const counting: ConnectorDb = { ...db, select: async (...a) => { reads++; return db.select(...a); } };
  const r = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_courses' } }, { db: counting, authorize: async () => ({ ok: false, status: 401, error: 'auth_required' }) });
  expect(r.status).toBe(401);
  expect(r.headers['WWW-Authenticate']).toContain('error="invalid_token"');
  expect(reads).toBe(0);
});

// Supabase's user endpoint decides whose token it is (it accepts the tokens
// its OAuth server issues to Claude: confirmed live 2026-10-11), and a refusal
// is logged with its reason, since the first failed connection left no trace.
test('a token is judged by Supabase, then by the subscription, and a refusal logs why', async () => {
  const admin = (user: Row | null, error: Row | null = null, sub: Row | null = { status: 'active', trial_start: null, extension_start: null }) => {
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: sub, error: null }) };
    return { auth: { getUser: async () => ({ data: { user }, error }) }, from: () => query };
  };
  expect(await authorizeConnector(admin({ id: 'student', email: 'a@b.c' }), 't')).toEqual({ ok: true, userId: 'student' });
  expect(await authorizeConnector(admin({ id: 'student' }, null, null), 't')).toMatchObject({ ok: false, status: 402 });
  const logged: string[] = [], quiet = console.error; console.error = (line: string) => { logged.push(line); };
  try {
    expect(await authorizeConnector(admin(null, { status: 403, code: 'bad_jwt' }), 'secret-token')).toMatchObject({ ok: false, status: 401 });
    // Supabase being down is not the student's token being wrong.
    expect(await authorizeConnector(admin(null, { status: 502 }), 't')).toMatchObject({ ok: false, status: 503 });
  } finally { console.error = quiet; }
  expect(logged).toEqual(['{"event":"connector_token_refused","status":403,"code":"bad_jwt"}']);
});

test('the sign-in server is published where Claude looks for it', async () => {
  const handler = createConnectorHandler({ authServer: () => 'https://soma.supabase.co/auth/v1', fetchJson: async url => ({ issuer: 'https://soma.supabase.co/auth/v1', asked: url }) });
  const a = response();
  await handler({ method: 'GET', headers: { host: 'somastudy.app' }, query: { connector: 'resource' } }, a.res);
  expect(a.result.body).toMatchObject({ resource: 'https://somastudy.app/api/mcp', authorization_servers: ['https://soma.supabase.co/auth/v1'] });
  const b = response();
  await handler({ method: 'GET', headers: { host: 'somastudy.app' }, query: { connector: 'server' } }, b.res);
  expect(b.result.body).toEqual({ issuer: 'https://soma.supabase.co/auth/v1', asked: 'https://soma.supabase.co/.well-known/oauth-authorization-server/auth/v1' });
  // A made-up Host header can't put another site's address in the reply.
  const c = response();
  await handler({ method: 'GET', headers: { host: 'evil.example/"x' }, query: { connector: 'resource' } }, c.res);
  expect(c.result.body).toMatchObject({ resource: 'https://somastudy.app/api/mcp' });
});

test('an account with no subscription connects, and each tool says why it will not run', async () => {
  const db = memoryDb();
  const lapsed = { db, authorize: async () => ({ ok: false as const, status: 402, error: 'subscription_required' }) };
  expect((await post({ jsonrpc: '2.0', id: 1, method: 'initialize' }, lapsed)).status).toBe(200);
  const r = await tool('add_tasks', { tasks: [{ title: 'Sneaky', course: 'Physics 5A', date: '2026-10-13', minutes: 30 }] }, lapsed);
  expect(r.isError).toBe(true);
  expect(r.text).toContain('no active subscription or trial');
  expect(db.writes).toEqual([]);
});

// ── The protocol ────────────────────────────────────────────────────────────

test('Claude can start a session and list the tools', async () => {
  const init = await post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } } });
  expect(init.body).toMatchObject({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'soma' } } });
  const note = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  expect([note.status, note.ended, note.body]).toEqual([202, true, undefined]);
  const listed = await post({ jsonrpc: '2.0', id: 'a', method: 'tools/list' });
  const tools = (listed.body as { result: { tools: { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[] } }).result.tools;
  expect(tools.map(t => t.name)).toEqual(['get_courses', 'get_plan', 'get_deadlines', 'get_reading_lists', 'get_study_time', 'get_documents', 'read_document', 'save_reading_list', 'add_tasks', 'move_tasks']);
  expect(tools.filter(t => !t.annotations.readOnlyHint).map(t => t.name)).toEqual(['save_reading_list', 'add_tasks', 'move_tasks']);
  expect(tools.every(t => t.annotations.destructiveHint === false)).toBe(true);
  expect((await post({ jsonrpc: '2.0', id: 2, method: 'resources/list' })).body).toMatchObject({ error: { code: -32601 } });
  expect((await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'delete_everything' } })).body).toMatchObject({ error: { code: -32602 } });
  expect((await post('not json')).status).toBe(400);
  expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}, { authorization: 'Bearer token', host: 'somastudy.app' }, 'GET')).status).toBe(405);
});

test('no tool can delete or check work off; what the connector may write is listed here', () => {
  const source = readFileSync('api/_connector.ts', 'utf8');
  expect(source).not.toMatch(/\.delete\(|delete\(table/);
  // The only tables written: tasks, their blocks, and reading-list sections.
  expect([...new Set([...source.matchAll(/db\.(insert|upsert|update)\('(\w+)'/g)].map(m => `${m[1]} ${m[2]}`))].sort()).toEqual(['insert todo_sessions', 'insert todos', 'update course_items', 'update todo_sessions', 'update todos', 'upsert course_items']);
  // A task that already exists is only ever given a new day: never a status, never a name.
  expect(source.match(/db\.update\('todos'[^\n]*/g)).toEqual(["db.update('todos', userId, [move.task.id], { date: day });"]);
  expect(source.match(/db\.update\('todo_sessions'[^\n]*/g)).toEqual(["db.update('todo_sessions', userId, [text(move.block.id)], times);"]);
  expect(source).not.toMatch(/done_at:\s*(new|now|')/);
  expect(TOOLS.filter(t => !t.readOnly).map(t => t.name)).toEqual(['save_reading_list', 'add_tasks', 'move_tasks']);
  // A task carries a day and a length; a start only when the student agreed to it, bounds when Soma picks.
  const task = (TOOLS.find(t => t.name === 'add_tasks')!.inputSchema.properties.tasks as { items: { properties: Row } }).items.properties;
  expect(Object.keys(task).sort()).toEqual(['after', 'before', 'course', 'date', 'due', 'minutes', 'sections', 'start', 'title']);
});

// ── Reading ─────────────────────────────────────────────────────────────────

test('the plan matches the dashboard: blocks at their times, untimed tasks on their day, nobody else\'s', async () => {
  const { data } = await tool('get_plan', { from: '2026-10-11', to: '2026-10-13', timezone: 'America/Los_Angeles' });
  expect(data.today).toBe('2026-10-12');
  expect(data.days.map((d: Row) => [d.date, d.weekday])).toEqual([['2026-10-11', 'Sun'], ['2026-10-12', 'Mon'], ['2026-10-13', 'Tue']]);
  expect(data.days[0].tasks).toEqual([{ id: 't2', title: 'Math 53 homework 14.3', course: 'Math 53', status: 'done', due: '2026-10-13' }]);
  // A stored time with no zone is UTC, as the app reads it: 23:00Z is 4 PM in Los Angeles.
  // A block is named by its own id, a task with no time by the task's: what move_tasks takes.
  expect(data.days[1].tasks).toEqual([{ id: 's1', title: 'Physics reading: 4.1–4.2', course: 'Physics 5A', status: 'open', time: '16:00–17:00', minutes: 60, sections: ['4.2'] }]);
  expect(data.days[2].tasks).toEqual([{ id: 't3', title: 'Problem set 6', course: 'Physics 5A', status: 'open', estimated_minutes: 90, due: '2026-10-16' }]);
  expect(JSON.stringify(data)).not.toContain('Their essay');
  // Without a time zone the reply says its times are UTC rather than passing them off as local.
  const utc = await tool('get_plan', { from: '2026-10-12', to: '2026-10-12' });
  expect(utc.data.timezone).toContain('UTC (no timezone was given');
  expect(utc.data.days[0].tasks[0].time).toBe('23:00–00:00');
  expect((await tool('get_plan', { from: '2026-10-01', to: '2026-12-01' })).text).toBe('Ask for at most 31 days at a time.');
  expect((await tool('get_plan', { timezone: 'Mars/Olympus' })).isError).toBe(true);
  expect((await tool('get_plan', { day: '2026-10-12' })).text).toBe('get_plan does not take "day".');
});

// "now let claude see my google calendar events too" (2026-10-11).
test('the plan lists Google Calendar events on their days, as the dashboard draws them', async () => {
  const at = (day: string, clock: string) => Date.parse(`${day}T${clock}:00-07:00`);
  const events = [
    { title: 'Physics 5A lecture', start: at('2026-10-12', '09:00'), end: at('2026-10-12', '09:59') },
    { title: 'Fall break', start: at('2026-10-13', '00:00'), end: at('2026-10-14', '00:00'), allDay: true },
    { title: 'Overnight shift', start: at('2026-10-13', '22:00'), end: at('2026-10-14', '02:00') },
  ];
  let asked: number[] = [];
  const { data } = await tool('get_plan', { from: '2026-10-12', to: '2026-10-14', timezone: 'America/Los_Angeles' }, { calendar: async (...a: unknown[]) => { asked = a.slice(1, 3) as number[]; return cal(events); } });
  // The whole of the days asked for, in the student's zone.
  expect(asked).toEqual([at('2026-10-12', '00:00'), at('2026-10-15', '00:00')]);
  expect(data.days.map((d: Row) => d.events)).toEqual([
    [{ title: 'Physics 5A lecture', time: '09:00–09:59' }],
    [{ title: 'Fall break', all_day: true }, { title: 'Overnight shift', time: '22:00–23:59' }],
    [{ title: 'Overnight shift', time: '00:00–02:00' }],
  ]);
  // Tasks are still there beside them, and the plan says nothing about the calendar when it was read in full.
  expect(data.days[0].tasks.map((t: Row) => t.title)).toEqual(['Physics reading: 4.1–4.2']);
  expect(data.calendar).toBeUndefined();
  // A calendar that can't be read, or isn't connected, leaves the plan intact and says which.
  const unread = await tool('get_plan', { from: '2026-10-12', to: '2026-10-12' }, { calendar: async () => { throw new Error('down'); } });
  expect(unread.data.calendar).toContain('could not read all of the student\'s Google Calendar');
  expect(unread.data.days[0].tasks).toHaveLength(1);
  expect((await tool('get_plan', { from: '2026-10-12', to: '2026-10-12' }, { calendar: async () => cal([], true, false) })).data.calendar).toBe('No Google Calendar is connected in Soma, so no events are listed.');
});

test('reading lists report done only from checkmarks, and courses, deadlines and study time are the student\'s own', async () => {
  const lists = await tool('get_reading_lists', { course: 'physics' });
  expect(lists.data.reading_lists).toEqual([{ course: 'Physics 5A', sections: [
    { label: '4.1', title: 'Momentum', done: true }, { label: '4.2', title: 'Impulse', done: false, planned: true }, { label: '4.3', done: false }, { label: '4.4', done: false },
  ] }]);
  const courses = await tool('get_courses');
  expect(courses.data.courses).toEqual([
    { name: 'Physics 5A', reading_list: { sections: 4, done: 1, next: '4.2' } }, { name: 'Math 53' }, { name: 'Chem 1A', archived: true },
  ]);
  const due = await tool('get_deadlines', { timezone: 'America/Los_Angeles' });
  expect(due.data.deadlines).toEqual([{ title: 'Problem set 6', course: 'Physics 5A', due: '2026-10-16', weekday: 'Fri', kind: 'homework', status: 'open' }]);
  const time = await tool('get_study_time', { timezone: 'America/Los_Angeles' });
  expect(time.data).toMatchObject({ from: '2026-10-06', to: '2026-10-12', total_minutes: 45, by_course: [{ course: 'Math 53', minutes: 45 }] });
  expect(time.data.days).toEqual([{ date: '2026-10-11', weekday: 'Sun', minutes: 45, sessions: [{ course: 'Math 53', task: 'Math 53 homework 14.3', time: '19:00–19:45', minutes: 45 }] }]);
});

test('documents are read in pieces, and only the student\'s own', async () => {
  const docs = await tool('get_documents');
  expect(docs.data.documents).toEqual([{ id: '11111111-1111-4111-8111-111111111111', name: 'Physics syllabus.pdf', course: 'Physics 5A', type: 'syllabus' }]);
  const first = await tool('read_document', { id: '11111111-1111-4111-8111-111111111111' });
  expect(first.data).toMatchObject({ characters: 54_000, next_offset: 40_000 });
  expect(first.data.text).toHaveLength(40_000);
  const rest = await tool('read_document', { id: '11111111-1111-4111-8111-111111111111', offset: 40_000 });
  expect(rest.data.text).toHaveLength(14_000);
  expect(rest.data.next_offset).toBeUndefined();
  expect((await tool('read_document', { id: '22222222-2222-4222-8222-222222222222' })).text).toBe('No document with that id. Use get_documents to list them.');
});

// ── Adding tasks ────────────────────────────────────────────────────────────

const LA = 'America/Los_Angeles';
/** An instant from Los Angeles wall-clock time in October 2026 (UTC−7). */
const la = (day: string, clock: string) => Date.parse(`${day}T${clock}:00-07:00`);
const added = (db: ReturnType<typeof memoryDb>) => db.data.todos.filter(t => !['t1', 't2', 't3', 't9'].includes(String(t.id)));
const blocksOf = (db: ReturnType<typeof memoryDb>) => db.data.todo_sessions.filter(b => b.id !== 's1').map(({ id: _id, todo_id: _todo, ...b }) => b);

test('Soma places each task in the first open stretch of its day and says when', async () => {
  const db = memoryDb();
  // A class 9:00–9:59 on Wednesday.
  const r = await tool('add_tasks', { timezone: LA, tasks: [
    { title: '  Stewart 3.4:\n problems 5, 11, 23  ', course: 'physics 5a', date: '2026-10-14', minutes: 45, due: '2026-10-16', sections: ['4.3', '4.2', '4.1', '9.9'] },
    { title: 'Review lecture 12', course: 'Math', date: '2026-10-14', minutes: 30 },
  ] }, { db, calendar: async () => cal([[la('2026-10-14', '09:00'), la('2026-10-14', '09:59')]]) });
  expect(r.data.added).toEqual([
    // Study hours open at 8.
    { title: 'Stewart 3.4: problems 5, 11, 23', course: 'Physics 5A', date: '2026-10-14', weekday: 'Wed', time: '08:00–08:45', minutes: 45, sections: ['4.3'], sections_not_linked: ['4.2 (already planned under another task)', '4.1 (already done)', '9.9 (not on the reading list)'] },
    // 8:45–9:00 is too short, and class runs to 9:59: the next round time after it.
    { title: 'Review lecture 12', course: 'Math 53', date: '2026-10-14', weekday: 'Wed', time: '10:00–10:30', minutes: 30 },
  ]);
  expect(r.data.note).toContain('These are the times saved in Soma');
  expect(added(db).map(({ id: _id, ...t }) => t)).toEqual([
    { user_id: ME, text: 'Stewart 3.4: problems 5, 11, 23', subject_id: 'phys', assignment_id: null, estimated_minutes: 45, status: 'nothing', date: '2026-10-14', due_date: '2026-10-16', kind: null, notes: null, order: null },
    { user_id: ME, text: 'Review lecture 12', subject_id: 'math', assignment_id: null, estimated_minutes: 30, status: 'nothing', date: '2026-10-14', due_date: null, kind: null, notes: null, order: null },
  ]);
  // Saved the way the dashboard saves a block: the day, and the start and end as instants.
  expect(blocksOf(db)).toEqual([
    { user_id: ME, date: '2026-10-14', start_time: '2026-10-14T15:00:00.000Z', end_time: '2026-10-14T15:45:00.000Z' },
    { user_id: ME, date: '2026-10-14', start_time: '2026-10-14T17:00:00.000Z', end_time: '2026-10-14T17:30:00.000Z' },
  ]);
  expect(db.data.todo_sessions.slice(1).map(b => b.todo_id)).toEqual(added(db).map(t => t.id));
  expect(db.data.course_items.find(i => i.id === 'i3')!.todo_id).toBe(added(db)[0].id);
  expect(db.data.course_items.find(i => i.id === 'i2')!.todo_id).toBe('t1');
  expect(db.data.course_items.find(i => i.id === 'i1')!.done_at).toBe('2026-10-10T05:00:00Z');
  // And Claude reads the same times back from the plan.
  const plan = await tool('get_plan', { from: '2026-10-14', to: '2026-10-14', timezone: LA }, { db });
  expect(plan.data.days[0].tasks.map((t: Row) => [t.title, t.time])).toEqual([['Stewart 3.4: problems 5, 11, 23', '08:00–08:45'], ['Review lecture 12', '10:00–10:30']]);
});

test('today\'s tasks start from now, go round the blocks already there, and keep to a time the student named', async () => {
  const db = memoryDb();   // noon on Monday; "Physics reading" is planned 4–5 PM
  const r = await tool('add_tasks', { timezone: LA, tasks: [
    { title: 'Problem set 5 corrections', course: 'Physics 5A', date: '2026-10-12', minutes: 120 },
    { title: 'Lab report draft', course: 'Physics 5A', date: '2026-10-12', minutes: 180 },
    { title: 'Flashcards', course: 'Math 53', date: '2026-10-12', minutes: 30, after: '21:00' },
    { title: 'Quiz review', course: 'Math 53', date: '2026-10-12', minutes: 45, after: '20:00', before: '21:00' },
  ] }, { db });
  expect(r.data.added.map((t: Row) => [t.title, t.time])).toEqual([
    ['Problem set 5 corrections', '12:00–14:00'],
    // Two hours are left before the 4 PM block, so three hours go after it.
    ['Lab report draft', '17:00–20:00'],
    ['Flashcards', '21:00–21:30'],
    ['Quiz review', '20:00–20:45'],
  ]);
  // Never in the past: at 12:07 the next start is 12:15.
  const later = memoryDb();
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add_tasks', arguments: { timezone: LA, tasks: [{ title: 'Quick review', course: 'Math 53', date: '2026-10-12', minutes: 20 }] } } };
  const { result, res } = response();
  await createConnectorHandler({ authorize: async () => ({ ok: true, userId: ME }), db: () => later, limited: () => false, calendar: async () => cal(), now: () => new Date('2026-10-12T19:07:00Z') })({ method: 'POST', headers: { authorization: 'Bearer t', host: 'somastudy.app' }, body, query: { connector: 'mcp' } }, res);
  expect(JSON.parse((result.body as any).result.content[0].text).added[0].time).toBe('12:15–12:35');
});

test('a task that does not fit on its day is not added, and Claude is told what is open', async () => {
  const db = memoryDb();
  // Tuesday is busy 8:00–20:30 apart from 12:00–12:40.
  const tuesday: Busy[] = [[la('2026-10-13', '08:00'), la('2026-10-13', '12:00')], [la('2026-10-13', '12:40'), la('2026-10-13', '20:30')]];
  const r = await tool('add_tasks', { timezone: LA, tasks: [
    { title: 'Practice midterm', course: 'Math 53', date: '2026-10-13', minutes: 180 },
    { title: 'Short quiz prep', course: 'Math 53', date: '2026-10-13', minutes: 30 },
    { title: 'Evening only', course: 'Math 53', date: '2026-10-13', minutes: 60, before: '18:00' },
  ] }, { db, calendar: async () => cal(tuesday) });
  expect(r.data.added.map((t: Row) => [t.title, t.time])).toEqual([['Short quiz prep', '12:00–12:30']]);
  expect(r.data.not_added).toEqual([
    { title: 'Practice midterm', course: 'Math 53', date: '2026-10-13', minutes: 180, reason: 'No 180 minutes free on Tue 2026-10-13, inside study hours (08:00–23:00) and clear of the calendar and other blocks. If the student agreed to a specific time, including one outside study hours, send it as start.', open_that_day: ['12:00–12:40 (40 min)', '20:30–23:00 (150 min)'] },
    { title: 'Evening only', course: 'Math 53', date: '2026-10-13', minutes: 60, reason: 'No 60 minutes free on Tue 2026-10-13 before 18:00, inside study hours (08:00–23:00) and clear of the calendar and other blocks. If the student agreed to a specific time, including one outside study hours, send it as start.', open_that_day: 'nothing' },
  ]);
  expect(added(db).map(t => t.text)).toEqual(['Short quiz prep']);
  // An all-day event fills the day on the dashboard, so nothing is placed on it.
  const allDay = await tool('add_tasks', { timezone: LA, tasks: [{ title: 'Reading', course: 'Math 53', date: '2026-10-15', minutes: 30 }] }, { db: memoryDb(), calendar: async () => cal([{ title: 'Fall break', start: la('2026-10-15', '00:00'), end: la('2026-10-16', '00:00'), allDay: true }]) });
  expect(allDay.data.added).toEqual([]);
  expect(allDay.data.not_added[0].open_that_day).toBe('nothing');
});

test('a calendar Soma cannot read means no time is picked, and sending the task again places it', async () => {
  const db = memoryDb();
  const task = { title: 'Chapter 5 outline', course: 'Math 53', date: '2026-10-14', minutes: 60 };
  const first = await tool('add_tasks', { timezone: LA, tasks: [task, { title: 'Full practice exam', course: 'Math 53', date: '2026-10-14', minutes: 300 }] }, { db, calendar: async () => cal([], false) });
  expect(first.data.added.map((t: Row) => [t.title, t.time, String(t.no_time).slice(0, 40)])).toEqual([
    ['Chapter 5 outline', undefined, 'Soma could not read the student\'s Google'],
    ['Full practice exam', undefined, 'Longer than 4 hours, the most Soma place'],
  ]);
  expect(blocksOf(db)).toEqual([]);
  expect(first.data.note).toBeUndefined();
  // The calendar is back: the same task gets its time, and is not added twice.
  const again = await tool('add_tasks', { timezone: LA, tasks: [task] }, { db });
  expect(again.data.added).toEqual([]);
  expect(again.data.given_a_time).toEqual([{ title: 'Chapter 5 outline', course: 'Math 53', date: '2026-10-14', weekday: 'Wed', time: '08:00–09:00', minutes: 60 }]);
  expect(added(db).map(t => t.text)).toEqual(['Chapter 5 outline', 'Full practice exam']);
  expect(db.data.todo_sessions.slice(1).map(b => b.todo_id)).toEqual([added(db)[0].id]);
  // A calendar read that throws is treated the same way.
  const broken = await tool('add_tasks', { timezone: LA, tasks: [{ title: 'Notes', course: 'Math 53', date: '2026-10-15', minutes: 30 }] }, { db: memoryDb(), calendar: async () => { throw new Error('down'); } });
  expect(broken.data.added[0].no_time).toContain('could not read');
});

test('study hours decide where a day starts and ends, including past midnight and when they are off', async () => {
  const hours = (studyWindow: Row) => { const db = memoryDb(); db.data.settings = [{ user_id: ME, data: { studyWindow } }, { user_id: OTHER, data: { studyWindow: { start: '03:00', end: '04:00' } } }]; return db; };
  // 8 PM to 2 AM: four hours end at midnight, and the next hour starts on Thursday.
  const night = hours({ start: '20:00', end: '02:00' });
  const r = await tool('add_tasks', { timezone: LA, tasks: [
    { title: 'Essay draft', course: 'Math 53', date: '2026-10-14', minutes: 240 },
    { title: 'Essay edit', course: 'Math 53', date: '2026-10-14', minutes: 60 },
    { title: 'One more hour', course: 'Math 53', date: '2026-10-14', minutes: 90 },
  ] }, { db: night });
  expect(r.data.added.map((t: Row) => [t.title, t.date, t.weekday, t.time])).toEqual([['Essay draft', '2026-10-14', 'Wed', '20:00–00:00'], ['Essay edit', '2026-10-15', 'Thu', '00:00–01:00']]);
  expect(r.data.not_added.map((t: Row) => [t.title, t.open_that_day])).toEqual([['One more hour', ['01:00–02:00 (60 min)']]]);
  // A block is saved on the day it starts, and so is its task, as the dashboard does.
  expect(blocksOf(night).map(b => [b.date, b.start_time])).toEqual([['2026-10-14', '2026-10-15T03:00:00.000Z'], ['2026-10-15', '2026-10-15T07:00:00.000Z']]);
  expect(added(night).map(t => t.date)).toEqual(['2026-10-14', '2026-10-15']);
  // Off: any hour, but not before 8 AM unless the student named a time.
  const off = hours({ start: '08:00', end: '23:00', off: true });
  const o = await tool('add_tasks', { timezone: LA, tasks: [
    { title: 'Morning pages', course: 'Math 53', date: '2026-10-14', minutes: 60 },
    { title: 'Before class', course: 'Math 53', date: '2026-10-14', minutes: 45, after: '06:00' },
    { title: 'Late night', course: 'Math 53', date: '2026-10-14', minutes: 60, after: '23:30' },
  ] }, { db: off });
  expect(o.data.added.map((t: Row) => t.time)).toEqual(['08:00–09:00', '06:00–06:45']);
  expect(o.data.not_added[0].reason).toContain('inside study hours (any hour (study hours are off))');
  // No saved settings: the app's default, 8 AM to 11 PM.
  const none = memoryDb(); none.data.settings = [];
  expect((await tool('add_tasks', { timezone: LA, tasks: [{ title: 'Default hours', course: 'Math 53', date: '2026-10-14', minutes: 30 }] }, { db: none })).data.added[0].time).toBe('08:00–08:30');
});

test('a time zone that does not match the student\'s own sessions places nothing', async () => {
  const db = memoryDb();
  // Three evenings of study in Los Angeles, each saved on the day it started.
  for (const [i, day] of ['2026-10-07', '2026-10-08', '2026-10-09'].entries()) db.data.timer_sessions.push({ id: `e${i}`, user_id: ME, subject_id: 'math', task_text: 'Homework', date: day, start_time: new Date(la(day, '20:00')).toISOString(), end_time: new Date(la(day, '21:00')).toISOString(), duration_seconds: 3600 });
  const task = { title: 'Wrong zone', course: 'Math 53', date: '2026-10-14', minutes: 30 };
  const utc = await tool('add_tasks', { timezone: 'UTC', tasks: [task] }, { db });
  expect(utc.isError).toBe(true);
  expect(utc.text).toContain('"UTC" does not match the days this student\'s study sessions were saved on');
  expect(db.writes).toEqual([]);
  expect((await tool('add_tasks', { tasks: [task] }, { db })).text).toContain('Pass the student\'s time zone');
  expect((await tool('add_tasks', { timezone: 'Mars/Olympus', tasks: [task] }, { db })).isError).toBe(true);
  expect(db.writes).toEqual([]);
  expect((await tool('add_tasks', { timezone: LA, tasks: [task] }, { db })).data.added[0].time).toBe('08:00–08:30');
});

// "Soma ignored the overnight again. It only places tasks between about 8am
// and midnight … I can't set clock times, so you'll need to drag the blocks"
// (2026-10-11): an all-nighter the student had agreed to could not be entered.
test('a time the student agreed to is saved exactly, overnight and outside study hours included', async () => {
  const db = memoryDb();   // study hours 8 AM–11 PM; noon on Monday
  const lecture = { title: 'Physics discussion', start: la('2026-10-13', '03:00'), end: la('2026-10-13', '04:00') };
  const r = await tool('add_tasks', { timezone: LA, tasks: [
    { title: 'HW weeks 4-6', course: 'Physics 5A', date: '2026-10-12', minutes: 120, start: '23:00' },
    { title: 'English reading', course: 'Math 53', date: '2026-10-13', minutes: 60, start: '01:00' },
    { title: 'Ch 4-5 hard topics', course: 'Physics 5A', date: '2026-10-13', minutes: 105, start: '02:00' },
    { title: 'Past midterms 1-2, timed', course: 'Physics 5A', date: '2026-10-13', minutes: 480, start: '11:00' },
  ] }, { db, calendar: async () => cal([lecture]) });
  expect(r.data.not_added).toBeUndefined();
  expect(r.data.added.map((t: Row) => [t.title, t.date, t.weekday, t.time, t.over_calendar_events])).toEqual([
    ['HW weeks 4-6', '2026-10-12', 'Mon', '23:00–01:00', undefined],
    ['English reading', '2026-10-13', 'Tue', '01:00–02:00', undefined],
    // Over a calendar event is the student's call; the reply says which.
    ['Ch 4-5 hard topics', '2026-10-13', 'Tue', '02:00–03:45', ['Physics discussion']],
    // Longer than Soma would size a block itself, but the student said so.
    ['Past midterms 1-2, timed', '2026-10-13', 'Tue', '11:00–19:00', undefined],
  ]);
  expect(blocksOf(db).map(b => [b.date, b.start_time, b.end_time])).toEqual([
    ['2026-10-12', '2026-10-13T06:00:00.000Z', '2026-10-13T08:00:00.000Z'],
    ['2026-10-13', '2026-10-13T08:00:00.000Z', '2026-10-13T09:00:00.000Z'],
    ['2026-10-13', '2026-10-13T09:00:00.000Z', '2026-10-13T10:45:00.000Z'],
    ['2026-10-13', '2026-10-13T18:00:00.000Z', '2026-10-14T02:00:00.000Z'],
  ]);
  expect(added(db).map(t => t.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-13', '2026-10-13']);
  // A calendar that can't be read doesn't stop a time the student chose.
  const unread = await tool('add_tasks', { timezone: LA, tasks: [{ title: 'Cheat sheet', course: 'Physics 5A', date: '2026-10-14', minutes: 120, start: '05:00' }] }, { db: memoryDb(), calendar: async () => cal([], false) });
  expect(unread.data.added[0].time).toBe('05:00–07:00');
});

test('an agreed time is refused only when it has passed or lands on another block', async () => {
  const db = memoryDb();   // "Physics reading" is planned Monday 4–5 PM; it is noon
  const r = await tool('add_tasks', { timezone: LA, tasks: [
    { title: 'Morning review', course: 'Math 53', date: '2026-10-12', minutes: 60, start: '09:00' },
    { title: 'Problem session', course: 'Math 53', date: '2026-10-12', minutes: 60, start: '16:30' },
    { title: 'Just now', course: 'Math 53', date: '2026-10-12', minutes: 30, start: '11:50' },
    { title: 'After the first', course: 'Math 53', date: '2026-10-12', minutes: 30, start: '12:00' },
  ] }, { db });
  expect(r.data.not_added.map((t: Row) => [t.title, t.reason])).toEqual([
    ['Morning review', 'That start time has already passed.'],
    ['Problem session', 'That overlaps "Physics reading: 4.1–4.2" (16:00–17:00). Move that block first, or use another time.'],
    // Two tasks in one request can't take the same time either.
    ['After the first', 'That overlaps "Just now" (11:50–12:20). Move that block first, or use another time.'],
  ]);
  // "Start now" a few minutes late still saves.
  expect(r.data.added.map((t: Row) => [t.title, t.time])).toEqual([['Just now', '11:50–12:20']]);
  // A start and bounds together is a contradiction, caught before anything is saved.
  const both = await tool('add_tasks', { timezone: LA, tasks: [{ title: 'Which?', course: 'Math 53', date: '2026-10-14', minutes: 30, start: '18:00', after: '17:00' }] }, { db });
  expect(both.text).toContain('Task 1 ("Which?"): give start, or after/before, not both.');
  expect(added(db).map(t => t.text)).toEqual(['Just now']);
});

test('Claude can move a block to another time or day, and give a time to a task that has none', async () => {
  const db = memoryDb();
  const r = await tool('move_tasks', { timezone: LA, moves: [
    { id: 's1', date: '2026-10-12', start: '23:00' },   // tonight instead of 4 PM, same length
    { id: 't3', date: '2026-10-14' },                    // no time yet: Soma picks one, 90 minutes from its estimate
  ] }, { db });
  expect(r.data.moved).toEqual([
    { id: 's1', title: 'Physics reading: 4.1–4.2', was: 'Mon 2026-10-12 16:00–17:00', date: '2026-10-12', weekday: 'Mon', time: '23:00–00:00', minutes: 60 },
    { id: 't3', title: 'Problem set 6', was: 'Tue 2026-10-13, no time', date: '2026-10-14', weekday: 'Wed', time: '08:00–09:30', minutes: 90 },
  ]);
  expect(db.data.todo_sessions.find(b => b.id === 's1')).toMatchObject({ todo_id: 't1', date: '2026-10-12', start_time: '2026-10-13T06:00:00.000Z', end_time: '2026-10-13T07:00:00.000Z' });
  expect(blocksOf(db)).toEqual([{ user_id: ME, date: '2026-10-14', start_time: '2026-10-14T15:00:00.000Z', end_time: '2026-10-14T16:30:00.000Z' }]);
  // The task's own day follows its only block; nothing else about either task changed.
  expect(db.data.todos.find(t => t.id === 't3')).toEqual({ id: 't3', user_id: ME, text: 'Problem set 6', subject_id: 'phys', status: 'nothing', date: '2026-10-14', due_date: '2026-10-16', kind: 'homework', estimated_minutes: 90 });
  expect(db.data.todos.find(t => t.id === 't1')).toEqual({ id: 't1', user_id: ME, text: 'Physics reading: 4.1–4.2', subject_id: 'phys', status: 'nothing', date: '2026-10-12', estimated_minutes: 60 });
  expect(db.data.todos).toHaveLength(4);
  // To another day and a new length, Soma picking the time around what's there.
  const next = await tool('move_tasks', { timezone: LA, moves: [{ id: 's1', date: '2026-10-14', minutes: 120 }] }, { db });
  expect(next.data.moved[0]).toMatchObject({ was: 'Mon 2026-10-12 23:00–00:00', date: '2026-10-14', time: '09:30–11:30', minutes: 120 });
  expect(db.data.todos.find(t => t.id === 't1')!.date).toBe('2026-10-14');
});

test('blocks moved together make room for each other, and one that cannot move stays put', async () => {
  const db = memoryDb();
  db.data.todos.push({ id: 't4', user_id: ME, text: 'Cheat sheet', subject_id: 'phys', status: 'nothing', date: '2026-10-12' });
  db.data.todo_sessions.push({ id: 's4', user_id: ME, todo_id: 't4', date: '2026-10-12', start_time: new Date(la('2026-10-12', '18:00')).toISOString(), end_time: new Date(la('2026-10-12', '19:00')).toISOString() });
  // A swap: each takes the other's time.
  const swap = await tool('move_tasks', { timezone: LA, moves: [{ id: 's1', date: '2026-10-12', start: '18:00' }, { id: 's4', date: '2026-10-12', start: '16:00' }] }, { db });
  expect(swap.data.moved.map((m: Row) => [m.title, m.time])).toEqual([['Physics reading: 4.1–4.2', '18:00–19:00'], ['Cheat sheet', '16:00–17:00']]);
  // Onto a block that isn't moving: refused, and it keeps its time.
  const blocked = await tool('move_tasks', { timezone: LA, moves: [{ id: 's4', date: '2026-10-12', start: '18:30' }] }, { db });
  expect(blocked.data.moved).toEqual([]);
  expect(blocked.data.not_moved).toEqual([{ id: 's4', title: 'Cheat sheet', was: 'Mon 2026-10-12 16:00–17:00', reason: 'That overlaps "Physics reading: 4.1–4.2" (18:00–19:00). Move that block first, or use another time.' }]);
  expect(db.data.todo_sessions.find(b => b.id === 's4')!.start_time).toBe(new Date(la('2026-10-12', '16:00')).toISOString());
});

test('finished work, another student\'s blocks and made-up ids are not moved', async () => {
  const db = memoryDb();
  db.data.todo_sessions.push({ id: 's9', user_id: OTHER, todo_id: 't9', date: '2026-10-12', start_time: '2026-10-12T20:00:00Z', end_time: '2026-10-12T21:00:00Z' });
  const r = await tool('move_tasks', { timezone: LA, moves: [
    { id: 't2', date: '2026-10-14' }, { id: 's9', date: '2026-10-14' }, { id: 't9', date: '2026-10-14' }, { id: 'nope', date: '2026-10-14' },
    { id: 't1', date: '2026-10-14' }, { id: 's1', date: '2026-10-11' }, { id: 's1', date: '2026-10-14', start: '7pm' },
  ] }, { db });
  expect(r.isError).toBe(true);
  expect(r.text).toContain('Nothing was moved.');
  expect(r.text).toContain('Move 1 ("Math 53 homework 14.3"): it is checked off, and finished work is not moved.');
  expect(r.text).toContain('Move 2: nothing on the plan has the id "s9".');
  expect(r.text).toContain('Move 3: nothing on the plan has the id "t9".');
  expect(r.text).toContain('Move 4: nothing on the plan has the id "nope".');
  // A task that has a block is moved by the block's id, so it's clear which sitting is meant.
  expect(r.text).toContain('Move 5: nothing on the plan has the id "t1".');
  expect(r.text).toContain('Move 6 ("Physics reading: 4.1–4.2"): 2026-10-11 is in the past.');
  expect(r.text).not.toContain('Their essay');
  expect(db.writes).toEqual([]);
  expect((await tool('move_tasks', { timezone: LA, moves: [{ id: 's1', date: '2026-10-14', start: '7pm' }] }, { db })).text).toContain('start must be a 24-hour time like 18:00.');
  expect((await tool('move_tasks', { moves: [{ id: 's1', date: '2026-10-14' }] }, { db })).text).toContain('Pass the student\'s time zone');
  expect(db.writes).toEqual([]);
});

test('a repeat, or a task already checked off, is skipped rather than doubled', async () => {
  const db = memoryDb();
  const r = await tool('add_tasks', { timezone: LA, tasks: [
    { title: 'physics reading: 4.1-4.2', course: 'Physics 5A', date: '2026-10-12', minutes: 60 },
    { title: 'Math 53 Homework 14.3', course: 'Math 53', date: '2026-10-15', minutes: 60 },
    { title: 'Practice midterm', course: 'Math 53', date: '2026-10-15', minutes: 120 },
    { title: 'Practice  Midterm', course: 'Math 53', date: '2026-10-15', minutes: 120 },
  ] }, { db });
  expect(r.data.added.map((t: Row) => t.title)).toEqual(['Practice midterm']);
  expect(r.data.skipped).toEqual([
    { title: 'physics reading: 4.1-4.2', reason: 'Already on 2026-10-12. To change its time, use move_tasks.' },
    { title: 'Math 53 Homework 14.3', reason: 'A task with this name in Math 53 is already checked off. If this is new work, give it a different title.' },
    { title: 'Practice Midterm', reason: 'Already on 2026-10-15. To change its time, use move_tasks.' },
  ]);
  expect(db.data.todos).toHaveLength(5);
  expect(db.data.todo_sessions).toHaveLength(2);
});

test('one bad task means nothing is added, and the reply says what to fix', async () => {
  const db = memoryDb();
  const r = await tool('add_tasks', { timezone: LA, tasks: [
    { title: 'Fine', course: 'Physics 5A', date: '2026-10-14', minutes: 45 },
    { title: 'When?', course: 'Physics 5A', date: 'next tuesday', minutes: 45 },
    { title: 'Yesterday', course: 'Physics 5A', date: '2026-10-11', minutes: 45 },
    { title: 'All day', course: 'Physics 5A', date: '2026-10-14', minutes: 5000 },
    { title: 'Whose?', course: 'History 7B', date: '2026-10-14', minutes: 45 },
    { title: 'x'.repeat(141), course: 'Physics 5A', date: '2026-10-14', minutes: 45 },
    { title: 'Sixish', course: 'Physics 5A', date: '2026-10-14', minutes: 45, after: '6pm' },
  ] }, { db });
  expect(r.isError).toBe(true);
  expect(r.text).toContain('Nothing was added.');
  expect(r.text).toContain('Task 2 ("When?"): date must be a date like 2026-10-12.');
  expect(r.text).toContain('Task 3 ("Yesterday"): 2026-10-11 is in the past.');
  expect(r.text).toContain('Task 4 ("All day"): minutes must be a whole number from 5 to 720.');
  // Another student's course is not a course here, and is never named.
  expect(r.text).toContain('No course is called "History 7B". The student\'s courses: Physics 5A, Math 53.');
  expect(r.text).toContain('Task 6\'s title is longer than 140 characters');
  expect(r.text).toContain('Task 7 ("Sixish"): after must be a 24-hour time like 18:00.');
  expect(db.writes).toEqual([]);
  expect((await tool('add_tasks', { timezone: LA, tasks: Array.from({ length: 21 }, (_, i) => ({ title: `T${i}`, course: 'Math 53', date: '2026-10-14', minutes: 30 })) }, { db })).text).toBe('tasks takes at most 20 entries at a time.');
  expect((await tool('add_tasks', { timezone: LA, tasks: [{ title: 'Busy', course: 'Math 53', date: '2026-10-14', minutes: 30 }] }, { db, limited: () => true })).text).toContain('Too many requests');
  expect(db.writes).toEqual([]);
});

// ── The placement rules ─────────────────────────────────────────────────────

test('clock times are worked out in the student\'s zone, across a clock change too', () => {
  expect(new Date(zonedToUtc('2026-10-14', 8 * 60, LA)).toISOString()).toBe('2026-10-14T15:00:00.000Z');
  // Clocks go back on Sun Nov 1 2026: midnight is still UTC−7, 8 AM is UTC−8.
  expect(new Date(zonedToUtc('2026-11-01', 0, LA)).toISOString()).toBe('2026-11-01T07:00:00.000Z');
  expect(new Date(zonedToUtc('2026-11-01', 8 * 60, LA)).toISOString()).toBe('2026-11-01T16:00:00.000Z');
  // And forward on Sun Mar 8 2026.
  expect(new Date(zonedToUtc('2026-03-08', 8 * 60, LA)).toISOString()).toBe('2026-03-08T15:00:00.000Z');
  // Minutes past 1440 carry into the next day; a half-hour zone works too.
  expect(new Date(zonedToUtc('2026-10-14', 25 * 60, LA)).toISOString()).toBe('2026-10-15T08:00:00.000Z');
  expect(new Date(zonedToUtc('2026-10-14', 9 * 60, 'Asia/Kolkata')).toISOString()).toBe('2026-10-14T03:30:00.000Z');
  // On the morning the clocks change, a task still lands at 8 by the student's clock.
  const spot = firstFit(openSlots('2026-11-01', LA, { start: '08:00', end: '23:00' }, [], Date.parse('2026-10-30T00:00:00Z')), 60)!;
  expect([clockAt(LA, spot[0]), clockAt(LA, spot[1])]).toEqual(['08:00', '09:00']);
});

test('study hours are read from saved settings the way the app reads them', () => {
  expect(studyWindowOf({ studyWindow: { start: '09:30', end: '01:00', off: false } })).toEqual({ start: '09:30', end: '01:00' });
  expect(studyWindowOf({ studyWindow: { start: '09:30', end: '22:00', off: true } })).toEqual({ start: '09:30', end: '22:00', off: true });
  expect(studyWindowOf(null)).toEqual({ start: '08:00', end: '23:00' });
  expect(studyWindowOf({ studyWindow: { start: 'nine', end: '22:00' } })).toEqual({ start: '08:00', end: '23:00' });
  // An account from before study hours were one window: the widest span of its old per-day hours.
  expect(studyWindowOf({ personalHours: { mon: { start: '10:00', end: '21:00' }, tue: { start: '07:30', end: '22:30' }, wed: {} } })).toEqual({ start: '07:30', end: '22:30' });
  expect(studyWindowOf({ personalHoursEnabled: false, personalHours: { mon: { start: '10:00', end: '21:00' } } })).toEqual({ start: '08:00', end: '23:00' });
});

test('the zone check needs real disagreement before it refuses', () => {
  const evening = (day: string) => ({ day, start: la(day, '20:00') });
  const three = ['2026-10-07', '2026-10-08', '2026-10-09'].map(evening);
  expect(zoneFitsHistory(three, LA)).toBe(true);
  expect(zoneFitsHistory(three, 'UTC')).toBe(false);
  expect(zoneFitsHistory(three, 'Asia/Tokyo')).toBe(false);
  // A new account, or one odd row, is not evidence.
  expect(zoneFitsHistory([], 'UTC')).toBe(true);
  expect(zoneFitsHistory(three.slice(0, 2), 'UTC')).toBe(true);
  // Mostly at home, a few sessions logged on a trip: still home.
  expect(zoneFitsHistory([...three, ...three, { day: '2026-10-02', start: la('2026-10-01', '22:00') }], LA)).toBe(true);
});

test('the calendar is read as a title and a time, nothing more, and it says when it is incomplete', async () => {
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  const rows = [
    { id: 'c1', user_id: ME, google_email: 'a@example.com', refresh_token: 'r', access_token: 'tok-1', access_token_expires_at: soon, selected_calendars: [{ id: 'classes' }, { id: 'broken' }] },
    { id: 'c2', user_id: ME, google_email: 'b@example.com', refresh_token: 'r', access_token: 'tok-2', access_token_expires_at: soon, selected_calendars: [] },
  ];
  const filters: [string, string][] = [];
  const admin = (data: unknown) => ({ from: () => ({ select: () => ({ eq: async (k: string, v: string) => { filters.push([k, v]); return { data, error: null }; } }) }) });
  const asked: string[] = [], fields: string[] = [], realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: { headers: Record<string, string> }) => {
    asked.push(`${init.headers.Authorization} ${new URL(url).pathname.split('/')[4]}`);
    fields.push(new URL(url).searchParams.get('fields')!);
    if (url.includes('/broken/')) return new Response('nope', { status: 403 });
    return Response.json({ items: [
      { summary: 'Fall break', start: { date: '2026-10-15' }, end: { date: '2026-10-16' } },
      { summary: '  Physics\n lecture ', description: 'Room 4, bring the lab notebook', location: 'Pimentel', start: { dateTime: '2026-10-14T09:00:00-07:00' }, end: { dateTime: '2026-10-14T09:59:00-07:00' } },
      { start: { dateTime: '2026-10-14T11:00:00-07:00' }, end: { dateTime: '2026-10-14T12:00:00-07:00' } },
      { summary: 'Cancelled lab', status: 'cancelled', start: { dateTime: '2026-10-14T13:00:00-07:00' }, end: { dateTime: '2026-10-14T15:00:00-07:00' } },
    ] });
  }) as never;
  try {
    const read = await googleEvents(admin(rows), ME, la('2026-10-14', '00:00'), la('2026-10-16', '00:00'), LA);
    expect(read).toEqual({ complete: false, connected: true, events: [   // one calendar could not be read
      { title: 'Physics lecture', start: la('2026-10-14', '09:00'), end: la('2026-10-14', '09:59') },
      { title: 'Calendar commitment', start: la('2026-10-14', '11:00'), end: la('2026-10-14', '12:00') },
      { title: 'Fall break', start: la('2026-10-15', '00:00'), end: la('2026-10-16', '00:00'), allDay: true },
    ] });
    // Descriptions, locations and guests are not even asked for.
    expect(new Set(fields)).toEqual(new Set(['nextPageToken,items(status,summary,start,end)']));
    expect(filters).toEqual([['user_id', ME]]);
    expect(asked.sort()).toEqual(['Bearer tok-1 broken', 'Bearer tok-1 classes']);
    // No calendar chosen on any account: nothing is asked of Google, and it says so.
    asked.length = 0;
    expect(await googleEvents(admin([rows[1]]), ME, 0, 1, LA)).toEqual({ events: [], complete: true, connected: false });
    expect(asked).toEqual([]);
  } finally { globalThis.fetch = realFetch; }
  const failing = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: 'down' } }) }) }) };
  expect(await googleEvents(failing, ME, 0, 1, LA)).toEqual({ events: [], complete: false, connected: true });
});

// ── Reading lists ───────────────────────────────────────────────────────────

test('a reading list gains finer sections and keeps its progress, its plans and everything left out', async () => {
  const db = memoryDb();
  const r = await tool('save_reading_list', { course: 'Physics 5A', sections: [
    { label: '4.2', title: 'Impulse, pp. 140–150' },
    { label: '4.2a', title: 'Worked examples 4.5–4.8', due: '2026-10-15' },
    { label: '4.3', title: 'Collisions, pp. 151–163' },
  ] }, { db });
  expect(r.data).toMatchObject({ course: 'Physics 5A', added: ['4.2a'], updated: ['4.2', '4.3'], total_sections: 5 });
  const list = db.data.course_items.filter(i => i.subject_id === 'phys').sort((a, b) => Number(a.position) - Number(b.position));
  expect(list.map(i => [i.label, i.title, i.position])).toEqual([['4.1', 'Momentum', 0], ['4.2', 'Impulse, pp. 140–150', 1], ['4.2a', 'Worked examples 4.5–4.8', 2], ['4.3', 'Collisions, pp. 151–163', 3], ['4.4', null, 4]]);
  // What was read stays read, and the block planned for 4.2 is still planned for it.
  expect(list[0].done_at).toBe('2026-10-10T05:00:00Z');
  expect(list[1].todo_id).toBe('t1');
  expect(list[2]).toMatchObject({ user_id: ME, due_date: '2026-10-15', done_at: null, todo_id: null });
  expect((await tool('save_reading_list', { course: 'Physics 5A', sections: [{ label: '5.1' }, { label: '5.1' }] }, { db })).text).toBe('"5.1" is listed twice. Each label can appear once.');
  expect((await tool('save_reading_list', { course: 'Biology', sections: [{ label: '1' }] }, { db })).isError).toBe(true);
});

// ── The database boundary ───────────────────────────────────────────────────

test('every query is limited to the signed-in student, whatever the rows say', async () => {
  const calls: { table: string; op: string; rows?: Row[]; filters: [string, unknown][] }[] = [];
  const admin = { from(table: string) {
    const call = { table, op: '', filters: [] as [string, unknown][], rows: undefined as Row[] | undefined };
    calls.push(call);
    const q: any = {
      select: () => { call.op ||= 'select'; return q; }, order: () => q, range: () => q,
      eq: (k: string, v: unknown) => { call.filters.push([k, v]); return q; }, in: (k: string, v: unknown) => { call.filters.push([k, v]); return q; },
      insert: (rows: Row[]) => { call.op = 'insert'; call.rows = rows; return q; }, upsert: (rows: Row[]) => { call.op = 'upsert'; call.rows = rows; return q; },
      update: (values: Row) => { call.op = 'update'; call.rows = [values]; return q; },
      then: (done: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(done),
    };
    return q;
  } };
  const db = supabaseDb(admin);
  await db.select('todos', ME);
  await db.select('documents', ME, { id: 'doc' });
  await db.select('settings', ME, { columns: 'data', first: true });
  await db.insert('todos', ME, [{ id: 'x', user_id: OTHER }]);
  await db.upsert('course_items', ME, [{ id: 'y', user_id: OTHER }]);
  await db.update('course_items', ME, ['y'], { todo_id: 'x' });
  expect(calls.map(c => [c.op, c.filters])).toEqual([
    ['select', [['user_id', ME]]], ['select', [['user_id', ME], ['id', 'doc']]], ['select', [['user_id', ME]]], ['insert', []], ['upsert', []], ['update', [['user_id', ME], ['id', ['y']]]],
  ]);
  expect(calls[3].rows).toEqual([{ id: 'x', user_id: ME }]);
  expect(calls[4].rows).toEqual([{ id: 'y', user_id: ME }]);
});

// ── Where it is deployed ────────────────────────────────────────────────────

test('the connector rides on an existing function, and the course-site import is unchanged', async () => {
  // This Vercel plan deploys twelve functions; a thirteenth fails the deploy.
  expect(readdirSync('api').filter(f => f.endsWith('.ts') && !f.startsWith('_')).length).toBeLessThanOrEqual(12);
  const rewrites = (JSON.parse(readFileSync('vercel.json', 'utf8')) as { rewrites: { source: string; destination: string }[] }).rewrites;
  const at = (source: string) => rewrites.findIndex(r => r.source === source);
  expect(rewrites[at('/api/mcp')].destination).toBe('/api/import-schedule?connector=mcp');
  expect(rewrites[at('/.well-known/oauth-protected-resource/:path*')].destination).toBe('/api/import-schedule?connector=resource');
  expect(rewrites[at('/.well-known/oauth-authorization-server')].destination).toBe('/api/import-schedule?connector=server');
  // The catch-alls would swallow these paths if they came first.
  for (const source of ['/api/mcp', '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server/:path*']) {
    expect(at(source)).toBeGreaterThanOrEqual(0);
    expect(at(source)).toBeLessThan(at('/api/(.*)'));
  }
  // The function Vercel runs: the file's default export (api/ is CommonJS, so it may arrive wrapped).
  const exported = importSchedule.default as unknown as { default?: unknown };
  const hosted = (typeof exported === 'function' ? exported : exported.default) as (req: unknown, res: unknown) => Promise<unknown>;
  const asConnector = response(), asImport = response();
  await hosted({ method: 'POST', headers: { host: 'somastudy.app' }, query: { connector: 'mcp' }, body: {} }, asConnector.res);
  expect(asConnector.result.headers['WWW-Authenticate']).toContain('oauth-protected-resource');
  await hosted({ method: 'POST', headers: {}, query: {}, body: { url: 'https://cs61a.org', today: '2026-10-12' } }, asImport.res);
  expect([asImport.result.status, asImport.result.body, asImport.result.headers['WWW-Authenticate']]).toEqual([401, { error: 'auth_required' }, undefined]);
});

// ── The approval page ───────────────────────────────────────────────────────

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
async function approval(page: Page, opts: { signedIn?: boolean; redirectUri?: string; client?: string } = {}) {
  const state = { decisions: [] as string[], asked: 0 };
  if (opts.signedIn !== false) await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path.endsWith('/oauth/authorizations/auth-123/consent')) {
      const action = String(req.postDataJSON().action);
      state.decisions.push(action);
      return route.fulfill({ json: { redirect_url: action === 'approve' ? 'https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz' : 'https://claude.ai/api/mcp/auth_callback?error=access_denied&state=xyz' } });
    }
    if (path.endsWith('/oauth/authorizations/auth-123')) {
      state.asked++;
      return route.fulfill({ json: { authorization_id: 'auth-123', redirect_uri: opts.redirectUri ?? 'https://claude.ai/api/mcp/auth_callback', client: { id: 'c1', name: opts.client ?? 'Claude' }, user: { id: account.id, email: account.email }, scope: 'email' } });
    }
    if (path.includes('/oauth/authorizations/')) return route.fulfill({ status: 404, json: { message: 'not found' } });
    if (path.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (path.endsWith('/settings')) return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    return route.fulfill({ json: [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('https://claude.ai/**', r => r.fulfill({ contentType: 'text/html', body: '<title>Back in Claude</title>' }));
  return state;
}

test('the student sees what Claude will be able to do, and Allow sends them back to Claude', async ({ page }) => {
  const state = await approval(page);
  await page.goto('/oauth/consent?authorization_id=auth-123');
  await expect(page.getByRole('heading', { name: 'Let Claude use your Soma?' })).toBeVisible();
  await expect(page.getByText('Signed in as student@example.com')).toBeVisible();
  await expect(page.getByText('uploaded documents and the Google Calendar events shown in Soma')).toBeVisible();
  await expect(page.getByText('Add tasks, move them to another time, and add reading-list sections')).toBeVisible();
  await expect(page.getByText('it can’t delete anything or check work off')).toBeVisible();
  await expect(page.getByText('This is not Claude')).toHaveCount(0);
  expect(state.decisions).toEqual([]);   // nothing is granted by opening the page
  await page.getByRole('button', { name: 'Allow' }).click();
  await page.waitForURL('https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz');
  expect(state.decisions).toEqual(['approve']);
});

test('Cancel refuses the connection', async ({ page }) => {
  const state = await approval(page);
  await page.goto('/oauth/consent?authorization_id=auth-123');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForURL(/error=access_denied/);
  expect(state.decisions).toEqual(['deny']);
});

test('an app that only calls itself Claude is shown for what it is', async ({ page }) => {
  await approval(page, { redirectUri: 'https://claude-connect.example.net/callback', client: 'Claude' });
  await page.goto('/oauth/consent?authorization_id=auth-123');
  // Named by where it sends the student, never by the name it gave itself.
  await expect(page.getByRole('heading', { name: 'Let claude-connect.example.net use your Soma?' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('This is not Claude. Allowing it gives claude-connect.example.net access to your Soma account.');
  await expect(page.getByText('it can’t delete anything')).toHaveCount(0);
});

test('signed out, the student signs in first; a broken or expired link says so', async ({ page }) => {
  const state = await approval(page, { signedIn: false });
  await page.goto('/oauth/consent?authorization_id=auth-123');
  await expect(page.getByText('Sign in to Soma to finish connecting Claude.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  expect(state.asked).toBe(0);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('soma_connect_return')!).path)).toBe('/oauth/consent?authorization_id=auth-123');
});

test('a link with no request, or one that has expired, asks the student to start again', async ({ page }) => {
  await approval(page);
  await page.goto('/oauth/consent');
  await expect(page.getByText('This link is incomplete. Go back to Claude and connect Soma again.')).toBeVisible();
  await page.goto('/oauth/consent?authorization_id=gone-456');
  await expect(page.getByRole('alert')).toContainText('This request has expired');
  await expect(page.getByRole('button', { name: 'Allow' })).toHaveCount(0);
});

test('signing in with Google from the approval page comes back to it', async ({ page }) => {
  await approval(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); sessionStorage.setItem('soma_connect_return', JSON.stringify({ path: '/oauth/consent?authorization_id=auth-123', at: Date.now() })); }
  });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/oauth\/consent\?authorization_id=auth-123$/);
  await expect(page.getByRole('heading', { name: 'Let Claude use your Soma?' })).toBeVisible();
});
