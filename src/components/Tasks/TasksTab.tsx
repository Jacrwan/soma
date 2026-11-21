import { useCallback, useEffect, useState } from 'react';
import TaskDetail from './TaskDetail';
import { deadlineOf } from '../../lib/taskDetails';
import { GripVertical, Pin, PinOff, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { storage } from '../../lib/storage';
import { dateAt, localDate, readPlan, setTaskStatus, type Snapshot } from '../DashboardV2/liveData';
import { clearFutureSittings, lastSchedule, rescheduleTasks, setSittingPinned, tasksFrom, TASKS_CHANGED, type RescheduleResult, type TaskInfo } from '../../lib/taskSchedule';
import { estimate } from '../../lib/planIt';
import { rankBetween } from '../../lib/taskScheduler';
import { formatClock, useTimeFormat } from '../../lib/timeFormat';
import type { Todo } from '../../types';
import { SkeletonBlock, SkeletonPage } from '../UI/Skeleton';
import { matches, placeTodo, readFilter, saveFilter, statusOf, tagsOf, undatedRows, type ListFilter, type ListRow, type ListTag } from '../../lib/taskList';
import styles from './TasksTab.module.css';

/**
 * Tasks (2026-11-15): every open task with a due date, in priority order.
 * Soma schedules them (lib/taskScheduler.ts) without AI. Priority is silent:
 * there are no labels, only the order, and dragging a task changes it.
 * Adding a task places it right away; missed sittings move on their own.
 *
 * Since 2026-11-21 it is the whole to-do list (lib/taskList.ts): tasks with
 * no due date are listed too, with where each stands (scheduled, missed, no
 * time yet), Multi-step / Multi-session tags, and a filter.
 */
const TAG_LABEL: Record<ListTag, string> = { 'multi-step': 'Multi-step', 'multi-session': 'Multi-session' };

const hours = (m: number) => m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function dueLabel(due: string, timeFormat: '12h' | '24h') {
  const d = due.length <= 10 ? new Date(`${due}T12:00:00`) : new Date(due);
  const today = dateAt(new Date(), 0), day = Math.round((+dateAt(d, 0) - +today) / 86_400_000);
  const name = day < 0 ? `Overdue, ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : day === 0 ? 'Today' : day === 1 ? 'Tomorrow' : day < 7 ? d.toLocaleDateString(undefined, { weekday: 'long' }) : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return due.length > 10 ? `${name}, ${formatClock(hm(d), timeFormat)}` : name;
}
function whenLabel(d: Date, timeFormat: '12h' | '24h') {
  const day = Math.round((+dateAt(d, 0) - +dateAt(new Date(), 0)) / 86_400_000);
  const name = day === 0 ? 'Today' : day === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${name} ${formatClock(hm(d), timeFormat)}`;
}

export default function TasksTab({ userId }: { userId: string }) {
  const timeFormat = useTimeFormat();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [schedule, setSchedule] = useState<RescheduleResult | null>(() => lastSchedule());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [details, setDetails] = useState<Todo | null>(null);
  // The task just checked off, as it was, for Undo.
  const [undo, setUndo] = useState<Todo | null>(null);
  // "+ Add task": the Task details popup, empty (2026-11-17, replacing the add row).
  const [adding, setAdding] = useState(false);
  const [filter, setFilterState] = useState<ListFilter>(() => readFilter(userId));
  const setFilter = (f: ListFilter) => { setFilterState(f); saveFilter(userId, f); };

  const load = useCallback(async () => {
    const data = await readPlan(userId, dateAt(new Date(), 0), 0, 1);
    setSnapshot(data);
    return data;
  }, [userId]);
  /** Save, then let Soma place everything again, then show what it decided. */
  const after = useCallback(async (message?: string) => {
    try {
      const r = await rescheduleTasks(userId);
      setSchedule(r);
      if (r.skipped) setError(r.skipped);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not schedule your tasks.'); }
    await load().catch(() => {});
    if (message) setStatus(message);
  }, [userId, load]);

  useEffect(() => {
    load().then(() => after()).catch(e => setError(e instanceof Error ? e.message : 'Could not load your tasks.'));
    const changed = (e: Event) => { const d = (e as CustomEvent<RescheduleResult>).detail; if (d) setSchedule(d); };
    window.addEventListener(TASKS_CHANGED, changed);
    return () => window.removeEventListener(TASKS_CHANGED, changed);
  }, [load, after]);

  if (!snapshot) return error
    ? <div className={styles.page}><p role="alert" className={styles.error}>{error}</p></div>
    : <div className={styles.page}><SkeletonPage label="Loading your tasks…">{[0, 1, 2, 3].map(i => <div key={i} className={styles.skeletonRow}><SkeletonBlock width="60%" height={14} /></div>)}</SkeletonPage></div>;

  const subjects = snapshot.subjects.filter(s => !s.archived);
  // What Soma schedules, and what it could (not overdue yet). Old open to-dos
  // long past their date (from Day View and earlier versions) aren't tasks to plan.
  const today = localDate(new Date());
  const allTasks = tasksFrom(snapshot, userId).filter(t => t.managed || t.todo.dueDate!.slice(0, 10) >= today);
  const rowOf = (t: TaskInfo): ListRow => ({ todo: t.todo, status: statusOf(t.todo, snapshot.sessions, snapshot.history), tags: tagsOf(t.todo, snapshot.sessions) });
  const tasks = allTasks.filter(t => matches(rowOf(t), filter));
  const undated = undatedRows(snapshot).filter(r => matches(r, filter));
  const filtered = filter.course !== 'all' || filter.status !== 'all' || filter.type !== 'all' || filter.due !== 'all';
  const statusText = (r: ListRow) => r.status.kind === 'scheduled' ? `Scheduled ${whenLabel(r.status.at, timeFormat)}` : r.status.kind === 'missed' ? `Missed ${r.status.day.toLocaleDateString(undefined, { weekday: 'short' })}` : 'No time yet';
  const tagPills = (tags: ListTag[]) => tags.map(tag => <span key={tag} className={styles.tag}>{TAG_LABEL[tag]}</span>);
  const subjectOf = (t: TaskInfo) => snapshot.subjects.find(s => s.id === t.todo.subjectId);
  const lengthGuess = (text: string, subjectId?: string) => { const sb = subjects.find(x => x.id === subjectId); return sb && text.trim() ? estimate({ key: 'detail', title: text, subject: sb.name, subjectId: sb.id, color: '', due: '' }, snapshot.history).minutes : 60; };

  async function act(work: () => Promise<void>, message?: string) {
    if (busy) return;
    setBusy(true); setError(''); setStatus('');
    try { await work(); await after(message); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Please retry.'); }
    finally { setBusy(false); }
  }

  /** Drop `id` at position `to` in the list: its rank goes between its new neighbours. */
  const moveTo = (id: string, to: number) => {
    const from = tasks.findIndex(t => t.todo.id === id);
    if (from < 0 || to === from) return;
    const rest = tasks.filter(t => t.todo.id !== id);
    const at = Math.max(0, Math.min(rest.length, to > from ? to - 1 : to));
    const rank = rankBetween(rest[at - 1]?.rank, rest[at]?.rank);
    const task = tasks[from];
    void act(() => storage.saveTodo({ ...task.todo, rank }), `Moved “${task.todo.text}” to ${at === 0 ? 'the top' : `number ${at + 1}`}.`);
  };

  const setTotal = (t: TaskInfo, minutes: number) => act(() => storage.saveTodo({ ...t.todo, estimatedMinutes: Math.max(15, Math.min(1200, minutes)) }));
  const finish = async (t: TaskInfo) => {
    await act(async () => {
      await setTaskStatus(userId, snapshot, t.todo, 'done');
      await clearFutureSittings(userId, snapshot.sessions.filter(s => s.todoId === t.todo.id));
    }, `Done: “${t.todo.text}”.`);
    setUndo(t.todo);
  };
  /** Undo a check-off: the task is open again, and Soma places its sittings again. */
  const undoFinish = async () => {
    const todo = undo; if (!todo) return;
    setUndo(null);
    await act(() => storage.saveTodo(todo), `“${todo.text}” is back on your list.`);
  };
  const setManaged = (t: TaskInfo, on: boolean) => act(() => storage.saveTodo({ ...t.todo, autoSchedule: on }), on ? `Soma is scheduling “${t.todo.text}”.` : `Soma stopped scheduling “${t.todo.text}”. Its sittings stay on your plan.`);
  const pin = (sessionId: string, pinned: boolean) => act(() => setSittingPinned(userId, sessionId, pinned));

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Tasks</h1>
          <p>Soma fits these into your open study time in the days before they're due, aiming to finish a day early, and moves a sitting when you miss it. Top of the list goes first. Drag to change the order.</p>
        </div>
      </header>

      <div className={styles.addBar}>
        <button type="button" className={styles.addButton} data-tour="tasks" onClick={() => setAdding(true)}><Plus size={15} /> Add task</button>
      </div>

      <div className={styles.filters} role="group" aria-label="Filter tasks">
        <label>Course <select value={filter.course} onChange={e => setFilter({ ...filter, course: e.target.value })}>
          <option value="all">All courses</option>
          {subjects.filter(sb => sb.name !== 'Personal commitments').map(sb => <option key={sb.id} value={sb.id}>{sb.name}</option>)}
          <option value="personal">Personal</option>
        </select></label>
        <label>Status <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value as ListFilter['status'] })}>
          <option value="all">All</option><option value="scheduled">Scheduled</option><option value="none">No time yet</option><option value="missed">Missed</option>
        </select></label>
        <label>Type <select value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value as ListFilter['type'] })}>
          <option value="all">All</option><option value="single">Single</option><option value="multi-step">Multi-step</option><option value="multi-session">Multi-session</option>
        </select></label>
        <label>Due date <select value={filter.due} onChange={e => setFilter({ ...filter, due: e.target.value as ListFilter['due'] })}>
          <option value="all">Any</option><option value="dated">Has a due date</option><option value="undated">No due date</option>
        </select></label>
        {filtered && <button type="button" className={styles.link} onClick={() => setFilter({ course: 'all', status: 'all', type: 'all', due: 'all' })}>Clear filters</button>}
      </div>

      <div className={styles.live} aria-live="polite">
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {status && !error && <p className={styles.status}>{status}{undo && status.startsWith('Done:') && <> <button type="button" className={styles.link} disabled={busy} onClick={() => void undoFinish()}>Undo</button></>}</p>}
        {busy && <p className={styles.status}>Scheduling…</p>}
      </div>

      {filter.due !== 'undated' && <h2 className={styles.section}>With a due date</h2>}
      {filter.due === 'undated' ? null : !tasks.length ? <p className={styles.empty}>{filtered ? 'No tasks with a due date match these filters.' : 'No tasks with a due date yet. Add one with + Add task.'}</p> : (
        <ol className={styles.list} aria-label="Tasks, most important first" onDragOver={e => e.preventDefault()}>
          {tasks.map((t, i) => {
            const subject = subjectOf(t);
            const now = Date.now();
            const ahead = t.sittings.filter(s => !s.done && +s.end > now);
            const next = ahead[0];
            const short = t.managed ? schedule?.atRisk[t.todo.id] ?? 0 : 0;
            const finishBy = schedule?.finishBy[t.todo.id];
            const expanded = open.has(t.todo.id);
            return (
              <li
                key={t.todo.id}
                className={`${styles.row}${dragId === t.todo.id ? ` ${styles.dragging}` : ''}${overIndex === i && dragId && dragId !== t.todo.id ? ` ${styles.dropAbove}` : ''}`}
                onDragOver={e => { e.preventDefault(); setOverIndex(i); }}
                onDrop={e => { e.preventDefault(); if (dragId) moveTo(dragId, i); setDragId(null); setOverIndex(null); }}
              >
                <div className={styles.rowMain}>
                  <button
                    type="button"
                    className={styles.handle}
                    draggable={!filtered}
                    disabled={busy || filtered}
                    aria-label={`Reorder ${t.todo.text}. Use the up and down arrow keys.`}
                    title="Drag to change the order"
                    onDragStart={e => { setDragId(t.todo.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.todo.id); }}
                    onDragEnd={() => { setDragId(null); setOverIndex(null); }}
                    onKeyDown={e => {
                      if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); moveTo(t.todo.id, i - 1); }
                      if (e.key === 'ArrowDown' && i < tasks.length - 1) { e.preventDefault(); moveTo(t.todo.id, i + 2); }
                    }}
                  ><GripVertical size={15} /></button>
                  <input type="checkbox" className={styles.check} aria-label={`Done: ${t.todo.text}`} disabled={busy} onChange={() => void finish(t)} />
                  <span className={styles.dot} style={{ background: subject?.color ?? 'var(--text-muted)' }} />
                  <div className={styles.info}>
                    <button type="button" className={styles.title} aria-label={`Details: ${t.todo.text}`} onClick={() => setDetails(t.todo)}>{t.todo.text}</button>
                    <span className={styles.meta}>{tagPills(rowOf(t).tags)}{subject?.name ?? 'Personal'} · {t.todo.myDue ? 'Due for you' : 'Due'} {dueLabel(deadlineOf(t.todo)!, timeFormat)}{t.todo.steps?.length ? ` · ${t.todo.steps.length} ${t.todo.steps.length === 1 ? 'step' : 'steps'}` : ''}</span>
                  </div>
                  <div className={styles.left} role="group" aria-label={`Time for ${t.todo.text}`}>
                    <button type="button" disabled={busy || t.total <= 15 || !!t.todo.steps?.length} aria-label={`30 minutes less for ${t.todo.text}`} onClick={() => void setTotal(t, t.total - 30)}>−</button>
                    <span title={t.basis ? `Soma's guess: ${t.basis}` : `${hours(t.total)} in all`}>{t.left ? `${hours(t.left)} left` : 'Covered'}</span>
                    <button type="button" disabled={busy || !!t.todo.steps?.length} aria-label={`30 minutes more for ${t.todo.text}`} onClick={() => void setTotal(t, t.total + 30)}>+</button>
                  </div>
                  <div className={styles.next}>
                    {!t.managed ? <button type="button" className={styles.link} disabled={busy} onClick={() => void setManaged(t, true)}>Schedule</button>
                      : next ? <span>Next: {whenLabel(next.start, timeFormat)}</span>
                      : t.left ? <span className={styles.muted}>Waiting for open time</span> : <span className={styles.muted}>Nothing left to place</span>}
                    {short > 0 && <span className={styles.risk}>{hours(short)} doesn’t fit{finishBy ? ` by ${finishBy.toLocaleDateString(undefined, { weekday: 'short' })}` : ''}</span>}
                  </div>
                  <button type="button" className={styles.expand} aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} sittings for ${t.todo.text}`} onClick={() => setOpen(o => { const n = new Set(o); if (n.has(t.todo.id)) n.delete(t.todo.id); else n.add(t.todo.id); return n; })}>
                    {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                </div>
                {expanded && (
                  <div className={styles.detail}>
                    {ahead.length ? <ul className={styles.sittings}>
                      {ahead.map(s => (
                        <li key={s.id}>
                          <span>{whenLabel(s.start, timeFormat)} – {formatClock(hm(s.end), timeFormat)}{s.stepId && t.todo.steps?.find(x => x.id === s.stepId) ? ` · ${t.todo.steps.find(x => x.id === s.stepId)!.title}` : ''}</span>
                          <span className={styles.muted}>{hours(Math.round((+s.end - +s.start) / 60000))}{s.started ? ' · started' : ''}</span>
                          <button type="button" className={styles.pin} disabled={busy} aria-pressed={s.pinned} aria-label={s.pinned ? 'Unpin this sitting' : 'Pin this sitting so it never moves'} title={s.pinned ? 'Pinned: Soma won’t move it' : 'Pin so Soma won’t move it'} onClick={() => void pin(s.id, !s.pinned)}>
                            {s.pinned ? <Pin size={13} /> : <PinOff size={13} />}{s.pinned ? 'Pinned' : 'Pin'}
                          </button>
                        </li>
                      ))}
                    </ul> : <p className={styles.muted}>No sittings ahead.</p>}
                    <p className={styles.detailFoot}>
                      {hours(t.total)} in all{t.logged ? ` · ${hours(t.logged)} logged` : ''}{t.basis ? ` · Soma's guess (${t.basis})` : ''}
                      {t.managed && <> · <button type="button" className={styles.link} disabled={busy} onClick={() => void setManaged(t, false)}>Stop scheduling</button></>}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
          <li className={`${styles.endDrop}${overIndex === tasks.length ? ` ${styles.dropAbove}` : ''}`} aria-hidden="true"
            onDragOver={e => { e.preventDefault(); setOverIndex(tasks.length); }}
            onDrop={e => { e.preventDefault(); if (dragId) moveTo(dragId, tasks.length); setDragId(null); setOverIndex(null); }} />
        </ol>
      )}
      {filter.due !== 'dated' && <>
        <h2 className={styles.section}>No due date</h2>
        {!undated.length ? <p className={styles.empty}>{filtered ? 'Nothing here matches these filters.' : 'Work you take off the calendar, and to-dos with no due date, wait here.'}</p> : (
          <ul className={styles.list} aria-label="Tasks with no due date">
            {undated.map(r => {
              const subject = snapshot.subjects.find(sb => sb.id === r.todo.subjectId);
              return (
                <li key={r.todo.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <span className={styles.handle} aria-hidden="true" />
                    <input type="checkbox" className={styles.check} aria-label={`Done: ${r.todo.text}`} disabled={busy} onChange={() => void act(async () => { await setTaskStatus(userId, snapshot, r.todo, 'done'); }, `Done: “${r.todo.text}”.`)} />
                    <span className={styles.dot} style={{ background: subject?.color ?? 'var(--text-muted)' }} />
                    <div className={styles.info}>
                      <button type="button" className={styles.title} aria-label={`Details: ${r.todo.text}`} onClick={() => setDetails(r.todo)}>{r.todo.text}</button>
                      <span className={styles.meta}>{tagPills(r.tags)}{subject?.name ?? 'Personal'} · <span className={r.status.kind === 'missed' ? styles.risk : undefined}>{statusText(r)}</span></span>
                    </div>
                    <div className={styles.next}>
                      {r.status.kind === 'scheduled' ? <span>Next: {whenLabel(r.status.at, timeFormat)}</span>
                        : <button type="button" className={styles.link} disabled={busy} aria-label={`Schedule ${r.todo.text}`} onClick={() => void act(async () => {
                          const minutes = r.todo.estimatedMinutes || lengthGuess(r.todo.text, r.todo.subjectId);
                          const at = await placeTodo(userId, r.todo, minutes);
                          if (!at) throw new Error(`No open ${hours(minutes)} in the next week for “${r.todo.text}”.`);
                        }, `Scheduled “${r.todo.text}”.`)}>Schedule it</button>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </>}
      {details && <TaskDetail userId={userId} target={{ todo: details }} subjects={subjects} sessions={snapshot.sessions} guess={lengthGuess}
        onClose={saved => { setDetails(null); if (saved) void after('Saved. Soma placed it again.'); }} />}
      {adding && <TaskDetail userId={userId} target={{ seed: { title: '' } }} subjects={subjects} sessions={snapshot.sessions} guess={lengthGuess}
        onClose={saved => { setAdding(false); if (saved) void after('Added. Soma placed it.'); }} />}
    </div>
  );
}
