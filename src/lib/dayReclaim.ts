import { clockOf, rangeOf, spanMinutes } from './clockRange';

/**
 * Within-day reclaim (exam prep v2). No model.
 *
 * A study block whose time has ended, and that was never started (no Focus,
 * no check), is missed. Missed work and later never-started study on the
 * same day are repacked by priority into the gaps still left today.
 * Calendar events and anything already started stay where they are.
 * Nothing lands after `windowEnd` (study hours). Pass `null` when study
 * hours are off or the student opted into personal time.
 *
 * A block still in Focus past its end holds the day: nothing moves until
 * `finishOverrun` runs at check-off.
 */

export type DayBlock = {
  id: string;
  title: string;
  /** "HH:mm–HH:mm", or "" when it has no time. */
  time: string;
  minutes: number;
  /** 1 low … 5 high. Missing counts as 3. */
  priority?: number;
  /** Class or calendar event. Never moved. */
  fixed?: boolean;
  /** Focus was pressed or minutes were logged. */
  started?: boolean;
  done?: boolean;
  /** Focus is still running. */
  running?: boolean;
};

export type ReclaimMove = { id: string; from: string; to: string };

export type ReclaimResult = {
  blocks: DayBlock[];
  moved: ReclaimMove[];
  /** Missed work that did not fit before the study-hours end. */
  unplaced: string[];
  /** Focus is still running past the planned end. The day waits. */
  held: boolean;
};

const MIN_GAP = 15;

const pri = (b: DayBlock) => b.priority ?? 3;
const lenOf = (b: DayBlock) => b.minutes || (b.time ? spanMinutes(...b.time.split('–') as [string, string]) : 45);

function movable(b: DayBlock) {
  return !b.fixed && !b.done && !b.started && !b.running && !!b.time;
}

/** Free [from, to) gaps inside [start, limit), around occupied ranges. */
function gapsBetween(occupied: [number, number][], start: number, limit: number): [number, number][] {
  const occ = occupied
    .filter(([a, z]) => z > start && a < limit)
    .map(([a, z]) => [Math.max(a, start), Math.min(z, limit)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let cursor = start;
  for (const [a, z] of occ) {
    if (a - cursor >= MIN_GAP) gaps.push([cursor, a]);
    cursor = Math.max(cursor, z);
  }
  if (limit - cursor >= MIN_GAP) gaps.push([cursor, limit]);
  return gaps;
}

/**
 * Place `pool` (already in priority order) into gaps. Returns the new time
 * per id that landed, and ids that did not fit.
 */
function pack(pool: DayBlock[], gaps: [number, number][]): { times: Map<string, string>; unplaced: string[] } {
  const times = new Map<string, string>();
  const unplaced: string[] = [];
  const left = gaps.map(g => [...g] as [number, number]);
  for (const b of pool) {
    const len = lenOf(b);
    const at = left.findIndex(([a, z]) => z - a >= len);
    if (at < 0) { unplaced.push(b.id); continue; }
    const [a, z] = left[at];
    times.set(b.id, `${clockOf(a)}–${clockOf(a + len)}`);
    const restStart = a + len;
    left.splice(at, 1, ...(z - restStart >= MIN_GAP ? [[restStart, z] as [number, number]] : []));
  }
  return { times, unplaced };
}

function applyTimes(blocks: DayBlock[], times: Map<string, string>, clear: Set<string>): { blocks: DayBlock[]; moved: ReclaimMove[] } {
  const moved: ReclaimMove[] = [];
  const next = blocks.map(b => {
    if (clear.has(b.id) && b.time) {
      moved.push({ id: b.id, from: b.time, to: '' });
      return { ...b, time: '' };
    }
    const to = times.get(b.id);
    if (!to || to === b.time) return b;
    moved.push({ id: b.id, from: b.time, to });
    const [a, z] = to.split('–');
    return { ...b, time: to, minutes: spanMinutes(a, z) };
  });
  return { blocks: next, moved };
}

/**
 * Repack today from `nowMin` when something was missed.
 * `windowEnd` is minutes from midnight, or null for no cap.
 */
export function reclaimDay(blocks: DayBlock[], nowMin: number, windowEnd: number | null): ReclaimResult {
  const running = blocks.find(b => b.running && !b.done && b.time);
  if (running) {
    const [, end] = rangeOf(running.time);
    if (end <= nowMin) return { blocks, moved: [], unplaced: [], held: true };
  }

  const missed = blocks.filter(b => movable(b) && rangeOf(b.time)[1] <= nowMin);
  if (!missed.length) return { blocks, moved: [], unplaced: [], held: false };

  const later = blocks.filter(b => movable(b) && rangeOf(b.time)[0] >= nowMin);
  const pool = [...missed, ...later].sort((a, b) => pri(b) - pri(a) || a.title.localeCompare(b.title));
  const poolIds = new Set(pool.map(b => b.id));
  const occupied = blocks.filter(b => !poolIds.has(b.id) && b.time).map(b => rangeOf(b.time));
  const limit = windowEnd == null ? 24 * 60 : Math.min(24 * 60, windowEnd);
  const { times, unplaced } = pack(pool, gapsBetween(occupied, nowMin, limit));
  const clear = new Set(unplaced.filter(id => {
    const b = blocks.find(x => x.id === id);
    return !!b?.time && rangeOf(b.time)[1] <= nowMin;
  }));
  const applied = applyTimes(blocks, times, clear);
  return { ...applied, unplaced, held: false };
}

/**
 * The student checked off a block that ran long. Its end becomes `endedAtMin`,
 * then never-started study that overlaps that end is packed into the rest
 * of the day. Finishing early does not move anything else.
 */
export function finishOverrun(blocks: DayBlock[], id: string, endedAtMin: number, windowEnd: number | null): ReclaimResult {
  const block = blocks.find(b => b.id === id);
  if (!block?.time) return { blocks, moved: [], unplaced: [], held: false };
  const [start, plannedEnd] = rangeOf(block.time);
  if (endedAtMin <= plannedEnd) {
    const done = blocks.map(b => b.id === id ? { ...b, done: true, running: false, started: true } : b);
    return { blocks: done, moved: [], unplaced: [], held: false };
  }
  const end = Math.min(endedAtMin, 24 * 60);
  const time = `${clockOf(start)}–${clockOf(end)}`;
  const closed = blocks.map(b => b.id === id
    ? { ...b, time, minutes: spanMinutes(clockOf(start), clockOf(end)), done: true, running: false, started: true }
    : b);
  const pool = closed.filter(b => movable(b) && rangeOf(b.time)[0] < end).sort((a, b) => pri(b) - pri(a) || a.title.localeCompare(b.title));
  if (!pool.length) {
    const moved = time === block.time ? [] : [{ id, from: block.time, to: time }];
    return { blocks: closed, moved, unplaced: [], held: false };
  }
  const poolIds = new Set(pool.map(b => b.id));
  const occupied = closed.filter(b => !poolIds.has(b.id) && b.time).map(b => rangeOf(b.time));
  const limit = windowEnd == null ? 24 * 60 : Math.min(24 * 60, windowEnd);
  const { times, unplaced } = pack(pool, gapsBetween(occupied, end, limit));
  const clear = new Set(unplaced);
  const applied = applyTimes(closed, times, clear);
  if (time !== block.time) applied.moved.unshift({ id, from: block.time, to: time });
  return { ...applied, unplaced, held: false };
}
