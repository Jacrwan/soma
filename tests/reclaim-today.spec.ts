import { test, expect } from '@playwright/test';
import { pinKey } from '../src/lib/pinnedBlocks';
import { asDayBlocks, overrunToday, planToday, reclaimWindowEnd, type LiveDayBlock } from '../src/lib/reclaimToday';
import { pushVersion, samePlan, type VersionBlock } from '../src/lib/dayVersions';

/**
 * Wiring helpers for within-day reclaim: which blocks may move, and the
 * versions kept for the compare peek. No model.
 */

const block = (patch: Partial<LiveDayBlock> & Pick<LiveDayBlock, 'id' | 'title' | 'time'>): LiveDayBlock => ({
  subject: 'Math', minutes: 60, day: 0, state: 'Planned', ...patch,
});

test('a pinned time and a started block stay fixed', () => {
  const date = '2026-11-10';
  const pins = new Set([pinKey('todo-a', date, '11:00')]);
  const blocks = [
    block({ id: 'a', title: 'Pinned HW', time: '11:00–12:00', todoId: 'todo-a' }),
    block({ id: 'b', title: 'Started', time: '13:00–14:00', actualSeconds: 120 }),
    block({ id: 'c', title: 'Open', time: '15:00–16:00', note: 'Exam plan · Midterm · Mon Nov 16 · p5' }),
  ];
  const day = asDayBlocks(blocks, { pins, date });
  expect(day.find(b => b.id === 'a')!.fixed).toBe(true);
  expect(day.find(b => b.id === 'b')!.started).toBe(true);
  expect(day.find(b => b.id === 'c')!.priority).toBe(5);
});

test('personal time lifts the study-hours wall', () => {
  const hours = { studyWindow: { start: '08:00', end: '21:00' } };
  expect(reclaimWindowEnd(hours)).toBe(21 * 60);
  expect(reclaimWindowEnd({ ...hours, invadePersonalTime: true })).toBeNull();
  expect(reclaimWindowEnd({ studyWindow: { start: '08:00', end: '21:00', off: true } })).toBeNull();
});

test('a missed block is repacked and a late check-off shifts what it overlaps', () => {
  const blocks = [
    block({ id: 'a', title: 'Math HW', time: '11:00–12:00', note: '· p5' }),
    block({ id: 'class', title: 'CS', time: '12:00–13:00', external: true, subject: 'Calendar' }),
    block({ id: 'b', title: 'Reading', time: '13:00–14:00', note: '· p2' }),
  ];
  const opts = { pins: new Set<string>(), date: '2026-11-10' };
  const missed = planToday(blocks, 12 * 60 + 30, 21 * 60, opts);
  expect(missed.blocks.find(b => b.id === 'a')!.time).toBe('13:00–14:00');
  expect(missed.blocks.find(b => b.id === 'class')!.time).toBe('12:00–13:00');

  const late = overrunToday(blocks, 'a', 12 * 60 + 20, 21 * 60, opts);
  expect(late!.blocks.find(b => b.id === 'a')!.time).toBe('11:00–12:20');
  expect(late!.blocks.find(b => b.id === 'b')!.time).toBe('13:00–14:00');
  expect(overrunToday(blocks, 'a', 11 * 60 + 30, 21 * 60, opts)).toBeNull();
});

test('versions keep the original and skip an unchanged plan', () => {
  const plan: VersionBlock[] = [{ id: 'a', title: 'Math HW', subject: 'Math', time: '11:00–12:00', minutes: 60 }];
  const first = pushVersion([], { at: '2026-11-10T18:00:00.000Z', reason: 'original', blocks: plan });
  expect(pushVersion(first, { at: '2026-11-10T19:00:00.000Z', reason: 'original', blocks: plan })).toHaveLength(1);
  expect(pushVersion(first, { at: '2026-11-10T19:00:00.000Z', reason: 'reclaim', blocks: plan })).toHaveLength(1);
  const moved = [{ ...plan[0], time: '13:00–14:00' }];
  const next = pushVersion(first, { at: '2026-11-10T19:00:00.000Z', reason: 'reclaim', blocks: moved });
  expect(next.map(v => v.reason)).toEqual(['original', 'reclaim']);
  expect(samePlan(next[0].blocks, next[1].blocks)).toBe(false);
});
