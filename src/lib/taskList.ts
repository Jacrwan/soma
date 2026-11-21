import type { History, Snapshot } from '../components/DashboardV2/liveData';
import { dateAt, localDate, readPlan } from '../components/DashboardV2/liveData';
import { freeTime } from './aiPlanning';
import { clockOf, rangeOf } from './clockRange';
import { storage } from './storage';
import type { Todo, TodoSession } from '../types';

/**
 * The to-do list under the calendar (2026-11-21). Work is a task; a block is
 * only where it sits right now. Taking a block off the calendar leaves the
 * task here, so nothing is lost, and the Tasks page shows every open task:
 * with a due date or not, scheduled, missed, or with no time yet.
 */

export type ListStatus = { kind: 'scheduled'; at: Date } | { kind: 'missed'; day: Date } | { kind: 'none' };
export type ListTag = 'multi-step' | 'multi-session';
export type ListRow = { todo: Todo; status: ListStatus; tags: ListTag[] };

/** Undated work older than this, with nothing planned, is left out: old Day View to-dos. */
export const LIST_DAYS = 30;
const COMMITMENTS = 'Personal commitments';

const startOf = (s: TodoSession) => s.startTime ? new Date(s.startTime) : null;
const endOf = (s: TodoSession) => s.endTime ? new Date(s.endTime) : null;

/** Where a task stands: its next block, a block that passed untouched, or no time. */
export function statusOf(todo: Todo, sessions: TodoSession[], history: Pick<History, 'date' | 'task_text' | 'subject_id' | 'duration_seconds'>[], now = new Date()): ListStatus {
  const mine = sessions.filter(s => s.todoId === todo.id && s.startTime && s.endTime && !s.doneAt);
  const next = mine.filter(s => +endOf(s)! > +now).sort((a, b) => +startOf(a)! - +startOf(b)!)[0];
  if (next) return { kind: 'scheduled', at: startOf(next)! };
  // A block that ended with under five minutes of Focus on that day didn't happen.
  const missed = mine.filter(s => {
    const did = history.filter(h => h.date === s.date && h.task_text === todo.text && (!todo.subjectId || h.subject_id === todo.subjectId)).reduce((n, h) => n + Math.max(0, h.duration_seconds || 0), 0);
    return did < 300;
  }).sort((a, b) => +startOf(b)! - +startOf(a)!)[0];
  if (missed) return { kind: 'missed', day: startOf(missed)! };
  return { kind: 'none' };
}

/** Multi-step: named steps. Multi-session: its time is split over two or more sittings. */
export function tagsOf(todo: Todo, sessions: TodoSession[], now = new Date()): ListTag[] {
  if (todo.steps?.length) return ['multi-step'];
  const ahead = sessions.filter(s => s.todoId === todo.id && s.endTime && !s.doneAt && +new Date(s.endTime) > +now).length;
  return (todo.sittingCount ?? 0) > 1 || ahead > 1 ? ['multi-session'] : [];
}

/** Open tasks with no due date, most recent first: the ones the Tasks page used to leave out. */
export function undatedRows(snapshot: Pick<Snapshot, 'todos' | 'sessions' | 'subjects' | 'history'>, now = new Date()): ListRow[] {
  const commitments = new Set(snapshot.subjects.filter(s => s.name === COMMITMENTS).map(s => s.id));
  const since = localDate(dateAt(now, -LIST_DAYS));
  return snapshot.todos
    .filter(t => t.status !== 'done' && !t.dueDate && !(t.subjectId && commitments.has(t.subjectId)))
    .filter(t => (t.date || '') >= since || snapshot.sessions.some(s => s.todoId === t.id && s.date >= since))
    .map(todo => ({ todo, status: statusOf(todo, snapshot.sessions, snapshot.history, now), tags: tagsOf(todo, snapshot.sessions, now) }))
    .sort((a, b) => (b.todo.date || '').localeCompare(a.todo.date || '') || a.todo.text.localeCompare(b.todo.text));
}

export type ListFilter = { course: string; status: 'all' | 'scheduled' | 'none' | 'missed'; type: 'all' | 'single' | ListTag; due: 'all' | 'dated' | 'undated' };
export const NO_FILTER: ListFilter = { course: 'all', status: 'all', type: 'all', due: 'all' };

export function matches(row: ListRow, filter: ListFilter): boolean {
  if (filter.course !== 'all' && (row.todo.subjectId ?? 'personal') !== filter.course) return false;
  if (filter.status !== 'all' && row.status.kind !== filter.status) return false;
  if (filter.type === 'single' && row.tags.length) return false;
  if (filter.type !== 'all' && filter.type !== 'single' && !row.tags.includes(filter.type)) return false;
  if (filter.due === 'dated' && !row.todo.dueDate) return false;
  if (filter.due === 'undated' && row.todo.dueDate) return false;
  return true;
}

const filterKey = (userId: string) => `soma_tasks_filter:${userId}`;
export function readFilter(userId: string): ListFilter {
  try { return { ...NO_FILTER, ...JSON.parse(localStorage.getItem(filterKey(userId)) ?? '{}') as Partial<ListFilter> }; } catch { return NO_FILTER; }
}
export function saveFilter(userId: string, filter: ListFilter) {
  try { localStorage.setItem(filterKey(userId), JSON.stringify(filter)); } catch { /* remembered for this visit only */ }
}

/**
 * "Schedule it" for a task with no time: the first open slot in the next
 * seven days that fits its length, inside study hours, as Plan it finds them.
 * Returns the start, or null when nothing fits.
 */
export async function placeTodo(userId: string, todo: Todo, minutes: number, now = new Date()): Promise<Date | null> {
  const origin = dateAt(now, 0);
  const plan = await readPlan(userId, origin, 0, 7);
  if (plan.calendarError) throw new Error(plan.calendarError);
  const days = freeTime(plan, origin, storage.getSomaSettings(), now, 7, 15);
  for (const d of days) {
    for (const [a, z] of d.free.map(rangeOf)) {
      if (z - a < minutes) continue;
      const start = new Date(`${d.date}T${clockOf(a)}:00`);
      await storage.saveTodoSession({ todoId: todo.id, date: d.date, startTime: start.toISOString(), endTime: new Date(+start + minutes * 60000).toISOString() });
      await storage.saveTodo({ ...todo, date: d.date });
      return start;
    }
  }
  return null;
}
