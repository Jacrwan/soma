// Kept free of imports beyond clockRange so tests can load it without the Supabase client.
import { clockMinutes } from './clockRange';

/**
 * A recorded session as the student types it: a start date and time, an end
 * date and time. The end date follows the start unless the student picks one:
 * the same day, or the next day when the end time is at or before the start
 * (11:25 PM to 12:35 AM ran past midnight).
 */

const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** "YYYY-MM-DD" `n` days after `date`. */
export function addDaysTo(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days from `a` to `b`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);
}

/** Past midnight on its own, a session may run 12 hours: 3 PM to 2 PM is a typo, not 23 hours. */
export const OVERNIGHT_LIMIT = 720;
/** With an end date the student picked, up to a day. */
export const SESSION_LIMIT = 1440;

/**
 * The end's day when the student hasn't picked one: the next day for an end
 * time up to 12 hours past an evening start, otherwise the start's day (so
 * 3 PM to 2 PM reads as an end before the start until the date is changed).
 */
export function autoEndDate(startDate: string, startTime: string, endTime: string): string {
  if (!clock.test(startTime) || !clock.test(endTime)) return startDate;
  const diff = clockMinutes(endTime) - clockMinutes(startTime);
  return diff < 0 && diff + 1440 <= OVERNIGHT_LIMIT ? addDaysTo(startDate, 1) : startDate;
}

/** Minutes from start to end, across dates; zero or less when the end is not after the start. */
export function minutesBetween(startDate: string, startTime: string, endDate: string, endTime: string): number {
  if (!isDate(startDate) || !isDate(endDate) || !clock.test(startTime) || !clock.test(endTime)) return 0;
  return Math.round((new Date(`${endDate}T${endTime}:00`).getTime() - new Date(`${startDate}T${startTime}:00`).getTime()) / 60_000);
}

/**
 * The session's length, or why it can't be saved. `endOffset` is the end's
 * day counted from the start when the student picked it, or null to follow
 * the start.
 */
export function sessionSpan(startDate: string, startTime: string, endTime: string, endOffset: number | null) {
  const endDate = endOffset === null ? autoEndDate(startDate, startTime, endTime) : addDaysTo(startDate, endOffset);
  const minutes = minutesBetween(startDate, startTime, endDate, endTime);
  const ready = isDate(startDate) && clock.test(startTime) && clock.test(endTime);
  let problem = '';
  if (ready && minutes <= 0) {
    problem = endOffset === null
      ? 'End time must be later than start time. Past midnight, the end date moves to the next day for up to 12 hours; set it yourself for a longer session.'
      : 'The end must be after the start. Check the end date.';
  } else if (ready && minutes > SESSION_LIMIT) {
    problem = 'A session can run up to 24 hours.';
  }
  return { endDate, minutes: ready && !problem ? minutes : 0, problem };
}
