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
  /** The deadline, absolute minutes. */
  due: number;
  sittings: SchedSitting[];
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
export type Placement = { taskId: string; id?: string; start: number; end: number };
export type ScheduleResult = {
  place: Placement[];
  remove: { taskId: string; id: string }[];
  /** Minutes that fit nowhere before the task's finish day. */
  atRisk: { taskId: string; short: number }[];
  /** When each task has to be finished by, absolute minutes. */
  finishBy: Record<string, number>;
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

type State = {
  task: SchedTask;
  order: number;
  lastT: number;
  remaining: number;
  covered: number;
  /** Future sittings that are fine where they are, and may still move for a higher task. */
  movable: SchedSitting[];
  /** Existing sittings that need a new time. `asap`: missed. `removable`: delete it if unused. */
  pool: { id: string; len: number; asap: boolean; removable: boolean }[];
  days: Set<number>;
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
    const lastT = finishByOf(task.due, now, prefs.finishEarly, prefs.shortest);
    finishBy[task.id] = lastT;
    return { task, order, lastT, remaining: Math.max(0, task.total - Math.max(task.logged, doneMin)), covered: 0, movable: [], pool: [], days: new Set() };
  });

  // 1. Keep what can stay. Higher tasks claim first where two overlap.
  for (const st of states) {
    for (const s of st.task.sittings.map(x => ({ ...x })).sort((a, b) => a.start - b.start)) {
      if (s.done) continue;
      const len = s.end - s.start;
      if (s.end <= now) {
        // Missed (never started): moved, unless pinned or long gone.
        if (!s.started && !s.pinned && s.start >= now - MISSED_LOOKBACK) st.pool.push({ id: s.id, len, asap: true, removable: false });
        continue;
      }
      if (s.pinned || s.started || s.start < now) {
        // Fixed, or already under way: it holds its time.
        reserve(Math.max(s.start, now), s.end); use(s.start, len);
        st.covered += s.end - Math.max(s.start, now); st.days.add(dayOf(s.start));
        continue;
      }
      if (s.end <= st.lastT && isFree(s.start, s.end)) {
        reserve(s.start, s.end); use(s.start, len);
        st.covered += len; st.movable.push(s); st.days.add(dayOf(s.start));
      } else st.pool.push({ id: s.id, len, asap: false, removable: true });
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

  const need = (st: State) => Math.max(0, st.remaining - st.covered);
  const freeBefore = (t: number) => free.reduce((n, [a, z]) => n + Math.max(0, Math.min(z, t) - Math.max(a, now)), 0);
  /**
   * Taking [a, z) for `st` (optionally by bumping `bumped`) leaves every
   * lower task enough open time before its own finish day.
   */
  const safe = (st: State, a: number, z: number, bumped?: { owner: State; s: SchedSitting }) => {
    for (const low of states) {
      if (low.order <= st.order) continue;
      const bumpedLen = bumped?.owner === low ? bumped.s.end - bumped.s.start : 0;
      const n = need(low) + bumpedLen;
      if (!n) continue;
      const regained = bumped && bumped.s.start < low.lastT ? Math.min(bumped.s.end, low.lastT) - bumped.s.start : 0;
      const taken = Math.max(0, Math.min(z + brk, low.lastT) - a);
      if (freeBefore(low.lastT) + regained - taken < n) return false;
    }
    return true;
  };
  const commit = (st: State, start: number, end: number, asap: boolean) => {
    reserve(start, end); use(start, end - start);
    st.covered += end - start; st.days.add(dayOf(start));
    const at = st.pool.findIndex(p => p.asap === asap);
    const reuse = at >= 0 ? at : st.pool.findIndex(() => true);
    const id = reuse >= 0 ? st.pool.splice(reuse, 1)[0].id : undefined;
    place.push({ taskId: st.task.id, ...(id ? { id } : {}), start, end });
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
    release(s.start, s.end + brk);
    owner.pool.push({ id: s.id, len: s.end - s.start, asap: false, removable: true });
  };
  /** The open stretch containing t, after a release. */
  const segAt = (t: number) => free.find(([a, z]) => a <= t && z > t);

  // 2. Place what each task still needs, most important first.
  for (const st of states) {
    let short = need(st);
    if (!short) continue;
    const { lastT } = st;
    const lastDay = dayOf(lastT - 1), firstDay = dayOf(now);

    // Missed work: the earliest time there is, taking a lower task's slot if that comes first.
    let asapLeft = Math.min(short, st.pool.filter(p => p.asap).reduce((n, p) => n + p.len, 0));
    while (asapLeft > 0) {
      const piece = Math.min(asapLeft, prefs.longest);
      const want = Math.min(piece, prefs.shortest);
      const open = free.map(([a, z]) => [Math.max(a, now), Math.min(z, lastT)] as Seg)
        .find(([a, z]) => z - a >= want && capOk(a, Math.min(piece, z - a)) && safe(st, a, a + Math.min(piece, z - a)));
      const swap = bumpable(st).find(({ owner, s }) => capOk(s.start, Math.min(piece, s.end - s.start)) && safe(st, s.start, s.start + Math.min(piece, s.end - s.start), { owner, s }));
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
    if (!short) continue;

    // The rest: spread over the days up to the finish day, one sitting a day where there's room.
    const pieces: number[] = [];
    if (short <= Math.max(60, prefs.usual) && short <= prefs.longest) pieces.push(short);
    else {
      const n = Math.ceil(short / prefs.usual), size = round5(short / n);
      for (let i = 0; i < n; i++) pieces.push(i === n - 1 ? short - size * (n - 1) : size);
      if (pieces[n - 1] <= 0) { pieces.pop(); pieces[pieces.length - 1] += short - pieces.reduce((a, b) => a + b, 0); }
    }
    const span = Math.max(0, lastDay - firstDay);
    const dayOrder = (i: number, n: number): number[] => {
      const all = Array.from({ length: span + 1 }, (_, k) => firstDay + k);
      if (prefs.spread === 'early') return all;
      if (prefs.spread === 'late') return [...all].reverse();
      const want = firstDay + (n === 1 ? 0 : Math.round(i * span / (n - 1)));
      return [...all.filter(d => d >= want), ...all.filter(d => d < want).reverse()];
    };
    const leftovers: number[] = [];
    pieces.forEach((size, i) => {
      const order = dayOrder(i, pieces.length);
      const ranked = [...order.filter(d => !st.days.has(d)), ...order.filter(d => st.days.has(d))];
      const fit = (d: number, oneADay: boolean) => {
        if (oneADay && st.days.has(d)) return null;
        if (!capOk(d * DAY, size)) return null;
        const seg = segsOn(d, lastT).find(([a, z]) => z - a >= size && safe(st, a, a + size));
        return seg ? seg[0] : null;
      };
      for (const oneADay of [true, false]) {
        for (const d of ranked) {
          const at = fit(d, oneADay);
          if (at !== null) { commit(st, at, at + size, false); return; }
        }
      }
      leftovers.push(size);
    });
    short = leftovers.reduce((a, b) => a + b, 0);

    // Tight: whatever open time is left, in pieces from the shortest to the longest allowed.
    for (let d = firstDay; short > 0 && d <= lastDay; d++) {
      for (const [a, z] of segsOn(d, lastT)) {
        if (short <= 0) break;
        const room = prefs.maxPerDay ? prefs.maxPerDay - (used.get(d) ?? 0) : Infinity;
        const len = Math.min(short, prefs.longest, z - a, room);
        if (len < Math.min(short, prefs.shortest) || len < 5 || !safe(st, a, a + len)) continue;
        commit(st, a, a + len, false); short -= len;
      }
    }

    // Still short: a lower task's slot, if that task still fits before its own finish day.
    for (const { owner, s } of bumpable(st)) {
      if (short <= 0) break;
      const len0 = Math.min(short, prefs.longest, s.end - s.start);
      if (!capOk(s.start, 0) || !safe(st, s.start, s.start + len0, { owner, s })) continue;
      bump(owner, s);
      const seg = segAt(s.start);
      const len = Math.min(short, prefs.longest, (seg ? Math.min(seg[1], lastT) : s.end) - s.start);
      commit(st, s.start, s.start + len, false); short -= len;
    }

    if (short >= 5) atRisk.push({ taskId: st.task.id, short });
  }

  // Sittings that lost their time and found no new one.
  for (const st of states) for (const p of st.pool) if (p.removable) remove.push({ taskId: st.task.id, id: p.id });

  // A move back to the same time is no move.
  const original = new Map(input.tasks.flatMap(t => t.sittings.map(s => [s.id, s] as const)));
  const placed = place.filter(p => { const o = p.id ? original.get(p.id) : undefined; return !o || o.start !== p.start || o.end !== p.end; });
  return { place: placed, remove, atRisk, finishBy };
}

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
