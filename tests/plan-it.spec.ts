import { test, expect } from '@playwright/test';
import { defaultFinishBy, defaultSittings, estimate, isPartSitting, isSittingOf, placeSittings, sittingTitle, type PlanTarget } from '../src/lib/planIt';
import type { Snapshot } from '../src/components/DashboardV2/liveData';
import type { SomaSettings } from '../src/lib/storage';

/**
 * Plan it (2026-10-28): a due assignment spread into sittings before it's
 * due, in open study time, with no AI call.
 */

const settings = { studyWindow: { start: '08:00', end: '23:00' }, chunks: { min: 30 }, theme: 'light', timeFormat: '12h' } as SomaSettings;
const origin = new Date(2026, 9, 28, 0, 0);              // Wed, Oct 28
const morning = new Date(2026, 9, 28, 9, 0);
const target: PlanTarget = { key: 'canvas-1', title: 'Paper Summary 2', subject: 'Cell Biology', subjectId: 'bio', color: 'green', due: new Date(2026, 10, 3, 23, 59).toISOString() };
const empty = (blocks: Snapshot['blocks'] = []): Snapshot => ({ blocks, subjects: [], todos: [], sessions: [], history: [], calendarError: '', items: [] });
const day = (b: { day: number }) => b.day;

test('sittings spread over the days up to the finish day, one a day, numbered in order, never on the due day', () => {
  const { blocks, missing } = placeSittings(target, { minutes: 160, sittings: 4, finishBy: '2026-11-02' }, empty(), origin, settings, morning);
  expect(missing).toBe(0);
  expect(blocks.map(day)).toEqual([0, 2, 3, 5]);
  expect(Math.max(...blocks.map(day))).toBeLessThanOrEqual(5);    // Mon, Nov 2; the paper is due Tue
  expect(blocks.map(b => b.title)).toEqual(['Paper Summary 2 · 1 of 4', 'Paper Summary 2 · 2 of 4', 'Paper Summary 2 · 3 of 4', 'Paper Summary 2 · 4 of 4']);
  expect(blocks.every(b => b.state === 'Proposal' && b.minutes === 40 && b.subject === 'Cell Biology')).toBe(true);
});

test('a sitting goes around classes and planned blocks, and not before now', () => {
  const busy = [
    { id: 'c', title: 'Class', subject: 'x', time: '09:00–12:00', minutes: 180, color: 'neutral', state: 'Planned', day: 0, external: true },
    { id: 'p', title: 'Other work', subject: 'x', time: '12:00–13:00', minutes: 60, color: 'blue', state: 'Planned', day: 0 },
  ] as Snapshot['blocks'];
  const { blocks } = placeSittings(target, { minutes: 45, sittings: 1, finishBy: '2026-10-28' }, empty(busy), origin, settings, morning);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].time).toBe('13:00–13:45');
  expect(blocks[0].title).toBe('Paper Summary 2');
});

test('two sittings share a day when there is only one, with a break between', () => {
  const { blocks } = placeSittings(target, { minutes: 120, sittings: 2, finishBy: '2026-10-28' }, empty(), origin, settings, new Date(2026, 9, 28, 20, 0));
  expect(blocks.map(b => b.time)).toEqual(['20:00–21:00', '21:10–22:10']);
});

test('what no open time can take is counted, not squeezed in', () => {
  const late = new Date(2026, 9, 28, 22, 30);
  const { blocks, missing } = placeSittings(target, { minutes: 120, sittings: 2, finishBy: '2026-10-28' }, empty(), origin, settings, late);
  expect(blocks).toHaveLength(0);
  expect(missing).toBe(2);
});

test('defaults: finish the day before; due today or 12:30 AM tonight means today; longer work splits', () => {
  const now = new Date(2026, 9, 28, 9, 0);
  expect(defaultFinishBy(new Date(2026, 10, 3, 23, 59).toISOString(), now)).toBe('2026-11-02');
  expect(defaultFinishBy(new Date(2026, 9, 28, 23, 59).toISOString(), now)).toBe('2026-10-28');
  expect(defaultFinishBy(new Date(2026, 9, 30, 0, 30).toISOString(), now)).toBe('2026-10-28');
  expect(defaultFinishBy('2026-11-06', now)).toBe('2026-11-05');            // a task's due day, not UTC midnight
  expect([30, 60, 90, 165, 600].map(defaultSittings)).toEqual([1, 1, 2, 4, 6]);
});

test('the estimate comes from past work of the same kind in the course, then the course, then a guess', () => {
  const h = (task_text: string, minutes: number, subject_id = 'bio') => ({ id: task_text + minutes, subject_id, task_text, duration_seconds: minutes * 60, date: '2026-10-01' });
  expect(estimate(target, [h('Paper Summary 1', 150), h('Paper Summary 1', 30), h('Lab 3', 60)])).toMatchObject({ minutes: 180 });
  expect(estimate({ ...target, title: 'Problem set 4' }, [h('Lab 3', 60), h('Lab 4', 90)])).toMatchObject({ minutes: 75, basis: 'your average per task in Cell Biology' });
  expect(estimate(target, [h('Paper Summary 1', 150, 'chem')]).basis).toMatch(/guess/);
});

test('a sitting is known by its name; one of several doesn\'t finish the assignment', () => {
  expect(sittingTitle('Lab 8', 2, 3)).toBe('Lab 8 · 2 of 3');
  expect(isSittingOf('Lab 8 · 2 of 3', 'Lab 8')).toBe(true);
  expect(isSittingOf('Lab 8', 'Lab 8')).toBe(true);
  expect(isSittingOf('Lab 8 quiz · 1 of 2', 'Lab 8')).toBe(false);
  expect(isPartSitting('Lab 8 · 2 of 3')).toBe(true);
  expect(isPartSitting('Lab 8')).toBe(false);
});
