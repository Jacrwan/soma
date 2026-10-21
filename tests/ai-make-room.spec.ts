import { test, expect, type Page } from '@playwright/test';
import { setup, idOf, ask, at, type Row } from './event-day';

// Reported 2026-10-20: "this needs your call thing is actually pissing me the
// fuck off ... when i say to move shit around unless ive specificially said
// to have something done by a particular time or have sorted off a specific
// time for a specific session soma should have the ability to move stuff
// around". And accepting a move failed with "That time overlaps a scheduled
// session": the 10.5 review was offered 9:30 PM, where the 10.9 review sat,
// because 10.9's own move failed after 10.5 had been placed.
//
// The day (event-day.ts) is 12:28, study hours 8 AM–11 PM, gym 6–7 PM last.

const TODAY = new Date(at('12:00')).toLocaleDateString('en-CA');
const dayAfter = (n: number) => { const d = new Date(at('12:00')); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const USER = '11111111-1111-4111-8111-111111111111';

/** A planned block of its own task. */
const block = (db: Record<string, Row[]>, id: string, text: string, date: string, from: string, to: string) => {
  db.todos.push({ id: `t-${id}`, user_id: 'u', text, subject_id: 'phys', status: 'nothing', date });
  db.todo_sessions.push({ id: `s-${id}`, user_id: 'u', todo_id: `t-${id}`, date, start_time: new Date(`${date}T${from}:00`).toISOString(), end_time: new Date(`${date}T${to}:00`).toISOString() });
};
const startOf = (db: Record<string, Row[]>, id: string) => db.todo_sessions.find(s => s.id === id)?.start_time;
const pin = (page: Page, key: string) => page.addInitScript(([u, k]) => localStorage.setItem('soma_pinned_blocks', JSON.stringify({ userId: u, keys: [k] })), [USER, key]);

test('a move that fails keeps its slot: nothing else is offered on top of it', async ({ page }) => {
  const db = await setup(page, ctx => ({ reply: 'Moving both.', changes: [
    { action: 'move', id: idOf(ctx, 'Review A'), date: TODAY, after: '21:00', minutes: 40 },
    { action: 'move', id: idOf(ctx, 'Review C'), date: TODAY, after: '22:20', before: '22:40', minutes: 50 },
  ] }), d => {
    block(d, 'a', 'Review A', TODAY, '19:00', '19:40');
    block(d, 'c', 'Review C', TODAY, '21:30', '22:20');
  });
  await ask(page, 'move my reviews later');
  await expect(page.getByRole('log')).toContainText('Moving both.');
  // A goes after C, which stays where it is; it isn't offered 9 PM over C.
  await expect(page.getByRole('log')).toContainText(/Review A: \w+ 10:20 PM–11:00 PM/);
  await page.getByRole('button', { name: 'Accept', exact: true }).first().click();
  await expect.poll(() => startOf(db, 's-a')).toBe(at('22:20'));
  expect(startOf(db, 's-c')).toBe(at('21:30'));
});

test('a full evening: Soma moves a block it chose to make room, and Accept applies both', async ({ page }) => {
  const db = await setup(page, () => ({ reply: 'Essay tonight.', blocks: [{ title: 'Essay 1 body', subject: 'Physics 5A', date: TODAY, minutes: 60, after: '19:00' }] }), d => {
    block(d, 'flex', 'Problem set review', TODAY, '19:00', '20:00');
    block(d, 'late', 'Reading notes', TODAY, '20:00', '23:00');
  });
  await ask(page, 'i need to do essay 1 body tonight after gym');
  await expect(page.getByRole('log')).toContainText('Essay tonight.');
  await expect(page.getByRole('log')).not.toContainText('Needs your call');
  await expect(page.getByText(/to make room for "Essay 1 body"/)).toBeVisible();
  // Accepting only the new block brings the move with it.
  await page.getByText('Essay 1 body', { exact: true }).locator('xpath=ancestor::*[.//button[normalize-space()="Accept"]][1]').getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => db.todo_sessions.find(s => db.todos.find(t => t.id === s.todo_id)?.text === 'Essay 1 body')?.start_time).toBe(at('19:00'));
  expect(startOf(db, 's-flex')).toBe(at('13:00'));
  expect(startOf(db, 's-late')).toBe(at('20:00'));
});

test('a block whose time the student set is never moved to make room', async ({ page }) => {
  await pin(page, `t-flex@${TODAY}T19:00`);
  const db = await setup(page, () => ({ reply: 'Essay tonight.', blocks: [{ title: 'Essay 1 body', subject: 'Physics 5A', date: TODAY, minutes: 60, after: '19:00' }] }), d => {
    block(d, 'flex', 'Problem set review', TODAY, '19:00', '20:00');
    block(d, 'late', 'Reading notes', TODAY, '20:00', '21:00');
    block(d, 'late2', 'Flashcards', TODAY, '21:00', '23:00');
  });
  await ask(page, 'i need to do essay 1 body tonight after gym');
  await expect(page.getByRole('log')).toContainText('Essay tonight.');
  await expect(page.getByText(/Moves from 7:00 PM/)).toHaveCount(0);
  await expect(page.getByText(/to make room for "Essay 1 body"/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect.poll(() => db.todo_sessions.find(s => db.todos.find(t => t.id === s.todo_id)?.text === 'Essay 1 body')?.start_time).toBe(at('20:00'));
  expect(startOf(db, 's-flex')).toBe(at('19:00'));
});

test('dismissing the work also drops the moves that made room for it', async ({ page }) => {
  const db = await setup(page, () => ({ reply: 'Essay tonight.', blocks: [{ title: 'Essay 1 body', subject: 'Physics 5A', date: TODAY, minutes: 60, after: '19:00' }] }), d => {
    block(d, 'flex', 'Problem set review', TODAY, '19:00', '20:00');
    block(d, 'late', 'Reading notes', TODAY, '20:00', '23:00');
  });
  await ask(page, 'i need to do essay 1 body tonight after gym');
  await expect(page.getByText(/to make room for "Essay 1 body"/)).toBeVisible();
  await page.getByText('Essay 1 body', { exact: true }).locator('xpath=ancestor::*[.//button[normalize-space()="Dismiss"]][1]').getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.getByText(/to make room for "Essay 1 body"/)).toHaveCount(0);
  expect(startOf(db, 's-flex')).toBe(at('19:00'));
});

test('a day Soma chose that is full rolls to the next day with room, instead of asking', async ({ page }) => {
  const tomorrow = dayAfter(1), next = dayAfter(2);
  await pin(page, `t-busy@${tomorrow}T08:00`);
  const db = await setup(page, () => ({ reply: 'Early tomorrow.', blocks: [{ title: 'Lecture review', subject: 'Physics 5A', date: tomorrow, minutes: 60, before: '09:00' }] }), d => {
    block(d, 'busy', 'Lab prep', tomorrow, '08:00', '09:00');
  });
  await ask(page, 'put a lecture review on some other day, not today');
  await expect(page.getByRole('log')).toContainText('Early tomorrow.');
  await expect(page.getByRole('log')).not.toContainText('Needs your call');
  await page.getByRole('button', { name: 'Accept', exact: true }).first().click();
  await expect.poll(() => db.todo_sessions.find(s => db.todos.find(t => t.id === s.todo_id)?.text === 'Lecture review')?.date).toBe(next);
});
