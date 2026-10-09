import { test, expect } from '@playwright/test';
import { autoEndDate, sessionSpan, addDaysTo, daysBetween } from '../src/lib/sessionSpan';

// The end date follows the start: the same day, or the next when the end time
// is at or before the start (the past-midnight rule from 2026-10-02).
test('the end date follows the start, and the next day past midnight', () => {
  expect(autoEndDate('2026-10-08', '21:18', '23:35')).toBe('2026-10-08');
  expect(autoEndDate('2026-10-08', '23:25', '00:35')).toBe('2026-10-09');
  expect(autoEndDate('2026-10-31', '23:00', '01:00')).toBe('2026-11-01');
  expect(autoEndDate('2026-10-08', '21:18', '')).toBe('2026-10-08');
  // More than 12 hours back round the clock is a typo, so it stays on the start's day.
  expect(autoEndDate('2026-10-08', '15:00', '14:00')).toBe('2026-10-08');
  expect(autoEndDate('2026-10-08', '15:00', '15:00')).toBe('2026-10-08');
});

test('a session is measured across dates', () => {
  expect(sessionSpan('2026-10-08', '21:18', '23:35', null)).toMatchObject({ minutes: 137, endDate: '2026-10-08', problem: '' });
  expect(sessionSpan('2026-10-08', '23:25', '00:35', null)).toMatchObject({ minutes: 70, endDate: '2026-10-09' });
  // 3 PM to 2 PM on its own is a typo...
  expect(sessionSpan('2026-10-08', '15:00', '14:00', null).minutes).toBe(0);
  expect(sessionSpan('2026-10-08', '15:00', '14:00', null).problem).toMatch(/End time must be later/);
  // ...unless the student set the end date.
  expect(sessionSpan('2026-10-08', '15:00', '14:00', 1)).toMatchObject({ minutes: 1380, endDate: '2026-10-09', problem: '' });
  expect(sessionSpan('2026-10-08', '15:00', '16:00', -1).problem).toMatch(/end must be after the start/);
  expect(sessionSpan('2026-10-08', '15:00', '16:00', 1).problem).toMatch(/24 hours/);
  // Nothing typed yet: no length, no complaint.
  expect(sessionSpan('2026-10-08', '15:00', '', null)).toMatchObject({ minutes: 0, problem: '' });
});

test('the clocks going back do not move a date', () => {
  expect(addDaysTo('2026-10-31', 1)).toBe('2026-11-01');
  expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
});
