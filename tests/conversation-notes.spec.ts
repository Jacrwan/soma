import { test, expect, type Page } from '@playwright/test';
import { queryTerms, relevantNotes, notesContext, updateConversationNote, loadConversationNotes, spokenReply, type ConversationNote, type NotesStore } from '../api/_notes';
import { createChatHandler } from '../api/chat';
import { createMemoryHandler } from '../api/memory';
import { emptyMemory, type MemoryStore, type MemoryState } from '../api/_memory';

// "I recall talking to Soma about what I'm gonna do for my CS midterm prep but
// it has no memory of it" (2026-10-08). Each conversation now keeps a short
// dated note; a later chat gets it back only when it matches what's asked.

const note = (id: string, conversationId: string, title: string, text: string, updatedAt = '2026-10-07T03:00:00Z'): ConversationNote => ({ id, conversationId, title, note: text, updatedAt });
const prep = note('n1', 'chat-a', 'CS 61A Midterm 2 prep', 'Plans to finish Lists and Dictionaries (did 2 questions), then Linked Lists, then redo missed practice-midterm problems.');
const math = note('n2', 'chat-b', 'Math 53 homework', 'Last week\'s homework is 14.3–14.5, due Thursday.');

function memStore(): NotesStore & { rows: ConversationNote[] } {
  const rows: ConversationNote[] = [];
  return {
    rows,
    list: async () => [...rows],
    search: async () => [...rows],
    get: async (_u, c) => rows.find(r => r.conversationId === c) ?? null,
    save: async (_u, c, title, text) => { const i = rows.findIndex(r => r.conversationId === c); const n = note(i >= 0 ? rows[i].id : `n${rows.length + 1}`, c, title, text, new Date().toISOString()); if (i >= 0) rows[i] = n; else rows.push(n); },
    edit: async (_u, id, title, text) => { const r = rows.find(x => x.id === id); if (!r) return false; Object.assign(r, { title, note: text }); return true; },
    remove: async (_u, id) => { const i = rows.findIndex(x => x.id === id); if (i < 0) return false; rows.splice(i, 1); return true; },
    clear: async () => { rows.length = 0; },
  };
}

test('only notes that clearly match the message come back, never the current chat\'s own', () => {
  const terms = queryTerms('what did we plan for my cs midterm prep?');
  expect(terms).toEqual(['plan', 'cs', 'midterm', 'prep']);
  expect(relevantNotes([prep, math], terms).map(n => n.id)).toEqual(['n1']);
  expect(relevantNotes([prep, math], queryTerms('hello how are you'))).toEqual([]);
  expect(relevantNotes([prep], terms, 'chat-a')).toEqual([]);
  expect(notesContext([prep])).toContain('- Wed 2026-10-07 · CS 61A Midterm 2 prep: Plans to finish Lists and Dictionaries');
});

test('a conversation\'s note is written from what was said, and updated in place', async () => {
  const store = memStore(); let input = '';
  const reply = JSON.stringify({ reply: 'Lists and Dictionaries first, then Linked Lists.', blocks: [{ title: 'CS 61A: Lists and Dictionaries' }] });
  const changed = await updateConversationNote({ userId: 'u', conversationId: 'chat-a', studentMessage: "i'm prepping for my cs midterm, did 2 of the lists questions", somaReply: reply, store, today: '2026-10-07',
    callModel: async (_s, u) => { input = u; return JSON.stringify({ note: { title: 'CS 61A Midterm 2 prep', text: 'Did 2 Lists and Dictionaries questions; next Linked Lists.' } }); } });
  expect(changed).toBe(true);
  expect(JSON.parse(input)).toMatchObject({ today: '2026-10-07', noteSoFar: null, somaReply: 'Lists and Dictionaries first, then Linked Lists.\nProposed blocks: CS 61A: Lists and Dictionaries' });
  await updateConversationNote({ userId: 'u', conversationId: 'chat-a', studentMessage: 'finished lists, starting linked lists', somaReply: '{"reply":"Nice."}', store,
    callModel: async (_s, u) => { input = u; return JSON.stringify({ note: { title: 'CS 61A Midterm 2 prep', text: 'Finished Lists and Dictionaries; now on Linked Lists.' } }); } });
  expect(JSON.parse(input).noteSoFar.text).toContain('Did 2 Lists');
  expect(store.rows).toHaveLength(1);
  expect(store.rows[0].note).toBe('Finished Lists and Dictionaries; now on Linked Lists.');
});

test('small talk, commands and unusable output leave notes alone', async () => {
  const store = memStore(); let calls = 0;
  const model = (out: string) => async () => { calls++; return out; };
  expect(await updateConversationNote({ userId: 'u', conversationId: 'c', studentMessage: 'hello!', somaReply: '{"reply":"Hi!"}', store, callModel: model('{"note":null}') })).toBe(false);
  expect(await updateConversationNote({ userId: 'u', conversationId: 'c', studentMessage: '/memories', somaReply: '', store, callModel: model('{}') })).toBe(false);
  expect(await updateConversationNote({ userId: 'u', conversationId: 'c', studentMessage: 'plan my week', somaReply: '{}', store, callModel: model('not json') })).toBe(false);
  expect(await updateConversationNote({ userId: 'u', conversationId: 'c', studentMessage: 'plan my week', somaReply: '{}', store, callModel: model(JSON.stringify({ note: { title: 'x'.repeat(200), text: 'too long a title' } })) })).toBe(false);
  expect(store.rows).toHaveLength(0);
  expect(calls).toBe(3);   // the command never reaches the model
  expect(spokenReply('not json at all')).toBe('not json at all');
});

test('recall is skipped when memory is paused, and a failure costs only the notes', async () => {
  const store = memStore(); store.rows.push(prep);
  expect(await loadConversationNotes('u', 'cs midterm prep', undefined, { store, enabled: async () => false })).toBe('');
  expect(await loadConversationNotes('u', 'cs midterm prep', undefined, { store: { ...store, search: async () => { throw new Error('db down'); } }, enabled: async () => true })).toBe('');
  expect(await loadConversationNotes('u', 'cs midterm prep', undefined, { store, enabled: async () => true })).toContain('CS 61A Midterm 2 prep');
});

const handlerDeps = { authorize: async () => ({ ok: true as const, userId: 'u' }), apiKey: () => 'k', limited: () => false, budget: async () => null, memory: async () => '', learn: async () => {} };
const res = () => { const out = { status: 0, body: null as unknown }; const r = { status: (s: number) => { out.status = s; return r; }, json: (b: unknown) => { out.body = b; return r; }, setHeader: () => {}, end: () => r }; return { out, r }; };

test('the chat sends matching notes with the newest message, and updates this chat\'s note after', async () => {
  let sent: { messages: { content: { text: string }[] }[] } | undefined; const noted: unknown[] = []; let deferred: Promise<unknown> | undefined;
  const { out, r } = res();
  await createChatHandler({ ...handlerDeps, defer: (t: Promise<unknown>) => { deferred = t; },
    notes: async (_u: string, q: string, c?: string) => (q.includes('midterm') && c === 'chat-b' ? 'EARLIER CONVERSATIONS: - CS 61A Midterm 2 prep' : ''),
    noteChat: async (...a: unknown[]) => { noted.push(a); },
    request: async (_u: string, init: { body: string }) => { sent = JSON.parse(init.body); return Response.json({ content: [{ type: 'text', text: '{"reply":"Linked Lists next."}' }] }); },
  } as never)({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { messages: [{ role: 'user', content: 'what was my midterm plan?' }], systemPrompt: 'Soma', model: 'sonnet', conversationId: 'chat-b' } }, r);
  await deferred;
  expect(out.status).toBe(200);
  expect(sent!.messages.at(-1)!.content[0].text).toContain('EARLIER CONVERSATIONS: - CS 61A Midterm 2 prep');
  expect(noted[0]).toEqual(['u', 'chat-b', 'what was my midterm plan?', '{"reply":"Linked Lists next."}', 'k']);
});

test('the first pass gets no notes and writes none, and a bad conversation id is refused', async () => {
  let lookups = 0, writes = 0;
  const { r } = res();
  await createChatHandler({ ...handlerDeps, defer: () => {}, notes: async () => { lookups++; return ''; }, noteChat: async () => { writes++; }, request: async () => Response.json({ content: [{ type: 'text', text: '{"route":"ask"}' }] }) } as never)
    ({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { messages: [{ role: 'user', content: 'hi' }], systemPrompt: 'Front desk', purpose: 'triage', conversationId: 'chat-b' } }, r);
  expect([lookups, writes]).toEqual([0, 0]);
  const bad = res();
  await createChatHandler(handlerDeps as never)({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { messages: [{ role: 'user', content: 'hi' }], conversationId: '../../etc' } }, bad.r);
  expect(bad.out).toEqual({ status: 400, body: { error: 'invalid_conversation' } });
});

function factStore(): MemoryStore { let s: MemoryState | null = emptyMemory(); return { read: async () => structuredClone(s), compareAndSet: async (_u, _p, n) => { s = structuredClone(n); return true; } }; }
async function memoryApi(notes: NotesStore, body?: Record<string, unknown>) {
  const { out, r } = res();
  await createMemoryHandler({ store: factStore(), notes, authenticate: async () => 'u', enabled: () => true, limited: () => false })({ method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer t' }, body }, r);
  return out as { status: number; body: { notes?: ConversationNote[]; error?: string } };
}

test('notes can be listed, edited, deleted and cleared through the memory API', async () => {
  const store = memStore(); store.rows.push({ ...prep, id: '11111111-1111-4111-8111-111111111111' }, { ...math, id: '22222222-2222-4222-8222-222222222222' });
  expect((await memoryApi(store)).body.notes).toHaveLength(2);
  const edited = await memoryApi(store, { action: 'edit_note', id: '11111111-1111-4111-8111-111111111111', title: 'CS 61A Midterm 2 prep', note: 'Linked Lists left.' });
  expect(edited.body.notes!.find(n => n.id.startsWith('1111'))!.note).toBe('Linked Lists left.');
  expect((await memoryApi(store, { action: 'edit_note', id: '11111111-1111-4111-8111-111111111111', title: '', note: 'x' })).body.error).toBe('invalid_note');
  expect((await memoryApi(store, { action: 'forget_note', id: '22222222-2222-4222-8222-222222222222' })).body.notes).toHaveLength(1);
  expect((await memoryApi(store, { action: 'forget_note', id: 'not-an-id' })).body.error).toBe('invalid_note');
  expect((await memoryApi(store, { action: 'clear' })).body.notes).toEqual([]);
});

// ── Settings → Memory ───────────────────────────────────────────────────────
const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
async function settings(page: Page) {
  const state = { notes: [{ ...prep, id: '11111111-1111-4111-8111-111111111111' }] as ConversationNote[], posts: [] as Record<string, unknown>[] };
  await page.addInitScript(a => { localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a })); }, account);
  await page.route('https://soma-regression.supabase.co/**', route => { const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!; if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account }); if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } }); return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] }); });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/memory', route => {
    if (route.request().method() === 'POST') {
      const a = route.request().postDataJSON(); state.posts.push(a);
      if (a.action === 'edit_note') state.notes = state.notes.map(n => (n.id === a.id ? { ...n, title: a.title, note: a.note } : n));
      if (a.action === 'forget_note') state.notes = state.notes.filter(n => n.id !== a.id);
    }
    return route.fulfill({ json: { revision: 1, enabled: true, entries: [], notes: state.notes } });
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
  return state;
}

test('Settings → Memory lists conversation notes, and they can be edited and deleted', async ({ page }) => {
  const state = await settings(page);
  const list = page.getByLabel('Conversation notes');
  await expect(list).toContainText('CS 61A Midterm 2 prep');
  await expect(list).toContainText('then Linked Lists');
  await list.getByRole('button', { name: 'Edit note: CS 61A Midterm 2 prep' }).click();
  await page.getByLabel('Note', { exact: true }).fill('Lists done. Linked Lists left, then the practice midterm.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(list).toContainText('Linked Lists left, then the practice midterm.');
  expect(state.posts[0]).toMatchObject({ action: 'edit_note', title: 'CS 61A Midterm 2 prep', note: 'Lists done. Linked Lists left, then the practice midterm.' });
  await list.getByRole('button', { name: 'Delete note: CS 61A Midterm 2 prep' }).click();
  await expect(list).toContainText('No notes yet.');
});

test('before the notes table exists, the rest of memory still works', async () => {
  const broken = { ...memStore(), list: async () => { throw new Error('relation "soma_conversation_notes" does not exist'); }, clear: async () => { throw new Error('missing'); } };
  const listed = await memoryApi(broken);
  expect(listed.status).toBe(200);
  expect(listed.body.notes).toEqual([]);
  expect((await memoryApi(broken, { action: 'clear' })).status).toBe(200);
});
