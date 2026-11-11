import { kindOf } from './planIt';
import { mondayOf, rowForWeek, sectionsIn, type Guide, type GuideRow } from './weekGuide';

/**
 * Routines Soma learns from what the student actually did. No model.
 *
 * The owner does Math 53 homework on Tuesday nights and Wednesday mornings,
 * before discussion, and it's always the previous week's set. They had said
 * so many times, and their checked-off blocks showed it week after week, yet
 * Soma still asked which homework and when (2026-11-10). This reads the last
 * eight weeks of Focus sessions and checked-off blocks for patterns, so a
 * reply can say "Tuesday night, like usual: 15.6–15.9".
 */

export type Routine = {
  subjectId: string;
  kind: string;
  /** "Tue around 21:30", in week order. */
  slots: string[];
  /** Weeks with this work in the window, and weeks the most regular day held. */
  weeks: number;
  held: number;
  /** Weeks between the lectures and doing the work: 1 = the previous week's set. */
  lag?: number;
  /** The set that routine points to this week, from the course's guide. */
  next?: GuideRow;
  guide?: string;
};

type Done = { subjectId: string; title: string; at: Date };

const WEEKS = 8;
const MIN_WEEKS = 3;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MS = 86_400_000;

/**
 * The weekday work belongs to, and its start in minutes. Work after midnight,
 * before 4 AM, belongs to the night before (so 2:50 AM counts as 26:50).
 * Weekdays, not parts of the day: the owner's Wednesday sessions start 11:30
 * to 12:40, and a noon cut-off split that habit in two.
 */
function dayOf(at: Date): { day: number; minute: number } {
  const d = new Date(at);
  const late = d.getHours() < 4;
  if (late) d.setDate(d.getDate() - 1);
  return { day: (d.getDay() + 6) % 7, minute: at.getHours() * 60 + at.getMinutes() + (late ? 24 * 60 : 0) };
}

/** "Tue around 19:30": the middle start time, to the half hour, 24-hour like the rest of CONTEXT. */
function slotLabel(day: number, minutes: number[]): string {
  const sorted = [...minutes].sort((a, b) => a - b);
  const mid = Math.round(sorted[Math.floor((sorted.length - 1) / 2)] / 30) * 30 % (24 * 60);
  return `${DAYS[day]} around ${String(Math.floor(mid / 60)).padStart(2, '0')}:${String(mid % 60).padStart(2, '0')}`;
}

const weekKey = (at: Date) => {
  const d = new Date(at);
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  return mondayOf(d).getTime();
};

export type RoutineInput = {
  /** Focus sessions: timer_sessions. Times are UTC strings, maybe without a zone. */
  history: { subject_id: string; task_text: string; start_time?: string; duration_seconds: number }[];
  /** Tasks and their planned sessions: a checked-off block counts as done then. */
  todos: { id: string; text: string; subjectId?: string; status: string; date?: string }[];
  sessions: { todoId: string; startTime?: string }[];
};

const asUtc = (s: string) => new Date(/Z$|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);

/** What was done, when: Focus of 10 minutes or more, and checked-off blocks at their planned time. */
export function doneWork(input: RoutineInput): Done[] {
  const out: Done[] = [];
  for (const h of input.history) {
    if (!h.start_time || !h.subject_id || (h.duration_seconds || 0) < 600) continue;
    const at = asUtc(h.start_time);
    if (!Number.isNaN(+at)) out.push({ subjectId: h.subject_id, title: h.task_text ?? '', at });
  }
  const byTodo = new Map(input.todos.map(t => [t.id, t]));
  for (const s of input.sessions) {
    const t = byTodo.get(s.todoId);
    if (!t || t.status !== 'done' || !t.subjectId || !s.startTime) continue;
    const at = new Date(s.startTime);
    if (!Number.isNaN(+at)) out.push({ subjectId: t.subjectId, title: t.text, at });
  }
  return out;
}

/** The week gap between a guide row's lectures and when its work was done, if the title names its sections. */
function lagOf(guide: Guide, title: string, at: Date): number | undefined {
  // The last section named, in the latest row that lists it before the work:
  // a section can run over two weeks' rows ("14.5" on Oct 6 and Oct 13).
  const last = sectionsIn(title).pop();
  const row = last ? guide.rows.filter(r => r.sections.includes(last) && r.dates[0] <= at).pop() : undefined;
  if (!row) return undefined;
  return Math.round((weekKey(at) - mondayOf(row.dates[0]).getTime()) / (7 * DAY_MS));
}

export function findRoutines(input: RoutineInput, guides: Guide[], now = new Date()): Routine[] {
  const since = mondayOf(now).getTime() - WEEKS * 7 * DAY_MS;
  const work = doneWork(input).filter(w => +w.at >= since && +w.at <= +now);
  const groups = new Map<string, Done[]>();
  for (const w of work) {
    const kind = kindOf(w.title);
    if (!kind || kind === 'exam' || kind === 'quiz') continue;
    const key = `${w.subjectId}|${kind}`;
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  const out: Routine[] = [];
  for (const [key, list] of groups) {
    const [subjectId, kind] = key.split('|');
    const weeks = new Set(list.map(w => weekKey(w.at))).size;
    if (weeks < MIN_WEEKS) continue;
    const byDay = new Map<number, { weeks: Set<number>; minutes: number[] }>();
    for (const w of list) {
      const { day, minute } = dayOf(w.at);
      const entry = byDay.get(day) ?? { weeks: new Set(), minutes: [] };
      entry.weeks.add(weekKey(w.at)); entry.minutes.push(minute);
      byDay.set(day, entry);
    }
    const slots = [...byDay.entries()]
      .map(([day, e]) => ({ day, n: e.weeks.size, slot: slotLabel(day, e.minutes) }))
      .filter(s => s.n >= MIN_WEEKS && s.n * 2 >= weeks)
      .sort((a, b) => b.n - a.n || a.day - b.day)
      .slice(0, 3)
      // In week order, so "Tue …, Wed …" reads like the week does.
      .sort((a, b) => a.day - b.day);
    const guide = guides.find(g => g.subjectId === subjectId);
    // Which week's set: the gap seen most, when most of the titled work agrees.
    // One vote per week, so a set split over two sittings counts once.
    const votes = new Map<number, number>();
    for (const w of guide ? list : []) {
      const lag = lagOf(guide!, w.title, w.at);
      if (lag !== undefined && lag >= 0 && lag <= 2) votes.set(weekKey(w.at), lag);
    }
    const counts = new Map<number, number>();
    for (const lag of votes.values()) counts.set(lag, (counts.get(lag) ?? 0) + 1);
    const [lag, seen] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [undefined, 0];
    const total = votes.size;
    const steadyLag = lag !== undefined && seen >= MIN_WEEKS && seen * 10 >= total * 6 ? lag : undefined;
    if (!slots.length && steadyLag === undefined) continue;
    const next = guide && steadyLag !== undefined ? rowForWeek(guide, new Date(mondayOf(now).getTime() - steadyLag * 7 * DAY_MS)) : undefined;
    out.push({
      subjectId, kind, slots: slots.map(s => s.slot), weeks, held: Math.max(0, ...slots.map(s => s.n)),
      ...(steadyLag !== undefined ? { lag: steadyLag } : {}),
      ...(next && guide ? { next, guide: guide.fileName } : {}),
    });
  }
  return out;
}

const LAG = ['the same week as the lectures', 'the previous week\'s set', 'the set from two weeks back'];

/** One short line per routine for Soma's context. */
export function routineLines(routines: Routine[], subjectName: (id: string) => string | undefined): string[] {
  return routines.flatMap(r => {
    const name = subjectName(r.subjectId);
    if (!name) return [];
    const when = r.slots.length ? `usually ${r.slots.join(', ')} (${r.held} of the last ${r.weeks} weeks with this work)` : '';
    const which = r.lag !== undefined ? `always ${LAG[r.lag]}` : '';
    const next = r.next ? `that's ${r.next.sections.join(', ')} now (lectures ${r.next.label}, "${r.guide}")` : '';
    return [`${name} ${r.kind}: ${[when, which, next].filter(Boolean).join('; ')}`];
  });
}

/** This week's and last week's rows of each course's guide: "last week's homework" without a search. */
export function guideWeeks(guides: Guide[], subjectName: (id: string) => string | undefined, now = new Date()): Record<string, { thisWeek?: string; lastWeek?: string; file: string }> {
  const out: Record<string, { thisWeek?: string; lastWeek?: string; file: string }> = {};
  const monday = mondayOf(now);
  const last = new Date(monday.getTime() - 7 * DAY_MS);
  for (const g of guides) {
    const name = subjectName(g.subjectId);
    if (!name || out[name]) continue;
    const row = (r?: GuideRow) => r ? `${r.label}: ${r.sections.join(', ')}` : undefined;
    const thisWeek = row(rowForWeek(g, monday)), lastWeek = row(rowForWeek(g, last));
    if (thisWeek || lastWeek) out[name] = { ...(thisWeek ? { thisWeek } : {}), ...(lastWeek ? { lastWeek } : {}), file: g.fileName };
  }
  return out;
}
