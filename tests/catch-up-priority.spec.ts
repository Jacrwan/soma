import { test, expect } from '@playwright/test';
import { buildCatchUp, type CatchUpAssignment } from '../src/lib/catchUp';
import { comesBefore, priorityOf, UNDATED } from '../src/lib/workOrder';
import type { LiveBlock, Snapshot } from '../src/components/DashboardV2/liveData';
import type { CourseItem } from '../src/lib/courseItems';
import type { SomaSettings } from '../src/lib/storage';
import type { Todo } from '../src/types';

/**
 * Reported 2026-11-20: two blocks missed on Thursday went to Sunday because
 * Friday and Saturday were full of old lecture reviews. Missed work now goes
 * back right away and lower-priority work moves aside; work that comes first
 * stays first; the student's own blocks are asked about, never moved.
 */

const settings = { studyWindow: { start: '08:00', end: '23:00' }, chunks: { min: 30 }, theme: 'light', timeFormat: '12h' } as SomaSettings;
const origin = new Date(2026, 10, 20, 0, 0);               // Fri, Nov 20
const now = new Date(2026, 10, 20, 11, 34);
const subjects = [{ id: 'phys', name: 'PHYSICS 5A', color: '#ab47bc', totalTimeToday: 0 }, { id: 'cs', name: 'CS 61A', color: '#66bb6a', totalTimeToday: 0 }] as Snapshot['subjects'];
const snap = (blocks: LiveBlock[], todos: Todo[], items: CourseItem[] = []): Snapshot => ({ blocks, subjects, todos, sessions: [], history: [], calendarError: '', items });
const todo = (id: string, text: string, subjectId = 'phys', extra: Partial<Todo> = {}): Todo => ({ id, text, status: 'nothing', subjectId, date: '2026-11-19', ...extra } as Todo);
const block = (id: string, todoId: string, title: string, day: number, time: string, subjectId = 'phys', extra: Partial<LiveBlock> = {}): LiveBlock => {
  const [a, z] = time.split('–').map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; });
  return { id, todoId, title, subject: subjectId === 'phys' ? 'PHYSICS 5A' : 'CS 61A', subjectId, time, minutes: z - a, color: 'purple', state: 'Planned', day, ...extra } as LiveBlock;
};
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
/** Old lecture reviews filling a day, an hour each, from `from` to 23:00. */
function reviews(day: number, from: number) {
  const blocks: LiveBlock[] = [], todos: Todo[] = [];
  for (let h = from; h < 23; h++) {
    const id = `old-${day}-${h}`;
    todos.push(todo(id, `Review: Physics lecture from Tue 09-${String(h).padStart(2, '0')}`));
    blocks.push(block(`s-${id}`, id, `Review: Physics lecture from Tue 09-${String(h).padStart(2, '0')}`, day, `${hh(h)}–${hh(h + 1)}`));
  }
  return { blocks, todos };
}
/** The owner's board: Thursday's two misses, Friday from noon and all of Saturday full. */
function owner() {
  const fri = reviews(0, 12), sat = reviews(1, 8);
  return snap(
    [block('s-read', 'read', 'Physics reading: 12.7–12.11 Special Relativity', -1, '18:00–20:00'), block('s-rev', 'rev', 'Review: CS 61A lecture from Mon 11-09', -1, '22:00–23:00', 'cs'), ...fri.blocks, ...sat.blocks],
    [todo('read', 'Physics reading: 12.7–12.11 Special Relativity'), todo('rev', 'Review: CS 61A lecture from Mon 11-09', 'cs'), ...fri.todos, ...sat.todos],
  );
}

test('missed work goes back today; old reviews move aside to the next open time', () => {
  const plan = buildCatchUp({ snapshot: owner(), assignments: [], settings, origin, now });
  // Both missed yesterday; a review counts as a little more urgent than reading.
  expect(plan.planned.map(p => [p.title, p.day, p.time])).toEqual([
    ['Review: CS 61A lecture from Mon 11-09', 0, '11:45–12:45'],
    ['Physics reading: 12.7–12.11 Special Relativity', 0, '12:55–14:55'],
  ]);
  expect(plan.planned[1]).toMatchObject({ replaces: 's-read' });
  // Three old reviews made room, and went to Sunday (Saturday is full).
  expect(plan.moves.length).toBe(3);
  for (const m of plan.moves) { expect(m.from.day).toBe(0); expect(m.to.day).toBe(2); expect(m.why).toMatch(/goes first/); }
  expect(plan.offers).toEqual([]);
});

test('work due later only takes open time, however far out', () => {
  const s = owner();
  const later: CatchUpAssignment = { id: 7, title: 'Lab 8', subjectId: 'cs', subject: 'CS 61A', color: 'green', dueAt: new Date(2026, 10, 24, 23, 59).toISOString() };
  const plan = buildCatchUp({ snapshot: { ...s, blocks: s.blocks.filter(b => b.day >= 0) }, assignments: [later], settings, origin, now });
  expect(plan.planned.map(p => [p.title, p.day])).toEqual([['Lab 8', 2]]);
  expect(plan.moves).toEqual([]);
});

test('a missed chapter 5 goes before chapter 6: they trade slots', () => {
  const classes = [block('c1', '', 'Lecture', 0, '12:00–15:00', 'phys', { external: true, todoId: undefined })];
  const plan = buildCatchUp({
    snapshot: snap(
      [block('s5', 'c5', 'Reading: Chapter 5', -1, '15:00–16:00'), block('s6', 'c6', 'Reading: Chapter 6', 0, '15:00–16:00'), ...classes],
      [todo('c5', 'Reading: Chapter 5'), todo('c6', 'Reading: Chapter 6')],
    ),
    assignments: [], settings, origin, now: new Date(2026, 10, 20, 11, 50),
  });
  expect(plan.planned).toMatchObject([{ title: 'Reading: Chapter 5', day: 0, time: '15:00–16:00' }]);
  expect(plan.moves).toMatchObject([{ title: 'Reading: Chapter 6', from: { day: 0, time: '15:00–16:00' }, to: { day: 0, time: '16:00–17:00' } }]);
});

test('a block the student placed is asked about, never moved; a yes lets it move', () => {
  const s = owner();
  const pins = new Set(s.blocks.filter(b => b.day === 0).map(b => `${b.todoId}@2026-11-20T${b.time.split('–')[0]}`));
  const plan = buildCatchUp({ snapshot: s, assignments: [], settings, origin, now, pins });
  expect(plan.moves.every(m => m.from.day !== 0)).toBe(true);
  expect(plan.planned.every(p => p.day !== 0)).toBe(true);
  expect(plan.offers.length).toBeGreaterThan(0);
  const yes = buildCatchUp({ snapshot: s, assignments: [], settings, origin, now, pins, movePinned: new Set(plan.offers.map(o => String(o.blockId))) });
  expect(yes.planned.some(p => p.day === 0)).toBe(true);
});

test('comesBefore: reading-list order, numbers in the same title, "from <date>"; only within one course', () => {
  const items = ['5.1', '5.2', '6.1'].map((label, position) => ({ id: label, subjectId: 'phys', label, position })) as CourseItem[];
  expect(comesBefore({ subjectId: 'phys', title: 'Reading A', covers: ['5.2'] }, { subjectId: 'phys', title: 'Reading B', covers: ['6.1'] }, items)).toBe(true);
  expect(comesBefore({ subjectId: 'phys', title: 'Reading B', covers: ['6.1'] }, { subjectId: 'phys', title: 'Reading A', covers: ['5.1'] }, items)).toBe(false);
  expect(comesBefore({ subjectId: 'cs', title: 'Homework 9' }, { subjectId: 'cs', title: 'Homework 10' })).toBe(true);
  expect(comesBefore({ subjectId: 'cs', title: 'Homework 10' }, { subjectId: 'cs', title: 'Homework 9' })).toBe(false);
  expect(comesBefore({ subjectId: 'cs', title: 'Review: CS 61A lecture from Mon 11-09' }, { subjectId: 'cs', title: 'Review: CS 61A lecture from Wed 11-18' })).toBe(true);
  expect(comesBefore({ subjectId: 'cs', title: 'Homework 9' }, { subjectId: 'phys', title: 'Homework 10' })).toBe(false);
  expect(comesBefore({ subjectId: 'cs', title: 'Lab 2' }, { subjectId: 'cs', title: 'Homework 3' })).toBe(false);
});

test('priority: missed undated work ranks like work due the day it was planned, ahead of undated work to come', () => {
  const missed = priorityOf({ text: 'Physics reading' }, { missed: true, plannedDate: '2026-11-19' });
  const dueMon = priorityOf({ text: 'Lab 8', dueDate: '2026-11-23' });
  const later = priorityOf({ text: 'Review' }, { day: 0 });
  expect(missed).toBeLessThan(dueMon);
  expect(dueMon).toBeLessThan(later);
  expect(later).toBeGreaterThanOrEqual(UNDATED);
});
