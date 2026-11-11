import { test, expect } from '@playwright/test';
import { setup, at, type Row } from './event-day';

// UI review 2026-11-10: the reclaim said "Moved 2 blocks that hadn't been
// started." above the page for eight seconds, with no names and no way back;
// Compare showed two full lists with the moved rows a shade darker. Now the
// note sits on today's plan, names each move, has Undo, and stays until
// dismissed; Compare lists only what changed.

const user = '11111111-1111-4111-8111-111111111111';
const today = at('09:00').slice(0, 10);

/** A reading block at 9:00 that was never started; it's 12:28. */
function missedReading(db: Record<string, Row[]>) {
  db.todos.push({ id: 't-read', user_id: user, text: 'Physics reading: 6.2–6.4', subject_id: 'phys', status: 'nothing', date: today });
  db.todo_sessions.push({ id: 's-read', user_id: user, todo_id: 't-read', date: today, start_time: at('09:00'), end_time: at('10:00') });
}

const sessionStart = (db: Record<string, Row[]>) => new Date(String(db.todo_sessions.find(s => s.id === 's-read')!.start_time));

test('the move is named on today\'s plan, and Undo puts the block back for the rest of the day', async ({ page }) => {
  const db = await setup(page, () => ({ reply: 'ok' }), missedReading);
  const note = page.getByRole('status').filter({ hasText: 'you hadn’t started' });
  await expect(note).toContainText('Moved a block you hadn’t started');
  await expect(note).toContainText('Physics reading: 6.2–6.4');
  await expect(note).toContainText(/9:00 AM\s*→\s*to\s*1:00 PM|9:00 AM → 1:00 PM/);
  await expect.poll(() => sessionStart(db).getHours()).toBe(13);
  // Still there well after the old eight seconds.
  await page.clock.runFor(30_000);
  await expect(note).toBeVisible();

  await note.getByRole('button', { name: 'Undo' }).click();
  await expect(note).toHaveCount(0);
  await expect.poll(() => sessionStart(db).getHours()).toBe(9);
  // The reclaim leaves it alone afterwards, even minutes later.
  for (let i = 0; i < 3; i++) await page.clock.runFor(61_000);
  await page.waitForTimeout(300);
  expect(sessionStart(db).getHours()).toBe(9);
});

test('Compare lists only what moved, from and to', async ({ page }) => {
  await setup(page, () => ({ reply: 'ok' }), missedReading);
  await expect(page.getByRole('status').filter({ hasText: 'you hadn’t started' })).toBeVisible();
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  const panel = page.getByLabel('Compare today’s plan');
  await expect(panel.getByLabel('Changes since')).toHaveValue(/^original:/);
  await expect(panel.getByRole('listitem')).toHaveCount(1);
  await expect(panel.getByRole('listitem')).toContainText('Physics reading: 6.2–6.4');
  await expect(panel.getByRole('listitem')).toContainText('Moved');
  await expect(panel).not.toContainText('CS 61A Lecture');
});
