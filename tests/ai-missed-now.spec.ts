import { test, expect, type Page } from '@playwright/test';
import { setup, idOf, ask, at, type Row, type Ctx } from './event-day';

// Reported 2026-11-20 at 11:34: "nope im doing the physics reading i missed
// yesterday right now til 1pm". Catch-Up had already put that reading on
// Sunday. Soma made a second block for 12.7–12.9, couldn't link its sections
// ("12.7 is already planned in another block"), and refused it: "That time
// overlaps a scheduled session", an untouched 11:00 review. Now the real block
// moves to the time the student said, and the review moves out of the way.

const TODAY = new Date(at('12:00')).toLocaleDateString('en-CA');
const dayAfter = (n: number) => { const d = new Date(at('12:00')); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const USER = '11111111-1111-4111-8111-111111111111';
const SECTIONS = ['12.6', '12.7', '12.8', '12.9', '12.10', '12.11'];

const block = (db: Record<string, Row[]>, id: string, text: string, date: string, from: string, to: string) => {
  db.todos.push({ id: `t-${id}`, user_id: USER, text, subject_id: 'phys', status: 'nothing', date });
  db.todo_sessions.push({ id: `s-${id}`, user_id: USER, todo_id: `t-${id}`, date, start_time: new Date(`${date}T${from}:00`).toISOString(), end_time: new Date(`${date}T${to}:00`).toISOString() });
};
const board = (d: Record<string, Row[]>) => {
  block(d, 'rev', 'Review: Physics lecture from Tue 11-10', TODAY, '11:00', '12:00');
  block(d, 'read', 'Physics reading: 12.7–12.11 Special Relativity', dayAfter(2), '13:55', '15:55');
  d.course_items = SECTIONS.map((label, position) => ({ id: `i-${label}`, user_id: USER, subject_id: 'phys', label, title: 'Special Relativity', position, todo_id: label === '12.6' ? null : 't-read', done_at: label === '12.6' ? at('09:00') : null }));
};
/** The short id Soma's context gives a reading-list section. */
const sectionId = (ctx: Ctx, label: string) => {
  const courses = (ctx as unknown as { courses?: { open: string[] }[] }).courses ?? [];
  return courses.flatMap(c => c.open).find(l => l.split(' · ')[0].split(' ')[1] === label)!.split(' ')[0];
};
const startOf = (db: Record<string, Row[]>, id: string) => db.todo_sessions.find(s => s.id === id)?.start_time;
const pin = (page: Page, key: string) => page.addInitScript(([u, k]) => localStorage.setItem('soma_pinned_blocks', JSON.stringify({ userId: u, keys: [k] })), [USER, key]);
// What the model sent on 2026-11-20: a new block for part of the reading.
const reply = (ctx: Ctx) => ({
  reply: 'Physics reading until 1.',
  skip: [idOf(ctx, 'CS 61A Lecture')],
  blocks: [{ title: 'Physics reading: 12.7–12.9 Special Relativity', subject: 'Physics 5A', date: TODAY, start: 'now', end: '13:00', covers: [sectionId(ctx, '12.7'), sectionId(ctx, '12.9')] }],
});

test('"the reading I missed, right now til 1" moves the real block there, and the review in the way moves', async ({ page }) => {
  const db = await setup(page, reply, board, '11:34');
  await ask(page, 'nope im doing the physics reading i missed yesterday right now til 1pm');
  await expect(page.getByRole('log')).toContainText('Physics reading until 1.');
  await expect(page.getByRole('log')).not.toContainText('already planned in another block');
  await expect(page.getByRole('log')).not.toContainText('overlaps a scheduled session');
  await page.getByRole('button', { name: 'Accept all' }).click();
  // The whole block, title and all, from now until 1.
  await expect.poll(() => startOf(db, 's-read')).toBe(at('11:34'));
  expect(db.todo_sessions.find(s => s.id === 's-read')!.end_time).toBe(at('13:00'));
  expect(db.todo_sessions.filter(s => s.todo_id !== 't-read' && db.todos.find(t => t.id === s.todo_id)?.text.startsWith('Physics reading'))).toEqual([]);
  // The untouched 11:00 review moved out of the way.
  expect(startOf(db, 's-rev')).not.toBe(at('11:00'));
});

test('a block the student placed in the way says so and waits for its own Accept', async ({ page }) => {
  await pin(page, `t-rev@${TODAY}T11:00`);
  const db = await setup(page, reply, board, '11:34');
  await ask(page, 'nope im doing the physics reading i missed yesterday right now til 1pm');
  await expect(page.getByText(/You set this time yourself/)).toBeVisible();
  await page.getByRole('button', { name: 'Accept all' }).click();
  // Accept all leaves both: the move of their block, and the work that needs it.
  await page.waitForTimeout(500);
  expect(startOf(db, 's-rev')).toBe(at('11:00'));
  expect(startOf(db, 's-read')).not.toBe(at('11:34'));
  // Accepting the work itself is the yes.
  await page.getByText('Physics reading: 12.7–12.11 Special Relativity', { exact: true }).first().locator('xpath=ancestor::*[.//button[normalize-space()="Accept"]][1]').getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => startOf(db, 's-read')).toBe(at('11:34'));
  expect(startOf(db, 's-rev')).not.toBe(at('11:00'));
});

// 2026-11-21: work that comes first stays first. Moving chapter 5 to the
// evening also moves chapter 6, planned for the afternoon, to right after it;
// nothing else moves.
test('moving chapter 5 after chapter 6 moves chapter 6 after it, and nothing else', async ({ page }) => {
  const db = await setup(page, ctx => ({ reply: 'Chapter 5 tonight.', changes: [{ action: 'move', id: idOf(ctx, 'Reading: Chapter 5'), date: TODAY, start: '19:30', end: '20:30' }] }), d => {
    block(d, 'c5', 'Reading: Chapter 5', TODAY, '13:00', '14:00');
    block(d, 'c6', 'Reading: Chapter 6', TODAY, '15:00', '16:00');
    block(d, 'x', 'Problem set', TODAY, '20:45', '21:45');
  });
  await ask(page, 'move chapter 5 to 7:30 tonight');
  await expect(page.getByText(/to come after "Reading: Chapter 5", which goes first/)).toBeVisible();
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect.poll(() => startOf(db, 's-c5')).toBe(at('19:30'));
  await expect.poll(() => startOf(db, 's-c6')).toBe(at('21:45'));
  expect(startOf(db, 's-x')).toBe(at('20:45'));
});
