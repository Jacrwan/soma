import type { LiveBlock, Snapshot } from '../components/DashboardV2/liveData';
import { dateAt, localDate } from '../components/DashboardV2/liveData';
import { freeTime } from './aiPlanning';
import { clockOf, rangeOf, windowOf } from './clockRange';
import { pinKey } from './pinnedBlocks';
import { placeInSeries, reorderSeries } from './series';
import type { SomaSettings } from './storage';
import { deadlineOf } from './taskDetails';

/**
 * Study hours changed (2026-11-21): "moving earliest start from 8 AM to 10 AM
 * should ask whether to move scheduled blocks to fit". Before, only the task
 * scheduler's own sittings followed the new hours; every other block stayed
 * outside them without a word. These find the blocks now outside the hours and
 * place the ones the student says to move.
 */

export const HOURS_DAYS = 7;

export type Outside = { block: LiveBlock; pinned: boolean };

/** Planned blocks from now through the next week that start before or end after the hours. */
export function outsideHours(snapshot: Snapshot, hours: SomaSettings['studyWindow'], origin: Date, now: Date, pins: Set<string>): Outside[] {
  if (hours.off) return [];
  const [open, close] = windowOf(hours);
  const nowAt = Math.round((+now - +dateAt(origin, 0)) / 60000);
  return snapshot.blocks.filter(b => {
    if (b.external || !b.todoId || !b.time || b.sitting || b.state !== 'Planned' || (b.actualSeconds ?? 0) > 0 || b.day < 0 || b.day >= HOURS_DAYS) return false;
    const [a, z] = rangeOf(b.time);
    if (b.day * 1440 + a < nowAt) return false;
    // Inside today's window, or inside the after-midnight tail of yesterday's.
    const inside = (a >= open && z <= close) || (a + 1440 >= open && z + 1440 <= close);
    return !inside;
  }).sort((x, y) => x.day - y.day || rangeOf(x.time)[0] - rangeOf(y.time)[0])
    .map(block => ({ block, pinned: pins.has(pinKey(block.todoId!, localDate(dateAt(origin, block.day)), block.time.split('–')[0])) }));
}

export type HoursMove = { block: LiveBlock; day: number; time: string };

/**
 * Each block goes to the first open time inside the new hours on its own day,
 * else a later day this week, never past its due date. Series stay in order
 * afterwards (they trade slots). What fits nowhere is left where it is.
 */
export function placeInside(snapshot: Snapshot, moving: LiveBlock[], settings: SomaSettings, origin: Date, now: Date, pins: Set<string>): { moves: HoursMove[]; left: LiveBlock[] } {
  const ids = new Set(moving.map(b => String(b.id)));
  let board = snapshot.blocks.filter(b => !ids.has(String(b.id)));
  const placed = new Map<string, HoursMove>();
  const left: LiveBlock[] = [];
  for (const b of moving) {
    const [a, z] = rangeOf(b.time), len = z - a;
    const todo = snapshot.todos.find(t => t.id === b.todoId);
    const due = todo ? deadlineOf(todo) : undefined;
    const dueDay = due ? Math.round((+dateAt(new Date(`${due.slice(0, 10)}T12:00:00`), 0) - +dateAt(origin, 0)) / 86_400_000) : HOURS_DAYS - 1;
    const last = Math.min(HOURS_DAYS - 1, Math.max(b.day, dueDay));
    const free = freeTime({ ...snapshot, blocks: board }, origin, settings, now, HOURS_DAYS, 15);
    let spot: HoursMove | undefined;
    for (let d = b.day; d <= last && !spot; d++) {
      const slot = (free[d]?.free ?? []).map(rangeOf).find(([x, y]) => y - x >= len);
      if (slot) spot = { block: b, day: d, time: `${clockOf(slot[0])}–${clockOf(slot[0] + len)}` };
    }
    if (!spot) { left.push(b); continue; }
    placed.set(String(b.id), spot);
    board = [...board, { ...b, day: spot.day, time: spot.time }];
  }
  // A series touched by these moves goes back in date order by trading slots.
  const at = (x: { day: number; time: string }) => x.day * 1440 + rangeOf(x.time)[0];
  const nowAt = Math.round((+now - +dateAt(origin, 0)) / 60000);
  const plain = board.filter(x => !x.external && x.todoId && x.time && x.state === 'Planned' && !x.sitting && !(x.actualSeconds ?? 0) && x.day >= 0 && at(x) >= nowAt);
  const entries = plain.map(x => ({ id: String(x.id), title: x.title, subjectId: x.subjectId, covers: x.covers?.map(c => c.id), start: at(x), end: x.day * 1440 + rangeOf(x.time)[1], movable: !pins.has(pinKey(x.todoId!, localDate(dateAt(origin, x.day)), x.time.split('–')[0])) || placed.has(String(x.id)) }));
  const touched = new Set([...placed.values()].map(m => placeInSeries({ title: m.block.title, subjectId: m.block.subjectId, covers: m.block.covers?.map(c => c.id) }, snapshot.items)?.key).filter((k): k is string => !!k));
  for (const sw of reorderSeries(entries, snapshot.items)) {
    const e = entries.find(x => x.id === String(sw.id))!;
    if (!touched.has(placeInSeries(e, snapshot.items)?.key ?? '')) continue;
    const day = Math.floor(sw.to[0] / 1440);
    const time = `${clockOf(sw.to[0] - day * 1440)}–${clockOf(sw.to[1] - day * 1440)}`;
    const original = snapshot.blocks.find(x => String(x.id) === e.id)!;
    placed.set(e.id, { block: original, day, time });
  }
  return { moves: [...placed.values()].filter(m => m.day !== m.block.day || m.time !== m.block.time), left };
}
