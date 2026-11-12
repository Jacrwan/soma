import { test, expect } from '@playwright/test';
import { setup, ask, idOf, at } from './event-day';

const user = '11111111-1111-4111-8111-111111111111';
const today = new Date(at('12:00')).toLocaleDateString('en-CA');
const tomorrowDate = new Date(at('12:00')); tomorrowDate.setDate(tomorrowDate.getDate() + 1);
const tomorrow = tomorrowDate.toLocaleDateString('en-CA');

test('accepting a student-requested overdue day succeeds', async ({ page }) => {
  const db = await setup(page, ctx => ({ reply: 'Lab tomorrow.', changes: [{ action: 'move', id: idOf(ctx, 'CS 61A Lab 5'), date: tomorrow, minutes: 30, after: '09:00' }] }), d => {
    d.todos.push({ id: 't-lab', user_id: user, text: 'CS 61A Lab 5', subject_id: 'phys', status: 'nothing', date: '', due_date: today });
  });
  await ask(page, 'do the lab tomorrow');
  await page.getByLabel('Next seven days').getByRole('button').nth(1).click();
  await expect(page.getByText(/After its due date/)).toBeVisible();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => db.todo_sessions.filter(s => s.todo_id === 't-lab').length).toBe(1);
});

test('automatic reclaim must wait when the calendar cannot load', async ({ page }) => {
  const db = await setup(page, () => ({ reply: 'ok' }), d => {
    d.todos.push({ id: 't-read', user_id: user, text: 'Reading assignment', subject_id: 'phys', status: 'nothing', date: today });
    d.todo_sessions.push({ id: 's-read', user_id: user, todo_id: 't-read', date: today, start_time: at('09:00'), end_time: at('10:00') });
  }, '10:05');
  await page.route('**/api/google-calendar-events', r => r.fulfill({ status: 401, json: { error: 'Calendar unavailable' } }));
  await page.clock.setFixedTime(new Date(at('10:28')));
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'Calendar could not be fully loaded' })).toBeVisible();
  await page.clock.runFor(61_000);
  expect(db.todo_sessions.find(s => s.id === 's-read')!.start_time).toBe(at('09:00'));
  await expect(page.getByRole('status').filter({ hasText: 'you hadn’t started' })).toHaveCount(0);
  // A successful reload can recover; this must not disable reclaim forever.
  await page.unroute('**/api/google-calendar-events');
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => db.todo_sessions.find(s => s.id === 's-read')!.start_time).not.toBe(at('09:00'));
});

test('linked exam priority survives readPlan and reaches reclaim', async ({ page }) => {
  await setup(page, () => ({ reply: 'ok' }), d => {
    d.todos.push({ id: 't-read', user_id: user, text: 'Practice exam', subject_id: 'phys', status: 'nothing', date: today });
    d.todo_sessions.push({ id: 's-read', user_id: user, todo_id: 't-read', date: today, start_time: at('09:00'), end_time: at('10:00') });
    d.course_items = [{ id: 'i-exam', user_id: user, subject_id: 'phys', label: 'Practice exam', exam_id: 'e1', todo_id: 't-read', priority: 5, position: 0, minutes: 60 }];
  }, '08:00');
  const priority = await page.evaluate(async ({ user, today }) => {
    const { readPlan } = await import('/src/components/DashboardV2/liveData.ts');
    const { asDayBlocks } = await import('/src/lib/reclaimToday.ts');
    const snapshot = await readPlan(user, new Date(`${today}T00:00:00`));
    return asDayBlocks(snapshot.blocks, { pins: new Set(), date: today }).find(b => b.id === 's-read')!.priority;
  }, { user, today });
  expect(priority).toBe(5);
});

test('unrelated Focus history does not mark a planned block started', async ({ page }) => {
  const db = await setup(page, () => ({ reply: 'ok' }), d => {
    d.todos.push({ id: 't-read', user_id: user, text: 'Reading assignment', subject_id: 'phys', status: 'nothing', date: today });
    d.todo_sessions.push({ id: 's-read', user_id: user, todo_id: 't-read', date: today, start_time: at('09:00'), end_time: at('10:00') });
    d.timer_sessions.push({ id: 'h1', user_id: user, subject_id: 'phys', task_text: 'Unplanned lecture catch-up', date: today, start_time: at('07:00'), end_time: at('07:20'), duration_seconds: 1200 });
  }, '08:00');
  const result = await page.evaluate(async ({ user, today }) => {
    const { readPlan } = await import('/src/components/DashboardV2/liveData.ts');
    const { planToday } = await import('/src/lib/reclaimToday.ts');
    const snapshot = await readPlan(user, new Date(`${today}T00:00:00`));
    return planToday(snapshot.blocks, 12 * 60 + 28, 23 * 60, { pins: new Set(), date: today }).moved;
  }, { user, today });
  expect(result.some(m => m.id === 's-read')).toBe(true);
  // Actual work on this task still protects it from automatic moves.
  db.timer_sessions.push({ id: 'h2', user_id: user, subject_id: 'phys', task_text: 'Reading assignment', date: today, start_time: at('07:20'), end_time: at('07:30'), duration_seconds: 600 });
  const started = await page.evaluate(async ({ user, today }) => {
    const { readPlan } = await import('/src/components/DashboardV2/liveData.ts');
    const { planToday } = await import('/src/lib/reclaimToday.ts');
    const snapshot = await readPlan(user, new Date(`${today}T00:00:00`));
    return planToday(snapshot.blocks, 12 * 60 + 28, 23 * 60, { pins: new Set(), date: today }).moved;
  }, { user, today });
  expect(started.some(m => m.id === 's-read')).toBe(false);
});

test('requested-date exceptions cannot move to a different date or past an exam', async ({ page }) => {
  await setup(page, () => ({ reply: 'ok' }), d => {
    d.todos.push({ id: 't-lab', user_id: user, text: 'Lab 5', subject_id: 'phys', status: 'nothing', date: '', due_date: today });
    d.exam_plans = [{ id: 'e1', user_id: user, subject_id: 'phys', title: 'Midterm', exam_date: tomorrow }];
    d.course_items = [{ id: 'i-exam', user_id: user, subject_id: 'phys', label: 'Practice exam', exam_id: 'e1', priority: 5, position: 0, minutes: 60 }];
  }, '08:00');
  const errors = await page.evaluate(async ({ user, today, tomorrow }) => {
    const { applyProposal } = await import('/src/lib/assistant.ts');
    const origin = new Date(`${today}T00:00:00`);
    const base = { id: 'proposal:test', title: 'Lab 5', subject: 'Physics 5A', time: '09:00–09:30', minutes: 30, color: 'purple', state: 'Proposal', requestedDate: tomorrow };
    const proposals = [
      { ...base, day: 2, replaces: 't-lab', changeKind: 'move' },
      { ...base, title: 'Practice exam', day: 1, coverIds: ['i-exam'] },
    ];
    const out = [];
    for (const p of proposals) {
      try { await applyProposal(user, origin, p); out.push('accepted'); }
      catch (e) { out.push(e.message); }
    }
    return out;
  }, { user, today, tomorrow });
  expect(errors[0]).toContain("can't schedule after its due date");
  expect(errors[1]).toContain("exam prep can't land on or after the exam");
});

test('finishing during a calendar outage marks the task done without shifting other blocks', async ({ page }) => {
  const db = await setup(page, () => ({ reply: 'ok' }), d => {
    d.todos.push(
      { id: 't-read', user_id: user, text: 'Reading assignment', subject_id: 'phys', status: 'nothing', date: today },
      { id: 't-next', user_id: user, text: 'Worksheet', subject_id: 'phys', status: 'nothing', date: today },
    );
    d.todo_sessions.push(
      { id: 's-read', user_id: user, todo_id: 't-read', date: today, start_time: at('09:00'), end_time: at('10:00') },
      { id: 's-next', user_id: user, todo_id: 't-next', date: today, start_time: at('10:00'), end_time: at('11:00') },
    );
    d.timer_sessions.push({ id: 'h1', user_id: user, subject_id: 'phys', task_text: 'Reading assignment', date: today, start_time: at('09:00'), end_time: at('10:20'), duration_seconds: 4800 });
  }, '10:28');
  await page.route('**/api/google-calendar-events', r => r.fulfill({ status: 401, json: { error: 'Calendar unavailable' } }));
  await page.getByRole('button', { name: 'Complete: Reading assignment', exact: true }).click();
  await expect.poll(() => db.todos.find(t => t.id === 't-read')!.status).toBe('done');
  expect(db.todo_sessions.find(s => s.id === 's-next')!.start_time).toBe(at('10:00'));
  expect(db.todo_sessions.find(s => s.id === 's-read')!.end_time).toBe(at('10:00'));
});

// Suggestions saved before exam ids (2026-11-11) only carry the title note:
// removing the exam still clears them, and an id'd one from another exam with
// the same title stays.
