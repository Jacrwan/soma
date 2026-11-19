// Kept free of runtime imports except clockRange so tests can load it on its own.
import { windowOf } from './clockRange';

/**
 * The task scheduler (2026-11-15). No AI.
 *
 * A task is work with a due date and a length. Soma places its sittings in
 * open study time before the due date, and places them again when something
 * changes: a sitting is missed, a calendar event lands on one, time is logged,
 * the length changes, or the task moves up the priority list.
 *
 * Rules (the owner's, 2026-11-15):
 * - Sittings move only when they have to: missed, clashing, after the finish
 *   day, or no longer needed. A sitting that is fine stays where it is.
 * - Priority is silent: one ranked list, highest first. Higher tasks get the
 *   first pick of open time.
 * - A missed sitting goes to the earliest open time (today if possible). With
 *   no gap, it takes the slot of a lower-ranked sitting nobody started, and
 *   that one moves instead.
 * - Nothing is bumped or squeezed in a way that makes another task miss its
 *   own finish day: priority decides who gets the good slots, not who is dropped.
 * - Pinned, started and done sittings, calendar events and every other block
 *   never move. Work that doesn't fit is reported as at risk, not crammed.
 * - Work starts close to when it's due, not as soon as there's time
 *   (2026-11-15, "I don't want to work on something due three weeks later
 *   right now"): see startDayOf. Earlier days are used only when the window
 *   has no room, and a sitting placed before the window has to move.
 * - Today is already planned (2026-11-15, after Lab 10 was pulled into time a
 *   moved quiz left open): Soma never puts more task time on today than today
 *   already had. Sittings can move around within today, but freed time stays
 *   free. Two exceptions: missed work (that's being behind, not ahead, and
 *   still goes ASAP) and work whose finish day is today. Getting ahead is the student's call:
 *   `ahead` names the sitting that could move into today's open time, and the
 *   dashboard asks.
 *
 * Times are absolute minutes from day 0's midnight (day * 1440 + minute).
 */

export type Window = { start: string; end: string; off?: boolean };
export type Spread = 'even' | 'early' | 'late';

/** Settings → Scheduling. Every field is optional; DEFAULT_SCHEDULE fills the rest. */
export type SchedulePrefs = {
  /** Study hours for a weekday ('0' Sunday … '6' Saturday); missing = the usual study hours. */
  days?: Partial<Record<string, Window>>;
  /** Most study minutes in a day, counting every study block. 0 = no limit. */
  maxPerDay?: number;
  /** A sitting's usual length in minutes. */
  usual?: number;
  /** The longest one sitting may run. */
  longest?: number;
  /** Minutes kept free after each sitting. */
  breakMinutes?: number;
  /** Finish this many days before the due day (0 = on the due day). */
  finishEarly?: 0 | 1 | 2;
  spread?: Spread;
  /** Imported work with a due date (Canvas, course sites) is scheduled without asking. */
  autoImported?: boolean;
};

export const DEFAULT_SCHEDULE: Required<Omit<SchedulePrefs, 'days'>> & { days: Partial<Record<string, Window>> } = {
  days: {}, maxPerDay: 0, usual: 50, longest: 120, breakMinutes: 10, finishEarly: 1, spread: 'even', autoImported: true,
};

export type ResolvedPrefs = {
  /** [open, close] in minutes from that day's midnight, or null for a day off. */
  windowFor: (weekday: number) => [number, number] | null;
  shortest: number; usual: number; longest: number; brk: number; maxPerDay: number; finishEarly: number; spread: Spread;
};

export function resolvePrefs(settings: { studyWindow: Window; chunks?: { min: number }; schedule?: SchedulePrefs }): ResolvedPrefs {
  const s = { ...DEFAULT_SCHEDULE, ...(settings.schedule ?? {}) };
  const clamp = (n: unknown, lo: number, hi: number, d: number) => typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
  const shortest = clamp(settings.chunks?.min, 15, 240, 30);
  const longest = Math.max(shortest, clamp(s.longest, 30, 240, 120));
  return {
    windowFor: weekday => {
      if (settings.studyWindow.off) return [0, 1440];
      const w = s.days?.[String(weekday)] ?? settings.studyWindow;
      if (w.off || w.start === w.end) return w.off ? null : windowOf(settings.studyWindow);
      return windowOf(w);
    },
    shortest, longest,
    usual: Math.min(longest, Math.max(shortest, clamp(s.usual, 15, 240, 50))),
    brk: clamp(s.breakMinutes, 0, 60, 10),
    maxPerDay: clamp(s.maxPerDay, 0, 1440, 0),
    finishEarly: clamp(s.finishEarly, 0, 2, 1),
    spread: s.spread === 'early' || s.spread === 'late' ? s.spread : 'even',
  };
}

export type SchedSitting = {
  id: string; start: number; end: number;
  /** The step it's for, on a task with steps. */
  stepId?: string;
  done?: boolean; pinned?: boolean;
  /** Focus ran during it. */
  started?: boolean;
};
export type SchedTask = {
  id: string;
  /** Lower is more important. */
  rank: number;
  /** Minutes the whole task takes. */
  total: number;
  /** Focus minutes already logged on it. */
  logged: number;
  /** The deadline, absolute minutes (the student's own, when set). */
  due: number;
  sittings: SchedSitting[];
  /**
   * Task details (2026-11-15). `steps`: the open steps, in order; each gets
   * one sitting of its own length, after the one before, instead of generic
   * sittings. `count`: how many sittings the work is split into. `from` /
   * `until`: the earliest start and latest end the student chose (absolute
   * minutes), replacing Soma's start window and finish day.
   */
  steps?: { id: string; minutes: number }[];
  count?: number;
  from?: number;
  until?: number;
};
export type BusyBlock = { start: number; end: number; /** Counts toward the daily study limit. */ study?: boolean };
export type ScheduleInput = {
  tasks: SchedTask[];
  busy: BusyBlock[];
  prefs: ResolvedPrefs;
  now: number;
  /** How many days from day 0 may take sittings. */
  days: number;
  /** Day 0's weekday (0 Sunday). */
  weekday0: number;
};
/** A new sitting (no id) or an existing one moved or resized (id). */
export type Placement = { taskId: string; id?: string; start: number; end: number; stepId?: string };
export type ScheduleResult = {
  place: Placement[];
  remove: { taskId: string; id: string }[];
  /** Minutes that fit nowhere before the task's finish day. */
  atRisk: { taskId: string; short: number }[];
  /** When each task has to be finished by, absolute minutes. */
  finishBy: Record<string, number>;
  /** Open study minutes left today after this schedule. */
  todayOpen: number;
  /**
   * A later sitting that could move into today's open time, for the student
   * to say yes to: the most important task's next sitting after today.
   */
  ahead?: { taskId: string; id?: string; from?: number; start: number; end: number };
};

type Seg = [number, number];
const DAY = 1440;
const ceil5 = (n: number) => Math.ceil(n / 5) * 5;
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
const dayOf = (t: number) => Math.floor(t / DAY);
/** How far back a missed sitting is still moved; older ones are left as history. */
const MISSED_LOOKBACK = 14 * DAY;

function subtract(set: Seg[], a: number, z: number): Seg[] {
  if (z <= a) return set;
  const out: Seg[] = [];
  for (const [x, y] of set) {
    if (y <= a || x >= z) { out.push([x, y]); continue; }
    if (x < a) out.push([x, a]);
    if (y > z) out.push([z, y]);
  }
  return out;
}
function union(set: Seg[], a: number, z: number): Seg[] {
  if (z <= a) return set;
  const all = [...set, [a, z] as Seg].sort((p, q) => p[0] - q[0]);
  const out: Seg[] = [];
  for (const [x, y] of all) {
    const last = out[out.length - 1];
    if (last && x <= last[1]) last[1] = Math.max(last[1], y);
    else out.push([x, y]);
  }
  return out;
}

/**
 * When the work has to be done by: the finish day's end (`finishEarly` days
 * before the due day), or the deadline itself when finishing early leaves no
 * time. Due at 12:30 AM is the night before's work, as Plan it reads it.
 */
export function finishByOf(due: number, now: number, finishEarly: number, shortest = 30): number {
  const deadline = due % DAY < 180 && due % DAY > 0 ? dayOf(due) * DAY : due;
  if (deadline <= now) return (dayOf(now) + 2) * DAY;           // overdue: as soon as possible
  if (!finishEarly) return deadline;
  const early = (dayOf(deadline - 1) - finishEarly + 1) * DAY;
  return early - now >= shortest ? early : deadline;
}

/**
 * The first day a task's sittings go on. Evenly: about two days per sitting
 * before the finish day (2 to 14 days), so a 45-minute quiz starts two days
 * out and a six-hour project two weeks out. As late as safe: one day per
 * sitting. Start early: today.
 */
export function startDayOf(remaining: number, lastT: number, now: number, prefs: Pick<ResolvedPrefs, 'usual' | 'spread'>, count?: number): number {
  const today = dayOf(now), lastDay = dayOf(lastT - 1);
  if (prefs.spread === 'early') return today;
  // Counted the way they're cut: an hour or less is one sitting (unless the student set the number).
  const sittings = count ? count : remaining <= Math.max(60, prefs.usual) ? 1 : Math.ceil(remaining / prefs.usual);
  const lead = prefs.spread === 'late' ? sittings : Math.min(14, Math.max(2, sittings * 2));
  return Math.max(today, lastDay - lead + 1);
}

type State = {
  task: SchedTask;
  order: number;
  /** Soma's finish line: a day early (Settings), or "work on it until". A guide. */
  lastT: number;
  /** The real deadline. Work that misses the guide still goes before this. */
  dueT: number;
  /** The task's window opens here (absolute minutes; never before now). */
  startT: number;
  remaining: number;
  covered: number;
  /** Future sittings that are fine where they are, and may still move for a higher task. */
  movable: SchedSitting[];
  /** Existing sittings that need a new time. `asap`: missed. `removable`: delete it if unused. */
  pool: { id: string; len: number; asap: boolean; removable: boolean; stepId?: string }[];
  days: Set<number>;
  /** Steps with a sitting kept where it is: step id → that sitting's end. */
  stepEnd: Map<string, number>;
  /** Sittings placed by this run (a set number counts them). */
  placedN: number;
};

export function schedule(input: ScheduleInput): ScheduleResult {
  const { prefs, now: rawNow, days, weekday0 } = input;
  const now = ceil5(rawNow);
  const { brk } = prefs;
  const place: Placement[] = [], remove: ScheduleResult['remove'] = [], atRisk: ScheduleResult['atRisk'] = [];
  const finishBy: Record<string, number> = {};

  // Open time: study hours from now to the horizon, less every other block.
  let free: Seg[] = [];
  for (let d = Math.max(0, dayOf(now) - 1); d < days; d++) {
    const w = prefs.windowFor(((weekday0 + d) % 7 + 7) % 7);
    if (w) free = union(free, d * DAY + w[0], d * DAY + w[1]);
  }
  free = subtract(free, -Infinity, now);
  free = subtract(free, days * DAY, Infinity);
  const used = new Map<number, number>();
  const use = (start: number, len: number) => used.set(dayOf(start), (used.get(dayOf(start)) ?? 0) + len);
  for (const b of input.busy) {
    free = subtract(free, b.start, ceil5(b.end + (b.study ? brk : 0)));
    if (b.study) use(b.start, b.end - b.start);
  }
  free = free.map(([a, z]) => [ceil5(a), z] as Seg).filter(([a, z]) => z > a);
  const reserve = (a: number, z: number) => { free = subtract(free, a, z + brk); };
  const release = (a: number, z: number) => { free = union(free, Math.max(a, now), z); };
  const isFree = (a: number, z: number) => free.some(([x, y]) => x <= a && y >= z);
  const capOk = (start: number, len: number) => !prefs.maxPerDay || (used.get(dayOf(start)) ?? 0) + len <= prefs.maxPerDay;

  const states: State[] = [...input.tasks].sort((a, b) => a.rank - b.rank).map((task, order) => {
    const doneMin = task.sittings.filter(s => s.done).reduce((n, s) => n + s.end - s.start, 0);
    const lastT = task.until !== undefined ? Math.max(task.until, Math.min(now + prefs.shortest, task.due)) : finishByOf(task.due, now, prefs.finishEarly, prefs.shortest);
    finishBy[task.id] = lastT;
    // "Work on it until" is the student's own choice and holds; only Soma's
    // finish-a-day-early guide gives way to the real deadline.
    const dueT = task.until !== undefined ? lastT : Math.max(lastT, finishByOf(task.due, now, 0, prefs.shortest));
    const remaining = task.steps ? task.steps.reduce((n, x) => n + x.minutes, 0) : Math.max(0, task.total - Math.max(task.logged, doneMin));
    const startT = task.from !== undefined ? Math.max(now, task.from) : Math.max(now, startDayOf(remaining, lastT, now, prefs, task.steps?.length || task.count) * DAY);
    return { task, order, lastT, dueT, startT, remaining, covered: 0, movable: [], pool: [], days: new Set(), stepEnd: new Map(), placedN: 0 };
  });

  // Today's task time can only shrink: what was planned on today (missed bits
  // included) is all the room today has for task sittings.
  const today = dayOf(now);
  let todayRoom = input.tasks.flatMap(t => t.sittings).filter(s => !s.done && dayOf(s.start) === today).reduce((n, s) => n + s.end - s.start, 0);
  const forcedToday = (st: State) => dayOf(st.lastT - 1) <= today;
  /** Minutes `st` may still put on day d. */
  const roomOn = (st: State, d: number) => d !== today || forcedToday(st) ? Infinity : Math.max(0, todayRoom);

  /** Sittings that stay as they are whatever the count: done, started (even if over), pinned ahead, and missed ones (re-placed whole). */
  const sittingsSettled = (st: State) => st.task.sittings.filter(s => s.done || s.started || (s.end > now && (s.pinned || s.start < now))).length + st.pool.filter(p => p.asap).length;

  /**
   * One block cut up by breaks is one sitting again (2026-11-18: Project 4 sat
   * as 3:00–3:40, 3:50–4:05 and 4:15–4:20, pieces left by earlier runs, and
   * nothing joined them). Back-to-back sittings of the same task on one day,
   * apart by no more than a break, none started (Focus), pinned, done or past, become the
   * first one, as long as it stays within the longest sitting. Not for steps
   * or a set number of sittings, where each one is the student's.
   */
  const joined = new Set<string>();
  const joinPieces = (st: State): SchedSitting[] => {
    const list = st.task.sittings.map(x => ({ ...x })).sort((a, b) => a.start - b.start);
    if (st.task.steps || st.task.count) return list;
    // A piece whose time has come but that nobody started joins too: it counts whole and moves like a plain one.
    const loose = (x: SchedSitting) => !x.done && !x.pinned && !x.started && x.end > now;
    const out: SchedSitting[] = [];
    let lastEnd = -Infinity;
    for (const s of list) {
      const prev = out[out.length - 1];
      if (prev && loose(prev) && loose(s) && dayOf(prev.start) === dayOf(s.start)
        && s.start - lastEnd <= brk + 5 && prev.end - prev.start + s.end - s.start <= prefs.longest) {
        prev.end += s.end - s.start;
        joined.add(prev.id);
        remove.push({ taskId: st.task.id, id: s.id });
      } else out.push(s);
      lastEnd = s.end;
    }
    return out;
  };

  // 1. Keep what can stay. Higher tasks claim first where two overlap.
  for (const st of states) {
    const open = st.task.steps ? new Set(st.task.steps.map(x => x.id)) : null;
    for (const s of joinPieces(st)) {
      if (s.done) continue;
      const len = s.end - s.start;
      // With steps, a sitting stands for one open step; generic ones and extras go.
      const stepOk = !open || (!!s.stepId && open.has(s.stepId) && !st.stepEnd.has(s.stepId) && !st.pool.some(p => p.stepId === s.stepId));
      if (open && !stepOk && !s.pinned && !s.started) {
        if (s.end > now) st.pool.push({ id: s.id, len, asap: false, removable: true });
        continue;
      }
      if (s.end <= now) {
        // Missed (never started): moved, unless long gone. A pin holds a time
        // until it passes unstarted, then it moves like any miss (2026-11-16).
        if (!s.started && s.start >= now - MISSED_LOOKBACK) st.pool.push({ id: s.id, len, asap: true, removable: false, ...(open && s.stepId ? { stepId: s.stepId } : {}) });
        // Worked on in its time: that step has had its sitting, even if it isn't
        // ticked yet. Without this the step looked unplaced and, needing to come
        // before the next step, read as not fitting (2026-11-17, Quiz 12).
        else if (s.started && open && stepOk && s.stepId) st.stepEnd.set(s.stepId, s.end);
        continue;
      }
      if (s.pinned || s.started) {
        // Fixed, or under way (Focus ran): it holds its time.
        reserve(Math.max(s.start, now), s.end); use(s.start, len);
        if (dayOf(s.start) === today) todayRoom -= len;
        st.covered += s.end - Math.max(s.start, now); st.days.add(dayOf(s.start));
        if (open && stepOk && s.stepId) st.stepEnd.set(s.stepId, s.end);
        continue;
      }
      if (s.start < now) {
        // Its time has come but nobody started it (2026-11-18). It counts
        // whole, as plannedOn does: counting only what's left added a new
        // sitting for the minutes that went by on every run (Project 4 became
        // 15 + 5 + 40 minutes). Something now on top of it (a block the
        // student put there) moves it like any clash; it no longer holds.
        if (isFree(now, s.end)) {
          reserve(now, s.end); use(s.start, len);
          if (dayOf(s.start) === today) todayRoom -= len;
          st.covered += len; st.days.add(dayOf(s.start));
          if (open && stepOk && s.stepId) st.stepEnd.set(s.stepId, s.end);
          if (joined.has(s.id)) place.push({ taskId: st.task.id, id: s.id, start: s.start, end: s.end });
        } else st.pool.push({ id: s.id, len, asap: false, removable: true, ...(open && s.stepId ? { stepId: s.stepId } : {}) });
        continue;
      }
      // Fine where it is: open, before the deadline, and not before the task's
      // window. The finish day is a guide for new sittings, not a reason to move one.
      if (s.end <= st.dueT && s.start >= dayOf(st.startT) * DAY && isFree(s.start, s.end)) {
        reserve(s.start, s.end); use(s.start, len);
        if (dayOf(s.start) === today) todayRoom -= len;
        st.covered += len; st.movable.push(s); st.days.add(dayOf(s.start));
        if (open && s.stepId) st.stepEnd.set(s.stepId, s.end);
        if (joined.has(s.id)) place.push({ taskId: st.task.id, id: s.id, start: s.start, end: s.end });
      } else st.pool.push({ id: s.id, len, asap: false, removable: true, ...(open && s.stepId ? { stepId: s.stepId } : {}) });
    }
    // Steps keep their order: a kept sitting that now starts before an earlier step's ends has to move.
    if (st.task.steps) {
      let lastEnd = -Infinity;
      for (const step of st.task.steps) {
        const end = st.stepEnd.get(step.id);
        if (end === undefined) continue;
        const s = st.movable.find(x => x.stepId === step.id);
        if (s && s.start < lastEnd) {
          st.movable = st.movable.filter(x => x !== s); st.covered -= s.end - s.start;
          release(s.start, s.end); use(s.start, -(s.end - s.start));
          if (dayOf(s.start) === today) todayRoom += s.end - s.start;
          st.stepEnd.delete(step.id);
          st.pool.push({ id: s.id, len: s.end - s.start, asap: false, removable: true, stepId: step.id });
          continue;
        }
        lastEnd = Math.max(lastEnd, end);
      }
      continue;   // no trimming: each step is its own length
    }
    // A set number of sittings that the ones on the plan don't match (the
    // student changed it to 2 and four stayed, 2026-11-15): the ones that can
    // move are cut again. Done, pinned, started and missed ones count as they are.
    if (st.task.count) {
      const settled = sittingsSettled(st);
      // Only too many: with too few, the fine ones stay and the missing ones
      // are added (2026-11-16: one sitting moving re-cut the other, which was fine).
      if (st.movable.length && settled + st.movable.length > st.task.count) {
        for (const s of st.movable) {
          release(s.start, s.end); use(s.start, -(s.end - s.start));
          if (dayOf(s.start) === today) todayRoom += s.end - s.start;
          st.covered -= s.end - s.start; st.days.delete(dayOf(s.start));
          st.pool.push({ id: s.id, len: s.end - s.start, asap: false, removable: true });
        }
        st.movable = [];
        continue;
      }
    }
    // More planned than the task still needs: drop or shorten the latest.
    for (const s of [...st.movable].sort((a, b) => b.start - a.start)) {
      const extra = st.covered - st.remaining;
      if (extra <= 0) break;
      const len = s.end - s.start;
      if (extra >= len) {
        st.movable = st.movable.filter(x => x !== s); st.covered -= len;
        release(s.start, s.end); use(s.start, -len);
        remove.push({ taskId: st.task.id, id: s.id });
      } else if (len - extra >= prefs.shortest && extra >= 5) {
        const end = s.start + round5(len - extra);
        release(end, s.end); use(s.start, end - s.end);
        st.covered -= s.end - end; s.end = end;
        place.push({ taskId: st.task.id, id: s.id, start: s.start, end });
        break;
      } else break;
    }
  }

  // Counted now, before missed sittings leave the pool for their new times.
  const settledOf = new Map(states.map(st => [st, sittingsSettled(st)]));
  const need = (st: State) => Math.max(0, st.remaining - st.covered);
  const freeBefore = (t: number) => free.reduce((n, [a, z]) => n + Math.max(0, Math.min(z, t) - Math.max(a, now)), 0);
  /**
   * Taking [a, z) for `st` (optionally by bumping `bumped`) leaves every
   * lower task enough open time before its own finish day.
   */
  const safe = (st: State, a: number, z: number, bumped?: { owner: State; s: SchedSitting }) => {
    // Due today: the more important task gets today's time.
    if (dayOf(st.dueT - 1) <= today) return true;
    for (const low of states) {
      if (low.order <= st.order) continue;
      const bumpedLen = bumped?.owner === low ? bumped.s.end - bumped.s.start : 0;
      const n = need(low) + bumpedLen;
      if (!n) continue;
      // Judged against its real deadline: finishing a day early is only a guide (2026-11-16).
      const regained = bumped && bumped.s.start < low.dueT ? Math.min(bumped.s.end, low.dueT) - bumped.s.start : 0;
      const taken = Math.max(0, Math.min(z + brk, low.dueT) - a);
      if (freeBefore(low.dueT) + regained - taken < n) return false;
    }
    return true;
  };
  const commit = (st: State, start: number, end: number, asap: boolean, stepId?: string) => {
    reserve(start, end); use(start, end - start);
    if (dayOf(start) === today) todayRoom -= end - start;
    st.covered += end - start; st.days.add(dayOf(start)); st.placedN++;
    const same = stepId ? st.pool.findIndex(p => p.stepId === stepId) : -1;
    const at = same >= 0 ? same : st.pool.findIndex(p => p.asap === asap && (!stepId || !p.stepId));
    const reuse = at >= 0 ? at : st.pool.findIndex(p => !stepId || !p.stepId);
    const id = reuse >= 0 ? st.pool.splice(reuse, 1)[0].id : undefined;
    if (stepId) st.stepEnd.set(stepId, end);
    place.push({ taskId: st.task.id, ...(id ? { id } : {}), start, end, ...(stepId ? { stepId } : {}) });
  };
  /** Open stretches starting on day d (not before now, ending by `lastT`). */
  const segsOn = (d: number, lastT: number): Seg[] => free
    .map(([a, z]) => [Math.max(a, now), Math.min(z, lastT)] as Seg)
    .filter(([a, z]) => z > a && dayOf(a) === d);
  const bumpable = (st: State) => states.filter(o => o.order > st.order)
    .flatMap(owner => owner.movable.map(s => ({ owner, s })))
    .filter(({ s }) => s.start >= now && s.end <= st.lastT)
    .sort((p, q) => p.s.start - q.s.start);
  const bump = (owner: State, s: SchedSitting) => {
    owner.movable = owner.movable.filter(x => x !== s);
    owner.covered -= s.end - s.start;
    use(s.start, -(s.end - s.start));
    if (dayOf(s.start) === today) todayRoom += s.end - s.start;
    release(s.start, s.end + brk);
    owner.pool.push({ id: s.id, len: s.end - s.start, asap: false, removable: true });
  };
  /** The open stretch containing t, after a release. */
  const segAt = (t: number) => free.find(([a, z]) => a <= t && z > t);

  /**
   * A task with steps: each open step without a sitting gets one, of the
   * step's own length, after the step before it ends. Missed ones go to the
   * earliest open time; the rest spread over the window like any task.
   */
  function placeSteps(st: State) {
    // A step that finds no room after the one before it: the task's movable
    // step sittings are placed again, in order, so a kept early step doesn't
    // block the rest (2026-11-16: Quiz 12's first step kept 3–4 PM, its
    // second had nowhere before 4 PM, and 1–2 PM was open).
    const saved = { free, used: new Map(used), todayRoom, place: place.length, covered: st.covered, days: new Set(st.days), stepEnd: new Map(st.stepEnd), pool: [...st.pool], movable: [...st.movable], placedN: st.placedN };
    let short = trySteps(st);
    const movableSteps = st.movable.filter(s => s.stepId);
    if (short >= 5 && movableSteps.length) {
      free = saved.free; used.clear(); saved.used.forEach((v, k) => used.set(k, v)); todayRoom = saved.todayRoom; place.length = saved.place;
      Object.assign(st, { covered: saved.covered, days: saved.days, stepEnd: saved.stepEnd, pool: saved.pool, movable: saved.movable, placedN: saved.placedN });
      for (const s of st.movable.filter(x => x.stepId)) {
        const len = s.end - s.start;
        release(s.start, s.end + brk); use(s.start, -len);
        if (dayOf(s.start) === today) todayRoom += len;
        st.covered -= len; st.stepEnd.delete(s.stepId!);
        st.pool.push({ id: s.id, len, asap: false, removable: true, stepId: s.stepId });
      }
      st.movable = st.movable.filter(x => !x.stepId);
      short = trySteps(st);
    }
    if (short >= 5) atRisk.push({ taskId: st.task.id, short });
  }
  /** Each open step without a sitting gets one, in order; returns the minutes that found no room. */
  function trySteps(st: State): number {
    const steps = st.task.steps!, lastT = st.lastT;
    const firstDay = dayOf(now), lastDay = dayOf(lastT - 1);
    const startDay = Math.max(firstDay, dayOf(st.startT));
    const span = Math.max(0, lastDay - startDay);
    let after = st.startT;
    let short = 0;
    steps.forEach((step, i) => {
      const kept = st.stepEnd.get(step.id);
      if (kept !== undefined) { after = Math.max(after, kept); return; }
      const len = step.minutes;
      const ok = (a: number) => capOk(a, len) && len <= roomOn(st, dayOf(a)) && safe(st, a, a + len);
      const slotOn = (d: number) => segsOn(d, lastT).map(([a, z]) => [Math.max(a, after), z] as Seg).find(([a, z]) => z - a >= len && ok(a));
      const asap = st.pool.some(p => p.asap && p.stepId === step.id);
      let at: number | undefined;
      if (asap) at = free.map(([a, z]) => [Math.max(a, after, now), Math.min(z, lastT)] as Seg).find(([a, z]) => z - a >= len && ok(a))?.[0];
      else {
        const want = Math.max(dayOf(after), startDay + (steps.length === 1 ? 0 : Math.round(i * span / (steps.length - 1))));
        const window = Array.from({ length: span + 1 }, (_, k) => startDay + k).filter(d => d >= dayOf(after));
        const order = prefs.spread === 'late' ? [...window].reverse()
          : prefs.spread === 'early' ? window
          : [...window.filter(d => d >= want), ...window.filter(d => d < want).reverse()];
        const early = st.task.from !== undefined ? [] : Array.from({ length: Math.max(0, startDay - Math.max(firstDay, dayOf(after))) }, (_, k) => startDay - 1 - k);
        const ranked = [...order.filter(d => !st.days.has(d)), ...order.filter(d => st.days.has(d)), ...early];
        for (const d of ranked) { const seg = slotOn(d); if (seg) { at = seg[0]; break; } }
      }
      if (at === undefined) { short += len; return; }
      commit(st, at, at + len, asap, step.id);
      after = at + len;
    });
    return short;
  }

  // 2. Place what each task still needs, most important first. Against
  // Soma's finish day first; what doesn't fit by then still goes before the
  // real deadline, and only what misses that is at risk (2026-11-16: "finish
  // a day early" is a guide, and a task showed as not fitting when it did).
  for (const st of states) {
    const before = atRisk.length;
    placeRest(st);
    const mine = atRisk.findIndex((r, k) => k >= before && r.taskId === st.task.id);
    if (mine < 0 || st.dueT <= st.lastT) continue;
    atRisk.splice(mine, 1);
    st.lastT = st.dueT;
    placeRest(st);
  }

  function placeRest(st: State) {
    const { lastT } = st;
    const lastDay = dayOf(lastT - 1), firstDay = dayOf(now);
    if (st.task.steps) { placeSteps(st); return; }
    let short = need(st);
    if (!short) return;

    // Missed work: the earliest time there is, taking a lower task's slot if that comes first.
    const missedMin = st.pool.filter(p => p.asap).reduce((n, p) => n + p.len, 0);
    // A rest too small to be a sitting of its own goes with the missed one
    // (2026-11-18: a 15 and a 5 minute piece came back as two sittings).
    let asapLeft = missedMin && short - missedMin < prefs.shortest ? short : Math.min(short, missedMin);
    while (asapLeft > 0) {
      const piece = Math.min(asapLeft, prefs.longest);
      const want = Math.min(piece, prefs.shortest);
      const from = Math.max(now, st.startT);
      const open = free.map(([a, z]) => [Math.max(a, from), Math.min(z, lastT)] as Seg)
        .find(([a, z]) => z - a >= want && capOk(a, Math.min(piece, z - a)) && safe(st, a, a + Math.min(piece, z - a)));
      const swap = bumpable(st).filter(({ s }) => s.start >= from).find(({ owner, s }) => capOk(s.start, Math.min(piece, s.end - s.start)) && safe(st, s.start, s.start + Math.min(piece, s.end - s.start), { owner, s }));
      if (!open && !swap) break;
      if (open && (!swap || open[0] <= swap.s.start)) {
        const len = Math.min(piece, open[1] - open[0]);
        commit(st, open[0], open[0] + len, true);
        asapLeft -= len; short -= len;
      } else if (swap) {
        bump(swap.owner, swap.s);
        const seg = segAt(swap.s.start);
        const len = Math.min(piece, (seg ? Math.min(seg[1], lastT) : swap.s.end) - swap.s.start);
        if (len < 5) break;
        commit(st, swap.s.start, swap.s.start + len, true);
        asapLeft -= len; short -= len;
      }
    }
    // Every missed minute that was owed has a new time: missed sittings left
    // over had theirs taken into another, and come off rather than stay behind
    // as a missed 5 minutes.
    if (missedMin && asapLeft <= 0) for (const p of st.pool) if (p.asap) p.removable = true;
    if (!short) return;

    // The rest: spread over the days up to the finish day, one sitting a day where there's room.
    const pieces: number[] = [];
    // The student's number of sittings, less the ones that already stay.
    const slots = st.task.count ? st.task.count - (settledOf.get(st) ?? 0) - st.movable.length - st.placedN : null;
    // Every sitting the student asked for is already on the plan: what's still owed is reported, not added as another.
    if (slots !== null && slots <= 0) { if (short >= 5) atRisk.push({ taskId: st.task.id, short }); return; }
    const setCount = slots ?? 0;
    if (!setCount && short <= Math.max(60, prefs.usual) && short <= prefs.longest) pieces.push(short);
    else {
      const n = setCount || Math.ceil(short / prefs.usual), size = round5(short / n);
      for (let i = 0; i < n; i++) pieces.push(i === n - 1 ? short - size * (n - 1) : size);
      if (pieces[n - 1] <= 0) { pieces.pop(); pieces[pieces.length - 1] += short - pieces.reduce((a, b) => a + b, 0); }
    }
    // The window first; days before it (closest first) only when the window is full.
    const startDay = Math.max(firstDay, dayOf(st.startT));
    // A start day the student chose is a hard limit: no days before it.
    const before = st.task.from !== undefined ? [] : Array.from({ length: startDay - firstDay }, (_, k) => startDay - 1 - k);
    const span = Math.max(0, lastDay - startDay);
    const dayOrder = (i: number, n: number): number[] => {
      const all = Array.from({ length: span + 1 }, (_, k) => startDay + k);
      if (prefs.spread === 'early') return [...all, ...before];
      if (prefs.spread === 'late') return [...all].reverse().concat(before);
      const want = startDay + (n === 1 ? 0 : Math.round(i * span / (n - 1)));
      return [...all.filter(d => d >= want), ...all.filter(d => d < want).reverse(), ...before];
    };
    const leftovers: number[] = [];
    pieces.forEach((size, i) => {
      const order = dayOrder(i, pieces.length);
      // Days in the window without a sitting yet, then window days with one; earlier days only after both.
      const inWindow = order.filter(d => d >= startDay), early = order.filter(d => d < startDay);
      const ranked = [...inWindow.filter(d => !st.days.has(d)), ...inWindow.filter(d => st.days.has(d)), ...early.filter(d => !st.days.has(d)), ...early.filter(d => st.days.has(d))];
      const fit = (d: number, oneADay: boolean) => {
        if (oneADay && st.days.has(d)) return null;
        if (!capOk(d * DAY, size) || size > roomOn(st, d)) return null;
        // On the window's first day, not before it opens: a block moved off a
        // calendar event starts where it was, not earlier that day (2026-11-19).
        // For tasks the window opens at the day's start or now, so no change.
        const seg = segsOn(d, lastT).map(([a, z]) => [d === dayOf(st.startT) ? Math.max(a, st.startT) : a, z] as Seg)
          .find(([a, z]) => z - a >= size && safe(st, a, a + size));
        return seg ? seg[0] : null;
      };
      // The whole window (one a day, then doubling up) before any earlier day.
      for (const group of [ranked.filter(d => d >= startDay), ranked.filter(d => d < startDay)]) {
        for (const oneADay of [true, false]) {
          for (const d of group) {
            const at = fit(d, oneADay);
            if (at !== null) { commit(st, at, at + size, false); return; }
          }
        }
      }
      leftovers.push(size);
    });
    short = leftovers.reduce((a, b) => a + b, 0);

    // A number of sittings the student set is a limit, not a first cut (4h in
    // 2 sittings became 2h + 75 min + 45 min on a crowded day, 2026-11-15):
    // the sittings still owed take the largest open stretches, one each, and
    // what doesn't fit in that many is reported, not split further.
    let picks = setCount ? leftovers.length : Infinity;
    const cap = setCount ? Infinity : prefs.longest;
    if (setCount) {
      const windowDays = new Set(Array.from({ length: span + 1 }, (_, k) => startDay + k));
      while (picks > 0 && short > 0) {
        const options = [...windowDays, ...before].flatMap(d => segsOn(d, lastT).map(([a, z]) => {
          const room = prefs.maxPerDay ? prefs.maxPerDay - (used.get(d) ?? 0) : Infinity;
          return { a, len: Math.min(short, z - a, room, roomOn(st, d)), early: !windowDays.has(d) };
        })).filter(o => o.len >= Math.min(short, prefs.shortest) && o.len >= 5 && safe(st, o.a, o.a + o.len))
          // The window before earlier days; then the longest; then the earliest.
          .sort((x, y) => Number(x.early) - Number(y.early) || y.len - x.len || x.a - y.a);
        if (!options.length) break;
        const len = Math.floor(options[0].len / 5) * 5 || options[0].len;
        commit(st, options[0].a, options[0].a + len, false); short -= len; picks--;
      }
    }

    // Tight: whatever open time is left, in pieces from the shortest to the longest allowed.
    for (const d of setCount ? [] : [...Array.from({ length: span + 1 }, (_, k) => startDay + k), ...before]) {
      if (short <= 0) break;
      for (const [a, z] of segsOn(d, lastT)) {
        if (short <= 0) break;
        const room = prefs.maxPerDay ? prefs.maxPerDay - (used.get(d) ?? 0) : Infinity;
        const len = Math.min(short, prefs.longest, z - a, room, roomOn(st, d));
        if (len < Math.min(short, prefs.shortest) || len < 5 || !safe(st, a, a + len)) continue;
        commit(st, a, a + len, false); short -= len;
      }
    }

    // Still short: a lower task's slot, if that task still fits before its own finish day.
    const swaps = bumpable(st);
    for (const { owner, s } of [...swaps.filter(x => x.s.start >= st.startT), ...(st.task.from !== undefined ? [] : swaps.filter(x => x.s.start < st.startT).reverse())]) {
      if (short <= 0 || picks <= 0) break;
      const len0 = Math.min(short, cap, s.end - s.start, dayOf(s.start) === today ? roomOn(st, today) + (s.end - s.start) : Infinity);
      if (len0 < Math.min(short, prefs.shortest) || !capOk(s.start, 0) || !safe(st, s.start, s.start + len0, { owner, s })) continue;
      bump(owner, s);
      const seg = segAt(s.start);
      const len = Math.min(short, cap, (seg ? Math.min(seg[1], lastT) : s.end) - s.start, roomOn(st, dayOf(s.start)));
      commit(st, s.start, s.start + len, false); short -= len; picks--;
    }

    if (short >= 5) atRisk.push({ taskId: st.task.id, short });
  }

  // Sittings that lost their time and found no new one.
  for (const st of states) for (const p of st.pool) if (p.removable) remove.push({ taskId: st.task.id, id: p.id });

  // A move back to the same time is no move.
  const original = new Map(input.tasks.flatMap(t => t.sittings.map(s => [s.id, s] as const)));
  // A sitting placed twice in one run (joined, then moved or trimmed) keeps its last time.
  const last = new Map(place.map((p, i) => [p.id ?? i, i] as const));
  const placed = place.filter((p, i) => last.get(p.id ?? i) === i)
    .filter(p => { const o = p.id ? original.get(p.id) : undefined; return !o || o.start !== p.start || o.end !== p.end; });
  // Today's open time, and the sitting that could fill it if the student wants.
  const todayOpen = segsOnDay(free, today, now).reduce((n, [a, z]) => n + z - a, 0);
  let ahead: ScheduleResult['ahead'];
  const moved = new Map(place.filter(p => p.id).map(p => [p.id!, p]));
  // A task that doesn't fit comes first: today's open time is where it could go.
  for (const r of atRisk) {
    const len = Math.min(r.short, prefs.longest);
    const slot = segsOnDay(free, today, now).find(([a, z]) => z - a >= Math.min(len, prefs.shortest) && capOk(a, Math.min(len, z - a)));
    if (slot) { ahead = { taskId: r.taskId, start: slot[0], end: slot[0] + Math.min(len, slot[1] - slot[0]) }; break; }
  }
  for (const st of ahead ? [] : states) {
    const later = st.task.sittings
      .filter(s => !s.done && !s.pinned && !s.started && !remove.some(r => r.id === s.id))
      .map(s => ({ id: s.id, ...(moved.get(s.id) ?? s) }))
      .filter(s => dayOf(s.start) > today)
      .sort((a, b) => a.start - b.start)[0];
    if (!later) continue;
    const len = later.end - later.start;
    const slot = segsOnDay(free, today, now).find(([a, z]) => z - a >= len && capOk(a, len));
    if (slot) { ahead = { taskId: st.task.id, id: later.id, from: later.start, start: slot[0], end: slot[0] + len }; break; }
  }
  return { place: placed, remove, atRisk, finishBy, todayOpen, ...(ahead ? { ahead } : {}) };
}

const segsOnDay = (free: Seg[], d: number, now: number): Seg[] => free
  .map(([a, z]) => [Math.max(a, now, d * DAY), Math.min(z, (d + 1) * DAY)] as Seg)
  .filter(([a, z]) => z > a);

// ── Priority ──────────────────────────────────────────────────────────────

const KIND_LEAD: Record<string, number> = { exam: 5, project: 3, essay: 3, quiz: 1, homework: 0, lab: 0, reading: -1, discussion: -1 };
const TITLE_KINDS: [string, RegExp][] = [
  ['exam', /\b(exam|examen|midterm|final|test)\b/i], ['quiz', /\bquiz/i], ['lab', /\blab\b/i],
  ['project', /\bproject\b/i], ['essay', /\b(essay|paper|draft)\b/i],
  ['homework', /\b(homework|hw|problem set|pset|worksheet)\b/i], ['reading', /\b(reading|chapter|ch\.)/i],
];
/** "2026-11-20" is that day's end; a moment is itself. */
export const dueMoment = (due: string) => due.length <= 10 ? new Date(`${due}T23:59:00`) : new Date(due);

/**
 * Soma's guess at a task's place, until the student drags it: its due date in
 * days, pulled earlier for bigger kinds of work (an exam counts as due 5 days
 * sooner, a project 3, a reading a day later). Lower comes first.
 */
export function guessRank(t: { dueDate?: string; kind?: string; text: string }): number {
  const kind = t.kind && t.kind !== 'other' ? t.kind : TITLE_KINDS.find(([, re]) => re.test(t.text))?.[0];
  const days = t.dueDate ? dueMoment(t.dueDate).getTime() / 86_400_000 : 1e6;
  return Math.round((days - (KIND_LEAD[kind ?? ''] ?? 0)) * 1000) / 1000;
}
export const effectiveRank = (t: { rank?: number; dueDate?: string; kind?: string; text: string }) => t.rank ?? guessRank(t);
/** The rank that puts a task between two others in the list (either may be missing at the ends). */
export function rankBetween(above?: number, below?: number): number {
  if (above !== undefined && below !== undefined) return (above + below) / 2;
  if (above !== undefined) return above + 1;
  if (below !== undefined) return below - 1;
  return 0;
}

/**
 * Whether Soma schedules a task's sittings: it's open, has a due date, and
 * either the student asked (Schedule it, or added it on Tasks) or it's
 * imported work still ahead and the setting is on.
 */
export function isManaged(t: { status: string; dueDate?: string; kind?: string; autoSchedule?: boolean }, autoImported: boolean, today: string): boolean {
  if (t.status === 'done' || !t.dueDate) return false;
  if (t.autoSchedule !== undefined) return t.autoSchedule;
  return autoImported && !!t.kind && t.dueDate.slice(0, 10) >= today;
}

// ── What's already planned (used by the runner, lib/taskSchedule.ts) ──

/** As taskScheduler's MISSED_LOOKBACK: older misses are left as history. */
const MISSED_LOOKBACK_MS = 14 * 86_400_000;
export const plannedOn = (sittings: { start: Date; end: Date; done: boolean; started: boolean }[], logged: number, now = Date.now()) => {
  const minutes = (list: typeof sittings) => list.reduce((n, s) => n + Math.round((+s.end - +s.start) / 60000), 0);
  // A sitting that passed without being started is still owed: it counts
  // until the scheduler places it again (2026-11-15: left out, a task with no
  // length set could decide nothing was owed and leave the miss in the past).
  const owed = sittings.filter(s => !s.done && !s.started && (+s.end > now || +s.start >= now - MISSED_LOOKBACK_MS));
  return Math.max(logged, minutes(sittings.filter(s => s.done))) + minutes(owed);
};
