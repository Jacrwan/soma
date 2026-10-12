/// <reference types="node" />

/**
 * Clock times for tasks Claude adds through the connector (_connector.ts).
 *
 * These are the rules the app itself places by (`freeTime` in
 * src/lib/aiPlanning.ts and `autoPlace` in src/lib/assistant.ts), restated
 * here because that code runs in the student's browser and this runs on the
 * server: a task goes in the first open stretch of its day that holds all of
 * it, inside study hours, never on a calendar event or another block, never in
 * the past. Starts fall on five-minute marks, and "now" is rounded up to the
 * quarter hour. A task that doesn't fit whole is not split; it is reported
 * back so Claude can ask the student.
 *
 * A time the student agreed to is different, as it is in the app: it goes
 * exactly there, at any hour and over a calendar event, and is refused only
 * when it has passed or lands on another of their blocks (`exactSpot`).
 *
 * The browser knows the student's time zone; the server has to be told it, so
 * every time here is an instant (epoch milliseconds) worked out from a day and
 * a zone.
 */

export type StudyWindow = { start: string; end: string; off?: boolean };
/** Something already on the plan: [start, end] as instants. */
export type Busy = [number, number];

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isClock = (v: unknown): v is string => typeof v === 'string' && CLOCK.test(v);
export const minutesOf = (clock: string) => { const [h, m] = clock.split(':').map(Number); return h * 60 + m; };
const MINUTE = 60_000;
const ceilTo = (instant: number, minutes: number) => Math.ceil(instant / (minutes * MINUTE)) * minutes * MINUTE;

/** How far a zone's clocks are ahead of UTC at an instant, in milliseconds. */
function offsetAt(instant: number, zone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(instant / 1000) * 1000;
}
/** The instant a day's clock reads `minutes` after midnight in a zone. `minutes` may run past 1440 into the next day. */
export function zonedToUtc(day: string, minutes: number, zone: string): number {
  const wall = Date.parse(`${day}T00:00:00Z`) + minutes * MINUTE;
  let instant = wall;
  // The offset depends on the instant, which depends on the offset; this settles in two rounds, three across a clock change.
  for (let i = 0; i < 3; i++) instant = wall - offsetAt(instant, zone);
  return instant;
}
export const dayIn = (zone: string, instant: number) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
export const clockAt = (zone: string, instant: number) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(instant));

const DEFAULT_WINDOW: StudyWindow = { start: '08:00', end: '23:00' };
/** The student's study hours from their saved settings, read the way the app reads them (storage.ts `withDefaults`). */
export function studyWindowOf(data: unknown): StudyWindow {
  const raw = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const saved = raw.studyWindow as Partial<StudyWindow> | undefined;
  if (saved && isClock(saved.start) && isClock(saved.end)) return { start: saved.start, end: saved.end, ...(saved.off ? { off: true } : {}) };
  // Accounts from before study hours were one window: the widest span of the old per-day hours.
  if (raw.personalHoursEnabled !== false) {
    const week = (raw.personalHours ?? raw.availability) as Record<string, { start?: unknown; end?: unknown }> | undefined;
    const days = Object.values(week && typeof week === 'object' ? week : {}).filter(d => isClock(d?.start) && isClock(d?.end)) as { start: string; end: string }[];
    if (days.length) return { start: days.map(d => d.start).sort()[0], end: days.map(d => d.end).sort().reverse()[0] };
  }
  return DEFAULT_WINDOW;
}
export const windowLabel = (w: StudyWindow) => w.off ? 'any hour (study hours are off)' : `${w.start}–${w.end}`;

export type Bounds = { after?: string; before?: string };
/**
 * The open stretches of one day, in order: study hours (narrowed by
 * `after`/`before`), from now on, minus everything busy.
 */
export function openSlots(day: string, zone: string, window: StudyWindow, busy: Busy[], now: number, bounds: Bounds = {}): Busy[] {
  // Latest end at or before the earliest start runs past midnight; off is the whole day.
  const open = window.off ? 0 : minutesOf(window.start);
  const close = window.off ? 1440 : open + ((minutesOf(window.end) - open + 1440) % 1440 || 1440);
  // With study hours off, nothing lands before 8 AM unless the student named a time.
  const lo = bounds.after ? minutesOf(bounds.after) : window.off ? 480 : 0;
  let hi = bounds.before ? minutesOf(bounds.before) : Infinity;
  if (bounds.before && (hi < open || hi <= lo)) hi += 1440;   // "before 1 AM" is tonight
  const end = zonedToUtc(day, Math.min(close, hi), zone);
  let cursor = ceilTo(Math.max(zonedToUtc(day, Math.max(open, lo), zone), ceilTo(now, 15)), 5);
  const slots: Busy[] = [];
  const add = (from: number, to: number) => { if (to - from >= 15 * MINUTE) slots.push([from, to]); };
  for (const [a, z] of [...busy].sort((x, y) => x[0] - y[0])) {
    if (z <= cursor) continue;
    if (a >= end) break;
    add(cursor, Math.min(a, end));
    // Classes end at :59; free time starts at the next round five minutes.
    cursor = Math.max(cursor, ceilTo(z, 5));
  }
  if (cursor < end) add(cursor, end);
  return slots;
}

/** The first open stretch that holds the whole task, or null. */
export function firstFit(slots: Busy[], minutes: number): Busy | null {
  const slot = slots.find(([from, to]) => from + minutes * MINUTE <= to);
  return slot ? [slot[0], slot[0] + minutes * MINUTE] : null;
}

/**
 * Does this time zone agree with where the student has been studying? Each
 * session is saved with the day it started on, as the student's own clock had
 * it; a wrong zone puts evening sessions on the next day. Without this check a
 * mistaken zone would quietly put every task hours off.
 */
export function zoneFitsHistory(sessions: { day: string; start: number }[], zone: string): boolean {
  let fits = 0, misses = 0;
  for (const s of sessions) if (dayIn(zone, s.start) === s.day) fits++; else misses++;
  return !(misses >= 3 && misses > fits);
}

/** How long after a start time it can still be saved: "start now" arrives a few minutes old. */
const START_GRACE = 15 * MINUTE;
export type Marked = { span: Busy; title: string; own: boolean };
/**
 * A time the student named, taken as given: [start, end], the calendar events
 * it runs over (allowed, and reported), or why it can't go there. Study hours
 * don't apply: the student said when.
 */
export function exactSpot(day: string, start: string, minutes: number, zone: string, taken: Marked[], now: number): { spot: Busy; over: string[] } | { problem: string } {
  const from = zonedToUtc(day, minutesOf(start), zone), to = from + minutes * MINUTE;
  if (from < now - START_GRACE) return { problem: 'That start time has already passed.' };
  const hits = taken.filter(t => t.span[0] < to && t.span[1] > from);
  const mine = hits.find(t => t.own);
  if (mine) return { problem: `That overlaps "${mine.title}" (${clockAt(zone, mine.span[0])}–${clockAt(zone, mine.span[1])}). Move that block first, or use another time.` };
  return { spot: [from, to], over: [...new Set(hits.map(t => t.title))] };
}
