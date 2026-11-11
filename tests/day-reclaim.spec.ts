import { test, expect } from '@playwright/test';
import { finishOverrun, reclaimDay, type DayBlock } from '../src/lib/dayReclaim';

/**
 * Within-day reclaim: missed never-started study is repacked by priority
 * into today's remaining gaps. No model.
 */

const m = (hhmm: string) => { const [h, min] = hhmm.split(':').map(Number); return h * 60 + min; };

function day(): DayBlock[] {
  return [
    { id: 'eng', title: 'English', time: '10:00–11:00', minutes: 60, fixed: true },
    { id: 'a', title: 'Math HW', time: '11:00–12:00', minutes: 60, priority: 5 },
    { id: 'cs', title: 'CS', time: '12:00–13:00', minutes: 60, fixed: true },
    { id: 'b', title: 'Reading', time: '13:00–14:00', minutes: 60, priority: 2 },
    { id: 'disc', title: 'Math discussion', time: '14:00–15:00', minutes: 60, fixed: true },
    { id: 'c', title: 'Worksheet 3', time: '15:00–16:00', minutes: 60, priority: 4 },
  ];
}

test('a missed high-priority block takes the next gap ahead of lower work', () => {
  const r = reclaimDay(day(), m('12:30'), m('21:00'));
  const at = (id: string) => r.blocks.find(b => b.id === id)!.time;
  expect(r.held).toBe(false);
  expect(at('eng')).toBe('10:00–11:00');
  expect(at('cs')).toBe('12:00–13:00');
  expect(at('disc')).toBe('14:00–15:00');
  expect(at('a')).toBe('13:00–14:00');
  expect(at('c')).toBe('15:00–16:00');
  expect(at('b')).toBe('16:00–17:00');
  expect(r.moved.map(x => x.id)).toEqual(expect.arrayContaining(['a', 'b']));
});

test('a block that was started is not moved, even after its window', () => {
  const blocks = day().map(b => b.id === 'a' ? { ...b, started: true } : b);
  const r = reclaimDay(blocks, m('12:30'), m('21:00'));
  expect(r.moved).toEqual([]);
  expect(r.blocks.find(b => b.id === 'a')!.time).toBe('11:00–12:00');
});

test('focus still running past the end holds the day', () => {
  const blocks = day().map(b => b.id === 'a' ? { ...b, running: true, started: true } : b);
  const r = reclaimDay(blocks, m('12:30'), m('21:00'));
  expect(r.held).toBe(true);
  expect(r.moved).toEqual([]);
});

test('study hours are a wall unless personal time is allowed', () => {
  const blocks: DayBlock[] = [
    { id: 'a', title: 'Math HW', time: '20:00–21:00', minutes: 90, priority: 5 },
  ];
  const capped = reclaimDay(blocks, m('21:00'), m('21:00'));
  expect(capped.blocks[0].time).toBe('');
  expect(capped.unplaced).toEqual(['a']);

  const open = reclaimDay(blocks, m('21:00'), null);
  expect(open.blocks[0].time).toBe('21:00–22:30');
  expect(open.unplaced).toEqual([]);
});

test('checking off an overrun sets the real end and shifts the rest', () => {
  const r = finishOverrun(day(), 'a', m('12:40'), m('21:00'));
  const at = (id: string) => r.blocks.find(b => b.id === id)!;
  expect(at('a').time).toBe('11:00–12:40');
  expect(at('a').done).toBe(true);
  expect(at('cs').time).toBe('12:00–13:00');
  expect(at('b').time).toBe('13:00–14:00');
  expect(at('c').time).toBe('15:00–16:00');
});

test('an overrun pushes the study block it now overlaps', () => {
  const blocks: DayBlock[] = [
    { id: 'a', title: 'Math HW', time: '11:00–12:00', minutes: 60, priority: 5 },
    { id: 'b', title: 'Reading', time: '12:00–13:00', minutes: 60, priority: 3 },
  ];
  const r = finishOverrun(blocks, 'a', m('12:30'), m('21:00'));
  expect(r.blocks.find(b => b.id === 'a')!.time).toBe('11:00–12:30');
  expect(r.blocks.find(b => b.id === 'b')!.time).toBe('12:30–13:30');
});

test('finishing early does not shuffle the rest of the day', () => {
  const r = finishOverrun(day(), 'a', m('11:20'), m('21:00'));
  expect(r.moved).toEqual([]);
  expect(r.blocks.find(b => b.id === 'b')!.time).toBe('13:00–14:00');
  expect(r.blocks.find(b => b.id === 'a')!.done).toBe(true);
});
