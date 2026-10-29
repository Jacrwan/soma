import { test, expect } from '@playwright/test';
import { buildCatchUp, buildYesterday, type CatchUpAssignment } from '../src/lib/catchUp';
import type { LiveBlock, Snapshot } from '../src/components/DashboardV2/liveData';
import type { SomaSettings } from '../src/lib/storage';
import type { Todo } from '../src/types';

/**
 * Catch-Up (2026-10-29): a plan for a student who fell behind, with no AI
 * call, and the yesterday card. Soma decides; nothing is checked off for them.
 */

const settings = { studyWindow: { start: '08:00', end: '23:00' }, chunks: { min: 30 }, theme: 'light', timeFormat: '12h' } as SomaSettings;
const origin = new Date(2026, 9, 29, 0, 0);               // Thu, Oct 29
const morning = new Date(2026, 9, 29, 9, 0);
const subjects = [{ id: 'math', name: 'MATH 221', color: '#42a5f5', totalTimeToday: 0 }, { id: 'phys', name: 'PHYSICS 5A', color: '#66bb6a', totalTimeToday: 0 }] as Snapshot['subjects'];
const snap = (blocks: LiveBlock[] = [], todos: Todo[] = []): Snapshot => ({ blocks, subjects, todos, sessions: [], history: [], calendarError: '', items: [] });
const todo = (id: string, text: string, extra: Partial<Todo> = {}): Todo => ({ id, text, status: 'nothing', subjectId: 'math', date: '2026-10-27', ...extra } as Todo);
const block = (id: string, todoId: string, title: string, day: number, extra: Partial<LiveBlock> = {}): LiveBlock => ({ id, todoId, title, subject: 'MATH 221', subjectId: 'math', time: '15:00–16:00', minutes: 60, color: 'blue', state: 'Planned', day, ...extra } as LiveBlock);
const canvas = (id: number, title: string, dueAt: Date, extra: Partial<CatchUpAssignment> = {}): CatchUpAssignment => ({ id, title, subjectId: 'math', subject: 'MATH 221', color: 'blue', dueAt: dueAt.toISOString(), ...extra });

test('a block that didn’t happen moves forward instead of making a copy; one with time logged is left for the yesterday card', () => {
  const plan = buildCatchUp({
    snapshot: snap([block('s1', 't1', 'Problem set 5', -2), block('s2', 't2', 'Lab 6', -1, { actualSeconds: 1200 })], [todo('t1', 'Problem set 5'), todo('t2', 'Lab 6')]),
    assignments: [], settings, origin, now: morning,
  });
  expect(plan.planned.map(p => p.title)).toEqual(['Problem set 5']);
  expect(plan.planned[0]).toMatchObject({ replaces: 's1', base: { day: -2, time: '15:00–16:00' }, day: 0, time: '09:00–10:00' });
  expect(plan.planned[0].why).toBe('Planned for Tuesday and didn’t happen.');
  expect(plan.behind).toBe(1);
});

test('work already back on the plan, checked off, or done under the same name isn’t caught up again', () => {
  const plan = buildCatchUp({
    snapshot: snap(
      [block('s1', 't1', 'Reading 4.4', -2), block('s2', 't1', 'Reading 4.4', 1), block('s3', 't3', 'HW 6', -1), block('s4', 't4', 'Quiz prep', -1, { state: 'Completed' })],
      [todo('t1', 'Reading 4.4'), todo('t3', 'HW 6'), todo('t3b', 'HW 6', { status: 'done' }), todo('t4', 'Quiz prep', { status: 'done' })],
    ),
    assignments: [], settings, origin, now: morning,
  });
  expect(plan.planned).toEqual([]);
  expect(plan.skipped).toEqual([]);
});

test('overdue goes first, then by due day, and what counts for more breaks a tie', () => {
  const plan = buildCatchUp({
    snapshot: snap(), settings, origin, now: morning,
    assignments: [
      canvas(1, 'Due Sat', new Date(2026, 9, 31, 23, 59)),
      canvas(2, 'Small Fri', new Date(2026, 9, 30, 23, 59), { groupWeight: 5 }),
      canvas(3, 'Late', new Date(2026, 9, 26, 23, 59), { lateDueAt: new Date(2026, 9, 31, 23, 59).toISOString(), groupName: 'Homework', groupWeight: 20 }),
      canvas(4, 'Big Fri', new Date(2026, 9, 30, 23, 59), { groupWeight: 30 }),
    ],
  });
  expect(plan.planned.map(p => p.title)).toEqual(['Late', 'Big Fri', 'Small Fri', 'Due Sat']);
  expect(plan.planned.find(p => p.title === 'Late')!.why).toBe('Was due Monday. Canvas still takes it until Saturday. Homework is 20% of your grade.');
  expect(plan.behind).toBe(1);
});

test('three things a day at most, never after the due day, and "move one to tomorrow" lowers today', () => {
  const four = [1, 2, 3, 4].map(n => canvas(n, `Overdue ${n}`, new Date(2026, 9, 27, 23, 59)));
  const plan = buildCatchUp({ snapshot: snap(), assignments: four, settings, origin, now: morning });
  expect(plan.planned.map(p => p.day)).toEqual([0, 0, 0, 1]);
  expect(plan.lastDay).toBe(1);
  const lighter = buildCatchUp({ snapshot: snap(), assignments: four, settings, origin, now: morning, todayCap: 2 });
  expect(lighter.planned.map(p => p.day)).toEqual([0, 0, 1, 1]);

  // Due today with today already full: nowhere it can go before it's due.
  const dueToday = canvas(9, 'Due tonight', new Date(2026, 9, 29, 23, 59));
  const full = buildCatchUp({ snapshot: snap(), assignments: [...four.slice(0, 3), dueToday], settings, origin, now: morning, todayCap: 0 });
  expect(full.unplaced.map(p => p.title)).toEqual(['Due tonight']);
});

test('not worth it: very late Canvas work with no late window, and their own undated task from days ago; both can come back', () => {
  const input = {
    snapshot: snap([block('s1', 't1', 'Flashcards', -4)], [todo('t1', 'Flashcards')]),
    assignments: [canvas(1, 'Discussion post', new Date(2026, 9, 20, 23, 59)), canvas(2, 'Still open', new Date(2026, 9, 20, 23, 59), { lateDueAt: new Date(2026, 10, 1).toISOString() })],
    settings, origin, now: morning,
  };
  const plan = buildCatchUp(input);
  expect(plan.skipped.map(s => s.title).sort()).toEqual(['Discussion post', 'Flashcards']);
  expect(plan.planned.map(p => p.title)).toEqual(['Still open']);
  const back = buildCatchUp({ ...input, restored: new Set(['a:1']), skipped: new Set(['a:2']) });
  expect(back.planned.map(p => p.title)).toEqual(['Discussion post']);
  expect(back.skipped.map(s => s.title).sort()).toEqual(['Flashcards', 'Still open']);
});

test('Canvas work that already has a task isn’t listed twice', () => {
  const plan = buildCatchUp({
    snapshot: snap([], [todo('t1', 'Problem set 6 · 1 of 2', { date: '2026-10-30' })]),
    assignments: [canvas(1, 'Problem set 6', new Date(2026, 9, 30, 23, 59))], settings, origin, now: morning,
  });
  expect(plan.planned).toEqual([]);
});

test('long work that won’t fit whole gets a first hour', () => {
  const evening = new Date(2026, 9, 29, 21, 30);
  const plan = buildCatchUp({ snapshot: snap([], [todo('t1', 'Essay', { dueDate: '2026-10-29', estimatedMinutes: 120 })]), assignments: [], settings, origin, now: evening });
  expect(plan.unplaced).toEqual([]);
  expect(plan.planned[0]).toMatchObject({ minutes: 60, time: '21:30–22:30' });
  expect(plan.planned[0].why).toContain('A first hour now');
});

test('yesterday card: logged but unchecked work gets the rest today; nothing is checked off', () => {
  const rows = buildYesterday(
    snap([block('s1', 't1', 'HW 4', -1, { minutes: 60, actualSeconds: 40 * 60 }), block('s2', 't2', 'Reading', -1, { actualSeconds: 60 }), block('s3', 't3', 'Lab', -1, { minutes: 30, actualSeconds: 45 * 60 })],
      [todo('t1', 'HW 4'), todo('t2', 'Reading'), todo('t3', 'Lab')]),
    origin, settings, new Set(), morning,
  );
  expect(rows.map(r => [r.title, r.did, r.rest, r.time, r.day])).toEqual([['HW 4', 40, 20, '09:00–09:20', 0], ['Lab', 45, 20, '09:30–09:50', 0]]);
  // Handled once, it doesn't come back.
  expect(buildYesterday(snap([block('s1', 't1', 'HW 4', -1, { actualSeconds: 2400 })], [todo('t1', 'HW 4')]), origin, settings, new Set(['y:s1']), morning)).toEqual([]);
});
