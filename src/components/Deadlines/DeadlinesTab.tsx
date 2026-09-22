import { useState, useEffect } from 'react';
import { storage } from '../../lib/storage';
import { formatDateTime, useTimeFormat } from '../../lib/timeFormat';
import { CanvasAssignment, Todo } from '../../types';
import { getIcalAssignments } from '../../lib/canvas';
import { SkeletonBlock } from '../UI/Skeleton';
import styles from './DeadlinesTab.module.css';

/**
 * Everything that is due, whatever it came from. Canvas assignments arrive
 * from the calendar feed; classes that keep their schedule on their own site
 * (cs61a.org and the like) are imported as tasks with a due date, and so are
 * the tasks a student writes themselves. All of it is one list grouped by
 * day, because "what is due on Thursday" does not care which source it
 * came from.
 *
 * Canvas and tasks keep their own storage: assignment status lives in the
 * assignmentStatus/clearedAssignments maps that Day View and the AI context
 * also read, while a task's status is a column on the row. The two are
 * mapped onto one status here rather than merged underneath.
 */

type Status = 'not_started' | 'in_progress' | 'done';

/** A row in the list, from either source. */
type Deadline = {
  key: string;
  source: 'canvas' | 'task';
  canvasId: number | null;
  todoId: string | null;
  title: string;
  courseName: string;
  color: string;
  dueKey: string;
  dueLabel: string;
  status: Status;
  url: string | null;
};

const TODO_TO_STATUS: Record<Todo['status'], Status> = {
  nothing: 'not_started', in_progress: 'in_progress', done: 'done',
};
const STATUS_TO_TODO: Record<Status, Todo['status']> = {
  not_started: 'nothing', in_progress: 'in_progress', done: 'done',
};

/** Tasks with no course still have to appear; they group under one label. */
const NO_COURSE = 'No course';

function AssignmentSkeleton() {
  const widths = [170, 210, 145, 192, 128];
  return (
    <div>
      {widths.map((w, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <SkeletonBlock width={10} height={10} borderRadius="50%" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <SkeletonBlock width={w} height={13} />
            <SkeletonBlock width={76} height={11} />
          </div>
          <SkeletonBlock width={64} height={11} />
        </div>
      ))}
    </div>
  );
}

const COURSE_COLORS = [
  '#ef5350', '#42a5f5', '#66bb6a', '#ab47bc',
  '#ffa726', '#26c6da', '#ec407a', '#8d6e63',
];
const CACHE_MAX_AGE = 10 * 60 * 1000;

function fmtDueTime(iso: string) {
  return formatDateTime(new Date(iso));
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// Flags anything before today as overdue instead of just reading like any
// other weekday — a past-due assignment shouldn't look identical to a future
// one. Today/Tomorrow always carry their actual date alongside the label.
function assignmentDayLabel(dateKey: string): { label: string; overdue: boolean } {
  const today = startOfLocalDay(new Date());
  const tomorrow = addDays(today, 1);
  const dateLabel = new Date(`${dateKey}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  if (dateKey < dayKey(today)) return { label: `Overdue · ${dateLabel}`, overdue: true };
  if (dateKey === dayKey(today)) return { label: `Today · ${dateLabel}`, overdue: false };
  if (dateKey === dayKey(tomorrow)) return { label: `Tomorrow · ${dateLabel}`, overdue: false };
  return { label: dateLabel, overdue: false };
}

function fmtSynced(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  return `${mins} mins ago`;
}

export default function DeadlinesTab() {
  useTimeFormat(); // re-render when the 12h/24h preference changes
  const [icalUrl, setIcalUrl] = useState(() => storage.getCanvasIcalUrl());
  const [setupIcalUrl, setSetupIcalUrl] = useState('');
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [icalSyncing, setIcalSyncing] = useState(false);
  const [icalError, setIcalError] = useState('');

  const [assignments, setAssignments] = useState<CanvasAssignment[]>(
    () => storage.getCachedIcalAssignments(),
  );
  const [assignmentStatus, setAssignmentStatus] = useState<Record<number, string>>(
    () => storage.getAssignmentStatus(),
  );
  const [clearedAssignments, setClearedAssignments] = useState<Record<number, boolean>>(
    () => storage.getClearedAssignments(),
  );
  // Courses are filtered by name: Canvas courses are synced into Subjects by
  // name already, so it is the one key both sources share.
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<number | null>(() => storage.getCacheTimestamp());
  const [statusFilter, setStatusFilter] = useState<'all' | 'not_started' | 'in_progress' | 'done'>('all');

  // Imported and hand-written tasks. getTodos() is a synchronous read of a
  // list filled in asynchronously, so this starts with whatever is cached and
  // is refreshed once the real load settles.
  const [todos, setTodos] = useState<Todo[]>(() => storage.getTodos());
  const [taskError, setTaskError] = useState('');

  // storage.getSubjects() (used below to color-link each course to its
  // Subject) reads an in-memory list populated asynchronously by
  // loadTokens() -> loadSubjects(). This component re-reads it fresh on
  // every render but has no listener tied to subjects finishing loading, so
  // a render that happens to land before that resolves can silently fall
  // back to the index-based palette instead of the real subject color —
  // and nothing re-renders afterward to correct it. Force one re-render
  // once loading settles, same fix as Documents/Settings/AI.
  const [, forceSubjectColorRecheck] = useState(0);
  useEffect(() => {
    let cancelled = false;
    storage.whenTokensLoaded().then(() => {
      if (!cancelled) forceSubjectColorRecheck(n => n + 1);
    });
    return () => { cancelled = true; };
  }, []);

  // Tasks come from Supabase, not the feed cache, and the import flow, the
  // dashboard and the AI all change them from elsewhere — so refresh on the
  // same event those paths already dispatch.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { if (!cancelled) setTodos(storage.getTodos()); };
    void storage.whenTokensLoaded().then(refresh);
    void storage.fetchAllTodos()
      .then(refresh)
      .catch(e => { if (!cancelled) setTaskError(e instanceof Error ? e.message : 'Could not load your tasks.'); });
    window.addEventListener('soma_todos_changed', refresh);
    return () => { cancelled = true; window.removeEventListener('soma_todos_changed', refresh); };
  }, []);

  useEffect(() => {
    if (!icalUrl) return;
    const cached = storage.getCachedIcalAssignments();
    const cacheTs = storage.getCacheTimestamp();
    const cacheFresh = !!cacheTs && Date.now() - cacheTs < CACHE_MAX_AGE;
    if (cached.length === 0 || !cacheFresh) {
      loadIcalData();
    } else {
      void storage.syncCanvasSubjects(cached).catch(e => {
        setIcalError(e instanceof Error ? e.message : 'Could not save Canvas courses.');
      });
    }
  }, [icalUrl]);

  // getCanvasIcalUrl() reads an in-memory value populated asynchronously by
  // storage.loadTokens(). If this tab mounts before that finishes (direct
  // navigation to /canvas, a slow connection, etc.), the initial useState
  // above can capture an empty string even though Canvas is actually
  // connected. Rather than gate the whole page behind a "Checking..."
  // placeholder while that resolves, show the "Connect Canvas" prompt
  // immediately — a real user with no connection wants that instruction
  // right away, not a spinner — and quietly upgrade to the connected view
  // the moment the real state comes back, with no action needed from them.
  useEffect(() => {
    if (icalUrl) return;
    let cancelled = false;
    storage.whenTokensLoaded().then(() => {
      if (cancelled) return;
      const latest = storage.getCanvasIcalUrl();
      if (latest) setIcalUrl(latest);
    });
    return () => { cancelled = true; };
  }, [icalUrl]);

  async function loadIcalData() {
    if (!icalUrl) return;
    setIcalSyncing(true);
    setIcalError('');
    try {
      const fetched = await getIcalAssignments(icalUrl);
      await storage.syncCanvasSubjects(fetched);
      storage.setCachedIcalAssignments(fetched);
      storage.setCacheTimestamp(Date.now());
      setAssignments(fetched);
      setLastSynced(Date.now());
    } catch (e: unknown) {
      setIcalError(e instanceof Error ? e.message : 'Failed to sync calendar feed');
    } finally {
      setIcalSyncing(false);
    }
  }

  async function handleConnectIcal() {
    const url = setupIcalUrl.trim();
    if (!url) return;
    setConnectLoading(true);
    setConnectError('');
    try {
      const fetched = await getIcalAssignments(url);
      await storage.syncCanvasSubjects(fetched);
      storage.setCanvasIcalUrl(url);
      storage.setCachedIcalAssignments(fetched);
      storage.setCacheTimestamp(Date.now());
      setIcalUrl(url);
      setAssignments(fetched);
      setLastSynced(Date.now());
      setSetupIcalUrl('');
    } catch (e: unknown) {
      setConnectError(e instanceof Error ? e.message : 'Invalid calendar feed URL.');
    } finally {
      setConnectLoading(false);
    }
  }

  function handleDisconnect() {
    storage.setCanvasIcalUrl('');
    storage.setCachedIcalAssignments([]);
    storage.setCachedAssignments([]);
    setIcalUrl('');
    setAssignments([]);
  }

  function updateStatus(id: number, status: string) {
    const updated = { ...assignmentStatus, [String(id)]: status };
    storage.setAssignmentStatus(updated);
    setAssignmentStatus(updated);

    if (status === 'done') {
      setAssignmentCleared(id, true);
    } else {
      setAssignmentCleared(id, false);
      setStatusFilter(status as 'not_started' | 'in_progress');
    }

    const todoStatusMap: Record<string, Todo['status']> = {
      not_started: 'nothing',
      in_progress: 'in_progress',
      done: 'done',
    };
    const newTodoStatus = todoStatusMap[status];
    if (newTodoStatus) {
      const todos = storage.getTodos();
      const updatedTodos = todos.map(t =>
        t.assignmentId === id ? { ...t, status: newTodoStatus } : t,
      );
      if (updatedTodos.some((t, i) => t.status !== todos[i].status)) {
        storage.setTodos(updatedTodos);
      }
    }
  }

  function setAssignmentCleared(id: number, cleared: boolean) {
    const updated = { ...clearedAssignments };
    if (cleared) {
      updated[id] = true;
    } else {
      delete updated[id];
    }
    storage.setClearedAssignments(updated);
    setClearedAssignments(updated);
  }

  // A task's status is a column, so this writes through to the row. Applied
  // optimistically and rolled back on failure, because the list is grouped
  // and filtered by status — a silent failure would move the row and then
  // leave it in the wrong group.
  async function updateTaskStatus(todoId: string, status: Status) {
    const previous = storage.getTodos().find(t => t.id === todoId);
    if (!previous) return;
    const next: Todo = { ...previous, status: STATUS_TO_TODO[status] };
    setTaskError('');
    setTodos(ts => ts.map(t => (t.id === todoId ? next : t)));
    try {
      await storage.saveTodo(next);
      await storage.fetchAllTodos();
      window.dispatchEvent(new Event('soma_todos_changed'));
    } catch (e) {
      setTodos(ts => ts.map(t => (t.id === todoId ? previous : t)));
      setTaskError(e instanceof Error ? e.message : 'Could not save that change.');
    }
  }

  const datedTodos = todos.filter(t => !!t.dueDate);

  // ── Setup card ──────────────────────────────────────────────────────────────
  // Only when there is genuinely nothing to show. A student who imports from a
  // course site and never connects Canvas still has deadlines, and used to be
  // shown this prompt instead of them.
  if (!icalUrl && datedTodos.length === 0) {
    return (
      <div className={styles.setupOverlay}>
        <div className={styles.setupCard}>
          <span className={styles.setupTitle}>Connect Canvas</span>
          <div className={styles.setupHintNoBorder}>
            Paste your Canvas calendar feed URL to sync assignment due dates — no token needed.
          </div>
          <div className={styles.setupField}>
            <label className={styles.setupLabel}>Canvas Calendar Feed URL</label>
            <input
              className={styles.setupInput}
              placeholder="https://school.instructure.com/feeds/calendars/user_...ics"
              value={setupIcalUrl}
              onChange={e => setSetupIcalUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConnectIcal(); }}
            />
          </div>
          {connectError && <span className={styles.setupError}>{connectError}</span>}
          <button
            className={styles.setupBtn}
            onClick={handleConnectIcal}
            disabled={connectLoading || !setupIcalUrl.trim()}
          >
            {connectLoading ? 'Connecting…' : 'Connect'}
          </button>
          <div className={styles.setupHint}>
            <strong>How to get your calendar URL:</strong><br />
            Canvas → Calendar → scroll to bottom right → Calendar Feed → copy the link
          </div>
        </div>
      </div>
    );
  }

  // ── Main view ────────────────────────────────────────────────────────────────
  const subjects = storage.getSubjects();
  const archivedCourseNames = new Set(subjects.filter(s => s.archived).map(s => s.name));
  const subjectsByName = new Map(subjects.map(s => [s.name, s]));
  const subjectsById = new Map(subjects.map(s => [s.id, s]));

  const canvasCourseIds = [...new Map(
    assignments
      .filter(a => a.courseId && a.courseName && !archivedCourseNames.has(a.courseName))
      .map(a => [a.courseId, a.courseName]),
  )];
  const courseColorMap = Object.fromEntries(
    canvasCourseIds.map(([id], i) => [id, COURSE_COLORS[i % COURSE_COLORS.length]]),
  );
  const courseColor = (courseId: number, courseName: string) =>
    subjectsByName.get(courseName)?.color ?? courseColorMap[courseId] ?? '#888';

  const canvasItems: Deadline[] = assignments
    .filter(a => !archivedCourseNames.has(a.courseName))
    .map(a => ({
      key: `canvas-${a.id}`,
      source: 'canvas' as const,
      canvasId: a.id,
      todoId: null,
      title: a.name,
      courseName: a.courseName,
      color: courseColor(a.courseId, a.courseName),
      dueKey: dayKey(new Date(a.dueAt)),
      dueLabel: fmtDueTime(a.dueAt),
      status: (assignmentStatus[a.id] ?? 'not_started') as Status,
      url: a.htmlUrl,
    }));

  // A task imported from a course site already exists as a Canvas assignment
  // when a course is on both; assignmentId is what links them, so those are
  // dropped rather than listed twice.
  const canvasIds = new Set(assignments.map(a => a.id));
  const taskItems: Deadline[] = datedTodos
    .filter(t => !(t.assignmentId && canvasIds.has(t.assignmentId)))
    .map(t => {
      const subject = t.subjectId ? subjectsById.get(t.subjectId) : undefined;
      return {
        key: `task-${t.id}`,
        source: 'task' as const,
        canvasId: null,
        todoId: t.id,
        title: t.text,
        courseName: subject?.name ?? NO_COURSE,
        color: subject?.color ?? '#888',
        // Tasks carry a date with no time of day, so the day heading is the
        // whole story and the time column says as much.
        dueKey: t.dueDate!,
        dueLabel: 'All day',
        status: TODO_TO_STATUS[t.status],
        url: null,
      };
    })
    .filter(item => item.courseName === NO_COURSE || !archivedCourseNames.has(item.courseName));

  const allItems = [...canvasItems, ...taskItems];

  const courseNames = [...new Set(allItems.map(i => i.courseName))].sort((a, b) =>
    a === NO_COURSE ? 1 : b === NO_COURSE ? -1 : a.localeCompare(b),
  );

  const isDone = (item: Deadline) =>
    item.source === 'canvas' ? !!clearedAssignments[item.canvasId!] : item.status === 'done';

  const filtered = allItems
    .filter(i => selectedCourse === null || i.courseName === selectedCourse)
    .filter(i => (statusFilter === 'done' ? isDone(i) : !isDone(i)))
    .filter(i => statusFilter === 'all' || statusFilter === 'done' || i.status === statusFilter)
    .sort((a, b) => (a.dueKey === b.dueKey ? a.title.localeCompare(b.title) : a.dueKey.localeCompare(b.dueKey)));

  const doneCount = allItems.filter(isDone).length;

  // Group by due date (Today, Tomorrow, weekday...) so the page reads the
  // way Canvas's own dashboard does — what's due when — while course stays
  // visible per row via its subject color and a filter above, instead of
  // owning the top-level grouping.
  const dateGroups = new Map<string, Deadline[]>();
  for (const item of filtered) {
    if (!dateGroups.has(item.dueKey)) dateGroups.set(item.dueKey, []);
    dateGroups.get(item.dueKey)!.push(item);
  }
  const orderedDateKeys = [...dateGroups.keys()].sort();

  function renderRow(item: Deadline) {
    const done = isDone(item);
    const open = () => { if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer'); };
    return (
      <div
        key={item.key}
        className={`${styles.assignmentCard}${item.status === 'done' ? ` ${styles.done}` : ''}${done ? ` ${styles.cleared}` : ''}`}
        onClick={item.url ? open : undefined}
        style={item.url ? undefined : { cursor: 'default' }}
      >
        <span className={styles.dot} style={{ background: item.color, opacity: done ? 0.3 : 1 }} />
        <div className={styles.assignmentInfo}>
          <span className={styles.assignmentCourse}>{item.courseName}</span>
          <span className={styles.assignmentName}>{item.title}</span>
        </div>
        <span className={styles.dueTime}>{item.dueLabel}</span>
        <div className={styles.assignmentControls} onClick={e => e.stopPropagation()}>
          <select
            className={`${styles.statusSelect}${item.status === 'done' ? ` ${styles.statusSelectDone}` : ''}`}
            value={item.status}
            aria-label={`Status: ${item.title}`}
            onChange={e => {
              const next = e.target.value as Status;
              if (item.source === 'canvas') updateStatus(item.canvasId!, next);
              else void updateTaskStatus(item.todoId!, next);
            }}
          >
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
          </select>
          {item.url && (
            <a
              className={styles.externalLink}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in Canvas"
            >↗</a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div className={styles.subNav}>
          <button className={`${styles.subNavBtn} ${styles.subNavBtnActive}`}>Everything due</button>
        </div>
        <div className={styles.syncRow}>
          {icalUrl && lastSynced && (
            <span className={styles.syncLabel}>
              📅 Calendar Feed · Last synced: {fmtSynced(lastSynced)}
            </span>
          )}
          {icalError && <span className={styles.syncError}>{icalError}</span>}
          {taskError && <span className={styles.syncError} role="alert">{taskError}</span>}
          {icalUrl && (
            <button
              className={styles.refreshBtn}
              onClick={loadIcalData}
              disabled={icalSyncing}
              title="Refresh"
            >{icalSyncing ? '…' : '↻'}</button>
          )}
        </div>
        {icalUrl && (
          <button className={styles.disconnectLink} onClick={handleDisconnect}>Disconnect</button>
        )}
      </div>

      <div className={styles.main}>
        {/* Canvas is not connected but there are deadlines to show, so this
            offers the connection rather than standing in front of them. */}
        {!icalUrl && (
          <div className={styles.setupHintNoBorder} style={{ marginBottom: 14 }}>
            These are your imported and hand-written deadlines.{' '}
            <a href="/settings">Connect Canvas</a> to pull your assignments in too.
          </div>
        )}

        {icalSyncing && assignments.length === 0 && datedTodos.length === 0 && <AssignmentSkeleton />}

        {!(icalSyncing && assignments.length === 0 && datedTodos.length === 0) && (
          <>
            <div className={styles.filterBar}>
              <select
                className={styles.filterSelect}
                value={statusFilter}
                aria-label="Filter by status"
                onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
              >
                {(['all', 'not_started', 'in_progress', 'done'] as const).map(f => {
                  const label =
                    f === 'all' ? 'Active' :
                    f === 'not_started' ? 'Not started' :
                    f === 'in_progress' ? 'In progress' :
                    doneCount > 0 ? `Done (${doneCount})` : 'Done';
                  return <option key={f} value={f}>{label}</option>;
                })}
              </select>

              <select
                className={styles.filterSelect}
                value={selectedCourse ?? ''}
                aria-label="Filter by course"
                onChange={e => setSelectedCourse(e.target.value || null)}
              >
                <option value="">All courses</option>
                {courseNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            {filtered.length === 0 ? (
              <div className={styles.empty}>
                {statusFilter === 'done' ? 'Nothing completed yet.' : 'Nothing due.'}
              </div>
            ) : (
              <div className={styles.dateGroups}>
                {orderedDateKeys.map(key => {
                  const dayItems = dateGroups.get(key) ?? [];
                  const { label, overdue } = assignmentDayLabel(key);
                  return (
                    <div key={key} className={styles.dateGroup}>
                      <div className={styles.dateGroupHeader}>
                        <span className={`${styles.dateGroupLabel}${overdue ? ` ${styles.dateGroupLabelOverdue}` : ''}`}>
                          {label}
                        </span>
                        <span className={styles.dateGroupCount}>{dayItems.length}</span>
                      </div>
                      <div className={styles.assignmentList}>
                        {dayItems.map(renderRow)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
