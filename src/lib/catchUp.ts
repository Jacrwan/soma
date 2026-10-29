import type { LiveBlock, Snapshot } from '../components/DashboardV2/liveData';
import type { SomaSettings } from './storage';
import type { Todo } from '../types';
import { freeTime } from './aiPlanning';
import { clockOf, rangeOf } from './clockRange';
import { estimate, isSittingOf } from './planIt';

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
export type CatchUpPlan = { planned: CatchUpItem[]; skipped: CatchUpItem[]; unplaced: CatchUpItem[]; behind: number; lastDay: number };

export type CatchUpInput = {
  /** readPlan from 7 days back: past blocks have negative days. */
  snapshot: Snapshot; assignments: CatchUpAssignment[]; settings: SomaSettings; origin: Date; now?: Date;
  /** Keys the student skipped, and ones Soma would skip that they brought back. */
  skipped?: Set<string>; restored?: Set<string>;
  /** How many things go on today; "Move one thing to tomorrow" lowers it. */
  todayCap?: number;
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
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

type Candidate = CatchUpItem & { dueDay?: number; weight: number; slipped?: boolean };

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
    });
  }
  return out;
}

/** Overdue first, then by due day; within a day, what counts for more. Undated work goes last. */
function order(a: Candidate, b: Candidate) {
  const da = a.dueDay ?? 99, db = b.dueDay ?? 99;
  return da - db || b.weight - a.weight;
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

export function buildCatchUp(input: CatchUpInput): CatchUpPlan {
  const { snapshot, settings, origin, now = new Date(), skipped = new Set(), restored = new Set(), todayCap = PER_DAY } = input;
  const all = candidates(input).sort(order);
  // What actually fell behind: overdue, or planned and didn't happen. Work due ahead isn't.
  const behind = all.filter(c => c.slipped || (c.dueDay ?? 0) < 0).length;
  const isSkipped = (c: Candidate) => skipped.has(c.key) || (c.notWorthIt && !restored.has(c.key));
  const slots = openSlots(snapshot, origin, settings, now, DAYS);
  const count = Array(DAYS).fill(0);
  const planned: CatchUpItem[] = [], unplaced: CatchUpItem[] = [];
  const strip = ({ dueDay: _d, weight: _w, slipped: _s, ...item }: Candidate): CatchUpItem => item;
  for (const c of all.filter(c => !isSkipped(c))) {
    // Never after it's due; overdue or undated work goes as soon as there's room.
    const last = c.dueDay !== undefined && c.dueDay >= 0 ? Math.min(DAYS - 1, c.dueDay) : DAYS - 1;
    const fit = (length: number) => {
      for (let day = 0; day <= last; day++) {
        if (count[day] >= (day === 0 ? todayCap : PER_DAY)) continue;
        const time = take(slots[day], length);
        if (time) { count[day]++; return { day, time }; }
      }
      return null;
    };
    const whole = fit(c.minutes);
    // Long work that won't fit whole gets a first hour.
    const start = !whole && c.minutes > 60 ? fit(60) : null;
    const spot = whole ?? start;
    if (!spot) { unplaced.push(strip(c)); continue; }
    planned.push({ ...strip(c), ...spot, minutes: whole ? c.minutes : 60, why: whole ? c.why : `${c.why} A first hour now; plan the rest later.` });
  }
  return {
    planned: planned.sort((a, b) => a.day! - b.day! || rangeOf(a.time!)[0] - rangeOf(b.time!)[0]),
    skipped: all.filter(isSkipped).map(strip),
    unplaced, behind,
    lastDay: planned.reduce((n, p) => Math.max(n, p.day!), 0),
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
