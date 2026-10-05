import { test, expect } from '@playwright/test';
import { setup, idOf, ask, acceptedTimes, at, type Ctx } from './event-day';

// Reported 2026-10-05, at 12:28 on a Monday: "physics homework from now until
// the physics 5a discussion; I'm skipping cs61a lecture and the math
// discussion." Soma split it into 1–2 and 3–4 around the classes being
// skipped, then made a second copy of the homework, then put it at 1–2 again.
// Times named by an event ("until the discussion", "after lecture") and events
// named loosely ("the math discussion") now resolve in the app, by id, whatever
// the wording, instead of through patterns over the student's message.
const SAID = "im gonna work on the physics homework thats due tomorrow from now until the physics 5a discussion; im skipping cs61a lecture and the math discussion";

test('every calendar event has an id Soma can refer to', async ({ page }) => {
  let seen: Ctx | undefined;
  await setup(page, ctx => { seen = ctx; return { reply: 'Noted.' }; });
  await ask(page, 'hi');
  await expect(page.getByRole('log')).toContainText('Noted.');
  const disc = seen!.plan.find(e => e.title === 'Physics 5A Discussion')!;
  expect(disc).toMatchObject({ ro: true });
  expect(disc.id).toMatch(/^b[0-9a-z]{6}$/);
});

test('"from now until the discussion" by event id goes exactly there, over the skipped classes', async ({ page }) => {
  const db = await setup(page, ctx => ({ reply: 'Physics until discussion.', changes: [{ action: 'move', id: idOf(ctx, 'Physics HW 5: KK-5'), start: 'now', end: idOf(ctx, 'Physics 5A Discussion') }] }));
  await ask(page, SAID);
  await expect(page.getByText(/overlaps CS 61A Lecture, MATH 53 Discussion/i).first()).toBeVisible();
  expect(await acceptedTimes(page, db)).toEqual([[at('12:28'), at('16:00')]]);
});

test('an event named in words instead of an id resolves the same way', async ({ page }) => {
  const db = await setup(page, ctx => ({ reply: 'Physics until discussion.', changes: [{ action: 'move', id: idOf(ctx, 'Physics HW 5: KK-5'), start: 'now', end: 'the physics 5a discussion' }] }));
  await ask(page, SAID);
  expect(await acceptedTimes(page, db)).toEqual([[at('12:28'), at('16:00')]]);
});

test('skipped classes named loosely free their time for the app to place work in', async ({ page }) => {
  const db = await setup(page, ctx => ({ reply: 'Physics, one block.', changes: [{ action: 'move', id: idOf(ctx, 'Physics HW 5: KK-5'), minutes: 210, after: 'now', overlapOk: ['cs61a lecture', 'the math discussion'] }] }));
  await ask(page, SAID);
  // One piece from the next round time to the discussion, not 1–2 and 3–4.
  expect(await acceptedTimes(page, db)).toEqual([[at('12:30'), at('16:00')]]);
});

test('a new block for work already waiting unscheduled schedules that one instead of a copy', async ({ page }) => {
  const db = await setup(page, ctx => ({ reply: 'Physics now.', blocks: [{ title: 'Physics HW 5', subject: 'Physics 5A', start: 'now', end: idOf(ctx, 'Physics 5A Discussion') }] }));
  await ask(page, 'no just do one study session from right now until discussion');
  expect(await acceptedTimes(page, db)).toEqual([[at('12:28'), at('16:00')]]);
  expect(db.todo_sessions[0].todo_id).toBe('t-kk5');
});

test('"between lecture and the math discussion" is from the end of one to the start of the other', async ({ page }) => {
  const db = await setup(page, ctx => ({ reply: 'In between.', changes: [{ action: 'move', id: idOf(ctx, 'Physics HW 5: KK-5'), start: idOf(ctx, 'CS 61A Lecture'), end: idOf(ctx, 'MATH 53 Discussion') }] }));
  await ask(page, 'physics hw between cs lecture and the math discussion');
  expect(await acceptedTimes(page, db)).toEqual([[at('12:59'), at('14:00')]]);
});

// Reported 2026-10-05 after the fix above: to say the student was skipping the
// two classes, Soma sent changes to them, and the homework move came back
// without a date. All three were shown as errors.
test('changes aimed at calendar events are read as skipping them, and a move without a date stays on its day', async ({ page }) => {
  let calls = 0;
  const db = await setup(page, ctx => { calls++; return { reply: 'Physics until discussion.', changes: [
    { action: 'remove', id: idOf(ctx, 'CS 61A Lecture') },
    { action: 'remove', id: idOf(ctx, 'MATH 53 Discussion') },
    { action: 'move', id: idOf(ctx, 'Physics HW 5: KK-5'), start: 'now', end: idOf(ctx, 'Physics 5A Discussion') },
  ] }; });
  await ask(page, SAID);
  await expect(page.getByRole('log')).toContainText('Physics until discussion.');
  await expect(page.getByRole('log')).not.toContainText('calendar event');
  expect(await acceptedTimes(page, db)).toEqual([[at('12:28'), at('16:00')]]);
  expect(calls).toBe(1);
});

test('"skip" frees skipped classes for the app to place work over', async ({ page }) => {
  const db = await setup(page, ctx => ({ reply: 'One block.', skip: [idOf(ctx, 'CS 61A Lecture'), 'the math discussion'], changes: [{ action: 'move', id: idOf(ctx, 'Physics HW 5: KK-5'), minutes: 210, after: 'now' }] }));
  await ask(page, SAID);
  expect(await acceptedTimes(page, db)).toEqual([[at('12:30'), at('16:00')]]);
});

test('a reply the app cannot use goes back to the model once, and the student sees the corrected one', async ({ page }) => {
  const asked: string[] = [];
  const db = await setup(page, (ctx, body) => {
    const messages = body.messages as { content: string }[];
    asked.push(messages[messages.length - 1].content);
    return asked.length === 1
      ? { reply: 'First try.', changes: [{ action: 'move', id: idOf(ctx, 'Physics HW 5: KK-5'), start: 'now' }] }
      : { reply: 'Corrected.', changes: [{ action: 'move', id: idOf(ctx, 'Physics HW 5: KK-5'), start: 'now', end: idOf(ctx, 'Physics 5A Discussion') }] };
  });
  await ask(page, SAID);
  await expect(page.getByRole('log')).toContainText('Corrected.');
  await expect(page.getByRole('log')).not.toContainText('First try.');
  expect(asked[1]).toContain("your reply couldn't be used as sent: Physics HW 5: KK-5: the new time was incomplete (no end)");
  expect(await acceptedTimes(page, db)).toEqual([[at('12:28'), at('16:00')]]);
});

test('an unreadable reply is retried too', async ({ page }) => {
  let calls = 0;
  const db = await setup(page, ctx => ++calls === 1 ? '{"reply": "broken' : { reply: 'Readable now.', changes: [{ action: 'move', id: idOf(ctx, 'Physics HW 5: KK-5'), start: 'now', end: idOf(ctx, 'Physics 5A Discussion') }] });
  await ask(page, SAID);
  await expect(page.getByRole('log')).toContainText('Readable now.');
  expect(await acceptedTimes(page, db)).toEqual([[at('12:28'), at('16:00')]]);
});

test('when the retry is no better, the first answer and its problems are shown', async ({ page }) => {
  let calls = 0;
  await setup(page, ctx => { calls++; return { reply: 'Still wrong.', changes: [{ action: 'move', id: idOf(ctx, 'Physics HW 5: KK-5'), start: 'now' }] }; });
  await ask(page, SAID);
  await expect(page.getByRole('log')).toContainText('the new time was incomplete');
  expect(calls).toBe(2);
});

// A task with no day (on Soma's task list, not the plan) used to get a second
// task with the same name when Soma scheduled it, and the first stayed waiting.
const withTask = (db: Record<string, Record<string, unknown>[]>) => { db.todos.push({ id: 't-hw6', user_id: 'u', text: 'Physics HW 6', subject_id: 'phys', status: 'nothing', date: '' }); };
const taskId = (ctx: Ctx) => ctx.tasks.find(t => t.title === 'Physics HW 6')!.id;
const TODAY = new Date(at('12:00')).toLocaleDateString('en-CA');

test('a task with no day has an id, and scheduling it gives that task its time', async ({ page }) => {
  const db = await setup(page, ctx => ({ reply: 'HW 6 now.', changes: [{ action: 'move', id: taskId(ctx), date: TODAY, start: 'now', end: idOf(ctx, 'Physics 5A Discussion') }] }), withTask);
  await ask(page, 'do physics hw 6 from now until discussion');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => db.todo_sessions.length).toBe(1);
  expect(db.todo_sessions[0]).toMatchObject({ todo_id: 't-hw6', start_time: at('12:28'), end_time: at('16:00') });
  expect(db.todos.map(t => t.text).sort()).toEqual(['Physics HW 5: KK-5', 'Physics HW 6']);
});

test('a new block for a task already on the list schedules that task instead of a copy', async ({ page }) => {
  const db = await setup(page, ctx => ({ reply: 'HW 6 after math.', blocks: [{ title: 'Physics HW 6', subject: 'Physics 5A', date: TODAY, start: idOf(ctx, 'MATH 53 Discussion'), end: idOf(ctx, 'Physics 5A Discussion') }] }), withTask);
  await ask(page, 'physics hw 6 after the math discussion until my discussion');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => db.todo_sessions.length).toBe(1);
  expect(db.todo_sessions[0]).toMatchObject({ todo_id: 't-hw6', start_time: at('14:59'), end_time: at('16:00') });
  expect(db.todos.filter(t => t.text === 'Physics HW 6')).toHaveLength(1);
});

test('a task with no day can be marked done by its id', async ({ page }) => {
  const db = await setup(page, ctx => ({ reply: 'Marking it done.', changes: [{ action: 'complete', id: taskId(ctx) }] }), withTask);
  await ask(page, 'i already finished hw 6');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => db.todos.find(t => t.id === 't-hw6')?.status).toBe('done');
});
