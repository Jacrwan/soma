// Kept free of runtime imports beyond clockRange so tests can load it on its own.
import { clockMinutes, clockOf } from './clockRange';

/**
 * The student's weekly routine: the life around studying. Gym, cardio,
 * lunch and dinner with the walk there and back, evening projects. Asked for
 * on 2026-11-05 after another AI "pretty much just built my life" from one
 * vent: "classes + gym + food + study all done by 9pm, then 9-11 other stuff".
 *
 * Kept in settings (settings.routine), not as tasks. Each day's routine blocks
 * are worked out from it when the plan is read (readPlan), so the dashboard,
 * Soma and placement all see the same blocks and nothing needs writing week to
 * week. They act like calendar events: study goes around them, and the student
 * can skip one for a day the way they skip a class.
 *
 * An item either has a fixed start ("21:00", projects) or a window it goes in
 * ("between 07:00 and 21:00", gym). Windowed items are placed around that
 * day's calendar events and the fixed items, never around study blocks, so a
 * day's routine doesn't shift when study is added.
 */

export type RoutineItem = {
  /** From the title, so a skip remembered for "Gym" still applies after the routine is edited. */
  id: string;
  title: string;
  /** 0 Sunday … 6 Saturday. */
  days: number[];
  minutes: number;
  /** Fixed start, HH:mm. */
  start?: string;
  /** Without a start: the window it is placed in, HH:mm. */
  after?: string;
  before?: string;
};
export type Routine = {
  /** YYYY-MM-DD: days before this don't get routine blocks. */
  since: string;
  items: RoutineItem[];
};
export type RoutineBlock = {
  id: string; title: string; subject: string; time: string; minutes: number; color: string;
  state: 'Planned'; day: number; external: true; routine: true; note?: string;
};

export const MAX_ROUTINE_ITEMS = 12;
export const ROUTINE_SUBJECT = 'Routine';
/** Where a windowed item goes when it names no window. */
export const DAY_OPENS = '07:00', DAY_CLOSES = '23:00';

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const str = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const clock = (v: unknown) => typeof v === 'string' && CLOCK.test(v.trim()) ? v.trim() : undefined;
const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'item';

/** A weekday as a number: 0–6, or a name ("Mon", "monday"). */
function dayOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 6 ? v : null;
  if (typeof v !== 'string') return null;
  const i = WEEKDAYS.indexOf(v.trim().toLowerCase().slice(0, 3));
  return i >= 0 ? i : null;
}

/**
 * Routine items from anywhere untrusted (settings, Soma's reply), checked:
 * a title, at least one day, 5 minutes to 12 hours, and a fixed start or a
 * window long enough to hold it. Anything else is left out.
 */
export function readRoutineItems(raw: unknown): RoutineItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RoutineItem[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_ROUTINE_ITEMS) break;
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const title = str(r.title, 60);
    const minutes = Math.round(Number(r.minutes));
    const days = [...new Set((Array.isArray(r.days) ? r.days : []).map(dayOf).filter((d): d is number => d !== null))].sort((a, b) => a - b);
    if (!title || !days.length || !Number.isFinite(minutes) || minutes < 5 || minutes > 720) continue;
    const start = clock(r.start);
    const item: RoutineItem = { id: '', title, days, minutes, ...(start ? { start } : {}) };
    if (!start) {
      const after = clock(r.after), before = clock(r.before);
      const lo = clockMinutes(after ?? DAY_OPENS), hi = clockMinutes(before ?? DAY_CLOSES);
      // A window has to run forward within the day and hold the item.
      if (hi <= lo || hi - lo < minutes) continue;
      if (after) item.after = after;
      if (before) item.before = before;
    }
    let id = slug(title), n = 2;
    while (out.some(i => i.id === id)) id = `${slug(title)}-${n++}`;
    item.id = id;
    out.push(item);
  }
  return out;
}

/** The routine kept in settings, checked; null when there is none. */
export function readRoutine(raw: unknown): Routine | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const since = typeof r.since === 'string' && DATE.test(r.since) ? r.since : null;
  const items = readRoutineItems(r.items);
  return since && items.length ? { since, items } : null;
}

/**
 * One day's routine blocks. `busy` is that day's calendar events as minute
 * ranges; all-day events don't count, or a "Finals week" banner would push
 * every meal off the day. Fixed items go at their time; windowed ones, in the
 * order listed, in the first open stretch of their window. One that fits
 * nowhere still shows, with no time, so it isn't silently dropped.
 */
export function routineDay(routine: Routine | null, date: Date, day: number, busy: [number, number][]): RoutineBlock[] {
  if (!routine) return [];
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (key < routine.since) return [];
  const today = routine.items.filter(i => i.days.includes(date.getDay()));
  const taken: [number, number][] = busy.filter(([a, z]) => z - a < 1380);
  const block = (i: RoutineItem, time: string, note?: string): RoutineBlock => ({
    id: `routine:${i.id}:${key}`, title: i.title, subject: ROUTINE_SUBJECT, time, minutes: time ? i.minutes : 0,
    color: 'neutral', state: 'Planned', day, external: true, routine: true, ...(note ? { note } : {}),
  });
  const out: RoutineBlock[] = [];
  for (const i of today.filter(i => i.start)) {
    const from = clockMinutes(i.start!);
    taken.push([from, from + i.minutes]);
    out.push(block(i, `${i.start}–${clockOf(from + i.minutes)}`));
  }
  for (const i of today.filter(i => !i.start)) {
    const lo = clockMinutes(i.after ?? DAY_OPENS), hi = clockMinutes(i.before ?? DAY_CLOSES);
    let cursor = lo, spot: number | null = null;
    for (const [a, z] of [...taken].sort((x, y) => x[0] - y[0])) {
      if (z <= cursor) continue;
      if (a - cursor >= i.minutes) break;
      cursor = Math.max(cursor, Math.ceil(z / 5) * 5);
    }
    if (cursor + i.minutes <= hi) spot = cursor;
    if (spot === null) { out.push(block(i, '', 'No open time in its window today')); continue; }
    taken.push([spot, spot + i.minutes]);
    out.push(block(i, `${clockOf(spot)}–${clockOf(spot + i.minutes)}`));
  }
  return out.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Mon–Sat", "Mon, Wed, Fri", "every day". */
export function daysLabel(days: number[]): string {
  if (days.length === 7) return 'every day';
  const sorted = [...days].sort((a, b) => a - b);
  const run = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  return run && sorted.length > 2 ? `${DAY_NAMES[sorted[0]]}–${DAY_NAMES[sorted[sorted.length - 1]]}` : sorted.map(d => DAY_NAMES[d]).join(', ');
}

/** "1h 30m", "45 min". */
export const lengthLabel = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`;

/** One line per item, for Soma's context: "Gym · 90 min · Mon–Sat · between 07:00 and 21:00". */
export function routineLines(routine: Routine | null): string[] {
  return (routine?.items ?? []).map(i => [i.title, `${i.minutes} min`, daysLabel(i.days), i.start ? `at ${i.start}` : `between ${i.after ?? DAY_OPENS} and ${i.before ?? DAY_CLOSES}`].join(' · '));
}
