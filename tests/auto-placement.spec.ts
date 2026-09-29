import { test, expect, type Page } from '@playwright/test';

// Reported: "the whole AI scheduler loses purpose if I have to tell it exactly
// when to schedule stuff". Soma chose clock times itself and put blocks on top
// of classes, at 10:59, or in the past. Now it names the day, length and any
// bounds, and the app puts the work in the first open slot.
const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const at = (n: number, t: string) => { const d = offset(n); const [h, m] = t.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };
const TOMORROW = key(offset(1));
type Row = Record<string, unknown>;

// Tomorrow: a lecture 10:00–10:59 and a discussion 16:00–17:59, like the report.
const events = [
  { id: 'lec', summary: 'Comparative Literature Lecture', start: { dateTime: at(1, '10:00') }, end: { dateTime: at(1, '10:59') }, source: { connectionId: 'c', calendarId: 'k' } },
  { id: 'disc', summary: 'Physics 5A Discussion', start: { dateTime: at(1, '16:00') }, end: { dateTime: at(1, '17:59') }, source: { connectionId: 'c', calendarId: 'k' } },
];

async function setup(page: Page, reply: unknown, more: typeof events = [], clock?: Date) {
  const db: Record<string, Row[]> = {
    subjects: [{ id: 'phys', user_id: account.id, name: 'Physics 5A', color: '#ab47bc', archived: false }],
    todos: [{ id: 't-hw', user_id: account.id, text: 'Physics HW 4', subject_id: 'phys', status: 'nothing', date: TOMORROW }],
    todo_sessions: [{ id: 's-hw', user_id: account.id, todo_id: 't-hw', date: TOMORROW, start_time: at(1, '20:00'), end_time: at(1, '21:00') }],
    timer_sessions: [],
  };
  const state = { db, prompt: '' };
  // Nine in the morning today, so all of tomorrow is ahead whatever the real clock says.
  const morning = new Date(); morning.setHours(9, 0, 0, 0);
  await page.clock.install({ time: clock ?? morning });
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
    localStorage.setItem('soma_settings', JSON.stringify({ onboardingCompleted: true, theme: 'light', studyWindow: { start: '08:00', end: '23:00' } }));
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
    if (req.method() !== 'GET') return route.fulfill({ json: null });
    let out = rows ?? [];
    for (const k of ['id', 'todo_id']) { const f = url.searchParams.get(k); if (f?.startsWith('eq.')) out = out.filter(r => String(r[k]) === f.slice(3)); }
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? out[0] ?? null : out });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/memory', r => r.fulfill({ json: { revision: 0, enabled: true, entries: [] } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [...events, ...more], incomplete: false } }));
  await page.route('**/api/chat', route => {
    const body = route.request().postDataJSON();
    state.prompt = `${body.systemPrompt}\n${body.context ?? ''}`;
    return route.fulfill({ json: { content: [{ text: JSON.stringify(reply) }] } });
  });
  await page.goto('/dashboard');
  await page.getByLabel('Next seven days').getByRole('button').nth(1).click();
  await expect(page.getByText('Physics HW 4')).toBeVisible();
  return state;
}
async function ask(page: Page, text: string) {
  await page.getByLabel('What do you need to work on?').fill(text);
  await page.getByRole('button', { name: 'Send to Soma' }).click();
}
const saved = (db: Record<string, Row[]>, title: string) => {
  const todo = db.todos.find(t => t.text === title)!;
  const s = db.todo_sessions.find(x => x.todo_id === todo.id)!;
  return [s.start_time, s.end_time];
};

test('work given a day and a length is placed in order, around classes, on round times', async ({ page }) => {
  const state = await setup(page, { reply: 'Reading first, then the problem set.', blocks: [
    { title: 'Physics reading 5.1–5.4', subject: 'Physics 5A', date: TOMORROW, minutes: 60, after: '09:00' },
    { title: 'Physics problem set', subject: 'Physics 5A', date: TOMORROW, minutes: 90, after: '09:00' },
  ] });
  await ask(page, 'plan the reading and then the problem set tomorrow');
  const log = page.getByRole('log');
  await expect(log).toContainText('Times from your open slots');
  await expect(log).not.toContainText("Couldn't place");
  expect(state.prompt).toContain('the app picks the clock time');
  await page.getByRole('button', { name: /^Accept all/ }).click();
  await expect.poll(() => state.db.todo_sessions.length).toBe(3);
  // 9:00–10:00 fits before the lecture; 90 minutes doesn't, so it goes after it
  // at 11:00, not 10:59.
  expect(saved(state.db, 'Physics reading 5.1–5.4')).toEqual([at(1, '09:00'), at(1, '10:00')]);
  expect(saved(state.db, 'Physics problem set')).toEqual([at(1, '11:00'), at(1, '12:30')]);
});

test('"before the discussion" keeps it before the discussion', async ({ page }) => {
  const state = await setup(page, { reply: 'Before discussion.', blocks: [
    { title: 'Physics reading 5.1–5.4', subject: 'Physics 5A', date: TOMORROW, minutes: 60, after: '14:30', before: '16:00' },
  ] });
  await ask(page, 'reading tomorrow afternoon before discussion');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.todo_sessions.length).toBe(2);
  expect(saved(state.db, 'Physics reading 5.1–5.4')).toEqual([at(1, '14:30'), at(1, '15:30')]);
});

test('a move without times is placed by the app too', async ({ page }) => {
  const state = await setup(page, { reply: 'Moved it earlier.', changes: [{ action: 'move', id: 's-hw', date: TOMORROW, after: '12:00' }] });
  await ask(page, 'do the homework earlier tomorrow');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.todo_sessions.find(s => s.id === 's-hw')!.start_time).toBe(at(1, '12:00'));
  expect(state.db.todo_sessions.find(s => s.id === 's-hw')!.end_time).toBe(at(1, '13:00'));
});

test('a time the student states goes there, even over a class, and says so', async ({ page }) => {
  await setup(page, { reply: 'There.', blocks: [{ title: 'Physics reading', subject: 'Physics 5A', date: TOMORROW, start: '16:30', end: '17:30' }] });
  await ask(page, 'reading tomorrow at 4:30');
  await expect(page.getByRole('log')).not.toContainText("Couldn't place");
  await expect(page.getByText(/Overlaps Physics 5A Discussion/).first()).toBeVisible();
});

test('skipping the class allows it', async ({ page }) => {
  await setup(page, { reply: 'Over discussion.', blocks: [{ title: 'Physics reading', subject: 'Physics 5A', date: TOMORROW, start: '16:30', end: '17:30' }] });
  await ask(page, "i'm skipping discussion tomorrow, read then");
  await expect(page.getByRole('log')).not.toContainText("Couldn't place");
});

test('when nothing fits, it asks with real options instead of just refusing', async ({ page }) => {
  await setup(page, { reply: 'Trying.', blocks: [{ title: 'Long essay', subject: 'Physics 5A', date: TOMORROW, minutes: 240, after: '13:00', before: '16:00' }] });
  await ask(page, 'essay tomorrow afternoon before discussion');
  const log = page.getByRole('log');
  await expect(log).toContainText('Needs your call');
  await expect(log).toContainText("there isn't 240 min open");
  // What's open in the window, what's open later that day, and the first slot that fits whole.
  await expect(log).toContainText('a shorter block in what\'s open after 1:00 PM before 4:00 PM: 1:00 PM–4:00 PM (180 min)');
  await expect(log).toContainText('use later');
  await expect(log).toContainText('the first open 240-minute slot');
  await expect(log).toContainText('Which do you want?');
  await expect(log).not.toContainText("Couldn't place");
});

// The reported Monday: CS lecture ends 1 PM, Math discussion 2–3 PM, Physics discussion at 4 PM.
const math = [{ id: 'math', summary: 'MATH 53 Discussion', start: { dateTime: at(1, '14:00') }, end: { dateTime: at(1, '14:59') }, source: { connectionId: 'c', calendarId: 'k' } }];

test('a task too long for one gap is offered split, for Accept, instead of refused', async ({ page }) => {
  const state = await setup(page, { reply: 'Trying.', changes: [{ action: 'move', id: 's-hw', date: TOMORROW, minutes: 76, after: '13:00', before: '16:00' }] }, math);
  await ask(page, 'homework tomorrow afternoon before discussion');
  const log = page.getByRole('log');
  await expect(log).toContainText("doesn't fit in one open slot, so it is split across your gaps");
  await expect(log).not.toContainText("Couldn't place");
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.todo_sessions.filter(s => s.todo_id === 't-hw').length).toBe(2);
});

test('"in the gaps" splits one task across them, and Accept saves both sessions', async ({ page }) => {
  const state = await setup(page, { reply: 'Split across your gaps.', changes: [{ action: 'move', id: 's-hw', date: TOMORROW, minutes: 76, after: '13:00', before: '16:00', split: true }] }, math);
  await ask(page, 'do the homework in the gaps between classes before discussion');
  const log = page.getByRole('log');
  await expect(log).not.toContainText("Couldn't place");
  await expect(log).toContainText('Physics HW 4: Mon 1:00 PM–2:00 PM, Mon 3:00 PM–3:16 PM'.replace(/Mon/g, new Date(`${TOMORROW}T12:00`).toLocaleDateString('en-US', { weekday: 'short' })));
  expect(state.prompt).toContain('"split":true');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.todo_sessions.filter(s => s.todo_id === 't-hw').length).toBe(2);
  const sessions = state.db.todo_sessions.filter(s => s.todo_id === 't-hw').map(s => [s.start_time, s.end_time]).sort();
  expect(sessions).toEqual([[at(1, '13:00'), at(1, '14:00')], [at(1, '15:00'), at(1, '15:16')]]);
  expect(state.db.todos.filter(t => t.text === 'Physics HW 4')).toHaveLength(1);   // one task, two sessions
});

test('"in the gaps" splits even when Soma forgets to ask for it', async ({ page }) => {
  // What the model actually sent: one 120-minute block, no split.
  const state = await setup(page, { reply: 'Monday afternoon.', changes: [{ action: 'move', id: 's-hw', date: TOMORROW, minutes: 120, after: '12:59', before: '16:00' }] }, math);
  await ask(page, 'do the physics homework in the gaps between classes before the discussion on Monday');
  await expect(page.getByRole('log')).not.toContainText("Couldn't place");
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.todo_sessions.filter(s => s.todo_id === 't-hw').length).toBe(2);
  const sessions = state.db.todo_sessions.filter(s => s.todo_id === 't-hw').map(s => [s.start_time, s.end_time]).sort();
  expect(sessions).toEqual([[at(1, '13:00'), at(1, '14:00')], [at(1, '15:00'), at(1, '16:00')]]);
});

// Reported at 11:41 AM: "from now until 1" was read as until 1 AM.
test('"until 1" in the morning means 1 PM, as a bound and as a stated time', async ({ page }) => {
  const late = new Date(); late.setHours(11, 41, 0, 0);
  const TODAY = key(offset(0));
  // A bound the model gives as 01:00.
  const state = await setup(page, { reply: 'Until 1.', blocks: [{ title: 'Physics reading 4.7–4.9', subject: 'Physics 5A', date: TODAY, minutes: 60, before: '01:00' }] }, [], late);
  await ask(page, 'the physics reading from now until 1');
  await expect(page.getByRole('log')).not.toContainText('1:00 AM');
  await expect(page.getByRole('log')).not.toContainText("Couldn't place");
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.todo_sessions.length).toBe(2);
  const [start, end] = saved(state.db, 'Physics reading 4.7–4.9');
  expect(new Date(String(end)) <= new Date(at(0, '13:00'))).toBe(true);
  expect(new Date(String(start)) >= new Date(at(0, '11:41'))).toBe(true);
});

test('stated "11:45 until 01:00" in the morning ends at 1 PM', async ({ page }) => {
  const late = new Date(); late.setHours(11, 41, 0, 0);
  const TODAY = key(offset(0));
  const state = await setup(page, { reply: 'Now until 1.', blocks: [{ title: 'Physics reading 4.7–4.9', subject: 'Physics 5A', date: TODAY, start: '11:45', end: '01:00' }] }, [], late);
  await ask(page, 'from now until 1');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.todo_sessions.length).toBe(2);
  expect(saved(state.db, 'Physics reading 4.7–4.9')).toEqual([at(0, '11:45'), at(0, '13:00')]);
});

test('"I skipped the discussion" still counts on the next message', async ({ page }) => {
  await setup(page, { reply: 'Over discussion.', blocks: [{ title: 'Physics reading', subject: 'Physics 5A', date: TOMORROW, start: '16:30', end: '17:30' }] });
  await ask(page, "i'm skipping physics discussion tomorrow");
  await expect(page.getByRole('log')).toContainText('Over discussion.');
  await ask(page, 'ok put the reading then');
  await expect(page.getByRole('log')).not.toContainText('on your calendar');
});

test('a range that already reads forwards is left alone ("after 11:40, before 12:52")', async ({ page }) => {
  const eleven = new Date(); eleven.setHours(11, 0, 0, 0);
  const TODAY = key(offset(0));
  const state = await setup(page, { reply: 'Late morning.', blocks: [{ title: 'Physics reading 4.6–4.9', subject: 'Physics 5A', date: TODAY, minutes: 30, after: '11:40', before: '12:52' }] }, [], eleven);
  await ask(page, 'reading between 11:40 and 12:52');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.todo_sessions.length).toBe(2);
  expect(saved(state.db, 'Physics reading 4.6–4.9')).toEqual([at(0, '11:40'), at(0, '12:10')]);
});

// Reported: "fill the rest of my time from now until 10 with physics homework"
// at 9 PM, with gym 9–10 PM, just said it didn't fit.
test('tonight with no room, it asks: the hour after gym, or the first full slot', async ({ page }) => {
  const nine = new Date(); nine.setHours(21, 0, 0, 0);
  const TODAY = key(offset(0));
  const gym = [{ id: 'gym', summary: 'gym', start: { dateTime: at(0, '21:00') }, end: { dateTime: at(0, '21:59') }, source: { connectionId: 'c', calendarId: 'k' } }];
  await setup(page, { reply: 'Filling tonight.', blocks: [{ title: 'Physics HW 4', subject: 'Physics 5A', date: TODAY, minutes: 105, after: '21:00', before: '23:00' }] }, gym, nine);
  await ask(page, 'fill the rest of my time from now until 10 for physics homework');
  const log = page.getByRole('log');
  await expect(log).toContainText("there isn't 105 min open");
  await expect(log).toContainText('10:00 PM–11:00 PM (60 min)');
  await expect(log).toContainText('the first open 105-minute slot');
  await expect(log).toContainText('Which do you want?');
});

// ── The reported evening and Tuesday ─────────────────────────────────────
// "Start a block from now until 11 pm" at 9:57 PM, with "Study with Dojin"
// 10–11 PM on the calendar: Soma sent a 63-minute length instead of times.
test('"from now until 11" goes exactly there, even over a calendar event', async ({ page }) => {
  const late = new Date(); late.setHours(21, 57, 0, 0);
  const TODAY = key(offset(0));
  const dojin = [{ id: 'dojin', summary: 'Study with Dojin', start: { dateTime: at(0, '22:00') }, end: { dateTime: at(0, '23:00') }, source: { connectionId: 'c', calendarId: 'k' } }];
  const state = await setup(page, { reply: 'Until 11.', blocks: [{ title: 'Physics HW 4 tonight', subject: 'Physics 5A', date: TODAY, minutes: 63, after: '21:57', before: '23:00' }] }, dojin, late);
  await ask(page, 'just start a block from now until 11 pm today');
  await expect(page.getByRole('log')).not.toContainText('Needs your call');
  await expect(page.getByText(/Overlaps Study with Dojin/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.todo_sessions.length).toBe(2);
  expect(saved(state.db, 'Physics HW 4 tonight')).toEqual([at(0, '21:57'), at(0, '23:00')]);
});

// "Every single gap after the lecture and office hour until the quiz; it can
// overlap the flower arrangement thing."
test('fill uses every gap in the window, and overlapOk lets named events be overlapped', async ({ page }) => {
  const tue = [
    { id: 'oh', summary: 'Physics 5A OH', start: { dateTime: at(1, '13:30') }, end: { dateTime: at(1, '14:30') }, source: { connectionId: 'c', calendarId: 'k' } },
    { id: 'flower', summary: 'Japanese Flower Arrangement Demonstration & Workshop', start: { dateTime: at(1, '14:30') }, end: { dateTime: at(1, '16:00') }, source: { connectionId: 'c', calendarId: 'k' } },
    { id: 'quiz', summary: 'CS 61A Quiz 3 - Recursion', start: { dateTime: at(1, '15:05') }, end: { dateTime: at(1, '15:15') }, source: { connectionId: 'c', calendarId: 'k' } },
  ];
  const state = await setup(page, { reply: 'Every gap.', changes: [{ action: 'move', id: 's-hw', date: TOMORROW, after: '11:00', before: '15:05', fill: true, overlapOk: ['Japanese Flower Arrangement'] }] }, tue);
  await ask(page, 'every single gap after the lecture and office hour until the quiz, it can overlap the flower thing');
  await expect(page.getByRole('log')).not.toContainText('Needs your call');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => state.db.todo_sessions.filter(s => s.todo_id === 't-hw').length).toBe(2);
  const sessions = state.db.todo_sessions.filter(s => s.todo_id === 't-hw').map(s => [s.start_time, s.end_time]).sort();
  // 11:00 after the lecture until OH, then after OH until the quiz, over the workshop.
  expect(sessions).toEqual([[at(1, '11:00'), at(1, '13:30')], [at(1, '14:30'), at(1, '15:05')]]);
});

// The stuck "Delete Quiz 3 (was 8–9 PM)" card: a delete suggested before the
// block was moved must not delete the moved block.
test('accepting a move retires the other suggestions for that block', async ({ page }) => {
  let n = 0;
  const state = await setup(page, {} as never);
  await page.unroute('**/api/chat');
  await page.route('**/api/chat', route => route.fulfill({ json: { content: [{ text: JSON.stringify(++n === 1
    ? { reply: 'Delete it?', changes: [{ action: 'remove', id: 's-hw' }] }
    : { reply: 'Moved.', changes: [{ action: 'move', id: 's-hw', date: TOMORROW, start: '12:00', end: '13:00' }] }) }] } }));
  await ask(page, 'delete the homework');
  await expect(page.getByRole('log')).toContainText('Delete it?');
  await ask(page, 'actually move it to noon');
  await expect(page.getByRole('log')).toContainText('Moved.');
  await expect(page.getByRole('button', { name: /^Accept all/ })).toBeVisible();
  await page.getByRole('button', { name: /^Accept all/ }).click();
  await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0);
  // Moved, not deleted.
  expect(state.db.todo_sessions.find(s => s.id === 's-hw')!.start_time).toBe(at(1, '12:00'));
  expect(state.db.todos.some(t => t.id === 't-hw')).toBe(true);
});

test('a suggestion made before its block changed is refused with the reason', async ({ page }) => {
  const state = await setup(page, { reply: 'Delete it?', changes: [{ action: 'remove', id: 's-hw' }] });
  await ask(page, 'delete the homework');
  await expect(page.getByRole('log')).toContainText('Delete it?');
  // The block moves elsewhere (another tab, the editor) before Accept.
  state.db.todo_sessions.find(s => s.id === 's-hw')!.start_time = at(1, '18:00');
  state.db.todo_sessions.find(s => s.id === 's-hw')!.end_time = at(1, '19:00');
  await page.getByRole('button', { name: /^Accept all/ }).click();
  await expect(page.getByRole('alert').first()).toContainText('"Physics HW 4" has changed since Soma suggested this');
  expect(state.db.todos.some(t => t.id === 't-hw')).toBe(true);
});
