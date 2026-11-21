import type { LiveBlock, Snapshot } from '../components/DashboardV2/liveData';
import type { SomaSettings } from './storage';
import type { Todo } from '../types';
import { freeTime } from './aiPlanning';
import { clockOf, rangeOf } from './clockRange';
import { estimate, isSittingOf } from './planIt';
import { deadlineOf } from './taskDetails';
import { pinKey } from './pinnedBlocks';
import { comesBefore, priorityOf, UNDATED } from './workOrder';
import { placeInSeries, reorderSeries } from './series';

/**
 * Catch-Up: a plan for a student who has fallen behind, worked out here with
 * no AI call. Soma decides what still matters, what isn't worth catching up
 * on, and where each piece goes; the student accepts it in one tap. Nothing is
 * saved from here: the dashboard turns the result into ordinary suggestions
 * and accepts them the way Accept all does.
 *
 * The yesterday card is the small daily version: blocks the student logged
 * time on yesterday but didn't check off. Soma never checks work off on its
 * own; it suggests time for the rest, and "I finished it" is the student's tap.
 */

/** Canvas work not handed in, already matched to the student's course. */
export type CatchUpAssignment = { id: number; title: string; subjectId: string; subject: string; color: string; dueAt: string; groupName?: string; groupWeight?: number; lateDueAt?: string };

export type CatchUpItem = {
  key: string; title: string; subject: string; subjectId?: string; color: string; minutes: number; why: string;
  /** An existing block or task this moves, instead of making a new one. */
  replaces?: string | number; base?: { day: number; time: string };
  /** Soma would leave this out; the student can bring it back. */
  notWorthIt: boolean;
  day?: number; time?: string;
};
/** A block already on the plan that Catch-Up moves aside, or later, for work that goes first. */
export type CatchUpMove = { key: string; blockId: string | number; title: string; subject: string; color: string; from: { day: number; time: string }; to: { day: number; time: string }; why: string };
/** A block the student placed themselves that is in the way: Catch-Up asks before moving it. */
export type CatchUpOffer = { blockId: string | number; title: string; time: string; forTitle: string };
export type CatchUpPlan = { planned: CatchUpItem[]; skipped: CatchUpItem[]; unplaced: CatchUpItem[]; behind: number; lastDay: number; moves: CatchUpMove[]; offers: CatchUpOffer[] };

export type CatchUpInput = {
  /** readPlan from 7 days back: past blocks have negative days. */
  snapshot: Snapshot; assignments: CatchUpAssignment[]; settings: SomaSettings; origin: Date; now?: Date;
  /** Keys the student skipped, and ones Soma would skip that they brought back. */
  skipped?: Set<string>; restored?: Set<string>;
  /** How many things go on today; "Move one thing to tomorrow" lowers it. */
  todayCap?: number;
  /** Blocks whose time the student chose (pinnedBlocks keys): never moved without a yes. */
  pins?: Set<string>;
  /** Blocks of theirs the student said Catch-Up may move. */
  movePinned?: Set<string>;
};

const DAYS = 5, PER_DAY = 3, LONGEST = 180;
const midnight = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const daysBetween = (a: Date, b: Date) => Math.round((midnight(b).getTime() - midnight(a).getTime()) / 86_400_000);
/** A task's due day is that day; a Canvas due time before 3 AM is the night before's work. */
function dueDay(due: string, origin: Date): number {
  if (due.length <= 10) return daysBetween(origin, new Date(`${due}T12:00:00`));
  const d = new Date(due);
  if (d.getHours() < 3) d.setDate(d.getDate() - 1);
  return daysBetween(origin, d);
}
function dayName(day: number, origin: Date): string {
  if (day === -1) return 'yesterday';
  if (day === 0) return 'today';
  if (day === 1) return 'tomorrow';
  const d = midnight(origin); d.setDate(d.getDate() + day);
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dueWords = (day: number, origin: Date) => day < 0 ? `Was due ${dayName(day, origin)}.` : `Due ${dayName(day, origin)}.`;
const worthWords = (a?: CatchUpAssignment) => a?.groupWeight ? ` ${a.groupName ? `${a.groupName} is` : 'Its group is'} ${a.groupWeight}% of your grade.` : '';
const localDay = (origin: Date, day: number) => { const d = midnight(origin); d.setDate(d.getDate() + day); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

type Candidate = CatchUpItem & { dueDay?: number; weight: number; slipped?: boolean; prio: number; covers?: string[] };

function candidates({ snapshot, assignments, origin, now = new Date() }: CatchUpInput): Candidate[] {
  const out: Candidate[] = [];
  const byId = new Map(assignments.map(a => [a.id, a]));
  const todo = (id?: string) => snapshot.todos.find(t => t.id === id);
  // Planned from today on (by task, or by name in the same course), or already done.
  const ahead = snapshot.blocks.filter(b => b.day >= 0 && !b.external && b.todoId);
  const plannedAhead = (t: Todo) => ahead.some(b => b.todoId === t.id || (b.subjectId === t.subjectId && norm(b.title) === norm(t.text)));
  const doneTwin = (t: Todo) => snapshot.todos.some(x => x.id !== t.id && x.status === 'done' && x.subjectId === t.subjectId && norm(x.text) === norm(t.text));
  const open = (t?: Todo): t is Todo => !!t && t.status !== 'done' && !doneTwin(t) && !plannedAhead(t);
  const seen = new Set<string>();

  // Blocks from the last week that didn't happen: not checked off, under 5 minutes logged.
  const past = snapshot.blocks.filter(b => b.day < 0 && b.day >= -7 && !b.external && b.todoId && b.state !== 'Completed' && (b.actualSeconds ?? 0) < 300)
    .sort((a, b) => b.day - a.day);
  for (const b of past) {
    const t = todo(b.todoId);
    if (!open(t) || seen.has(t.id)) continue;
    seen.add(t.id);
    const a = t.assignmentId !== undefined ? byId.get(t.assignmentId) : undefined;
    const due = t.dueDate ? dueDay(t.dueDate, origin) : a ? dueDay(a.dueAt, origin) : undefined;
    // Their own task with no due date, from three or more days ago: let it go.
    const stale = due === undefined && !a && b.day <= -3;
    out.push({
      key: `t:${t.id}`, title: b.title, subject: b.subject, subjectId: b.subjectId, color: b.color,
      minutes: Math.min(LONGEST, b.minutes || t.estimatedMinutes || 45),
      why: stale ? `Your own task from ${dayName(b.day, origin)}, with no due date.` : `Planned for ${dayName(b.day, origin)} and didn’t happen.${due !== undefined ? ` ${dueWords(due, origin)}` : ''}${worthWords(a)}`,
      replaces: b.id, base: b.time ? { day: b.day, time: b.time } : undefined,
      notWorthIt: stale, dueDay: due, weight: a?.groupWeight ?? 0, slipped: true,
      // Missed work with no due date counts as due the day it was planned.
      prio: priorityOf({ ...t, dueDate: deadlineOf(t) ?? a?.dueAt }, { missed: true, plannedDate: localDay(origin, b.day) }),
      covers: b.covers?.map(c => c.id),
    });
  }

  // Open tasks with a due date and no block: overdue, or due in the next few days.
  const placed = new Set(snapshot.blocks.map(b => b.todoId).filter(Boolean));
  for (const t of snapshot.todos) {
    if (!t.dueDate || placed.has(t.id) || seen.has(t.id) || !open(t)) continue;
    const due = dueDay(t.dueDate, origin);
    if (due < -14 || due >= DAYS) continue;
    seen.add(t.id);
    const a = t.assignmentId !== undefined ? byId.get(t.assignmentId) : undefined;
    const subject = snapshot.subjects.find(s => s.id === t.subjectId);
    out.push({
      key: `t:${t.id}`, title: t.text, subject: subject?.name ?? 'Personal', subjectId: t.subjectId, color: a?.color ?? 'blue',
      minutes: Math.min(LONGEST, t.estimatedMinutes || 60), why: `${dueWords(due, origin)}${worthWords(a)}`,
      replaces: t.id, notWorthIt: false, dueDay: due, weight: a?.groupWeight ?? 0,
      prio: priorityOf({ ...t, dueDate: deadlineOf(t) }),
    });
  }

  // Canvas work with no task of its own yet.
  for (const a of assignments) {
    const due = dueDay(a.dueAt, origin);
    if (due < -14 || due >= DAYS) continue;
    if (snapshot.todos.some(t => t.assignmentId === a.id || (t.subjectId === a.subjectId && isSittingOf(t.text, a.title)))) continue;
    const lateOpen = !!a.lateDueAt && new Date(a.lateDueAt) > now;
    // Over a week late with no late window: probably not worth it, but it's their call.
    const old = due <= -7 && !lateOpen;
    out.push({
      key: `a:${a.id}`, title: a.title, subject: a.subject, subjectId: a.subjectId, color: a.color,
      // How long work like this takes them, as Plan it estimates it.
      minutes: Math.min(LONGEST, estimate({ key: `a:${a.id}`, title: a.title, subject: a.subject, subjectId: a.subjectId, color: a.color, due: a.dueAt }, snapshot.history).minutes),
      why: old ? 'Due over a week ago. Check Canvas if it’s still accepted.'
        : `${dueWords(due, origin)}${lateOpen ? ` Canvas still takes it until ${dayName(dueDay(a.lateDueAt!, origin), origin)}.` : ''}${worthWords(a)}`,
      notWorthIt: old, dueDay: due, weight: a.groupWeight ?? 0,
      prio: priorityOf({ text: a.title, dueDate: a.dueAt }),
    });
  }
  return out;
}

/** Most urgent first (workOrder's priority); a tie goes to what counts for more. */
function order(a: Candidate, b: Candidate) {
  return a.prio - b.prio || b.weight - a.weight;
}

/** Open time per day from today, as [from, to] minutes, taken out as work lands. */
function openSlots(snapshot: Snapshot, origin: Date, settings: SomaSettings, now: Date, days: number): [number, number][][] {
  return freeTime(snapshot, origin, settings, now, days, 15).map(d => d.free.map(rangeOf));
}
function take(slots: [number, number][], length: number): string | null {
  const at = slots.findIndex(([a, z]) => z - a >= length);
  if (at < 0) return null;
  const [a, z] = slots[at];
  slots.splice(at, 1, ...(z - (a + length) >= 15 ? [[a + length + 10, z] as [number, number]] : []));
  return `${clockOf(a)}–${clockOf(a + length)}`;
}

/** How far ahead blocks moved aside may go: the plan Catch-Up reads runs a week from today. */
const HORIZON = 7, BREAK = 10;
type Board = { id: string | number; day: number; time: string };

/**
 * Catch-Up's plan (2026-11-20). Work goes in most urgent first. What fell
 * behind (missed, overdue, due today or tomorrow) goes back right away: an
 * open slot from today on, or else the slot of lower-priority work that hasn't
 * started, which moves to the next open time. Everything else only takes open
 * time, however far out. Blocks the student placed themselves never move
 * without a yes: they come back as offers. Last, work that comes first (a
 * missed chapter 5) takes the slot of what it comes before (chapter 6 today),
 * and that one moves after it.
 */
export function buildCatchUp(input: CatchUpInput): CatchUpPlan {
  const { snapshot, settings, origin, now = new Date(), skipped = new Set(), restored = new Set(), todayCap = PER_DAY, pins = new Set(), movePinned = new Set() } = input;
  const items = snapshot.items ?? [];
  const all = candidates(input).sort(order);
  // Work that has to come first goes ahead of what it comes before.
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    if (comesBefore(all[j], all[i], items) && !comesBefore(all[i], all[j], items)) { const [x] = all.splice(j, 1); all.splice(i, 0, x); }
  }
  // What actually fell behind: overdue, or planned and didn't happen. Work due ahead isn't.
  const behind = all.filter(c => c.slipped || (c.dueDay ?? 0) < 0).length;
  const isSkipped = (c: Candidate) => skipped.has(c.key) || (c.notWorthIt && !restored.has(c.key));

  const nowAt = Math.ceil((now.getTime() - midnight(origin).getTime()) / 60000);
  const startOf = (time: string) => rangeOf(time)[0];
  const lengthOf = (time: string) => { const [a, z] = rangeOf(time); return z - a; };
  const span = (a: number, len: number) => `${clockOf(a)}–${clockOf(a + len)}`;
  let board: Board[] = snapshot.blocks.filter(b => b.time && b.day >= 0).map(b => ({ id: b.id, day: b.day, time: b.time }));
  const slotsOn = (day: number): [number, number][] => freeTime({ ...snapshot, blocks: board as unknown as LiveBlock[] }, origin, settings, now, HORIZON, 15)[day]?.free.map(rangeOf) ?? [];
  // Work placed here keeps a short break after it, as before.
  const occupy = (id: string | number, day: number, a: number, len: number) => { board = [...board, { id, day, time: span(a, len + BREAK) }]; };
  const without = (ids: (string | number)[]) => board.filter(x => !ids.includes(x.id));

  // Blocks already on the plan that may move aside: planned study, not
  // started, not on a class, not a scheduler sitting (the task scheduler moves
  // those), and not yet begun by the clock.
  type Info = { block: LiveBlock; prio: number; last: number; pinned: boolean };
  const info = new Map<string | number, Info>();
  for (const b of snapshot.blocks) {
    if (b.day < 0 || !b.time || b.external || !b.todoId || b.sitting || b.state !== 'Planned' || (b.actualSeconds ?? 0) > 0 || b.day * 1440 + startOf(b.time) < nowAt) continue;
    const t = snapshot.todos.find(x => x.id === b.todoId);
    const due = t ? deadlineOf(t) : undefined;
    const dueD = due ? dueDay(due, origin) : undefined;
    info.set(b.id, {
      block: b,
      prio: t ? priorityOf({ ...t, dueDate: due }, { day: b.day }) : UNDATED + b.day,
      last: Math.min(HORIZON - 1, dueD !== undefined ? Math.max(b.day, dueD) : HORIZON - 1),
      pinned: pins.has(pinKey(b.todoId, localDay(origin, b.day), b.time.split('–')[0])) && !movePinned.has(String(b.id)),
    });
  }
  const moves = new Map<string | number, CatchUpMove>();
  const record = (b: LiveBlock, to: { day: number; time: string }, why: string) => {
    const was = moves.get(b.id);
    moves.set(b.id, { key: `m:${b.id}`, blockId: b.id, title: b.title, subject: b.subject, color: b.color, from: was?.from ?? { day: b.day, time: b.time }, to, why: was?.why ?? why });
  };
  /** The next open time for a block moved aside, from `minAt` on its first day, never past its due day. */
  const relocate = (id: string | number, fromDay: number, minAt = 0): { day: number; time: string } | null => {
    const it = info.get(id)!;
    const len = lengthOf(it.block.time);
    for (let d = fromDay; d <= it.last; d++) {
      for (const [a, z] of slotsOn(d)) {
        const start = Math.max(a, d === fromDay ? minAt : a);
        if (z - start >= len) { occupy(id, d, start, len); return { day: d, time: span(start, len) }; }
      }
    }
    return null;
  };
  /**
   * Room on `day` for `length` minutes of `c`, made by moving lower-priority
   * blocks that haven't started (as few as will do, side by side). `extra`
   * lets one of the student's own blocks count, to see whether asking is worth it.
   */
  const bump = (day: number, c: Candidate, length: number, commit: boolean, extra?: string | number): { day: number; time: string } | null => {
    const lower = board.filter(x => x.day === day && info.has(x.id) && !moves.has(x.id) && info.get(x.id)!.prio > c.prio && (!info.get(x.id)!.pinned || x.id === extra))
      .sort((a, b) => startOf(a.time) - startOf(b.time));
    for (let k = 1; k <= Math.min(3, lower.length); k++) for (let i = 0; i + k <= lower.length; i++) {
      const out = lower.slice(i, i + k), saved = board;
      if (extra !== undefined && !out.some(x => x.id === extra)) continue;
      board = without(out.map(x => x.id));
      const slot = slotsOn(day).find(([a, z]) => z - a >= length);
      if (!slot) { board = saved; continue; }
      occupy(`cu:${c.key}`, day, slot[0], length);
      const spots = [...out].sort((a, b) => info.get(a.id)!.prio - info.get(b.id)!.prio).map(x => ({ x, to: relocate(x.id, day) }));
      if (!commit || spots.some(s => !s.to)) { board = saved; if (!spots.some(s => !s.to)) return { day, time: span(slot[0], length) }; continue; }
      for (const s of spots) record(info.get(s.x.id)!.block, s.to!, `Moves to make room for “${c.title}”, which goes first.`);
      return { day, time: span(slot[0], length) };
    }
    return null;
  };

  const count = Array(DAYS).fill(0);
  const planned: (CatchUpItem & { from: Candidate })[] = [], unplaced: CatchUpItem[] = [];
  const strip = ({ dueDay: _d, weight: _w, slipped: _s, prio: _p, covers: _c, ...item }: Candidate): CatchUpItem => item;
  // What fell behind goes back now; work due later only takes open time.
  const urgent = (c: Candidate) => c.slipped || (c.dueDay ?? 99) <= 1;
  for (const c of all.filter(c => !isSkipped(c))) {
    // Never after it's due; overdue or undated work goes as soon as there's room.
    const last = c.dueDay !== undefined && c.dueDay >= 0 ? Math.min(DAYS - 1, c.dueDay) : DAYS - 1;
    const fit = (length: number) => {
      for (let day = 0; day <= last; day++) {
        if (count[day] >= (day === 0 ? todayCap : PER_DAY)) continue;
        const slot = slotsOn(day).find(([a, z]) => z - a >= length);
        if (slot) { occupy(`cu:${c.key}`, day, slot[0], length); count[day]++; return { day, time: span(slot[0], length) }; }
        const made = urgent(c) ? bump(day, c, length, true) : null;
        if (made) { count[day]++; return made; }
      }
      return null;
    };
    const whole = fit(c.minutes);
    // Long work that won't fit whole gets a first hour.
    const start = !whole && c.minutes > 60 ? fit(60) : null;
    const spot = whole ?? start;
    if (!spot) { unplaced.push(strip(c)); continue; }
    planned.push({ ...strip(c), ...spot, minutes: whole ? c.minutes : 60, why: whole ? c.why : `${c.why} A first hour now; plan the rest later.`, from: c });
  }

  // Work that comes first goes before what it comes before (2026-11-20,
  // reworked 2026-11-22): a series trades slots, so a missed chapter 5 takes
  // chapter 6's slot and chapter 6 takes chapter 5's. No new times (series.ts).
  {
    const entries = board.flatMap(x => {
      const p = planned.find(q => `cu:${q.key}` === x.id);
      if (p) return [{ id: x.id, title: p.title, subjectId: p.subjectId, covers: p.from.covers, start: p.day! * 1440 + startOf(p.time!), end: p.day! * 1440 + startOf(p.time!) + p.minutes, movable: true }];
      const it = info.get(x.id);
      if (!it || it.pinned) return [];
      const s0 = x.day * 1440 + startOf(x.time);
      return [{ id: x.id, title: it.block.title, subjectId: it.block.subjectId, covers: it.block.covers?.map(c => c.id), start: s0, end: s0 + lengthOf(it.block.time), movable: true }];
    });
    const touched = new Set(planned.map(p => placeInSeries({ title: p.title, subjectId: p.subjectId, covers: p.from.covers }, items)?.key).filter((k): k is string => !!k));
    for (const sw of reorderSeries(entries, items)) {
      const e = entries.find(x => x.id === sw.id)!;
      if (!touched.has(placeInSeries(e, items)?.key ?? '')) continue;
      const day = Math.floor(sw.to[0] / 1440), time = span(sw.to[0] - day * 1440, sw.to[1] - sw.to[0]);
      const p = planned.find(q => `cu:${q.key}` === sw.id);
      if (p) { p.day = day; p.time = time; continue; }
      record(info.get(sw.id)!.block, { day, time }, 'Trades places so its series stays in order.');
      const m = moves.get(sw.id)!; m.to = { day, time };
    }
  }

  // The student's own blocks in the way of work that fell behind: ask, never move.
  const offers: CatchUpOffer[] = [];
  for (const c of all.filter(c => !isSkipped(c) && urgent(c))) {
    const p = planned.find(x => x.key === c.key);
    if (p && p.day === 0) continue;
    const length = c.minutes;
    for (const x of board.filter(x => x.day === 0 && info.get(x.id)?.pinned && info.get(x.id)!.prio > c.prio)) {
      if (offers.some(o => o.blockId === x.id)) continue;
      const it = info.get(x.id)!;
      it.pinned = false;
      const could = bump(0, c, length, false, x.id);
      it.pinned = true;
      if (could) offers.push({ blockId: x.id, title: it.block.title, time: it.block.time, forTitle: c.title });
    }
  }

  const done = planned.map(({ from: _f, ...p }) => p);
  return {
    planned: done.sort((a, b) => a.day! - b.day! || rangeOf(a.time!)[0] - rangeOf(b.time!)[0]),
    skipped: all.filter(isSkipped).map(strip),
    unplaced, behind,
    lastDay: done.reduce((n, p) => Math.max(n, p.day!), 0),
    moves: [...moves.values()].sort((a, b) => a.from.day - b.from.day || startOf(a.from.time) - startOf(b.from.time)),
    offers,
  };
}

export const catchUpDayName = (day: number, origin: Date) => capital(dayName(day, origin));

export type YesterdayRow = {
  key: string; blockId: string | number; title: string; subject: string; color: string; did: number; rest: number;
  today?: string; tomorrow?: string; time: string; day: number; base: { day: number; time: string };
};

/**
 * Yesterday's blocks with logged time that weren't checked off, and where the
 * rest of each could go: today if there's room, else tomorrow.
 */
export function buildYesterday(snapshot: Snapshot, origin: Date, settings: SomaSettings, handled: Set<string>, now = new Date()): YesterdayRow[] {
  const ahead = snapshot.blocks.filter(b => b.day >= 0 && !b.external);
  const rows = snapshot.blocks.filter((b): b is LiveBlock & { todoId: string } => b.day === -1 && !b.external && !!b.todoId && b.state !== 'Completed' && (b.actualSeconds ?? 0) >= 300)
    .filter(b => !handled.has(`y:${b.id}`) && snapshot.todos.find(t => t.id === b.todoId)?.status !== 'done')
    // Already back on the plan.
    .filter(b => !ahead.some(x => x.todoId === b.todoId || (x.subjectId === b.subjectId && norm(x.title) === norm(b.title))));
  const slots = openSlots(snapshot, origin, settings, now, 2);
  return rows.map(b => {
    const did = Math.round((b.actualSeconds ?? 0) / 60);
    const planned = b.minutes || snapshot.todos.find(t => t.id === b.todoId)?.estimatedMinutes || 60;
    const rest = planned - did >= 15 ? Math.round((planned - did) / 5) * 5 : 20;
    const today = take(slots[0], rest) ?? undefined, tomorrow = take(slots[1], rest) ?? undefined;
    return { key: `y:${b.id}`, blockId: b.id, title: b.title, subject: b.subject, color: b.color, did, rest, today, tomorrow, time: today ?? tomorrow ?? '', day: today ? 0 : 1, base: { day: b.day, time: b.time } };
  });
}
