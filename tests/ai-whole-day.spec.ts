import { test, expect } from '@playwright/test';
import { triaged } from './triage';
import { setup, idOf, ask, at, lineOf, lines, type Ctx } from './event-day';

// Reported 2026-10-06, planning a whole day at 3 AM: only five blocks per
// reply; "I'm not attending OH and RUF" forgotten two replies later; "when I
// wake up" read as the next date; "delete everything and reschedule" made a
// delete and a copy of each block; ids like "(b0aza7a)" shown in the reply.

const TODAY = new Date(at('12:00')).toLocaleDateString('en-CA');
const reply = (out: (ctx: Ctx, n: number) => unknown) => { let n = 0; const seen: Ctx[] = []; return { seen, fn: (ctx: Ctx) => { seen.push(ctx); return out(ctx, ++n); } }; };

test('a skipped class stays skipped on later replies, and the plan says so', async ({ page }) => {
  const r = reply((ctx, n) => n === 1
    ? { reply: 'Noted, skipping lecture.', skip: [idOf(ctx, 'CS 61A Lecture')] }
    : { reply: 'Physics now.', changes: [{ action: 'move', id: idOf(ctx, 'Physics HW 5: KK-5'), minutes: 90, after: 'now' }] });
  const db = await setup(page, r.fn);
  await ask(page, "i'm not going to cs lecture today");
  await expect(page.getByRole('log')).toContainText('Noted, skipping lecture.');
  await expect(page.getByText(/Read-only commitment · Skipping/)).toHaveCount(1);
  await ask(page, 'do physics for an hour and a half');
  await expect(page.getByRole('log')).toContainText('Physics now.');
  expect(lineOf(r.seen[1], 'CS 61A Lecture')).toMatch(/ · calendar event · skip$/);
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => db.todo_sessions.length).toBe(1);
  // Over the skipped lecture, in one piece, not 1–2 PM and a remainder.
  expect([db.todo_sessions[0].start_time, db.todo_sessions[0].end_time]).toEqual([at('12:30'), at('14:00')]);
});

test('"I\'ll go after all" takes a skip back', async ({ page }) => {
  const r = reply((ctx, n) => n === 1 ? { reply: 'Skipping.', skip: [idOf(ctx, 'gym')] } : n === 2 ? { reply: 'Going.', attend: ['gym'] } : { reply: 'ok' });
  await setup(page, r.fn);
  await ask(page, 'skipping gym');
  await expect(page.getByRole('log')).toContainText('Skipping.');
  await ask(page, 'actually im going to the gym');
  await expect(page.getByRole('log')).toContainText('Going.');
  await expect(page.getByText(/Read-only commitment · Skipping/)).toHaveCount(0);
  await ask(page, 'what now');
  await expect(page.getByRole('log')).toContainText('ok');
  expect(lineOf(r.seen[2], 'gym')).toMatch(/ · calendar event$/);
});

test('a whole day of blocks comes back in one reply, not five at a time', async ({ page }) => {
  const blocks = Array.from({ length: 9 }, (_, i) => ({ title: `Practice set ${i + 1}`, subject: 'Physics 5A', date: TODAY, minutes: 15, after: 'now' }));
  await setup(page, () => ({ reply: 'The whole day.', blocks }));
  await ask(page, 'schedule everything');
  await expect(page.getByRole('log')).toContainText('The whole day.');
  await expect(page.getByRole('log')).not.toContainText('over the limit');
  await expect(page.getByRole('button', { name: 'Accept all (9)' })).toBeVisible();
});

test('deleting a block and making the same work anew is one move, keeping the task', async ({ page }) => {
  const tomorrow = new Date(at('12:00')); tomorrow.setDate(tomorrow.getDate() + 1);
  const T = tomorrow.toLocaleDateString('en-CA');
  const db = await setup(page, ctx => ({ reply: 'Rescheduling today.', changes: [{ action: 'remove', id: idOf(ctx, 'Math 53 Homework - Chapters 14.3–14.5') }], blocks: [{ title: 'Math 53 Homework - Chapters 14.3–14.5', subject: 'Physics 5A', date: TODAY, start: '19:00', end: '20:00' }] }), d => {
    d.todos.push({ id: 't-math', user_id: 'u', text: 'Math 53 Homework - Chapters 14.3–14.5', subject_id: 'phys', status: 'nothing', date: T });
    d.todo_sessions.push({ id: 's-math', user_id: 'u', todo_id: 't-math', date: T, start_time: new Date(`${T}T15:00:00`).toISOString(), end_time: new Date(`${T}T17:30:00`).toISOString() });
  });
  await ask(page, 'delete everything and reschedule it all today');
  await expect(page.getByRole('log')).toContainText('Rescheduling today.');
  await expect(page.getByText(/Delete from plan/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => db.todo_sessions.find(s => s.id === 's-math')?.start_time).toBe(at('19:00'));
  expect(db.todos.filter(t => String(t.text).startsWith('Math 53'))).toHaveLength(1);
});

test('ids in Soma\'s reply are shown as names', async ({ page }) => {
  await setup(page, ctx => ({ reply: `Skipping CS 61A Lecture (${idOf(ctx, 'CS 61A Lecture')}) and ${idOf(ctx, 'gym')}.` }));
  await ask(page, 'skip stuff');
  await expect(page.getByRole('log')).toContainText('Skipping CS 61A Lecture and gym.');
});

test('after midnight, "when I wake up" is today', async ({ page }) => {
  const r = reply(() => ({ reply: 'ok' }));
  await setup(page, r.fn, undefined, '02:50');
  await ask(page, 'i wake up at 9:30, schedule my day');
  await expect(page.getByRole('log')).toContainText('ok');
  expect(r.seen[0].lateNight).toContain(new Date(at('12:00')).toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + TODAY);
});

// Reported 2026-10-06 at midday: with no day in the message, Soma kept the
// "tomorrow" from the message before and put half the day on Wednesday.
const TOMORROW = (() => { const d = new Date(at('12:00')); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA'); })();
const block = (date?: string) => ({ title: 'Math 53 past midterm', subject: 'Physics 5A', minutes: 60, ...(date ? { date } : {}) });

test('with no day in the message, work Soma dates tomorrow goes on today', async ({ page }) => {
  const db = await setup(page, () => ({ reply: 'Midterm practice.', blocks: [block(TOMORROW)] }));
  await ask(page, 'i also want to do a past math 53 midterm');
  await expect(page.getByRole('log')).toContainText('Midterm practice.');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => db.todo_sessions.length).toBe(1);
  // Today's first open hour after the CS lecture, before the math discussion.
  expect([db.todo_sessions[0].start_time, db.todo_sessions[0].end_time]).toEqual([at('13:00'), at('14:00')]);
});

test('the day on screen is not a default: undated work goes on today', async ({ page }) => {
  const db = await setup(page, () => ({ reply: 'Midterm practice.', blocks: [block()] }));
  await page.getByLabel('Next seven days').getByRole('button').nth(1).click();
  await ask(page, 'i also want to do a past math 53 midterm');
  await expect(page.getByRole('log')).toContainText('Midterm practice.');
  await page.getByLabel('Next seven days').getByRole('button').nth(0).click();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => db.todo_sessions.length).toBe(1);
  expect(db.todo_sessions[0].date).toBe(TODAY);
});

test('a day the student names is kept', async ({ page }) => {
  const db = await setup(page, () => ({ reply: 'Tomorrow then.', blocks: [{ ...block(TOMORROW), after: '09:00' }] }));
  await ask(page, 'do a past math 53 midterm tomorrow morning');
  await expect(page.getByRole('log')).toContainText('Tomorrow then.');
  await page.getByLabel('Next seven days').getByRole('button').nth(1).click();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => db.todo_sessions.length).toBe(1);
  expect(db.todo_sessions[0].date).toBe(TOMORROW);
});

test('work moved past its due date says so on the card', async ({ page }) => {
  await setup(page, ctx => ({ reply: 'Lab tomorrow.', changes: [{ action: 'move', id: idOf(ctx, 'CS 61A Lab 5'), date: TOMORROW, minutes: 30, after: '09:00' }] }), d => {
    d.todos.push({ id: 't-lab', user_id: 'u', text: 'CS 61A Lab 5', subject_id: 'phys', status: 'nothing', date: '', due_date: TODAY });
  });
  await ask(page, 'do the lab tomorrow');
  await page.getByLabel('Next seven days').getByRole('button').nth(1).click();
  await expect(page.getByText(/After its due date/)).toBeVisible();
});

// "Then what homework was last week's?" (2026-10-06): Soma kept giving the
// homework done last week. Weeks are worked out by the app.
test('Soma is given this week and last week as dates', async ({ page }) => {
  const r = reply(() => ({ reply: 'ok' }));
  await setup(page, r.fn);
  await ask(page, "what was last week's homework");
  await expect(page.getByRole('log')).toContainText('ok');
  const day = (d: Date) => `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.toLocaleDateString('en-CA')}`;
  const monday = new Date(at('12:00')); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const lastMonday = new Date(monday); lastMonday.setDate(lastMonday.getDate() - 7);
  const lastSunday = new Date(monday); lastSunday.setDate(lastSunday.getDate() - 1);
  const ctx = r.seen[0] as Ctx & { weeks: { this: string; last: string } };
  expect(ctx.weeks.this.startsWith(day(monday))).toBe(true);
  expect(ctx.weeks.last).toBe(`${day(lastMonday)} – ${day(lastSunday)}`);
});

test('every Soma reply uses the larger model, not only planning ones', async ({ page }) => {
  let model: unknown;
  await setup(page, () => ({ reply: 'ok' }));
  await page.route('**/api/chat', async route => { if (triaged(route)) return; model = route.request().postDataJSON().model; await route.fallback(); });
  await ask(page, 'are you sure the math homework is correct?');
  await expect(page.getByRole('log')).toContainText('ok');
  expect(model).toBe('sonnet');
});

test('a leftover copy of finished work is not offered as an open task', async ({ page }) => {
  const r = reply(() => ({ reply: 'ok' }));
  await setup(page, r.fn, d => {
    d.todos.push(
      { id: 'hw-done', user_id: 'u', text: 'Math 53 Homework - Chapters 13.1, 13.2, 14.1, 14.2', subject_id: 'phys', status: 'done', date: '2026-09-29' },
      { id: 'hw-copy', user_id: 'u', text: 'Math 53 Homework — Chapters 13.1, 13.2, 14.1, 14.2', subject_id: 'phys', status: 'nothing', date: '' },
    );
  });
  await ask(page, 'what do i have left');
  await expect(page.getByRole('log')).toContainText('ok');
  expect(lines(r.seen[0].tasks).join('\n')).not.toContain('Math 53 Homework — Chapters 13.1, 13.2, 14.1, 14.2');
});
