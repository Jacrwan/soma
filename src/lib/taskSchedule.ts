import { deadlineOf, detailsFromRow } from './taskDetails';
import { supabase } from './supabase';
import { storage } from './storage';
import { readPlan, dateAt, localDate, utcIso, type History, type Snapshot } from '../components/DashboardV2/liveData';
import { getProposals } from './proposalStore';
import { estimate, kindOf } from './planIt';
import { rangeOf } from './clockRange';
import { placeInSeries, reorderSeries } from './series';
import { pinBlock, pinKey, pinnedKeys } from './pinnedBlocks';
import { eventKey, skippedKeys } from './skippedEvents';
import { subjectForCourse } from './canvasDeepSync';
import { readMirror } from './activeTimerMirror';
import { asTodoKind, type Todo, type TodoSession } from '../types';
import { dueMoment, effectiveRank, isManaged, plannedOn, resolvePrefs, schedule, type SchedTask } from './taskScheduler';

/**
 * Runs the task scheduler (lib/taskScheduler.ts) on the student's real plan
 * and saves what it decides: new sittings, moved ones, and ones no longer
 * needed. No AI. The dashboard runs it on load, after any change to the plan,
 * and when a sitting is missed; the Tasks page runs it after every edit.
 */

export const TASKS_CHANGED = 'soma_tasks_changed';
const DAY_MS = 86_400_000;
/** How far ahead sittings are placed. */
const MAX_DAYS = 60;
/** Canvas assignments due within this many days get a task without asking (when the setting is on). */
const ADOPT_DAYS = 21;

export type TaskSitting = { id: string; date: string; start: Date; end: Date; done: boolean; pinned: boolean; started: boolean; stepId?: string };
export type TaskInfo = {
  todo: Todo;
  /** Minutes the whole task takes: what the student set, else Soma's guess. */
  total: number;
  /** Where the total came from, when it's a guess. */
  basis?: string;
  logged: number;
  left: number;
  sittings: TaskSitting[];
  managed: boolean;
  rank: number;
};
export type RescheduleResult = {
  moved: { todoId: string; title: string; from: Date | null; to: Date }[];
  created: number;
  removed: number;
  atRisk: Record<string, number>;
  /** The names of the tasks in atRisk, for the dashboard note. */
  atRiskTitles?: string[];
  finishBy: Record<string, Date>;
  skipped?: string;
  /**
   * Time opened up today (a block moved off it, say) and a later sitting could
   * use it. Soma doesn't move it there itself; the dashboard asks.
   */
  ahead?: AheadOffer;
};
/** `sessionId` missing: a new sitting for a task that doesn't fit. */
export type AheadOffer = { todoId: string; title: string; sessionId?: string; from?: Date; start: Date; end: Date; opened: number };

const minutesOf = (seconds: number) => Math.round(seconds / 60);
/** Focus logged on a task: its title in its course, the way Insights files it. */
export const loggedOn = (todo: Todo, history: History[]) =>
  minutesOf(history.filter(h => h.subject_id === todo.subjectId && h.task_text === todo.text).reduce((n, h) => n + Math.max(0, h.duration_seconds || 0), 0));

/**
 * With no length set, time already planned on it counts: blocks the student
 * accepted earlier (often 2h where the guess says 1h) are never trimmed to a guess.
 */
export function totalFor(todo: Todo, snapshot: Pick<Snapshot, 'subjects' | 'history'>, planned = 0): { minutes: number; basis?: string } {
  if (todo.estimatedMinutes) return { minutes: todo.estimatedMinutes };
  const g = guessFor(todo, snapshot);
  return planned > g.minutes ? { minutes: planned, basis: 'the time already planned for it' } : g;
}
function guessFor(todo: Todo, snapshot: Pick<Snapshot, 'subjects' | 'history'>): { minutes: number; basis?: string } {
  const subject = snapshot.subjects.find(s => s.id === todo.subjectId);
  if (!subject) return { minutes: 60, basis: 'a guess' };
  const e = estimate({ key: todo.id, title: todo.text, subject: subject.name, subjectId: subject.id, color: '', due: todo.dueDate ?? '' }, snapshot.history);
  return { minutes: e.minutes, basis: e.basis };
}

/**
 * The Focus timer running now, if it's this student's: its course, task and
 * start. Its session is saved only when it stops, so until then history
 * doesn't show it (2026-11-17: a sitting focused on past its end time read as
 * missed and moved away mid-study).
 */
function liveFocus(userId: string): { subjectId: string; task: string; start: number } | null {
  const m = readMirror();
  if (!m || (m.userId && m.userId !== userId)) return null;
  const start = Date.parse(m.sessionStartTimeISO);
  return Number.isFinite(start) ? { subjectId: m.subjectId, task: m.task, start } : null;
}

function sittingsOf(todo: Todo, sessions: TodoSession[], history: History[], pins: Set<string>, live: ReturnType<typeof liveFocus> = null): TaskSitting[] {
  const mine = history.filter(h => h.subject_id === todo.subjectId && h.task_text === todo.text && h.start_time && h.end_time);
  const focusing = !!live && live.subjectId === todo.subjectId && live.task === todo.text;
  return sessions.filter(s => s.todoId === todo.id && s.startTime && s.endTime).map(s => {
    const start = new Date(s.startTime!), end = new Date(s.endTime!);
    const hhmm = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    return {
      id: s.id, date: s.date, start, end, done: !!s.doneAt, ...(s.stepId ? { stepId: s.stepId } : {}),
      pinned: !!s.pinned || pins.has(pinKey(todo.id, s.date, hhmm)),
      // Focus ran during it.
      started: mine.some(h => +new Date(utcIso(h.start_time!)) < +end && +new Date(utcIso(h.end_time!)) > +start)
        || (focusing && live!.start < +end && Date.now() > +start),
    };
  }).sort((a, b) => +a.start - +b.start);
}

/** Scheduler ids for blocks moved off a calendar event: `block:<session id>`. */
const BLOCK = 'block:';
type Clash = { sessionId: string; todoId: string; title: string; start: number; end: number; pinned: boolean };

/**
 * Event times as they were last seen here, per event and date ("gym@2026-11-19"
 * → "17:00–18:00"), and the dates that read covered. Browser storage, per
 * account, like pins and skips.
 */
const SEEN_KEY = 'soma_seen_event_times';
type Seen = { times: Record<string, string>; dates: Set<string> };
function seenEvents(userId: string): Seen | null {
  try {
    const stored = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null') as { userId: string; times: Record<string, string>; dates: string[] } | null;
    if (!stored || stored.userId !== userId || !stored.times || !Array.isArray(stored.dates)) return null;
    return { times: stored.times, dates: new Set(stored.dates) };
  } catch { return null; }
}
function rememberEvents(userId: string, old: Seen | null, now: Record<string, string>, dates: Set<string>, today: string) {
  const keep = (d: string) => d >= today && !dates.has(d);
  // Dates this run read are replaced whole (a deleted event drops out); past dates go.
  const times = Object.fromEntries(Object.entries(old?.times ?? {}).filter(([k]) => keep(k.slice(k.lastIndexOf('@') + 1))));
  const all = [...[...(old?.dates ?? [])].filter(keep), ...dates];
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ userId, times: { ...times, ...now }, dates: all })); } catch { /* not remembered on this device */ }
}

/**
 * Blocks a calendar event moved onto (2026-11-19: the owner moved gym in
 * Google Calendar to 5 PM and "Review: CS 61A lecture" stayed under it).
 * Before, only tasks with a due date ever moved, and nothing ran when the
 * calendar changed. A block moves when an event on it is new or has moved
 * since the last run here, whoever placed it. A block the student already
 * had over an event (accepted with the overlap, or a class they may skip)
 * stays, and so does every clash on the first run on a device, which has
 * nothing to compare with. Never: a task's sitting (the task
 * scheduler has those), a block that's begun, checked off or had Focus,
 * or an event the student said they're skipping.
 */
function calendarClashes(userId: string, snapshot: Snapshot, managed: Set<string>, origin: Date, now: number, pins: Set<string>): Clash[] {
  const skipped = skippedKeys(userId), seen = seenEvents(userId);
  const dateOf = (day: number) => localDate(dateAt(origin, day));
  const span = (b: { day: number; time: string }) => { const [a, z] = rangeOf(b.time); return [b.day * 1440 + a, b.day * 1440 + z] as const; };
  const events = snapshot.blocks.filter(b => b.external && b.time && !skipped.has(eventKey(b.id, dateOf(b.day))));
  const read = new Set(snapshot.blocks.map(b => dateOf(b.day)));
  rememberEvents(userId, seen, Object.fromEntries(snapshot.blocks.filter(e => e.external && !e.manual && e.time).map(e => [eventKey(e.id, dateOf(e.day)), e.time])), read, dateOf(0));
  // Only on a date the last run read: a day just coming into view isn't a change.
  const movedOnto = (e: typeof events[number]) => {
    const date = dateOf(e.day);
    return !!seen && !e.manual && seen.dates.has(date) && seen.times[eventKey(e.id, date)] !== e.time;
  };
  return snapshot.blocks.flatMap(b => {
    if (b.external || !b.todoId || !b.sessionId || managed.has(b.todoId) || !b.time || b.state !== 'Planned') return [];
    const [a, z] = span(b);
    if (a < now) return [];
    const on = events.filter(e => { const [x, y] = span(e); return x < z && y > a; });
    if (!on.length) return [];
    const session = snapshot.sessions.find(s => s.id === b.sessionId);
    if (!session?.startTime || !session.endTime) return [];
    const pinned = !!session.pinned || pins.has(pinKey(b.todoId, session.date, b.time.slice(0, 5)));
    if (!on.some(movedOnto)) return [];
    const focused = snapshot.history.some(h => h.subject_id === b.subjectId && h.task_text === b.title && h.start_time && h.end_time
      && +new Date(utcIso(h.start_time)) < +new Date(session.endTime!) && +new Date(utcIso(h.end_time)) > +new Date(session.startTime!));
    if (focused) return [];
    return [{ sessionId: b.sessionId, todoId: b.todoId, title: b.title, start: a, end: z, pinned }];
  });
}

/** Priority uses the student's own deadline when there is one. */
const rankOf = (t: Todo) => effectiveRank({ ...t, dueDate: deadlineOf(t) ?? undefined });
/** Steps not checked off, and not done through their sitting. */
export const openSteps = (t: Todo, sittings: { stepId?: string; done: boolean }[]) =>
  (t.steps ?? []).filter(x => !x.done && !sittings.some(s => s.stepId === x.id && s.done));

/** Every open task with a due date, with its sittings and what's left, in priority order. */
export function tasksFrom(snapshot: Pick<Snapshot, 'todos' | 'sessions' | 'subjects' | 'history'>, userId: string, now = new Date()): TaskInfo[] {
  const settings = storage.getSomaSettings();
  const auto = settings.schedule?.autoImported ?? true;
  const today = localDate(now), pins = pinnedKeys(userId), live = liveFocus(userId);
  return snapshot.todos.filter(t => t.status !== 'done' && t.dueDate).map(todo => {
    const sittings = sittingsOf(todo, snapshot.sessions, snapshot.history, pins, live);
    const logged = loggedOn(todo, snapshot.history);
    const managed = isManaged(todo, auto, today), rank = rankOf(todo);
    if (todo.steps?.length) {
      const open = openSteps(todo, sittings);
      return { todo, total: todo.steps.reduce((n, x) => n + x.minutes, 0), logged, left: open.reduce((n, x) => n + x.minutes, 0), sittings, managed, rank };
    }
    const { minutes: total, basis } = totalFor(todo, snapshot, plannedOn(sittings, logged));
    const doneMin = sittings.filter(s => s.done).reduce((n, s) => n + Math.round((+s.end - +s.start) / 60000), 0);
    return { todo, total, basis, logged, left: Math.max(0, total - Math.max(logged, doneMin)), sittings, managed, rank };
  }).sort((a, b) => a.rank - b.rank);
}

/**
 * Canvas assignments live in this browser's cache, not as tasks. With
 * "Schedule imported assignments" on, each one due in the next three weeks,
 * not handed in or marked done, gets a task linked by its assignment id
 * (Deadlines already shows a linked task once, as the assignment).
 */
async function adoptCanvas(userId: string, todos: Todo[]): Promise<number> {
  const subjects = storage.getSubjects(), marked = storage.getAssignmentStatus();
  const linked = new Set(todos.map(t => t.assignmentId).filter(Boolean));
  const now = Date.now();
  let added = 0;
  for (const a of storage.getCachedAssignments()) {
    if (!a.dueAt || a.submittedAt || (marked[a.id] ?? a.status) === 'done' || linked.has(a.id)) continue;
    const due = new Date(a.dueAt).getTime();
    if (due < now || due > now + ADOPT_DAYS * DAY_MS) continue;
    const subject = subjectForCourse(subjects, a.courseId, a.courseName);
    if (!subject || subject.archived) continue;
    await storage.saveTodo({ id: crypto.randomUUID(), text: a.name, status: 'nothing', subjectId: subject.id, assignmentId: a.id, dueDate: a.dueAt, kind: asTodoKind(kindOf(a.name)) ?? 'homework', date: localDate(new Date()) });
    added++;
  }
  void userId;
  return added;
}

/**
 * What's already planned: the work done so far, plus sittings still to come.
 * Work done is the larger of Focus logged and sittings checked off, the way
 * what's left is counted: a sitting focused through and then ticked is one
 * hour, not two. Added together (until 2026-11-15) they doubled a guessed
 * task's length, so ticking its only sitting left it open with another
 * sitting to place.
 */
export { plannedOn } from './taskScheduler';

/**
 * Work handed in on Canvas is finished: its task is checked off and its
 * sittings still ahead come off the plan. Nothing did this before
 * (2026-11-15): the due card went, but the sittings stayed and each one,
 * once missed, moved to the next open time until the due date passed.
 * Only `status` is written, so nothing else on the row can be overwritten.
 */
async function closeHandedIn(userId: string, todos: Todo[]): Promise<number> {
  const handedIn = new Set(storage.getCachedAssignments().filter(a => a.submittedAt).map(a => a.id));
  let closed = 0;
  for (const t of todos) {
    if (t.status === 'done' || t.assignmentId == null || !handedIn.has(t.assignmentId)) continue;
    const { error } = await supabase.from('todos').update({ status: 'done' }).eq('id', t.id).eq('user_id', userId);
    if (error) throw new Error(error.message);
    t.status = 'done';
    const { data, error: readError } = await supabase.from('todo_sessions').select('*').eq('todo_id', t.id).eq('user_id', userId);
    if (readError) throw new Error(readError.message);
    await clearFutureSittings(userId, ((data ?? []) as Record<string, unknown>[]).map(r => ({
      id: String(r.id), todoId: t.id, date: String(r.date),
      startTime: r.start_time ? utcIso(String(r.start_time)) : undefined,
      ...(r.done_at ? { doneAt: String(r.done_at) } : {}),
    })));
    closed++;
  }
  return closed;
}

/**
 * The student's tasks, read by id. Not storage.fetchAllTodos(): that asks
 * Supabase auth who is signed in, and runs alongside Ask Soma's own loads.
 */
async function readTodos(userId: string): Promise<Todo[]> {
  const out: Todo[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('todos').select('*').eq('user_id', userId).order('id').range(from, from + 999);
    if (error) throw new Error('Could not load your tasks. Please retry.');
    for (const r of (data ?? []) as Record<string, unknown>[]) out.push({
      id: String(r.id), text: String(r.text ?? ''), status: (r.status as Todo['status']) ?? 'nothing', date: String(r.date ?? ''),
      subjectId: (r.subject_id as string | null) ?? undefined, dueDate: (r.due_date as string | null) ?? undefined,
      estimatedMinutes: (r.estimated_minutes as number | null) ?? undefined, kind: asTodoKind(r.kind),
      assignmentId: (r.assignment_id as number | null) ?? undefined, rank: (r.rank as number | null) ?? undefined,
      autoSchedule: (r.auto_schedule as boolean | null) ?? undefined, ...detailsFromRow(r),
    });
    if (!data || data.length < 1000) return out;
  }
}

let running: Promise<RescheduleResult> | null = null;
let last: RescheduleResult | null = null;
/** Today's open minutes at the last run, to tell time opening up from time passing. */
let openToday: { date: string; minutes: number } | null = null;
const aheadKey = (userId: string, date: string) => `soma_ahead_declined:${userId}:${date}`;
/** "Not today": no more work-ahead offers for the rest of the day. */
export function declineAhead(userId: string) {
  try { localStorage.setItem(aheadKey(userId, localDate(new Date())), '1'); } catch { /* the offer just comes back */ }
}
const aheadDeclined = (userId: string, date: string) => { try { return localStorage.getItem(aheadKey(userId, date)) === '1'; } catch { return false; } };
/** What the last run decided (at-risk minutes and finish days), for the Tasks page. */
export const lastSchedule = () => last;

export function rescheduleTasks(userId: string): Promise<RescheduleResult> {
  if (running) return running;
  running = run(userId).finally(() => { running = null; });
  return running;
}

async function run(userId: string): Promise<RescheduleResult> {
  const empty: RescheduleResult = { moved: [], created: 0, removed: 0, atRisk: {}, finishBy: {} };
  const settings = storage.getSomaSettings();
  const prefs = resolvePrefs(settings);
  const auto = settings.schedule?.autoImported ?? true;
  const now = new Date(), origin = dateAt(now, 0), today = localDate(origin);

  let todos = await readTodos(userId);
  const closed = await closeHandedIn(userId, todos);
  if (auto && await adoptCanvas(userId, todos)) todos = await readTodos(userId);
  const managed = todos.filter(t => isManaged(t, auto, today));
  const nothing = () => {
    last = empty;
    // The pages read the plan again: a task was just finished.
    if (closed) window.dispatchEvent(new Event('soma_todos_changed'));
    return closed ? { ...empty, removed: closed } : empty;
  };

  const furthest = Math.max(0, ...managed.map(t => Math.ceil((+dueMoment(deadlineOf(t)!) - +origin) / DAY_MS) + 1));
  const days = Math.min(MAX_DAYS, Math.max(7, furthest));
  const snapshot = await readPlan(userId, origin, 0, days);
  // Half a calendar would read as open time and put work over classes.
  if (snapshot.calendarError) return managed.length ? { ...empty, skipped: snapshot.calendarError } : nothing();

  const ids = new Set(managed.map(t => t.id));
  const abs = (d: Date) => Math.round((+d - +origin) / 60000);
  const pins = pinnedKeys(userId);
  const clashes = calendarClashes(userId, snapshot, ids, origin, abs(now), pins);
  if (!managed.length && !clashes.length) return nothing();
  const live = liveFocus(userId);
  const info = new Map(managed.map(t => [t.id, { todo: t, sittings: sittingsOf(t, snapshot.sessions, snapshot.history, pins, live) }]));
  const dayStart = (date: string) => abs(new Date(`${date}T00:00:00`));
  const tasks: SchedTask[] = managed.map(t => {
    const sittings = info.get(t.id)!.sittings;
    const steps = t.steps?.length ? openSteps(t, sittings).map(x => ({ id: x.id, minutes: x.minutes })) : undefined;
    return {
      id: t.id,
      rank: rankOf(t),
      total: steps ? steps.reduce((n, x) => n + x.minutes, 0) : totalFor(t, snapshot, plannedOn(sittings, loggedOn(t, snapshot.history))).minutes,
      logged: loggedOn(t, snapshot.history),
      due: abs(dueMoment(deadlineOf(t)!)),
      sittings: sittings.map(s => ({ id: s.id, start: abs(s.start), end: abs(s.end), done: s.done, pinned: s.pinned, started: s.started, ...(s.stepId ? { stepId: s.stepId } : {}) })),
      ...(steps ? { steps } : {}),
      ...(t.sittingCount && !steps ? { count: t.sittingCount } : {}),
      ...(t.workFrom ? { from: dayStart(t.workFrom) } : {}),
      ...(t.workUntil ? { until: dayStart(t.workUntil) + 1440 } : {}),
    };
  });
  // Everything else on the plan holds its time, and so do Soma's suggestions
  // still waiting: new blocks, moves (the time the student asked for), and
  // every piece of a split one (2026-11-16: a sitting landed in a waiting
  // move's slot, and Accept failed with "That time overlaps").
  const waiting = getProposals(userId).filter(p => p.time)
    .flatMap(p => [p, ...(p.extra ?? []).filter(x => x.time).map(x => ({ ...p, day: x.day, time: x.time }))]);
  // A block a calendar event now sits on isn't in the way: it's moving.
  const clashing = new Set(clashes.map(c => c.sessionId));
  const busy = [...snapshot.blocks.filter(b => b.time && !(b.todoId && ids.has(b.todoId)) && !(b.sessionId && clashing.has(b.sessionId))), ...waiting]
    .map(b => { const [a, z] = rangeOf(b.time); return { start: b.day * 1440 + a, end: b.day * 1440 + z, study: !b.external }; });
  // Each goes to the first open time after where it was, whole, on its day or
  // the next few, after every task with a due date has had its turn.
  for (const c of clashes) tasks.push({
    id: BLOCK + c.sessionId, rank: Number.MAX_SAFE_INTEGER, total: c.end - c.start, logged: 0,
    due: (Math.floor(c.start / 1440) + 8) * 1440 - 1, from: c.start, count: 1,
    sittings: [{ id: c.sessionId, start: c.start, end: c.end }],
  });

  const result = schedule({ tasks, busy, prefs, now: abs(now), days, weekday0: origin.getDay() });
  const clash = (taskId: string) => taskId.startsWith(BLOCK) ? clashes.find(c => BLOCK + c.sessionId === taskId) : undefined;
  // A student's block is never deleted here: one with nowhere to go stays put.
  result.remove = result.remove.filter(r => !clash(r.taskId));
  result.atRisk = result.atRisk.filter(r => !clash(r.taskId));
  if (result.ahead && clash(result.ahead.taskId)) delete result.ahead;
  const moment = (minute: number) => new Date(origin.getFullYear(), origin.getMonth(), origin.getDate(), 0, minute);

  const fail = (e: { message: string } | null) => { if (e) throw new Error(/step_id/.test(e.message) ? 'Run task_details_migration.sql in Supabase to schedule steps.' : /done_at|pinned/.test(e.message) ? 'Run task_scheduler_migration.sql in Supabase to schedule tasks.' : e.message); };
  for (const r of result.remove) {
    const { error } = await supabase.from('todo_sessions').delete().eq('id', r.id).eq('user_id', userId);
    fail(error);
  }
  const moved: RescheduleResult['moved'] = [];
  let created = 0;
  for (const p of result.place) {
    const start = moment(p.start), end = moment(p.end);
    // step_id only for tasks with steps, so scheduling works before task_details_migration.sql.
    const row = { date: localDate(start), start_time: start.toISOString(), end_time: end.toISOString(), ...(p.stepId ? { step_id: p.stepId } : {}) };
    const c = clash(p.taskId);
    if (c) {
      if (!p.id) continue;
      const { error } = await supabase.from('todo_sessions').update(row).eq('id', p.id).eq('user_id', userId);
      fail(error);
      // A time the student chose stays theirs at its new time.
      if (c.pinned) pinBlock(userId, pinKey(c.todoId, row.date, `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`));
      moved.push({ todoId: c.todoId, title: c.title, from: moment(c.start), to: start });
      continue;
    }
    if (p.id) {
      const { error } = await supabase.from('todo_sessions').update(row).eq('id', p.id).eq('user_id', userId);
      fail(error);
      const was = info.get(p.taskId)?.sittings.find(s => s.id === p.id);
      moved.push({ todoId: p.taskId, title: info.get(p.taskId)!.todo.text, from: was?.start ?? null, to: start });
    } else {
      const { error } = await supabase.from('todo_sessions').insert({ id: crypto.randomUUID(), user_id: userId, todo_id: p.taskId, ...row });
      fail(error);
      created++;
    }
  }
  // A block moved off an event keeps its series in order (2026-11-21,
  // reworked 2026-11-22): the series' blocks trade slots, so the 11-02 review
  // goes where the 11-04 one was and that one takes its new slot. No new
  // times, nothing pushed later (series.ts).
  const offEvents = moved.filter(m => clashes.some(c => c.todoId === m.todoId));
  if (offEvents.length) {
    const fresh = await readPlan(userId, origin, 0, days);
    if (!fresh.calendarError) {
      const at = (b: { day: number; time: string }) => b.day * 1440 + rangeOf(b.time)[0];
      const plain = fresh.blocks.filter(b => !b.external && b.todoId && b.sessionId && b.time && b.state === 'Planned' && !ids.has(b.todoId));
      const pinnedHere = (b: typeof plain[number]) => !!fresh.sessions.find(sn => sn.id === b.sessionId)?.pinned || pins.has(pinKey(b.todoId!, localDate(dateAt(origin, b.day)), b.time.slice(0, 5)));
      const board = plain.map(b => ({ id: b.sessionId!, title: b.title, subjectId: b.subjectId, covers: b.covers?.map(c => c.id), start: at(b), end: b.day * 1440 + rangeOf(b.time)[1], movable: at(b) >= abs(now) && !(b.actualSeconds ?? 0) && !pinnedHere(b) }));
      const touched = new Set(offEvents.flatMap(m => { const b = plain.find(x => x.todoId === m.todoId); const p = b && placeInSeries({ title: b.title, subjectId: b.subjectId, covers: b.covers?.map(c => c.id) }, fresh.items); return p ? [p.key] : []; }));
      for (const sw of reorderSeries(board, fresh.items)) {
        const b = plain.find(x => x.sessionId === sw.id)!;
        if (!touched.has(placeInSeries({ title: b.title, subjectId: b.subjectId, covers: b.covers?.map(c => c.id) }, fresh.items)?.key ?? '')) continue;
        const start = moment(sw.to[0]), end = moment(sw.to[1]);
        const { error } = await supabase.from('todo_sessions').update({ date: localDate(start), start_time: start.toISOString(), end_time: end.toISOString() }).eq('id', b.sessionId!).eq('user_id', userId);
        fail(error);
        const m = moved.find(x => x.todoId === b.todoId);
        if (m) m.to = start; else moved.push({ todoId: b.todoId!, title: b.title, from: moment(at(b)), to: start });
      }
    }
  }
  // Offer the work-ahead only when today's open time grew since the last run.
  const before = openToday?.date === today ? openToday.minutes : null;
  openToday = { date: today, minutes: result.todayOpen };
  const opened = before === null ? 0 : result.todayOpen - before;
  const offer = result.ahead && opened >= prefs.shortest && !aheadDeclined(userId, today) ? result.ahead : undefined;
  const out: RescheduleResult = {
    moved, created, removed: result.remove.length + closed,
    ...(offer ? { ahead: {
      todoId: offer.taskId, title: info.get(offer.taskId)!.todo.text, opened,
      ...(offer.id ? { sessionId: offer.id, from: moment(offer.from!) } : {}),
      start: moment(offer.start), end: moment(offer.end),
    } } : {}),
    atRisk: Object.fromEntries(result.atRisk.map(r => [r.taskId, r.short])),
    atRiskTitles: result.atRisk.map(r => info.get(r.taskId)?.todo.text ?? '').filter(Boolean),
    finishBy: Object.fromEntries(Object.entries(result.finishBy).map(([id, m]) => [id, moment(m)])),
  };
  last = out;
  window.dispatchEvent(new CustomEvent(TASKS_CHANGED, { detail: out }));
  if (closed) window.dispatchEvent(new Event('soma_todos_changed'));
  return out;
}

/**
 * Check off (or uncheck) one sitting of a scheduled task. The task is done
 * when nothing is left; until then it's in progress.
 */
export async function setSittingDone(userId: string, snapshot: Snapshot, todo: Todo, sessionId: string, done: boolean) {
  const { error } = await supabase.from('todo_sessions').update({ done_at: done ? new Date().toISOString() : null }).eq('id', sessionId).eq('user_id', userId);
  if (error) throw new Error(/done_at/.test(error.message) ? 'Run task_scheduler_migration.sql in Supabase to check off one sitting.' : error.message);
  const sessions = snapshot.sessions.map(s => s.id === sessionId ? { ...s, doneAt: done ? new Date().toISOString() : undefined } : s);
  const [task] = tasksFrom({ ...snapshot, sessions, todos: [{ ...todo, status: 'nothing' }] }, userId);
  const status: Todo['status'] = task && task.left <= 0 ? 'done' : sessions.some(s => s.todoId === todo.id && s.doneAt) || task?.logged ? 'in_progress' : 'nothing';
  if (status !== todo.status) await storage.saveTodo({ ...todo, status });
  if (status === 'done') await clearFutureSittings(userId, sessions.filter(s => s.todoId === todo.id));
}

/** A finished task's sittings still ahead, never started or checked, come off the plan. */
export async function clearFutureSittings(userId: string, sessions: TodoSession[]) {
  const now = Date.now();
  for (const s of sessions) {
    if (s.doneAt || !s.startTime || +new Date(s.startTime) <= now) continue;
    const { error } = await supabase.from('todo_sessions').delete().eq('id', s.id).eq('user_id', userId);
    if (error) throw new Error(error.message);
  }
}

/** Yes to a work-ahead offer: the sitting moves into today (or a new one goes there), pinned. */
export async function acceptAhead(userId: string, offer: AheadOffer) {
  const row = { date: localDate(offer.start), start_time: offer.start.toISOString(), end_time: offer.end.toISOString() };
  const { error } = offer.sessionId
    ? await supabase.from('todo_sessions').update(row).eq('id', offer.sessionId).eq('user_id', userId)
    : await supabase.from('todo_sessions').insert({ id: crypto.randomUUID(), user_id: userId, todo_id: offer.todoId, ...row });
  if (error) throw new Error(error.message);
  const hhmm = `${String(offer.start.getHours()).padStart(2, '0')}:${String(offer.start.getMinutes()).padStart(2, '0')}`;
  pinBlock(userId, pinKey(offer.todoId, row.date, hhmm));
  openToday = null;
}

/** Pin or unpin a sitting: pinned ones never move. */
export async function setSittingPinned(userId: string, sessionId: string, pinned: boolean) {
  const { error } = await supabase.from('todo_sessions').update({ pinned }).eq('id', sessionId).eq('user_id', userId);
  if (error) throw new Error(/pinned/.test(error.message) ? 'Run task_scheduler_migration.sql in Supabase to pin sittings.' : error.message);
}
