import { test, expect } from '@playwright/test';
import { layChain, fitsAfter, outranks, overlaps, unbackedClaims, withoutClaims } from '../src/lib/replan';
import { statedRange } from '../src/lib/statedTime';

// The pure steps of rescheduling (src/lib/replan.ts, 2026-11-17).

test('a sequence lies back to back from its anchor and flows past what cannot move', () => {
  // Math 120 then Oral 60 from 5:23 PM; a class 7:30–8:00 PM is in the way of Oral.
  expect(layChain(1043, [120, 60], [[1170, 1200]])).toEqual([[1043, 1163], [1200, 1260]]);
  expect(layChain(1043, [120, 60], [])).toEqual([[1043, 1163], [1163, 1223]]);
});

test('"later" on a step must leave room for the steps after it before the due time', () => {
  const free: [number, number][] = [[1200, 1440]];
  expect(fitsAfter(1200, [{ minutes: 60 }], free, 1230)).toBe(false);    // due 8:30, Part 2 needs an hour after 8:00
  expect(fitsAfter(1200, [{ minutes: 60 }], free, 1290)).toBe(true);
  // A later step already placed after it keeps its own time.
  expect(fitsAfter(1200, [{ minutes: 60, placedAt: 1220 }], [], 1290)).toBe(true);
  expect(fitsAfter(1200, [{ minutes: 60, placedAt: 1100 }], [], 1290)).toBe(false);
});

test('only lower-ranked work can be pushed aside; unknown ranks keep the old rule', () => {
  expect(outranks(2, 7)).toBe(true);
  expect(outranks(2, 0)).toBe(false);
  expect(outranks(undefined, 0)).toBe(true);
  expect(outranks(2, undefined)).toBe(true);
});

test('the board check finds every overlapping pair', () => {
  const pairs = overlaps([{ span: [0, 60] as [number, number], n: 'a' }, { span: [30, 90] as [number, number], n: 'b' }, { span: [90, 120] as [number, number], n: 'c' }]);
  expect(pairs.map(([x, y]) => x.n + y.n)).toEqual(['ab']);
});

test('a reply that says it moves something no card changes is caught, and cut', () => {
  const reply = "Oral Presentations starts at 8:30 PM. I'm also moving Project 4 checkpoint 1 to Thursday evening.";
  const entries = [{ id: 'p4', title: 'Project 4: Animator checkpoint 1' }, { id: 'oral', title: 'Oral Presentations' }];
  expect(unbackedClaims(reply, entries, new Set(['oral'])).map(c => c.title)).toEqual(['Project 4: Animator checkpoint 1']);
  expect(unbackedClaims(reply, entries, new Set(['oral', 'p4']))).toEqual([]);
  expect(withoutClaims(reply, unbackedClaims(reply, entries, new Set(['oral'])))).toBe('Oral Presentations starts at 8:30 PM.');
});

test('a number in a task\'s name is not a time: "move project 4 to 5:30 pm until 6:15 pm"', () => {
  expect(statedRange('move project 4 to 5:30 pm until 6:15 pm', 1043)).toEqual({ start: 1050, end: 1095, fromNow: false });
  expect(statedRange('hw 4 from 3 to 5pm', 1043)).toEqual({ start: 900, end: 1020, fromNow: false });
  expect(statedRange('2 to 4pm', 1043)).toEqual({ start: 840, end: 960, fromNow: false });
});
