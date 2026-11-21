import { test, expect } from '@playwright/test';
import { affected, type BoardBlock } from '../src/lib/workOrder';
import { reclaimDay, type DayBlock } from '../src/lib/dayReclaim';

/**
 * Only what a change touches moves (2026-11-21): the schedule is never
 * cleared and redone. workOrder's `affected` names those blocks; the movers
 * place them.
 */
const at = (h: number, m = 0) => h * 60 + m;
const b = (id: string, title: string, from: number, to: number, extra: Partial<BoardBlock> = {}): BoardBlock => ({ id, title, subjectId: 'phys', start: from, end: to, movable: true, ...extra });

test('an event moved onto one block touches that block only', () => {
  const board = [b('a', 'Lab', at(15), at(16)), b('c', 'Essay', at(17), at(18))];
  expect(affected(board, { covered: [[at(15, 30), at(16, 30)]] })).toEqual([{ id: 'a', reason: 'covered' }]);
});

test('a stated time touches only what is under it, never a pinned block', () => {
  const board = [b('a', 'Lab', at(11), at(12)), b('p', 'Essay', at(12), at(13), { movable: false }), b('c', 'Quiz prep', at(14), at(15))];
  expect(affected(board, { covered: [[at(11, 30), at(13)]] })).toEqual([{ id: 'a', reason: 'covered' }]);
});

test('chapter 5 moved after chapter 6 moves chapter 6, and nothing else', () => {
  const board = [b('c6', 'Reading: Chapter 6', at(15), at(16)), b('c7', 'Reading: Chapter 7', at(20), at(21)), b('x', 'Problem set', at(16), at(17)), b('m', 'Reading: Chapter 6', at(15), at(16), { subjectId: 'math' })];
  expect(affected(board, { moved: [{ id: 'c5', title: 'Reading: Chapter 5', subjectId: 'phys', start: at(18) }] })).toEqual([{ id: 'c6', reason: 'order', after: 'c5' }]);
});

test('each block is touched once, in the order of the rules', () => {
  const board = [b('a', 'Reading: Chapter 6', at(9), at(10), { lastDay: -1 })];
  expect(affected(board, { covered: [[at(9), at(10)]], missedBy: at(11), moved: [{ id: 'c5', title: 'Reading: Chapter 5', subjectId: 'phys', start: at(12) }] })).toEqual([{ id: 'a', reason: 'covered' }]);
});

test('within-day reclaim: a missed chapter 5 moved later takes chapter 6 after it', () => {
  const d = (id: string, title: string, time: string): DayBlock => ({ id, title, time, minutes: 60, subjectId: 'phys' });
  const r = reclaimDay([d('c5', 'Reading: Chapter 5', '09:00–10:00'), d('c6', 'Reading: Chapter 6', '13:00–14:00'), { id: 'lec', title: 'Lecture', time: '11:00–13:00', minutes: 120, fixed: true }], at(10, 30), at(23));
  const time = (id: string) => r.blocks.find(x => x.id === id)!.time;
  expect(time('c5')).toBe('14:00–15:00');
  expect(time('c6')).toBe('15:00–16:00');
});
