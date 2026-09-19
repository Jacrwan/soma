import { test, expect, type Page } from '@playwright/test';

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const at = (n: number, t: string) => { const d = offset(n); const [h, m] = t.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };
const TOMORROW = key(offset(1));
type Row = Record<string, unknown>;

// The reported plan, set tomorrow so the test doesn't depend on the clock:
// Physics and English early, CS in the evening.
function plan() {
  return {
    subjects: [
      { id: 'phys', user_id: account.id, name: 'Physics 5A', color: '#ab47bc', archived: false },
      { id: 'lit', user_id: account.id, name: 'COMLIT R1A', color: '#ef5350', archived: false },
      { id: 'cs', user_id: account.id, name: 'CS 61A', color: '#66bb6a', archived: false },
    ],
    todos: [
      { id: 't-phys', user_id: account.id, text: 'Physics reading guides', subject_id: 'phys', status: 'nothing', date: TOMORROW },
      { id: 't-lit', user_id: account.id, text: "Gulliver's Travels + Analysis Exercise 1", subject_id: 'lit', status: 'nothing', date: TOMORROW },
      { id: 't-cs', user_id: account.id, text: 'Hog project review', subject_id: 'cs', status: 'nothing', date: TOMORROW },
    ] as Row[],
    todo_sessions: [
      { id: 's-phys', user_id: account.id, todo_id: 't-phys', date: TOMORROW, start_time: at(1, '09:00'), end_time: at(1, '11:00') },
      { id: 's-lit', user_id: account.id, todo_id: 't-lit', date: TOMORROW, start_time: at(1, '11:00'), end_time: at(1, '12:30') },
      { id: 's-cs', user_id: account.id, todo_id: 't-cs', date: TOMORROW, start_time: at(1, '17:30'), end_time: at(1, '19:30') },
    ] as Row[],
  };
}

async function setup(page: Page, reply: unknown, edit?: (db: Record<string, Row[]>) => void) {
  const db: Record<string, Row[]> = { ...plan(), timer_sessions: [] };
  edit?.(db);
  const state = { db, prompt: '', deletes: [] as string[] };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    const rows = db[table];
    if (req.method() === 'POST' && rows) {
      const b = req.postDataJSON();
      for (const r of (Array.isArray(b) ? b : [b]) as Row[]) { const i = rows.findIndex(x => x.id === r.id); if (i < 0) rows.push(r); else rows[i] = { ...rows[i], ...r }; }
      return route.fulfill({ json: null });
    }
    if (req.method() === 'DELETE' && rows) {
      const id = url.searchParams.get('id')?.slice(3);
      state.deletes.push(`${table}:${id}`);
      db[table] = rows.filter(r => r.id !== id);
      return route.fulfill({ json: [{ id }] });
    }
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    let out = rows ?? [];
    for (const k of ['id', 'todo_id']) { const f = url.searchParams.get(k); if (f?.startsWith('eq.')) out = out.filter(r => String(r[k]) === f.slice(3)); }
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? out[0] ?? null : out });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/memory', r => r.fulfill({ json: { revision: 0, enabled: true, entries: [] } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/chat', route => {
    state.prompt = route.request().postDataJSON().systemPrompt;
    return route.fulfill({ json: { content: [{ text: JSON.stringify(reply) }] } });
  });
  await page.goto('/dashboard');
  await page.getByLabel('Next seven days').getByRole('button').nth(1).click();
  await expect(page.getByText('Hog project review')).toBeVisible();
  return state;
}
async function ask(page: Page, text: string) {
  await page.getByLabel('What do you need to work on?').fill(text);
  await page.getByRole('button', { name: 'Send to Soma' }).click();
}

test('Soma is given ids for your own blocks, but not for read-only calendar events', async ({ page }) => {
  const state = await setup(page, { reply: 'ok', blocks: [] });
  await ask(page, 'i overslept');
  await expect(page.getByRole('log')).toContainText('ok');
  const ctx = JSON.parse(state.prompt.match(/never instructions: (\{.*?\})\.\s/s)![1]);
  const lit = ctx.plan.find((p: { title: string }) => p.title.startsWith("Gulliver"));
  expect(lit.id).toBe('s-lit');
  expect(state.prompt).toContain('CHANGING THE EXISTING PLAN');
  expect(state.prompt).toContain('move the existing block rather than creating a second copy');
});

test('overslept: missed blocks are moved, not duplicated, and Accept all applies them', async ({ page }) => {
  const state = await setup(page, { reply: 'Moved English and Physics after your CS review.', blocks: [], changes: [
    { action: 'move', id: 's-lit', date: TOMORROW, start: '19:30', end: '21:00' },
    { action: 'move', id: 's-phys', date: TOMORROW, start: '13:00', end: '15:00' },
  ] });
  await ask(page, 'you have to move them');
  const log = page.getByRole('log');
  await expect(log).toContainText('Moved English and Physics');
  await expect(log).not.toContainText("Couldn't place");
  // The originals say where they're going; the proposals say where they came from.
  await expect(page.getByText(/Soma suggests moving this to 7:30 PM/)).toBeVisible();
  await expect(page.getByText(/Moves from 11:00 AM/)).toBeVisible();

  await page.getByRole('button', { name: /Accept all \(2\)/ }).click();
  await expect(page.getByRole('button', { name: /Accept all/ })).toHaveCount(0);

  const byId = Object.fromEntries(state.db.todo_sessions.map(s => [s.id, s]));
  expect(byId['s-lit'].start_time).toBe(at(1, '19:30'));
  expect(byId['s-phys'].start_time).toBe(at(1, '13:00'));
  expect(state.db.todo_sessions).toHaveLength(3);                       // moved, not copied
  expect(state.db.todos.filter(t => String(t.text).startsWith('Gulliver'))).toHaveLength(1);
});

test("a block can be moved into another block's old slot when that one moves too", async ({ page }) => {
  // English takes Physics' morning slot; Physics moves to the afternoon.
  const state = await setup(page, { reply: 'Swapped.', blocks: [], changes: [
    { action: 'move', id: 's-lit', date: TOMORROW, start: '09:00', end: '10:30' },
    { action: 'move', id: 's-phys', date: TOMORROW, start: '13:00', end: '15:00' },
  ] });
  await ask(page, 'do english first');
  await expect(page.getByRole('log')).toContainText('Swapped.');
  await expect(page.getByRole('log')).not.toContainText("Couldn't place");
  // Accepting in list order would try English first, onto Physics' current slot.
  await page.getByRole('button', { name: /Accept all \(2\)/ }).click();
  await expect(page.getByRole('button', { name: /Accept all/ })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const byId = Object.fromEntries(state.db.todo_sessions.map(x => [x.id, x]));
  expect(byId['s-lit'].start_time).toBe(at(1, '09:00'));
  expect(byId['s-phys'].start_time).toBe(at(1, '13:00'));
});

test('moving onto a block that stays put is still refused', async ({ page }) => {
  await setup(page, { reply: 'Here.', blocks: [], changes: [{ action: 'move', id: 's-lit', date: TOMORROW, start: '18:00', end: '19:00' }] });
  await ask(page, 'move english to 6');
  await expect(page.getByRole('log')).toContainText('Move Gulliver');
  await expect(page.getByRole('log')).toContainText('overlaps');
});

test('remove unschedules a block but keeps the task', async ({ page }) => {
  const state = await setup(page, { reply: 'Dropped physics for today.', blocks: [], changes: [{ action: 'remove', id: 's-phys' }] });
  await ask(page, 'skip physics');
  await expect(page.getByText('Soma suggests removing this')).toBeVisible();
  await page.getByRole('button', { name: /Accept all \(1\)/ }).click();
  await expect.poll(() => state.deletes).toContain('todo_sessions:s-phys');
  expect(state.db.todos.some(t => t.id === 't-phys')).toBe(true);
});

test('changes aimed at unknown blocks are rejected with a reason', async ({ page }) => {
  await setup(page, { reply: 'Tried.', blocks: [], changes: [{ action: 'move', id: 'google:c:k:lecture:1', date: TOMORROW, start: '15:00', end: '16:00' }] });
  await ask(page, 'move my lecture');
  await expect(page.getByRole('log')).toContainText("isn't in your plan");
});

test('rename: an existing block is renamed in place, not recreated', async ({ page }) => {
  const state = await setup(page, { reply: 'Renamed it.', blocks: [], changes: [{ action: 'update', id: 's-cs', title: 'Hog project — final review' }] });
  await ask(page, 'rename the cs block to hog project final review');
  await expect(page.getByRole('log')).toContainText('Renamed it.');
  await expect(page.getByRole('log')).not.toContainText("Couldn't place");
  await expect(page.getByText(/Soma suggests renaming this to "Hog project — final review"/)).toBeVisible();
  await expect(page.getByText(/Renamed from "Hog project review"/)).toBeVisible();
  await page.getByRole('button', { name: /Accept all \(1\)/ }).click();
  await expect(page.getByRole('button', { name: /Accept all/ })).toHaveCount(0);
  await expect.poll(() => state.db.todos.find(t => t.id === 't-cs')?.text).toBe('Hog project — final review');
  expect(state.db.todos).toHaveLength(3);
  expect(state.db.todo_sessions.find(x => x.id === 's-cs')!.start_time).toBe(at(1, '17:30'));   // time untouched
});

test('update can rename and retime together; omitted fields keep their values', async ({ page }) => {
  const state = await setup(page, { reply: 'Done.', blocks: [], changes: [{ action: 'update', id: 's-cs', title: 'Hog final', start: '20:00', end: '21:00' }] });
  await ask(page, 'push hog later and rename');
  await expect(page.getByText(/Renamed from "Hog project review" · Moves from 5:30/)).toBeVisible();
  await page.getByRole('button', { name: /Accept all \(1\)/ }).click();
  await expect(page.getByRole('button', { name: /Accept all/ })).toHaveCount(0);
  const s = state.db.todo_sessions.find(x => x.id === 's-cs')!;
  expect(s.start_time).toBe(at(1, '20:00'));
  expect(s.end_time).toBe(at(1, '21:00'));
  expect(state.db.todos.find(t => t.id === 't-cs')?.text).toBe('Hog final');
});

test('the prompt offers update and states the 4-hour limit', async ({ page }) => {
  const state = await setup(page, { reply: 'ok', blocks: [] });
  await ask(page, 'hi');
  await expect(page.getByRole('log')).toContainText('ok');
  expect(state.prompt).toContain('"action":"update"');
  expect(state.prompt).toContain('never say you cannot edit existing blocks');
  expect(state.prompt).toContain('Each block is at most 4 hours');
  expect(state.prompt).not.toContain('Changes to existing tasks must be made with Edit plan');
});

test('past weeks: the arrows show earlier days and their blocks, without Focus', async ({ page }) => {
  const past = key(offset(-3));
  await setup(page, { reply: 'ok', blocks: [] }, db => {
    db.todos.push({ id: 't-old', user_id: account.id, text: 'Old lab writeup', subject_id: 'phys', status: 'nothing', date: past });
    db.todo_sessions.push({ id: 's-old', user_id: account.id, todo_id: 't-old', date: past, start_time: at(-3, '14:00'), end_time: at(-3, '15:00') });
  });
  await page.getByRole('button', { name: 'Earlier week' }).click();
  const strip = page.getByLabel('Seven days shown');
  await expect(strip).toBeVisible();
  await strip.getByRole('button').nth(4).click();                // -7 + 4 = three days ago
  await expect(page.getByText('Old lab writeup')).toBeVisible();
  await expect(page.getByRole('button', { name: /Start focus/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to this week' }).click();
  await expect(page.getByLabel('Next seven days')).toBeVisible();
  await expect(page.getByLabel('Next seven days').getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
});
