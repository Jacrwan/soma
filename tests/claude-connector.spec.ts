import { test, expect, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'fs';
import { createConnectorHandler, authorizeConnector } from '../api/_mcp';
import { supabaseDb, TOOLS, type ConnectorDb } from '../api/_connector';
import * as importSchedule from '../api/import-schedule';

// The Claude connector (2026-10-11): a student adds Soma to Claude, which can
// then read their plan and add tasks and reading-list sections. "i cant give
// soma the entire pdf doc of a texbook, but i can give it to claude … and even
// ask claude what problems to solve from the textbook". Claude picks what,
// which day and how long; it never writes a clock time, marks work done or
// deletes anything.

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

function response() {
  const result = { status: 200, body: undefined as unknown, headers: {} as Record<string, string>, ended: false };
  const res = { status: (s: number) => { result.status = s; return res; }, json: (v: unknown) => { result.body = v; return res; }, setHeader: (k: string, v: string) => { result.headers[k] = v; }, end: () => { result.ended = true; } };
  return { result, res };
}
type Options = { db?: ConnectorDb; authorize?: () => Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }>; limited?: () => boolean };
async function post(body: unknown, opts: Options = {}, headers: Record<string, string> = { authorization: 'Bearer token', host: 'somastudy.app' }, method = 'POST') {
  const { result, res } = response();
  const db = opts.db ?? memoryDb();
  await createConnectorHandler({ authorize: opts.authorize ?? (async () => ({ ok: true, userId: ME })), db: () => db, limited: opts.limited ?? (() => false), now: () => NOW, authServer: () => 'https://soma.supabase.co/auth/v1' })({ method, headers, body, query: { connector: 'mcp' } }, res);
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

// Whether Supabase's user endpoint accepts a token its OAuth server issued to
// an app is not confirmed, so the connector can also verify one by signature.
test('a token issued to Claude is accepted on its signature when the user endpoint refuses it', async () => {
  const ISSUER = 'https://soma.supabase.co/auth/v1', STUDENT = '11111111-1111-4111-8111-111111111111';
  const good = { sub: STUDENT, email: 'student@example.com', iss: ISSUER, role: 'authenticated', aud: 'authenticated', client_id: 'claude-client' };
  const admin = (claims: Row | null, sub: Row | null = { status: 'active', trial_start: null, extension_start: null }, userEndpoint: Row | null = null) => {
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: sub, error: null }) };
    return {
      auth: {
        getUser: async () => userEndpoint ? { data: { user: userEndpoint }, error: null } : { data: { user: null }, error: { status: 403, code: 'bad_jwt' } },
        getClaims: async () => claims ? { data: { claims }, error: null } : { data: null, error: { status: 401, code: 'invalid_jwt' } },
      },
      from: () => query,
    };
  };
  const quiet = console.error; console.error = () => {};
  try {
    expect(await authorizeConnector(admin(good), 't', ISSUER)).toEqual({ ok: true, userId: STUDENT });
    // The subscription rule still applies to the student the signature names.
    expect(await authorizeConnector(admin(good, null), 't', ISSUER)).toMatchObject({ ok: false, status: 402 });
    // A bad signature, another project's token, a signed-out role, or an
    // ordinary session the user endpoint refused: all turned away.
    expect(await authorizeConnector(admin(null), 't', ISSUER)).toMatchObject({ ok: false, status: 401 });
    expect(await authorizeConnector(admin({ ...good, iss: 'https://other.supabase.co/auth/v1' }), 't', ISSUER)).toMatchObject({ ok: false, status: 401 });
    expect(await authorizeConnector(admin({ ...good, role: 'anon' }), 't', ISSUER)).toMatchObject({ ok: false, status: 401 });
    expect(await authorizeConnector(admin({ ...good, sub: 'not-an-id' }), 't', ISSUER)).toMatchObject({ ok: false, status: 401 });
    expect(await authorizeConnector(admin({ ...good, client_id: undefined }), 't', ISSUER)).toMatchObject({ ok: false, status: 401 });
  } finally { console.error = quiet; }
  // When the user endpoint does accept the token, that is who it is.
  expect(await authorizeConnector(admin(null, undefined, { id: 'from-endpoint', email: 'a@b.c' }), 't', ISSUER)).toEqual({ ok: true, userId: 'from-endpoint' });
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
  expect(tools.map(t => t.name)).toEqual(['get_courses', 'get_plan', 'get_deadlines', 'get_reading_lists', 'get_study_time', 'get_documents', 'read_document', 'save_reading_list', 'add_tasks']);
  expect(tools.filter(t => !t.annotations.readOnlyHint).map(t => t.name)).toEqual(['save_reading_list', 'add_tasks']);
  expect(tools.every(t => t.annotations.destructiveHint === false)).toBe(true);
  expect((await post({ jsonrpc: '2.0', id: 2, method: 'resources/list' })).body).toMatchObject({ error: { code: -32601 } });
  expect((await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'delete_everything' } })).body).toMatchObject({ error: { code: -32602 } });
  expect((await post('not json')).status).toBe(400);
  expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}, { authorization: 'Bearer token', host: 'somastudy.app' }, 'GET')).status).toBe(405);
});

test('no tool can delete, check work off, or write a clock time', () => {
  const source = readFileSync('api/_connector.ts', 'utf8');
  expect(source).not.toMatch(/\.delete\(|delete\(table/);
  // The only tables written are tasks and reading-list sections.
  expect([...source.matchAll(/db\.(insert|upsert|update)\('(\w+)'/g)].map(m => `${m[1]} ${m[2]}`).sort()).toEqual(['insert todos', 'update course_items', 'upsert course_items']);
  expect(TOOLS.filter(t => !t.readOnly).map(t => t.name)).toEqual(['save_reading_list', 'add_tasks']);
});

// ── Reading ─────────────────────────────────────────────────────────────────

test('the plan matches the dashboard: blocks at their times, untimed tasks on their day, nobody else\'s', async () => {
  const { data } = await tool('get_plan', { from: '2026-10-11', to: '2026-10-13', timezone: 'America/Los_Angeles' });
  expect(data.today).toBe('2026-10-12');
  expect(data.days.map((d: Row) => [d.date, d.weekday])).toEqual([['2026-10-11', 'Sun'], ['2026-10-12', 'Mon'], ['2026-10-13', 'Tue']]);
  expect(data.days[0].tasks).toEqual([{ title: 'Math 53 homework 14.3', course: 'Math 53', status: 'done', due: '2026-10-13' }]);
  // A stored time with no zone is UTC, as the app reads it: 23:00Z is 4 PM in Los Angeles.
  expect(data.days[1].tasks).toEqual([{ title: 'Physics reading: 4.1–4.2', course: 'Physics 5A', status: 'open', time: '16:00–17:00', minutes: 60, sections: ['4.2'] }]);
  expect(data.days[2].tasks).toEqual([{ title: 'Problem set 6', course: 'Physics 5A', status: 'open', estimated_minutes: 90, due: '2026-10-16' }]);
  expect(JSON.stringify(data)).not.toContain('Their essay');
  // Without a time zone the reply says its times are UTC rather than passing them off as local.
  const utc = await tool('get_plan', { from: '2026-10-12', to: '2026-10-12' });
  expect(utc.data.timezone).toContain('UTC (no timezone was given');
  expect(utc.data.days[0].tasks[0].time).toBe('23:00–00:00');
  expect((await tool('get_plan', { from: '2026-10-01', to: '2026-12-01' })).text).toBe('Ask for at most 31 days at a time.');
  expect((await tool('get_plan', { timezone: 'Mars/Olympus' })).isError).toBe(true);
  expect((await tool('get_plan', { day: '2026-10-12' })).text).toBe('get_plan does not take "day".');
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

test('tasks land on their day with a length and no clock time', async () => {
  const db = memoryDb();
  const r = await tool('add_tasks', { tasks: [
    { title: '  Stewart 3.4:\n problems 5, 11, 23  ', course: 'physics 5a', date: '2026-10-14', minutes: 45, due: '2026-10-16', sections: ['4.3', '4.2', '4.1', '9.9'] },
    { title: 'Review lecture 12', course: 'Math', date: '2026-10-14', minutes: 30 },
  ] }, { db });
  expect(r.data.added).toEqual([
    { title: 'Stewart 3.4: problems 5, 11, 23', course: 'Physics 5A', date: '2026-10-14', weekday: 'Wed', minutes: 45, sections: ['4.3'], sections_not_linked: ['4.2 (already planned under another task)', '4.1 (already done)', '9.9 (not on the reading list)'] },
    { title: 'Review lecture 12', course: 'Math 53', date: '2026-10-14', weekday: 'Wed', minutes: 30 },
  ]);
  expect(r.data.note).toContain('without a clock time');
  const saved = db.data.todos.filter(t => !['t1', 't2', 't3', 't9'].includes(String(t.id)));
  expect(saved.map(({ id: _id, ...t }) => t)).toEqual([
    { user_id: ME, text: 'Stewart 3.4: problems 5, 11, 23', subject_id: 'phys', assignment_id: null, estimated_minutes: 45, status: 'nothing', date: '2026-10-14', due_date: '2026-10-16', kind: null, notes: null, order: null },
    { user_id: ME, text: 'Review lecture 12', subject_id: 'math', assignment_id: null, estimated_minutes: 30, status: 'nothing', date: '2026-10-14', due_date: null, kind: null, notes: null, order: null },
  ]);
  // No block is written, so no clock time; the section it covers is now planned under it.
  expect(db.data.todo_sessions).toHaveLength(1);
  expect(db.data.course_items.find(i => i.id === 'i3')!.todo_id).toBe(saved[0].id);
  expect(db.data.course_items.find(i => i.id === 'i2')!.todo_id).toBe('t1');
  expect(db.data.course_items.find(i => i.id === 'i1')!.done_at).toBe('2026-10-10T05:00:00Z');
});

test('a repeat, or a task already checked off, is skipped rather than doubled', async () => {
  const db = memoryDb();
  const r = await tool('add_tasks', { tasks: [
    { title: 'physics reading: 4.1-4.2', course: 'Physics 5A', date: '2026-10-12', minutes: 60 },
    { title: 'Math 53 Homework 14.3', course: 'Math 53', date: '2026-10-15', minutes: 60 },
    { title: 'Practice midterm', course: 'Math 53', date: '2026-10-15', minutes: 120 },
    { title: 'Practice  Midterm', course: 'Math 53', date: '2026-10-15', minutes: 120 },
  ] }, { db });
  expect(r.data.added.map((t: Row) => t.title)).toEqual(['Practice midterm']);
  expect(r.data.skipped).toEqual([
    { title: 'physics reading: 4.1-4.2', reason: 'Already on 2026-10-12.' },
    { title: 'Math 53 Homework 14.3', reason: 'A task with this name in Math 53 is already checked off. If this is new work, give it a different title.' },
    { title: 'Practice Midterm', reason: 'Already on 2026-10-15.' },
  ]);
  expect(db.data.todos).toHaveLength(5);
});

test('one bad task means nothing is added, and the reply says what to fix', async () => {
  const db = memoryDb();
  const r = await tool('add_tasks', { tasks: [
    { title: 'Fine', course: 'Physics 5A', date: '2026-10-14', minutes: 45 },
    { title: 'When?', course: 'Physics 5A', date: 'next tuesday', minutes: 45 },
    { title: 'Long ago', course: 'Physics 5A', date: '2026-09-01', minutes: 45 },
    { title: 'All day', course: 'Physics 5A', date: '2026-10-14', minutes: 5000 },
    { title: 'Whose?', course: 'History 7B', date: '2026-10-14', minutes: 45 },
    { title: 'x'.repeat(141), course: 'Physics 5A', date: '2026-10-14', minutes: 45 },
  ] }, { db });
  expect(r.isError).toBe(true);
  expect(r.text).toContain('Nothing was added.');
  expect(r.text).toContain('Task 2 ("When?"): date must be a date like 2026-10-12.');
  expect(r.text).toContain('Task 3 ("Long ago"): 2026-09-01 is in the past.');
  expect(r.text).toContain('Task 4 ("All day"): minutes must be a whole number from 5 to 720.');
  // Another student's course is not a course here, and is never named.
  expect(r.text).toContain('No course is called "History 7B". The student\'s courses: Physics 5A, Math 53.');
  expect(r.text).toContain('Task 6\'s title is longer than 140 characters');
  expect(db.writes).toEqual([]);
  expect((await tool('add_tasks', { tasks: Array.from({ length: 21 }, (_, i) => ({ title: `T${i}`, course: 'Math 53', date: '2026-10-14', minutes: 30 })) }, { db })).text).toBe('tasks takes at most 20 entries at a time.');
  expect((await tool('add_tasks', { tasks: [{ title: 'Busy', course: 'Math 53', date: '2026-10-14', minutes: 30 }] }, { db, limited: () => true })).text).toContain('Too many requests');
  expect(db.writes).toEqual([]);
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
  await db.insert('todos', ME, [{ id: 'x', user_id: OTHER }]);
  await db.upsert('course_items', ME, [{ id: 'y', user_id: OTHER }]);
  await db.update('course_items', ME, ['y'], { todo_id: 'x' });
  expect(calls.map(c => [c.op, c.filters])).toEqual([
    ['select', [['user_id', ME]]], ['select', [['user_id', ME], ['id', 'doc']]], ['insert', []], ['upsert', []], ['update', [['user_id', ME], ['id', ['y']]]],
  ]);
  expect(calls[2].rows).toEqual([{ id: 'x', user_id: ME }]);
  expect(calls[3].rows).toEqual([{ id: 'y', user_id: ME }]);
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
  await expect(page.getByText('Add tasks and reading-list sections')).toBeVisible();
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
