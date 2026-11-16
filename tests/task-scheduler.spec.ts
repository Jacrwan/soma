import { test, expect } from '@playwright/test';
import { startDayOf, finishByOf, guessRank, isManaged, rankBetween, resolvePrefs, schedule, type SchedTask, type ScheduleInput } from '../src/lib/taskScheduler';

/**
 * The task scheduler (2026-11-15): tasks place and re-place their own
 * sittings before they're due, with a silent priority order. No AI.
 */

const D = 1440;
const at = (day: number, h: number, m = 0) => day * D + h * 60 + m;
const prefs = resolvePrefs({ studyWindow: { start: '08:00', end: '23:00' }, chunks: { min: 30 } });
const run = (p: Partial<ScheduleInput>) => schedule({ tasks: [], busy: [], prefs, now: at(0, 9), days: 14, weekday0: 3, ...p });
const task = (id: string, o: Partial<SchedTask> = {}): SchedTask => ({ id, rank: 0, total: 60, logged: 0, due: at(5, 23, 59), sittings: [], ...o });
const days = (r: ReturnType<typeof schedule>, id: string) => r.place.filter(p => p.taskId === id).map(p => Math.floor(p.start / D)).sort((a, b) => a - b);

test('a task spreads into ~50 minute sittings, one a day, finished the day before it is due', () => {
  const r = run({ tasks: [task('essay', { total: 150 })] });
  expect(r.place).toHaveLength(3);
  expect(r.place.every(p => p.end - p.start === 50 && !p.id)).toBe(true);
  expect(days(r, 'essay')).toEqual([1, 2, 4]);          // due day 5, finish by day 4; today had nothing planned, so it stays free
  expect(r.atRisk).toEqual([]);
});

test('an hour or less is one sitting, at the first open time that day, around other blocks', () => {
  const r = run({ tasks: [task('hw', { total: 45, due: at(1, 23, 59) })], busy: [{ start: at(0, 9), end: at(0, 12), study: false }] });
  expect(r.place).toEqual([{ taskId: 'hw', start: at(0, 12), end: at(0, 12, 45) }]);
});

test('a sitting that is fine stays where it is', () => {
  const s = { id: 's1', start: at(2, 15), end: at(2, 16) };
  const r = run({ tasks: [task('hw', { due: at(3, 23, 59), sittings: [s] })] });
  expect(r.place).toEqual([]);
  expect(r.remove).toEqual([]);
});

test('a missed sitting moves to the earliest open time, keeping its id', () => {
  const missed = { id: 'm', start: at(0, 7), end: at(0, 8) };
  const r = run({ now: at(0, 9), tasks: [task('hw', { due: at(1, 23, 59), sittings: [missed] })] });
  expect(r.place).toEqual([{ taskId: 'hw', id: 'm', start: at(0, 9), end: at(0, 10) }]);
});

test('a missed high-priority sitting takes a lower task\'s slot, and the lower one moves instead', () => {
  // Today: only 13:00–14:00 is open, held by the lower task. The high one was missed this morning.
  const busy = [{ start: at(0, 9), end: at(0, 13) }, { start: at(0, 14), end: at(0, 23) }];
  const high = task('high', { rank: 1, due: at(1, 23, 59), sittings: [{ id: 'h', start: at(0, 8), end: at(0, 9) }] });
  const low = task('low', { rank: 2, due: at(2, 23, 59), sittings: [{ id: 'l', start: at(0, 13), end: at(0, 14) }] });
  const r = run({ now: at(0, 9, 5), busy, tasks: [low, high] });
  expect(r.place.find(p => p.id === 'h')).toEqual({ taskId: 'high', id: 'h', start: at(0, 13), end: at(0, 14) });
  const moved = r.place.find(p => p.id === 'l')!;
  expect(Math.floor(moved.start / D)).toBeGreaterThan(0);
  expect(r.atRisk).toEqual([]);
});

test('a lower task is not bumped if that would make it miss its own finish day', () => {
  // The low task is due tomorrow and today 13–14 is its only slot; the high one has until day 5.
  const busy = [{ start: at(0, 9), end: at(0, 13) }, { start: at(0, 14), end: at(0, 23) }, { start: at(1, 0), end: at(1, 23, 59) }];
  const high = task('high', { rank: 1, sittings: [{ id: 'h', start: at(0, 8), end: at(0, 9) }] });
  const low = task('low', { rank: 2, due: at(1, 23, 59), sittings: [{ id: 'l', start: at(0, 13), end: at(0, 14) }] });
  const r = run({ now: at(0, 9, 5), busy, tasks: [high, low] });
  expect(r.place.find(p => p.id === 'l')).toBeUndefined();
  expect(r.place.find(p => p.id === 'h')!.start).toBeGreaterThanOrEqual(at(2, 0));
});

test('higher priority gets the earlier open time', () => {
  const busy = [{ start: at(0, 10), end: at(0, 23) }];
  const r = run({ now: at(0, 9), busy, tasks: [task('low', { rank: 5, total: 60, due: at(2, 23, 59) }), task('high', { rank: 1, total: 60, due: at(1, 23, 59) })] });
  expect(r.place.find(p => p.taskId === 'high')!.start).toBe(at(0, 9));
  expect(r.place.find(p => p.taskId === 'low')!.start).toBeGreaterThan(at(0, 10));
});

test('a sitting a calendar event now covers moves; pinned and started sittings never do', () => {
  const event = { start: at(2, 15), end: at(2, 17) };
  const r = run({ busy: [event], tasks: [
    task('a', { sittings: [{ id: 'clash', start: at(2, 15), end: at(2, 16) }] }),
    task('b', { sittings: [{ id: 'pin', start: at(2, 16), end: at(2, 17), pinned: true }] }),
  ] });
  expect(r.place.find(p => p.id === 'clash')).toBeDefined();
  expect(r.place.find(p => p.id === 'pin')).toBeUndefined();
});

test('logged time and checked sittings count: the rest shrinks or goes', () => {
  const later = [{ id: 'x', start: at(2, 15), end: at(2, 16) }, { id: 'y', start: at(3, 15), end: at(3, 16) }];
  // 120 needed, 70 logged: 50 left, so one sitting goes and the other is trimmed to 50.
  const r = run({ tasks: [task('a', { total: 120, logged: 70, due: at(3, 23, 59), sittings: later })] });
  expect(r.remove).toEqual([{ taskId: 'a', id: 'y' }]);
  expect(r.place).toEqual([{ taskId: 'a', id: 'x', start: at(2, 15), end: at(2, 15, 50) }]);
  const done = run({ tasks: [task('a', { total: 60, sittings: [{ id: 'd', start: at(0, 7), end: at(0, 8), done: true }, { id: 'z', start: at(2, 9), end: at(2, 10) }] })] });
  expect(done.remove).toEqual([{ taskId: 'a', id: 'z' }]);
});

test('what does not fit is reported at risk, not crammed past the finish day', () => {
  const busy = [{ start: at(0, 9), end: at(0, 22) }];
  const r = run({ now: at(0, 9), busy, tasks: [task('a', { total: 180, due: at(1, 12) })] });
  const placed = r.place.reduce((n, p) => n + p.end - p.start, 0);
  expect(r.place.every(p => p.end <= at(1, 12))).toBe(true);
  expect(r.atRisk[0]).toEqual({ taskId: 'a', short: 180 - placed });
});

test('settings: weekday hours, a daily limit, the break, and finishing on the due day', () => {
  const p = resolvePrefs({ studyWindow: { start: '08:00', end: '23:00' }, chunks: { min: 30 }, schedule: { days: { '4': { start: '08:00', end: '23:00', off: true } }, maxPerDay: 60, breakMinutes: 15, finishEarly: 0 } });
  // Day 0 is a Wednesday, so day 1 (Thursday) is off.
  const r = schedule({ tasks: [task('a', { total: 150, due: at(3, 23, 59) })], busy: [], prefs: p, now: at(0, 9), days: 14, weekday0: 3 });
  expect(days(r, 'a')).not.toContain(1);
  expect(days(r, 'a')).toContain(3);                     // finish early off: the due day counts
  const busy = run({ busy: [{ start: at(0, 9), end: at(0, 10), study: true }], tasks: [task('b', { total: 30, due: at(1, 23, 59) })] });
  expect(busy.place[0].start).toBe(at(0, 10, 10));       // 10-minute break after study
});

test('finish-by: a day early, the deadline if that leaves no time, 12:30 AM counts as the night before', () => {
  expect(finishByOf(at(5, 23, 59), at(0, 9), 1)).toBe(at(5, 0));
  expect(finishByOf(at(0, 23, 59), at(0, 9), 1)).toBe(at(0, 23, 59));
  expect(finishByOf(at(3, 0, 30), at(0, 9), 0)).toBe(at(3, 0));
});

test('priority guess: due date first, bigger work pulled earlier; dragging puts it between', () => {
  const exam = guessRank({ dueDate: '2026-11-25', kind: 'exam', text: 'Midterm' });
  const hw = guessRank({ dueDate: '2026-11-21', kind: 'homework', text: 'HW 9' });
  const reading = guessRank({ dueDate: '2026-11-19', text: 'Reading ch. 4' });
  expect(exam).toBeLessThan(hw);                         // due 4 days later, but an exam
  expect(reading).toBeLessThan(hw);                      // due 2 days sooner, a day of slack for reading
  expect(guessRank({ dueDate: '2026-11-20', text: 'Reading ch. 4' })).toBe(hw);
  expect(rankBetween(1, 2)).toBe(1.5);
  expect(rankBetween(undefined, 4)).toBe(3);
});

test('which tasks Soma schedules', () => {
  const today = '2026-11-15';
  expect(isManaged({ status: 'nothing', dueDate: '2026-11-20', kind: 'homework' }, true, today)).toBe(true);
  expect(isManaged({ status: 'nothing', dueDate: '2026-11-20', kind: 'homework' }, false, today)).toBe(false);
  expect(isManaged({ status: 'nothing', dueDate: '2026-11-01', kind: 'homework' }, true, today)).toBe(false);
  expect(isManaged({ status: 'nothing', dueDate: '2026-11-20' }, true, today)).toBe(false);
  expect(isManaged({ status: 'nothing', dueDate: '2026-11-20', autoSchedule: true }, false, today)).toBe(true);
  expect(isManaged({ status: 'done', dueDate: '2026-11-20', autoSchedule: true }, true, today)).toBe(false);
});

test('work starts near its due date, not as soon as there is time', () => {
  // An hour due in three weeks: nothing today, the sitting goes in the two days before the finish day.
  const far = run({ days: 30, tasks: [task('far', { total: 60, due: at(21, 23, 59) })] });
  expect(days(far, 'far')).toEqual([19]);
  // Six hours: about two weeks of runway, one sitting every other day or so.
  const big = run({ days: 30, tasks: [task('big', { total: 360, due: at(21, 23, 59) })] });
  expect(Math.min(...days(big, 'big'))).toBeGreaterThanOrEqual(7);
  expect(startDayOf(45, at(3, 0), at(0, 9), prefs)).toBe(1);
  expect(startDayOf(60, at(3, 0), at(0, 9), { usual: 50, spread: 'early' })).toBe(0);
});

test('a sitting placed before its window has to move into it; earlier days only when the window is full', () => {
  const early = { id: 'e', start: at(0, 15), end: at(0, 16) };
  const r = run({ days: 30, tasks: [task('far', { total: 60, due: at(21, 23, 59), sittings: [early] })] });
  expect(r.place).toEqual([{ taskId: 'far', id: 'e', start: at(19, 8), end: at(19, 9) }]);
  // Days 19 and 20 fully booked: it goes back to day 18, not today.
  const busy = [{ start: at(19, 0), end: at(20, 23, 59) }];
  const full = run({ days: 30, busy, tasks: [task('far', { total: 60, due: at(21, 23, 59) })] });
  expect(days(full, 'far')).toEqual([18]);
});

test('freed time today stays free: later work is offered, not moved in', () => {
  // Lab due day 3 had a sitting on day 1; the quiz that was on today moved away (pinned to day 2).
  const lab = task('lab', { total: 60, due: at(3, 23, 59), sittings: [{ id: 'l1', start: at(1, 15), end: at(1, 16) }] });
  const quiz = task('quiz', { total: 60, due: at(3, 23, 59), sittings: [{ id: 'q1', start: at(2, 10), end: at(2, 11), pinned: true }] });
  const r = run({ tasks: [lab, quiz] });
  expect(r.place).toEqual([]);                              // nothing pulled into today
  expect(r.ahead).toEqual({ taskId: 'lab', id: 'l1', from: at(1, 15), start: at(0, 9), end: at(0, 10) });
  expect(r.todayOpen).toBe(14 * 60);
});

test('a sitting forced off today by a new event moves within today, never adding to it', () => {
  const hw = task('hw', { total: 60, due: at(2, 23, 59), sittings: [{ id: 'h', start: at(0, 14), end: at(0, 15) }] });
  const other = task('other', { rank: 1, total: 60, due: at(2, 23, 59) });
  const r = run({ tasks: [hw, other], busy: [{ start: at(0, 13), end: at(0, 16) }] });
  expect(r.place.find(p => p.id === 'h')!.start).toBe(at(0, 9));          // still today
  expect(days(r, 'other').every(d => d > 0)).toBe(true);                  // the other task doesn't join it
});

test('missed work and work due tonight may still use today', () => {
  // Missed yesterday: being behind, not ahead.
  const missed = task('missed', { total: 60, due: at(2, 23, 59), sittings: [{ id: 'm', start: at(-1, 15), end: at(-1, 16) }] });
  const r1 = run({ tasks: [missed] });
  expect(r1.place).toEqual([{ taskId: 'missed', id: 'm', start: at(0, 9), end: at(0, 10) }]);
  const r2 = run({ tasks: [task('tonight', { total: 60, due: at(1, 23, 59) })] });
  expect(days(r2, 'tonight')).toEqual([0]);                               // finish day is today
});

test('a task that only fits with today is offered today, not crammed in', () => {
  // Due day 2 (finish day 1), but day 1 is full.
  const t = task('t', { total: 60, due: at(2, 23, 59) });
  const r = run({ tasks: [t], busy: [{ start: at(1, 0), end: at(2, 0) }] });
  expect(r.place).toEqual([]);
  expect(r.atRisk).toEqual([{ taskId: 't', short: 60 }]);
  expect(r.ahead).toEqual({ taskId: 't', start: at(0, 9), end: at(0, 10) });
});

// ── Task details (2026-11-15) ──

test('steps replace generic sittings: one each, its own length, in order', () => {
  const t = task('hw', { due: at(6, 23, 59), sittings: [{ id: 'g1', start: at(2, 10), end: at(2, 11) }],
    steps: [{ id: 'a', minutes: 30 }, { id: 'b', minutes: 90 }, { id: 'c', minutes: 45 }] });
  const r = run({ tasks: [t] });
  const placed = r.place.filter(p => p.taskId === 'hw').sort((x, y) => x.start - y.start);
  expect(placed.map(p => p.stepId)).toEqual(['a', 'b', 'c']);
  expect(placed.map(p => p.end - p.start)).toEqual([30, 90, 45]);
  expect(placed.every(p => p.end <= at(6, 0))).toBe(true);
  // The generic sitting is reused for the first step (same id), not left behind.
  expect(placed[0].id).toBe('g1');
  expect(r.remove).toEqual([]);
});

test('a step sitting that is fine stays; one for a step now done goes', () => {
  const t = task('hw', { due: at(6, 23, 59),
    sittings: [{ id: 'sa', stepId: 'a', start: at(4, 10), end: at(4, 10, 30) }, { id: 'sx', stepId: 'gone', start: at(4, 10), end: at(4, 11) }],
    steps: [{ id: 'a', minutes: 30 }] });
  const r = run({ tasks: [t] });
  expect(r.place).toEqual([]);
  expect(r.remove).toEqual([{ taskId: 'hw', id: 'sx' }]);
});

test('steps keep their order: a later step placed before an earlier one moves after it', () => {
  const t = task('hw', { due: at(6, 23, 59),
    sittings: [{ id: 'sa', stepId: 'a', start: at(4, 10), end: at(4, 11) }, { id: 'sb', stepId: 'b', start: at(3, 10), end: at(3, 11) }],
    steps: [{ id: 'a', minutes: 60 }, { id: 'b', minutes: 60 }] });
  const r = run({ tasks: [t] });
  const b = r.place.find(p => p.id === 'sb')!;
  expect(b.start).toBeGreaterThanOrEqual(at(4, 11));
});

test('a set number of sittings splits the work that many ways', () => {
  const r = run({ tasks: [task('hw', { total: 90, due: at(6, 23, 59), count: 3 })] });
  expect(r.place.map(p => p.end - p.start)).toEqual([30, 30, 30]);
});

test('your own deadline and work days bound the sittings', () => {
  // Posted due day 6; due day 3 for you: finish day 2.
  const mine = run({ tasks: [task('hw', { total: 60, due: at(3, 23, 59) })] });
  expect(Math.floor(mine.place[0].start / D)).toBeLessThanOrEqual(2);
  // Work on it only on days 4–5.
  const r = run({ tasks: [task('hw', { total: 120, due: at(8, 23, 59), from: at(4, 0), until: at(6, 0) })] });
  expect(r.place.every(p => p.start >= at(4, 0) && p.end <= at(6, 0))).toBe(true);
  expect(r.finishBy.hw).toBe(at(6, 0));
});

test('a typed length reads minutes, hours and h:mm', async () => {
  const { parseLength } = await import('../src/lib/taskDetails');
  expect(['45', '45 min', '1h', '1h 30m', '1.5h', '1:30', '2 hours', '90m'].map(parseLength)).toEqual([45, 45, 60, 90, 90, 90, 120, 90]);
  expect(parseLength('soon')).toBeNull();
  expect(parseLength('2')).toBe(5);   // a bare number is minutes, never under 5
});
