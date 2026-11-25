import { dateAt, localDate, utcIso, type Snapshot } from '../components/DashboardV2/liveData';
import { withWeekday } from './courseItems';

/**
 * What the student did 8 to 60 days ago, for Soma's AI (2026-11-24). Asked "did
 * I review the 11-02 CS lecture?", Soma could only see the last seven days.
 *
 * Built from rows readPlan already loaded (tasks, their blocks, Focus time), so
 * it costs no extra reads. Only work with a record goes in: checked off, or with
 * logged time. A planned block with neither didn't happen, and listing it would
 * cost tokens on every message for nothing. Focus time logged under a name no
 * block on that day has gets its own line.
 */
export const EARLIER_FROM = 60, EARLIER_TO = 8;
/** Lines at most, newest first: a busy student's two months stay small. */
export const EARLIER_MAX = 120;

const clock = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function earlierWork(snap: Pick<Snapshot, 'todos' | 'sessions' | 'history' | 'subjects'>, origin: Date): Record<string, string[]> {
  const first = localDate(dateAt(origin, -EARLIER_FROM)), last = localDate(dateAt(origin, -EARLIER_TO));
  const inRange = (d: string) => !!d && d >= first && d <= last;
  const nameOf = (id?: string) => snap.subjects.find(s => s.id === id)?.name ?? 'Personal';
  // Focus minutes by day, course and task name, the way the plan matches them.
  const focus = new Map<string, number>();
  for (const h of snap.history) {
    if (!inRange(h.date) || !h.subject_id) continue;
    const key = JSON.stringify([h.date, h.subject_id, h.task_text ?? '']);
    focus.set(key, (focus.get(key) ?? 0) + Math.max(0, h.duration_seconds ?? 0));
  }
  const rows: { date: string; at: string; text: string }[] = [];
  const used = new Set<string>();
  const add = (date: string, title: string, subjectId: string | undefined, state: string, start?: Date, end?: Date) => {
    const key = JSON.stringify([date, subjectId, title]);
    const seconds = used.has(key) ? 0 : focus.get(key) ?? 0;   // a task's time goes on its first block that day
    used.add(key);
    const did = Math.round(seconds / 60);
    if (!state && did < 1) return;
    const time = start && end && !isNaN(+start) && !isNaN(+end) ? `${clock(start)}–${clock(end)} ` : '';
    rows.push({ date, at: start && !isNaN(+start) ? start.toISOString() : '', text: [`${time}${title}`, nameOf(subjectId), state, did >= 1 ? `did ${did}m` : ''].filter(Boolean).join(' · ') });
  };
  const todoById = new Map(snap.todos.map(t => [t.id, t]));
  const stateOf = (status: string, doneAt?: string) => status === 'done' || doneAt ? 'Completed' : status === 'in_progress' ? 'Partially completed' : '';
  for (const s of snap.sessions) {
    const t = todoById.get(s.todoId);
    if (!t || !inRange(s.date)) continue;
    add(s.date, t.text, t.subjectId, stateOf(t.status, s.doneAt), s.startTime ? new Date(s.startTime) : undefined, s.endTime ? new Date(s.endTime) : undefined);
  }
  const withSessions = new Set(snap.sessions.map(s => s.todoId));
  for (const t of snap.todos) if (inRange(t.date) && !withSessions.has(t.id)) add(t.date, t.text, t.subjectId, stateOf(t.status));
  // Focus time with no block of that name that day.
  for (const [key, seconds] of focus) {
    if (used.has(key)) continue;
    const [date, subjectId, title] = JSON.parse(key) as [string, string, string];
    const did = Math.round(seconds / 60);
    if (did < 1) continue;
    const firstStart = snap.history.filter(h => h.date === date && h.subject_id === subjectId && (h.task_text ?? '') === title && h.start_time).map(h => new Date(utcIso(h.start_time!))).sort((a, b) => +a - +b)[0];
    rows.push({ date, at: firstStart?.toISOString() ?? '', text: [`${title || 'Focus'}`, nameOf(subjectId), `did ${did}m`, 'no block'].join(' · ') });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.at.localeCompare(b.at));
  const out: Record<string, string[]> = {};
  for (const r of rows.slice(0, EARLIER_MAX)) (out[withWeekday(r.date)] ??= []).push(r.text);
  return out;
}
