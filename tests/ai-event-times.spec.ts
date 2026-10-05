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

test('a change aimed at a calendar event says it is one', async ({ page }) => {
  await setup(page, ctx => ({ reply: 'Removing it.', changes: [{ action: 'remove', id: idOf(ctx, 'gym') }] }));
  await ask(page, 'remove gym');
  await expect(page.getByRole('log')).toContainText("gym is a calendar event; it can't be changed here.");
});
