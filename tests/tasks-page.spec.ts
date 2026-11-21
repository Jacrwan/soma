import { test, expect, type Page } from '@playwright/test';

/**
 * The Tasks page and the scheduler on the dashboard (2026-11-15): tasks with
 * a due date place their own sittings, a missed sitting moves on its own,
 * checking off one sitting doesn't finish the task, and dragging (or arrow
 * keys on the handle) changes the silent priority order. No AI.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const now = new Date(2026, 10, 16, 9, 0);                      // Mon, Nov 16, 9 AM
const dateOf = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (offset: number, time: string) => new Date(`${dateOf(offset)}T${time}:00`).toISOString();
type Row = Record<string, unknown>;
type State = { tables: Record<string, Row[]> };

/** `running`: a clock the test moves forward (page.clock.runFor), instead of one stopped at `now`. */
async function setup(page: Page, tables: Record<string, Row[]> = {}, opts: { running?: boolean } = {}) {
  const state: State = { tables: { subjects: [{ id: 'hist', user_id: account.id, name: 'HIST 10', color: '#ab47bc', archived: false }], todos: [], todo_sessions: [], timer_sessions: [], active_timer: [], brain_dump_items: [], ...tables } };
  if (opts.running) await page.clock.install({ time: now });
  else await page.clock.setFixedTime(now);
  await page.addInitScript(account => { localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 'test-token', refresh_token: 'test-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: account })); }, account);
  await page.route('https://soma-regression.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, walkthroughCompleted: true, theme: 'light' } } });
    const id = url.searchParams.get('id')?.replace(/^eq\./, '');
    if (req.method() === 'DELETE') { state.tables[table] = (state.tables[table] ?? []).filter(r => String(r.id) !== id); return route.fulfill({ json: [{ id }] }); }
    if (req.method() === 'PATCH') {
      const patch = req.postDataJSON() as Row;
      state.tables[table] = (state.tables[table] ?? []).map(r => String(r.id) === id ? { ...r, ...patch } : r);
      return route.fulfill({ json: null });
    }
    if (req.method() === 'GET') {
      let rows = state.tables[table] ?? [];
      for (const key of ['id', 'todo_id', 'date']) { const f = url.searchParams.get(key); if (f?.startsWith('eq.')) rows = rows.filter(r => String(r[key]) === f.slice(3)); }
      return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
    }
    if (req.method() === 'POST') {
      const row = req.postDataJSON(); const items = Array.isArray(row) ? row : [row];
      for (const item of items) state.tables[table] = [...(state.tables[table] ?? []).filter(r => r.id !== item.id), item];
    }
    return route.fulfill({ json: null });
  });
  await page.route('**/api/stripe', route => route.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', route => route.fulfill({ json: { events: [], incomplete: false } }));
  return state;
}

// assignment_id null, as the database returns it for a task with no Canvas link.
const task = (id: string, text: string, due: string, extra: Row = {}): Row => ({ id, user_id: account.id, text, subject_id: 'hist', status: 'nothing', date: dateOf(0), due_date: due, estimated_minutes: 60, auto_schedule: true, assignment_id: null, ...extra });

test('Tasks: adding a task places its sittings right away, before it is due', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/tasks');
  // "+ Add task" opens Task details, empty (2026-11-17: it replaced the add row).
  await page.getByRole('button', { name: 'Add task' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a task' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Essay draft');
  await dialog.getByRole('combobox', { name: 'Course' }).selectOption({ label: 'HIST 10' });
  await dialog.getByLabel('Due day').fill(dateOf(4));
  await dialog.getByLabel('Due time').fill('23:59');
  await dialog.getByRole('textbox', { name: 'How long, in all' }).fill('2h');
  await dialog.getByRole('textbox', { name: 'How long, in all' }).blur();
  await dialog.getByRole('button', { name: 'Schedule it' }).click();
  await expect(dialog).toHaveCount(0);

  const row = page.getByRole('listitem').filter({ hasText: 'Essay draft' });
  await expect(row).toBeVisible();
  // Today is already planned: new work starts tomorrow, not in today's open time.
  await expect(row.getByText(/^Next: Tomorrow/)).toBeVisible();
  const todo = state.tables.todos.find(t => t.text === 'Essay draft')!;
  expect(todo).toMatchObject({ auto_schedule: true, estimated_minutes: 120, due_date: `${dateOf(4)}T23:59` });
  const sittings = state.tables.todo_sessions.filter(s => s.todo_id === todo.id);
  // Two hours in sittings of about 50 minutes: three of 40, on different days, all before the due day.
  expect(sittings).toHaveLength(3);
  expect(sittings.every(s => +new Date(String(s.end_time)) - +new Date(String(s.start_time)) === 40 * 60000)).toBe(true);
  expect(new Set(sittings.map(s => s.date)).size).toBe(3);
  expect(sittings.every(s => String(s.date) < dateOf(4) && String(s.date) > dateOf(0))).toBe(true);
  await expect(row.getByText('2h left')).toBeVisible();
});

test('Tasks: the order is the priority, and arrow keys on the handle change it', async ({ page }) => {
  // Soma's guess: a project counts as due 3 days sooner, so it comes before homework due a day earlier.
  const state = await setup(page, { todos: [task('a', 'Homework 3', dateOf(2)), task('b', 'Project proposal', dateOf(3)), task('c', 'Reading ch. 5', dateOf(6))] });
  await page.goto('/tasks');
  const titles = page.getByRole('list', { name: 'Tasks, most important first' }).locator('li button[class*="title"]');
  await expect(titles).toHaveText(['Project proposal', 'Homework 3', 'Reading ch. 5']);
  await page.getByRole('button', { name: /Reorder Reading ch\. 5/ }).press('ArrowUp');
  await expect(titles).toHaveText(['Project proposal', 'Reading ch. 5', 'Homework 3']);
  // Its rank now sits between its new neighbours' places.
  await expect.poll(() => typeof state.tables.todos.find(t => t.id === 'c')!.rank).toBe('number');
});

test('dashboard: a missed sitting moves to the next open time and says so', async ({ page }) => {
  const state = await setup(page, {
    todos: [task('essay', 'Essay draft', dateOf(1))],
    todo_sessions: [{ id: 'missed', user_id: account.id, todo_id: 'essay', date: dateOf(0), start_time: at(0, '07:00'), end_time: at(0, '08:00') }],
  });
  await page.goto('/dashboard');
  await expect(page.getByText('Moved a sitting that had to move')).toBeVisible();
  const moved = state.tables.todo_sessions.find(s => s.id === 'missed')!;
  expect(moved.start_time).toBe(at(0, '09:00'));
  expect(moved.end_time).toBe(at(0, '10:00'));
});

test('dashboard: checking off one sitting leaves the task in progress until nothing is left', async ({ page }) => {
  const state = await setup(page, {
    todos: [task('essay', 'Essay draft', dateOf(4), { estimated_minutes: 120 })],
    todo_sessions: [
      { id: 's1', user_id: account.id, todo_id: 'essay', date: dateOf(0), start_time: at(0, '10:00'), end_time: at(0, '11:00') },
      { id: 's2', user_id: account.id, todo_id: 'essay', date: dateOf(2), start_time: at(2, '10:00'), end_time: at(2, '11:00') },
    ],
  });
  await page.goto('/dashboard');
  const block = page.locator('article').filter({ hasText: 'Essay draft' }).first();
  await expect(block).toBeVisible();
  await block.getByRole('button', { name: 'Complete: Essay draft' }).click();
  await expect.poll(() => state.tables.todo_sessions.find(s => s.id === 's1')?.done_at).toBeTruthy();
  expect(state.tables.todo_sessions.find(s => s.id === 's2')?.done_at).toBeFalsy();
  await expect.poll(() => state.tables.todos.find(t => t.id === 'essay')!.status).toBe('in_progress');
});

test('Tasks: open to-dos long past their date are not listed; ones still ahead are, to schedule', async ({ page }) => {
  await setup(page, { todos: [
    { id: 'old', user_id: account.id, text: 'K&K Ch.2 — End-of-chapter problem set', status: 'nothing', date: '2026-06-20', due_date: '2026-06-28' },
    { id: 'ahead', user_id: account.id, text: 'Read ch. 4 notes', status: 'nothing', date: dateOf(0), due_date: dateOf(5) },
  ] });
  await page.goto('/tasks');
  const ahead = page.getByRole('listitem').filter({ hasText: 'Read ch. 4 notes' });
  await expect(ahead).toBeVisible();
  await expect(ahead.getByRole('button', { name: 'Schedule' })).toBeVisible();
  await expect(page.getByText('K&K Ch.2 — End-of-chapter problem set')).toHaveCount(0);
});

test('dashboard: a scheduled course-site task still shows on the day it is due', async ({ page }) => {
  await setup(page, {
    todos: [
      task('lab', 'Lab 10: SQL', dateOf(2), { kind: 'lab', auto_schedule: null, date: dateOf(2) }),
      // No sittings yet, and filed on another day than it's due: still on its due day.
      task('proj', 'Project 4 checkpoint', dateOf(2), { kind: 'project', auto_schedule: false, date: dateOf(0) }),
    ],
    todo_sessions: [{ id: 'l1', user_id: account.id, todo_id: 'lab', date: dateOf(1), start_time: at(1, '15:00'), end_time: at(1, '16:00') }],
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /Wed\s*18/ }).first().click();
  const card = page.locator('article[data-kind="due"]').filter({ hasText: 'Lab 10: SQL' });
  await expect(card).toBeVisible();
  await expect(card.getByText(/Scheduled by Soma/)).toBeVisible();
  await expect(card.getByText('Sitting planned')).toBeVisible();
  await expect(card.getByRole('button', { name: /Plan it/ })).toHaveCount(0);
});

test('dashboard: time that opens up today is offered, never filled on its own', async ({ page }) => {
  const state = await setup(page, {
    todos: [task('quiz', 'Quiz 7 prep', dateOf(2)), task('lab', 'Lab 10', dateOf(2))],
    todo_sessions: [
      { id: 'q1', user_id: account.id, todo_id: 'quiz', date: dateOf(0), start_time: at(0, '10:00'), end_time: at(0, '11:00') },
      { id: 'l1', user_id: account.id, todo_id: 'lab', date: dateOf(1), start_time: at(1, '15:00'), end_time: at(1, '16:00') },
    ],
  });
  await page.goto('/dashboard');
  await expect(page.locator('article').filter({ hasText: 'Quiz 7 prep' }).first()).toBeVisible();
  // The quiz's sitting moves to tomorrow (pinned, as a move by hand is), opening today's 10–11.
  state.tables.todo_sessions = state.tables.todo_sessions.map(s => s.id === 'q1' ? { ...s, date: dateOf(1), start_time: at(1, '10:00'), end_time: at(1, '11:00'), pinned: true } : s);
  await page.evaluate(() => window.dispatchEvent(new Event('soma_todos_changed')));
  await expect(page.getByText(/opened up today/)).toBeVisible();
  // Nothing moved by itself.
  expect(state.tables.todo_sessions.find(s => s.id === 'l1')!.date).toBe(dateOf(1));
  await page.getByRole('button', { name: 'Move it to today' }).click();
  await expect.poll(() => state.tables.todo_sessions.find(s => s.id === 'l1')!.date).toBe(dateOf(0));
  await expect(page.getByText(/opened up today/)).toHaveCount(0);
});

test('dashboard: "Not today" keeps the open time free for the day', async ({ page }) => {
  const state = await setup(page, {
    todos: [task('quiz', 'Quiz 7 prep', dateOf(2)), task('lab', 'Lab 10', dateOf(2))],
    todo_sessions: [
      { id: 'q1', user_id: account.id, todo_id: 'quiz', date: dateOf(0), start_time: at(0, '10:00'), end_time: at(0, '11:00') },
      { id: 'l1', user_id: account.id, todo_id: 'lab', date: dateOf(1), start_time: at(1, '15:00'), end_time: at(1, '16:00') },
    ],
  });
  await page.goto('/dashboard');
  await expect(page.locator('article').filter({ hasText: 'Quiz 7 prep' }).first()).toBeVisible();
  state.tables.todo_sessions = state.tables.todo_sessions.map(s => s.id === 'q1' ? { ...s, date: dateOf(1), start_time: at(1, '10:00'), end_time: at(1, '11:00'), pinned: true } : s);
  await page.evaluate(() => window.dispatchEvent(new Event('soma_todos_changed')));
  await page.getByRole('button', { name: 'Not today' }).click();
  await expect(page.getByText(/opened up today/)).toHaveCount(0);
  expect(state.tables.todo_sessions.find(s => s.id === 'l1')!.date).toBe(dateOf(1));
});

// ── Task details (2026-11-15) ──

test('details: steps replace generic sittings, each named on the plan, in order', async ({ page }) => {
  const state = await setup(page, {
    todos: [task('hw', 'HW 9.5', dateOf(4), { kind: 'homework', auto_schedule: null, date: dateOf(4) })],
    todo_sessions: [{ id: 'g1', user_id: account.id, todo_id: 'hw', date: dateOf(2), start_time: at(2, '10:00'), end_time: at(2, '11:00') }],
  });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Details: HW 9.5' }).click();
  const dialog = page.getByRole('dialog', { name: 'Task details' });
  await dialog.getByRole('button', { name: 'Add a step' }).click();
  await dialog.getByRole('textbox', { name: 'Step 1', exact: true }).fill('Problems 1–3');
  await dialog.getByRole('button', { name: 'Add a step' }).click();
  await dialog.getByRole('textbox', { name: 'Step 2', exact: true }).fill('Problems 4–6');
  // Lengths are typed, not picked: "1h", "60", "1:00" all read as an hour.
  await dialog.getByRole('textbox', { name: 'Step 2 length' }).fill('1h');
  await dialog.getByRole('textbox', { name: 'Step 2 length' }).blur();
  await expect(dialog.getByText(/1h 30m in all/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  const todo = state.tables.todos.find(t => t.id === 'hw')!;
  const steps = todo.steps as { id: string; title: string; minutes: number }[];
  expect(steps.map(s => [s.title, s.minutes])).toEqual([['Problems 1–3', 30], ['Problems 4–6', 60]]);
  const sittings = state.tables.todo_sessions.filter(s => s.todo_id === 'hw').sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  expect(sittings.map(s => s.step_id)).toEqual(steps.map(s => s.id));
  expect(sittings[0].id).toBe('g1');                                     // the generic sitting became step 1
  expect(sittings.map(s => (+new Date(String(s.end_time)) - +new Date(String(s.start_time))) / 60000)).toEqual([30, 60]);
  await expect(page.getByRole('listitem').filter({ hasText: 'HW 9.5' }).getByText('2 steps', { exact: false })).toBeVisible();
});

test('details: your own deadline moves the work earlier, and the due card says so', async ({ page }) => {
  const state = await setup(page, {
    todos: [task('lab', 'Lab 10', dateOf(4), { kind: 'lab', auto_schedule: null, date: dateOf(4) })],
    todo_sessions: [{ id: 'l1', user_id: account.id, todo_id: 'lab', date: dateOf(3), start_time: at(3, '15:00'), end_time: at(3, '16:00') }],
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /Fri\s*20/ }).first().click();
  // The whole card opens its details in the side panel, as a block opens Edit block.
  await page.locator('article[data-kind="due"]').getByRole('button', { name: 'Details: Lab 10' }).click();
  const dialog = page.getByRole('region', { name: 'Task details' });
  await expect(dialog.getByText(/As posted: Fri, Nov 20/)).toBeVisible();
  await dialog.getByLabel('Your deadline, day').fill(dateOf(2));
  await expect(dialog.getByText(/Posted as due Fri, Nov 20/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  const todo = state.tables.todos.find(t => t.id === 'lab')!;
  expect(todo.my_due).toBe(`${dateOf(2)}T23:59`);
  expect(todo.due_date).toBe(dateOf(4));                                 // the posted date stays
  // The card moves to your day; a faint one stays where it was posted.
  await page.getByRole('button', { name: /Wed\s*18/ }).first().click();
  const moved = page.locator('article[data-kind="due"]').filter({ hasText: 'Lab 10' });
  await expect(moved).toBeVisible();
  await expect(moved.getByText(/Your deadline \(posted for Fri, Nov 20\)/)).toBeVisible();
  await page.getByRole('button', { name: /Fri\s*20/ }).first().click();
  const ghost = page.locator('article[data-kind="due-ghost"]').filter({ hasText: 'Lab 10' });
  await expect(ghost.getByText(/Posted as due this day · you moved it to Wed, Nov 18/)).toBeVisible();
  await expect(page.locator('article[data-kind="due"]').filter({ hasText: 'Lab 10' })).toHaveCount(0);
  // Finish a day before your deadline: by tomorrow.
  await expect.poll(() => String(state.tables.todo_sessions.find(s => s.id === 'l1')!.date) <= dateOf(1)).toBe(true);
});

test('details: work days and a sitting count bound and split the work', async ({ page }) => {
  const state = await setup(page, { todos: [task('essay', 'Essay', dateOf(6), { estimated_minutes: 120 })] });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Details: Essay' }).click();
  const dialog = page.getByRole('dialog', { name: 'Task details' });
  await dialog.getByLabel('Earliest day to work on it').fill(dateOf(3));
  await dialog.getByLabel('Latest day to work on it').fill(dateOf(4));
  await dialog.getByRole('spinbutton', { name: 'Sittings' }).fill('2');
  await expect(dialog.getByText('2 sittings of 1h.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  const todo = state.tables.todos.find(t => t.id === 'essay')!;
  expect(todo).toMatchObject({ work_from: dateOf(3), work_until: dateOf(4), sitting_count: 2 });
  const sittings = state.tables.todo_sessions.filter(s => s.todo_id === 'essay');
  expect(sittings).toHaveLength(2);
  expect(sittings.every(s => String(s.date) >= dateOf(3) && String(s.date) <= dateOf(4))).toBe(true);
});

test('brain dump: a line with a due date becomes a task with details, and leaves the list', async ({ page }) => {
  const state = await setup(page, { brain_dump_items: [{ id: 'd1', user_id: account.id, text: 'Lab report', created_at: '2026-11-16T08:00:00Z' }] });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Add “Lab report” to your plan' }).click();
  // "Make it a task" is a choice at the bottom of the popup, then Continue (2026-11-16).
  await page.getByRole('checkbox', { name: /Make it a task/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Make it a task' });
  await dialog.getByLabel('Due day').fill(dateOf(3));
  await dialog.getByRole('button', { name: 'Schedule it' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => state.tables.todos.find(t => t.text === 'Lab report')?.due_date).toBe(`${dateOf(3)}T23:59`);
  await expect.poll(() => state.tables.brain_dump_items.length).toBe(0);
  const id = state.tables.todos.find(t => t.text === 'Lab report')!.id;
  await expect.poll(() => state.tables.todo_sessions.filter(s => s.todo_id === id).length).toBeGreaterThan(0);
});

test('a Canvas due card shows under its task’s course and colour, like its sittings', async ({ page }) => {
  await setup(page, {
    todos: [task('hw', 'HW9.5', new Date(2026, 10, 18, 23, 59).toISOString(), { assignment_id: 95, kind: 'homework', auto_schedule: null })],
    todo_sessions: [{ id: 'h1', user_id: account.id, todo_id: 'hw', date: dateOf(1), start_time: at(1, '11:00'), end_time: at(1, '11:40') }],
  });
  await page.goto('/dashboard');
  // Canvas calls the course by its full name, which matches no course of the student's.
  await page.evaluate(async due => {
    // @ts-expect-error Vite serves this browser-only module at runtime.
    const { setLocalSnapshot } = await import('/src/lib/canvasDeepSync.ts');
    setLocalSnapshot({ v: 1, host: 'school.instructure.com', syncedAt: new Date().toISOString(), groups: [], announcements: [],
      courses: [{ id: 7, name: 'Introductory Mechanics and Relativity (Fall 2026)', courseCode: 'Introductory Mechanics and Relativity (Fall 2026)', currentScore: null, currentGrade: null, weighted: false }],
      assignments: [{ id: 95, courseId: 7, name: 'HW9.5', dueAt: due, htmlUrl: '', description: '', pointsPossible: null, groupId: null, workflowState: 'unsubmitted' }] });
    window.dispatchEvent(new Event('soma_canvas_changed'));
  }, new Date(2026, 10, 18, 23, 59).toISOString());
  await page.getByRole('button', { name: /Wed\s*18/ }).first().click();
  const card = page.locator('article[data-kind="due"]').filter({ hasText: 'HW9.5' });
  await expect(card).toBeVisible();
  await expect(card.getByText('HIST 10', { exact: true })).toBeVisible();
  await expect(card.getByText(/Introductory Mechanics/)).toHaveCount(0);
});

test('a Canvas assignment with your own deadline moves to that day, leaving a faint card behind', async ({ page }) => {
  await setup(page, {
    todos: [task('hw', 'HW9.5', new Date(2026, 10, 18, 23, 59).toISOString(), { assignment_id: 95, kind: 'homework', auto_schedule: null, my_due: `${dateOf(1)}T23:59` })],
    todo_sessions: [{ id: 'h1', user_id: account.id, todo_id: 'hw', date: dateOf(0), start_time: at(0, '11:00'), end_time: at(0, '11:40') }],
  });
  await page.goto('/dashboard');
  await page.evaluate(async due => {
    // @ts-expect-error Vite serves this browser-only module at runtime.
    const { setLocalSnapshot } = await import('/src/lib/canvasDeepSync.ts');
    setLocalSnapshot({ v: 1, host: 'school.instructure.com', syncedAt: new Date().toISOString(), groups: [], announcements: [],
      courses: [{ id: 7, name: 'HIST 10', courseCode: 'HIST 10', currentScore: null, currentGrade: null, weighted: false }],
      assignments: [{ id: 95, courseId: 7, name: 'HW9.5', dueAt: due, htmlUrl: '', description: '', pointsPossible: null, groupId: null, workflowState: 'unsubmitted' }] });
    window.dispatchEvent(new Event('soma_canvas_changed'));
  }, new Date(2026, 10, 18, 23, 59).toISOString());
  await page.getByRole('button', { name: /Tue\s*17/ }).first().click();
  await expect(page.locator('article[data-kind="due"]').filter({ hasText: 'HW9.5' }).getByText(/Your deadline \(posted for Wed, Nov 18\)/)).toBeVisible();
  await page.getByRole('button', { name: /Wed\s*18/ }).first().click();
  await expect(page.locator('article[data-kind="due-ghost"]').filter({ hasText: 'HW9.5' })).toBeVisible();
  await expect(page.locator('article[data-kind="due"]').filter({ hasText: 'HW9.5' })).toHaveCount(0);
});

test('details: each step says when it is on the plan', async ({ page }) => {
  await setup(page, {
    todos: [task('hw', 'HW 9.5', dateOf(4), { steps: [{ id: 'a', title: 'Problems 1–3', minutes: 45 }, { id: 'b', title: 'Problems 4–6', minutes: 30, done: true }] })],
    todo_sessions: [{ id: 'sa', user_id: account.id, todo_id: 'hw', date: dateOf(2), start_time: at(2, '15:00'), end_time: at(2, '15:45'), step_id: 'a' }],
  });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Details: HW 9.5' }).click();
  const dialog = page.getByRole('dialog', { name: 'Task details' });
  await expect(dialog.getByText(/Wed, Nov 18, 3:00\sPM–3:45\sPM/)).toBeVisible();
  await expect(dialog.getByText('Done', { exact: true })).toBeVisible();
});

// ── 2026-11-15 fixes ──

test('Tasks: a check-off can be undone, and its sittings come back', async ({ page }) => {
  const state = await setup(page, {
    todos: [task('essay', 'Essay draft', dateOf(3))],
    todo_sessions: [{ id: 's1', user_id: account.id, todo_id: 'essay', date: dateOf(2), start_time: at(2, '10:00'), end_time: at(2, '11:00') }],
  });
  await page.goto('/tasks');
  await page.getByRole('checkbox', { name: 'Done: Essay draft' }).check();
  await expect.poll(() => state.tables.todos.find(t => t.id === 'essay')!.status).toBe('done');
  await expect.poll(() => state.tables.todo_sessions.length).toBe(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => state.tables.todos.find(t => t.id === 'essay')!.status).toBe('nothing');
  await expect(page.getByRole('listitem').filter({ hasText: 'Essay draft' })).toBeVisible();
  await expect.poll(() => state.tables.todo_sessions.filter(s => s.todo_id === 'essay').length).toBe(1);
});

test('details: setting 2 sittings replaces the four already on the plan', async ({ page }) => {
  const four = [1, 2, 3, 4].map(d => ({ id: `o${d}`, user_id: account.id, todo_id: 'oral', date: dateOf(d), start_time: at(d, '10:00'), end_time: at(d, '10:30') }));
  const state = await setup(page, { todos: [task('oral', 'Oral Presentations', dateOf(6), { estimated_minutes: 120 })], todo_sessions: four });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Details: Oral Presentations' }).click();
  const dialog = page.getByRole('dialog', { name: 'Task details' });
  await dialog.getByRole('spinbutton', { name: 'Sittings' }).fill('2');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  const sittings = () => state.tables.todo_sessions.filter(s => s.todo_id === 'oral');
  await expect.poll(() => sittings().length).toBe(2);
  expect(sittings().map(s => (+new Date(String(s.end_time)) - +new Date(String(s.start_time))) / 60000)).toEqual([60, 60]);
});

test('dashboard: a finished assignment stays on its day, checked, and the check undoes it', async ({ page }) => {
  const state = await setup(page, {
    todos: [task('lab', 'Lab 10: SQL', dateOf(2), { kind: 'lab', auto_schedule: null, date: dateOf(0) })],
    todo_sessions: [{ id: 'l1', user_id: account.id, todo_id: 'lab', date: dateOf(1), start_time: at(1, '15:00'), end_time: at(1, '16:00') }],
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /Wed\s*18/ }).first().click();
  await page.getByRole('button', { name: 'Done: Lab 10: SQL' }).click();
  await expect.poll(() => state.tables.todos.find(t => t.id === 'lab')!.status).toBe('done');
  // Still there, checked.
  const done = page.locator('article[data-kind="due-done"]').filter({ hasText: 'Lab 10: SQL' });
  await expect(done).toBeVisible();
  await done.getByRole('button', { name: 'Undo done: Lab 10: SQL' }).click();
  await expect.poll(() => state.tables.todos.find(t => t.id === 'lab')!.status).toBe('nothing');
  await expect(page.locator('article[data-kind="due"]').filter({ hasText: 'Lab 10: SQL' })).toBeVisible();
});

test('dashboard: Focus through a sitting, then ticking it, finishes a task with a guessed length', async ({ page }) => {
  // No length set: Soma guesses an hour. The hour was focused, then ticked.
  // Logged time and the ticked sitting were added together (2026-11-15), so
  // the task read as two hours, stayed open and got another sitting.
  const state = await setup(page, {
    todos: [task('hw', 'Homework 7', dateOf(3), { estimated_minutes: null, kind: 'homework' })],
    todo_sessions: [{ id: 's1', user_id: account.id, todo_id: 'hw', date: dateOf(0), start_time: at(0, '07:30'), end_time: at(0, '08:30'), pinned: true }],
    timer_sessions: [{ id: 'f1', user_id: account.id, subject_id: 'hist', task_text: 'Homework 7', date: dateOf(0), start_time: at(0, '07:30'), end_time: at(0, '08:30'), duration_seconds: 3600 }],
  });
  await page.goto('/dashboard');
  const block = page.locator('article').filter({ hasText: 'Homework 7' }).first();
  await block.getByRole('button', { name: 'Complete: Homework 7' }).click();
  await expect.poll(() => state.tables.todos.find(t => t.id === 'hw')!.status).toBe('done');
  expect(state.tables.todo_sessions.filter(s => s.todo_id === 'hw')).toHaveLength(1);
});

test('dashboard: work handed in on Canvas finishes its task and clears its sittings', async ({ page }) => {
  const due = new Date(2026, 10, 18, 23, 59).toISOString();
  const state = await setup(page, {
    todos: [task('hw', 'HW9.5', due, { assignment_id: 95, kind: 'homework', auto_schedule: null, notes: 'bring calculator' })],
    todo_sessions: [
      { id: 'past', user_id: account.id, todo_id: 'hw', date: dateOf(-1), start_time: at(-1, '11:00'), end_time: at(-1, '11:40'), done_at: at(-1, '11:45') },
      { id: 'ahead', user_id: account.id, todo_id: 'hw', date: dateOf(1), start_time: at(1, '11:00'), end_time: at(1, '11:40') },
    ],
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Focus', exact: true })).toBeVisible();
  await page.evaluate(async due => {
    // @ts-expect-error Vite serves this browser-only module at runtime.
    const { setLocalSnapshot } = await import('/src/lib/canvasDeepSync.ts');
    setLocalSnapshot({ v: 1, host: 'school.instructure.com', syncedAt: new Date().toISOString(), groups: [], announcements: [],
      courses: [{ id: 7, name: 'HIST 10', courseCode: 'HIST 10', currentScore: null, currentGrade: null, weighted: false }],
      assignments: [{ id: 95, courseId: 7, name: 'HW9.5', dueAt: due, htmlUrl: '', description: '', pointsPossible: null, groupId: null, workflowState: 'submitted', submittedAt: new Date().toISOString() }] });
    window.dispatchEvent(new Event('soma_canvas_changed'));
  }, due);
  await expect.poll(() => state.tables.todos.find(t => t.id === 'hw')!.status).toBe('done');
  // The sitting still ahead goes; the one already checked off stays as history.
  await expect.poll(() => state.tables.todo_sessions.map(s => s.id)).toEqual(['past']);
  // Only the status was written: the rest of the row is as it was.
  expect(state.tables.todos.find(t => t.id === 'hw')).toMatchObject({ notes: 'bring calculator', assignment_id: 95, kind: 'homework' });
});

test('dashboard: a sitting not started on time moves, with the dashboard left open', async ({ page }) => {
  // 2026-11-15: the miss was only noticed when the plan was read again, so a sitting
  // left alone on an open dashboard stayed where it was.
  const state = await setup(page, {
    todos: [task('essay', 'Essay draft', dateOf(2))],
    todo_sessions: [{ id: 'm', user_id: account.id, todo_id: 'essay', date: dateOf(0), start_time: at(0, '09:20'), end_time: at(0, '09:50') }],
  }, { running: true });
  await page.goto('/dashboard');
  await expect(page.locator('article').filter({ hasText: 'Essay draft' }).first()).toBeVisible();
  expect(state.tables.todo_sessions.find(s => s.id === 'm')!.start_time).toBe(at(0, '09:20'));
  // 9:00 → 9:53: its time passes without Focus. Jump, then let the minute check run.
  await page.clock.fastForward('52:00');
  await page.clock.runFor(61_000);
  await expect.poll(() => String(state.tables.todo_sessions.find(s => s.id === 'm')!.start_time) >= at(0, '09:50')).toBe(true);
  expect(state.tables.todo_sessions.find(s => s.id === 'm')!.date).toBe(dateOf(0));
  await expect(page.getByText('Moved a sitting that had to move')).toBeVisible();
});

// ── 2026-11-17 follow-ups ──

test('dashboard: a step’s sitting leads with the step; the task’s name is under it, by Planned', async ({ page }) => {
  await setup(page, {
    todos: [task('quiz', 'Physics 5A Quiz 12', dateOf(1), { steps: [{ id: 'a', title: 'Practice Quiz 12', minutes: 60 }] })],
    todo_sessions: [{ id: 'qa', user_id: account.id, todo_id: 'quiz', date: dateOf(0), start_time: at(0, '15:00'), end_time: at(0, '16:00'), step_id: 'a' }],
  });
  await page.goto('/dashboard');
  const card = page.locator('article[data-kind="study"]').filter({ hasText: 'Practice Quiz 12' });
  await expect(card.getByRole('heading', { name: 'Practice Quiz 12' })).toBeVisible();
  await expect(card.getByText('Planned · Physics 5A Quiz 12')).toBeVisible();
});

test('dashboard: a checked-off due card still opens its details, and due cards have no Plan it', async ({ page }) => {
  const state = await setup(page, {
    todos: [task('lab', 'Lab 10: SQL', dateOf(2), { kind: 'lab', auto_schedule: null, date: dateOf(0) })],
    todo_sessions: [{ id: 'l1', user_id: account.id, todo_id: 'lab', date: dateOf(1), start_time: at(1, '15:00'), end_time: at(1, '16:00') }],
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /Wed\s*18/ }).first().click();
  await expect(page.getByRole('button', { name: /^Plan it/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done: Lab 10: SQL' }).click();
  await expect.poll(() => state.tables.todos.find(t => t.id === 'lab')!.status).toBe('done');
  const done = page.locator('article[data-kind="due-done"]').filter({ hasText: 'Lab 10: SQL' });
  await done.getByRole('button', { name: 'Details: Lab 10: SQL' }).click();
  await expect(page.getByRole('region', { name: 'Task details' })).toBeVisible();
});

test('dashboard: a completed block still opens Edit block', async ({ page }) => {
  await setup(page, {
    todos: [{ id: 'read', user_id: account.id, text: 'Reading 4.1', subject_id: 'hist', status: 'done', date: dateOf(0) }],
    todo_sessions: [{ id: 'r1', user_id: account.id, todo_id: 'read', date: dateOf(0), start_time: at(0, '10:00'), end_time: at(0, '11:00') }],
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Edit: Reading 4.1' }).click();
  await expect(page.getByRole('region', { name: 'Block editor' })).toBeVisible();
});

test('a sitting being focused on past its end time is not missed: it stays where it is', async ({ page }) => {
  // 2026-11-17: Quiz 12's 1–2 PM sitting, Focus still running at 2 PM, moved to 3 PM mid-study.
  // Here: a 7–8 AM sitting, Focus on its task since 7:00, and it's 9 AM.
  const start = new Date(at(0, '07:00')).toISOString();
  const state = await setup(page, {
    todos: [task('quiz', 'Physics 5A Quiz 12', dateOf(0) + 'T16:00', { estimated_minutes: 60 })],
    todo_sessions: [{ id: 'q1', user_id: account.id, todo_id: 'quiz', date: dateOf(0), start_time: at(0, '07:00'), end_time: at(0, '08:00'), pinned: true }],
    active_timer: [{ id: 'live', user_id: account.id, subject_id: 'hist', subject_name: 'HIST 10', task_text: 'Physics 5A Quiz 12', session_start_time: start, start_time: start, accumulated_seconds: 0, is_paused: false }],
  });
  await page.addInitScript(([userId, start]) => {
    localStorage.setItem('soma_active_timer', JSON.stringify({ userId, subjectId: 'hist', subjectName: 'HIST 10', subjectColor: '#ab47bc', task: 'Physics 5A Quiz 12', sessionStartTimeISO: start, accumulatedSeconds: 0, isPaused: false, markedAtMs: Date.parse(start) }));
  }, [account.id, start] as const);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Physics 5A Quiz 12' }).first()).toBeVisible();
  await page.waitForTimeout(2500);   // the scheduler's runs on load, and the reclaim's
  const sitting = state.tables.todo_sessions.find(s => s.id === 'q1')!;
  expect([sitting.start_time, sitting.end_time]).toEqual([at(0, '07:00'), at(0, '08:00')]);
  await expect(page.getByText('Moved a sitting that had to move')).toHaveCount(0);
});

test('with two sittings of one task today, the running timer shows on the one it started in', async ({ page }) => {
  const start = new Date(at(0, '07:00')).toISOString();
  await setup(page, {
    todos: [task('quiz', 'Physics 5A Quiz 12', dateOf(0) + 'T16:00', { estimated_minutes: 120 })],
    todo_sessions: [
      // The later sitting first, as on Nov 17 (it was made first).
      { id: 'q2', user_id: account.id, todo_id: 'quiz', date: dateOf(0), start_time: at(0, '10:00'), end_time: at(0, '11:00') },
      { id: 'q1', user_id: account.id, todo_id: 'quiz', date: dateOf(0), start_time: at(0, '07:00'), end_time: at(0, '08:00') },
    ],
    active_timer: [{ id: 'live', user_id: account.id, subject_id: 'hist', subject_name: 'HIST 10', task_text: 'Physics 5A Quiz 12', session_start_time: start, start_time: start, accumulated_seconds: 600, is_paused: true }],
  });
  await page.addInitScript(([userId, start]) => {
    localStorage.setItem('soma_active_timer', JSON.stringify({ userId, subjectId: 'hist', subjectName: 'HIST 10', subjectColor: '#ab47bc', task: 'Physics 5A Quiz 12', sessionStartTimeISO: start, accumulatedSeconds: 600, isPaused: true, markedAtMs: Date.parse(start) }));
  }, [account.id, start] as const);
  await page.goto('/dashboard');
  const first = page.locator('article[data-kind="study"]').filter({ hasText: '7:00 AM–8:00 AM' });
  const second = page.locator('article[data-kind="study"]').filter({ hasText: '10:00 AM–11:00 AM' });
  await expect(first.getByText(/^Paused/)).toBeVisible();
  await expect(second.getByText(/^Planned/)).toBeVisible();
});

// 2026-11-21: the Tasks page is the whole to-do list. Work with no due date is
// listed with where it stands, tasks with steps or several sittings are
// tagged, and a filter narrows the list (remembered on this device).
const undatedTask = (id: string, text: string, extra: Row = {}): Row => ({ id, user_id: account.id, text, subject_id: 'hist', status: 'nothing', date: dateOf(0), estimated_minutes: 60, assignment_id: null, ...extra });
test('Tasks lists work with no due date, where each stands, with tags and a filter', async ({ page }) => {
  await setup(page, {
    todos: [
      task('essay', 'Essay draft', dateOf(4), { steps: [{ id: 'a', title: 'Outline', minutes: 30 }, { id: 'b', title: 'Write', minutes: 60 }] }),
      undatedTask('read', 'Reading: Chapter 5', { date: dateOf(-1) }),
      undatedTask('notes', 'Clean up notes'),
      undatedTask('flash', 'Flashcards', { date: dateOf(1) }),
      undatedTask('old', 'Very old to-do', { date: dateOf(-60) }),
    ],
    todo_sessions: [
      { id: 'read-slot', user_id: account.id, todo_id: 'read', date: dateOf(-1), start_time: at(-1, '15:00'), end_time: at(-1, '16:00') },
      { id: 'f1', user_id: account.id, todo_id: 'flash', date: dateOf(1), start_time: at(1, '10:00'), end_time: at(1, '10:30') },
      { id: 'f2', user_id: account.id, todo_id: 'flash', date: dateOf(2), start_time: at(2, '10:00'), end_time: at(2, '10:30') },
    ],
  });
  await page.goto('/tasks');
  const undated = page.getByRole('list', { name: 'Tasks with no due date' });
  await expect(undated.getByRole('listitem').filter({ hasText: 'Reading: Chapter 5' })).toContainText('Missed Sun');
  await expect(undated.getByRole('listitem').filter({ hasText: 'Clean up notes' })).toContainText('No time yet');
  await expect(undated.getByRole('listitem').filter({ hasText: 'Flashcards' })).toContainText('Scheduled Tomorrow');
  await expect(undated.getByRole('listitem').filter({ hasText: 'Flashcards' })).toContainText('Multi-session');
  await expect(page.getByRole('listitem').filter({ hasText: 'Essay draft' })).toContainText('Multi-step');
  await expect(page.getByText('Very old to-do')).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Status' }).selectOption('missed');
  await expect(undated.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText('Clean up notes')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Status' }).selectOption('all');
  await page.getByRole('combobox', { name: 'Type' }).selectOption('multi-step');
  await expect(page.getByRole('listitem').filter({ hasText: 'Essay draft' })).toBeVisible();
  await expect(page.getByText('Flashcards')).toHaveCount(0);
  // Remembered when the page opens again.
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Type' })).toHaveValue('multi-step');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByText('Flashcards')).toBeVisible();
});

test('Schedule it puts work with no time in the first open slot', async ({ page }) => {
  const state = await setup(page, { todos: [undatedTask('notes', 'Clean up notes')] });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Schedule Clean up notes' }).click();
  await expect.poll(() => state.tables.todo_sessions.find(s => s.todo_id === 'notes')?.start_time).toBe(at(0, '09:00'));
  await expect(page.getByRole('list', { name: 'Tasks with no due date' })).toContainText('Scheduled Today');
});
