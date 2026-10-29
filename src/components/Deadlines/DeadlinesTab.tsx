import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { storage } from '../../lib/storage';
import { subjectForCourse } from '../../lib/canvasDeepSync';
import type { PlanTarget } from '../../lib/planIt';
import { formatDateTime, useTimeFormat } from '../../lib/timeFormat';
import { CanvasAssignment, Todo, TodoKind, isSubmittable } from '../../types';
import { CANVAS_CHANGED, EXTENSION_STORE_URL, deepSyncStatus, extensionPresent, requestSync } from '../../lib/canvasExtension';
import WhatChanged from './WhatChanged';
import ExtensionSetup from '../Onboarding/ExtensionSetup';
import { SkeletonBlock, SkeletonPage } from '../UI/Skeleton';
import styles from './DeadlinesTab.module.css';

/**
 * Everything that is due, whatever it came from. Canvas assignments arrive
 * from the Soma for Canvas extension; classes that keep their schedule on their own site
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
  /** Handed in on Gradescope or WebAssign, the easy ones to forget. */
  platform?: 'gradescope' | 'webassign';
  progress?: string;
  /** An exam or test: it gets "Plan review" (exam mode). */
  exam?: boolean;
  /** When it is, for the review request: the due time, or the day. */
  whenLabel?: string;
  /** What Plan it plans, on the dashboard. */
  plan?: PlanTarget;
};

/** Names that mean an exam rather than homework: "Midterm 1", "Final Exam", "Test 2". */
const EXAM_NAME = /\b(exam|midterm|final|test)\b/i;

const TODO_TO_STATUS: Record<Todo['status'], Status> = {
  nothing: 'not_started', in_progress: 'in_progress', done: 'done',
};
const STATUS_TO_TODO: Record<Status, Todo['status']> = {
  not_started: 'nothing', in_progress: 'in_progress', done: 'done',
};

const PLATFORM_NAMES = { gradescope: 'Gradescope', webassign: 'WebAssign' } as const;

/**
 * The kind "Hand in" gives a task with none, read from its name so the label
 * is not plainly wrong where the kind shows (the morning brief, the Claude
 * connector). Anything unrecognised is homework.
 */
function handInKind(title: string): TodoKind {
  if (EXAM_NAME.test(title)) return 'exam';
  if (/\bquiz/i.test(title)) return 'quiz';
  if (/\blabs?\b/i.test(title)) return 'lab';
  if (/\bproj(ect)?s?\b/i.test(title)) return 'project';
  return 'homework';
}

/** Tasks with no course still have to appear; they group under one label. */
const NO_COURSE = 'No course';

function DeadlinesSkeleton() {
  return (
    <SkeletonPage label="Loading your deadlines…">
      <div className={styles.filterBar}>
        <SkeletonBlock width={132} height={34} borderRadius={8} />
        <SkeletonBlock width={148} height={34} borderRadius={8} />
      </div>
      <div className={styles.dateGroups}>
        {[3, 2].map((rows, group) => (
          <div key={group} className={styles.dateGroup}>
            <div className={styles.dateGroupHeader}>
              <SkeletonBlock width={group === 0 ? 132 : 104} height={12} />
              <SkeletonBlock width={16} height={12} />
            </div>
            <div className={styles.assignmentList}>
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <SkeletonBlock width={10} height={10} borderRadius="50%" />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <SkeletonBlock width={[196, 150, 224, 168, 140][i % 5]} height={13} />
                    <SkeletonBlock width={82} height={11} />
                  </div>
                  <SkeletonBlock width={64} height={11} />
                  <SkeletonBlock width={96} height={26} borderRadius={6} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}

const COURSE_COLORS = [
  '#ef5350', '#42a5f5', '#66bb6a', '#ab47bc',
  '#ffa726', '#26c6da', '#ec407a', '#8d6e63',
];

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
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  // Canvas comes from the Soma for Canvas extension; this is when it last synced.
  const [synced, setSynced] = useState(() => deepSyncStatus()[0]?.syncedAt ?? null);

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
  const [statusFilter, setStatusFilter] = useState<'all' | 'not_started' | 'in_progress' | 'done'>('all');

  // Imported and hand-written tasks. getTodos() is a synchronous read of a
  // list filled in asynchronously, so this starts with whatever is cached and
  // is refreshed once the real load settles.
  const [todos, setTodos] = useState<Todo[]>(() => storage.getTodos());
  // Tasks come from Supabase, so until that settles the page cannot tell an
  // empty account from one that simply has not answered yet.
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [taskError, setTaskError] = useState('');
  const [showUnsorted, setShowUnsorted] = useState(false);

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
      .catch(e => { if (!cancelled) setTaskError(e instanceof Error ? e.message : 'Could not load your tasks.'); })
      .finally(() => { if (!cancelled) setTasksLoaded(true); });
    window.addEventListener('soma_todos_changed', refresh);
    return () => { cancelled = true; window.removeEventListener('soma_todos_changed', refresh); };
  }, []);

  // The Canvas extension's sync can land while this page is open.
  useEffect(() => {
    const refresh = () => { setAssignments(storage.getCachedIcalAssignments()); setSynced(deepSyncStatus()[0]?.syncedAt ?? null); };
    window.addEventListener(CANVAS_CHANGED, refresh);
    return () => window.removeEventListener(CANVAS_CHANGED, refresh);
  }, []);

  async function refreshNow() {
    setSyncing(true); setSyncError('');
    const results = await requestSync(60_000);
    setSyncing(false);
    if (!results.length) setSyncError('The extension didn’t answer. Make sure it’s turned on in Chrome.');
    else if (results.some(r => !r.ok)) setSyncError(results.filter(r => !r.ok).map(r => `${r.host}: ${r.error ?? 'didn’t sync'}`).join(' '));
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

  // Sorting a task with no kind: "Hand in" makes it a deadline, "Prepare" takes
  // it off this page. Same optimistic write and rollback as the status.
  async function sortTask(todoId: string, kind: TodoKind) {
    const previous = storage.getTodos().find(t => t.id === todoId);
    if (!previous) return;
    const next: Todo = { ...previous, kind };
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
  // Still waiting on whichever source could fill the page, with nothing cached
  // to show in the meantime.
  const loading = (!tasksLoaded)
    && assignments.length === 0 && datedTodos.length === 0;
  const anyToShow = datedTodos.some(t => isSubmittable(t.kind) || !!t.assignmentId || !t.kind);

  // ── Setup card ──────────────────────────────────────────────────────────────
  // Only when there is genuinely nothing to show. A student who imports from a
  // course site and never connects Canvas still has deadlines, and used to be
  // shown this prompt instead of them.
  if (!anyToShow && assignments.length === 0 && tasksLoaded) {
    return (
      <div className={styles.setupOverlay}>
        <div className={styles.guideCard}>
          <span className={styles.setupTitle}>Bring in Canvas</span>
          <ExtensionSetup />
        </div>
      </div>
    );
  }

  // ── Main view ────────────────────────────────────────────────────────────────
  const subjects = storage.getSubjects();
  const archivedCourseNames = new Set(subjects.filter(s => s.archived).map(s => s.name));
  const subjectsById = new Map(subjects.map(s => [s.id, s]));
  // Synced work goes under the student's own course for it (subjectForCourse,
  // the same match the dashboard, Calendar and Soma use), by its name there.
  const courseOf = (a: CanvasAssignment) => subjectForCourse(subjects, a.courseId, a.courseName);
  const shownAssignments = assignments.filter(a => !courseOf(a)?.archived);

  const canvasCourseIds = [...new Map(
    shownAssignments
      .filter(a => a.courseId && a.courseName)
      .map(a => [a.courseId, a.courseName]),
  )];
  const courseColorMap = Object.fromEntries(
    canvasCourseIds.map(([id], i) => [id, COURSE_COLORS[i % COURSE_COLORS.length]]),
  );

  const canvasItems: Deadline[] = shownAssignments
    .map(a => ({
      key: `canvas-${a.id}`,
      source: 'canvas' as const,
      canvasId: a.id,
      todoId: null,
      title: a.name,
      courseName: courseOf(a)?.name ?? a.courseName,
      color: courseOf(a)?.color ?? courseColorMap[a.courseId] ?? '#888',
      plan: { key: `canvas-${a.id}`, title: a.name, subject: courseOf(a)?.name ?? a.courseName, subjectId: courseOf(a)?.id, color: 'blue', due: a.dueAt },
      dueKey: dayKey(new Date(a.dueAt)),
      dueLabel: fmtDueTime(a.dueAt),
      // A status the student set wins; otherwise what Canvas, Gradescope or
      // WebAssign say (handed in is done; WebAssign partly answered is in progress).
      status: (assignmentStatus[a.id] ?? a.status ?? 'not_started') as Status,
      url: a.htmlUrl,
      ...(a.platform ? { platform: a.platform } : {}),
      ...(a.progress ? { progress: a.progress } : {}),
      ...(EXAM_NAME.test(a.name) ? { exam: true } : {}),
      whenLabel: new Date(a.dueAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    }));

  // A task imported from a course site already exists as a Canvas assignment
  // when a course is on both; assignmentId is what links them, so those are
  // dropped rather than listed twice.
  const canvasIds = new Set(assignments.map(a => a.id));

  // This page is for work that has to be handed in. A reading or a study block
  // a student wrote for themselves has a date without being a deadline, and
  // burying Lab 3 among the chapters to read is how the page stopped being
  // useful. A task linked to a Canvas assignment counts whatever its kind.
  const submittable = (t: Todo) => isSubmittable(t.kind) || !!t.assignmentId;
  // No kind: written by hand, added by the AI, or imported before the kind
  // column existed. Nothing on the row says which, so these are not guessed
  // at: they get their own "Not sorted" group, where the student sorts each
  // one (re-importing a course site also sorts the ones it finds).
  const unsorted = datedTodos
    .filter(t => !t.kind && !t.assignmentId && t.status !== 'done')
    .map(t => ({ todo: t, subject: t.subjectId ? subjectsById.get(t.subjectId) : undefined }))
    .filter(({ subject }) => !subject?.archived)
    .filter(({ subject }) => selectedCourse === null || (subject?.name ?? NO_COURSE) === selectedCourse)
    .sort((a, b) => a.todo.dueDate!.localeCompare(b.todo.dueDate!) || a.todo.text.localeCompare(b.todo.text));

  const taskItems: Deadline[] = datedTodos
    .filter(submittable)
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
        plan: { key: `task-${t.id}`, title: t.text, subject: subject?.name ?? '', subjectId: t.subjectId, color: 'blue', due: t.dueDate!.slice(0, 10) },
        // Tasks carry a date with no time of day, so the day heading is the
        // whole story and the time column says as much.
        dueKey: t.dueDate!,
        dueLabel: 'All day',
        status: TODO_TO_STATUS[t.status],
        url: null,
        ...(t.kind === 'exam' || EXAM_NAME.test(t.text) ? { exam: true } : {}),
        whenLabel: new Date(`${t.dueDate!.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      };
    })
    .filter(item => item.courseName === NO_COURSE || !archivedCourseNames.has(item.courseName));

  const allItems = [...canvasItems, ...taskItems];

  const courseNames = [...new Set(allItems.map(i => i.courseName))].sort((a, b) =>
    a === NO_COURSE ? 1 : b === NO_COURSE ? -1 : a.localeCompare(b),
  );

  // A Canvas item is done when the student cleared it, or when Canvas says it
  // was handed in and the student hasn't set a status of their own.
  const isDone = (item: Deadline) =>
    item.source === 'canvas'
      ? !!clearedAssignments[item.canvasId!] || (assignmentStatus[item.canvasId!] === undefined && item.status === 'done')
      : item.status === 'done';

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

  /** Exam mode: ask Soma for review sessions across the days before this exam. */
  function planReview(item: Deadline) {
    const course = item.courseName === NO_COURSE ? '' : ` in ${item.courseName}`;
    navigate('/ai', { state: { ask: `Plan my review for "${item.title}"${course}, on ${item.whenLabel}.` } });
  }

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
          <span className={styles.assignmentCourse}>{item.courseName}{item.platform ? ` · ${PLATFORM_NAMES[item.platform]}` : ''}{item.progress && item.status !== 'done' ? ` · ${item.progress}` : ''}</span>
          <span className={styles.assignmentName}>{item.title}</span>
        </div>
        {item.exam && !done && item.dueKey >= dayKey(new Date()) && (
          <button type="button" className={styles.reviewBtn} onClick={e => { e.stopPropagation(); planReview(item); }} aria-label={`Plan review for ${item.title}`}>Plan review</button>
        )}
        {!item.exam && !done && item.plan?.subjectId && item.dueKey >= dayKey(new Date()) && (
          <button type="button" className={styles.reviewBtn} onClick={e => { e.stopPropagation(); navigate('/dashboard', { state: { planIt: item.plan } }); }} aria-label={`Plan it: ${item.title}`}>Plan it</button>
        )}
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
              title={`Open in ${item.platform ? PLATFORM_NAMES[item.platform] : 'Canvas'}`}
            >↗</a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {(synced || syncError || taskError || extensionPresent()) && <div className={styles.topBar}>
        <div className={styles.syncRow}>
          {synced && (
            <span className={styles.syncLabel}>
              Canvas · Last synced: {fmtSynced(Date.parse(synced))}
            </span>
          )}
          {syncError && <span className={styles.syncError}>{syncError}</span>}
          {taskError && <span className={styles.syncError} role="alert">{taskError}</span>}
          {extensionPresent() && (
            <button
              className={styles.refreshBtn}
              onClick={() => void refreshNow()}
              disabled={syncing}
              title="Refresh"
            >{syncing ? '…' : '↻'}</button>
          )}
        </div>
      </div>}

      <div className={styles.main}>
        {/* Canvas is not connected but there are deadlines to show, so this
            offers the connection rather than standing in front of them. */}
        {!loading && assignments.length === 0 && (
          <div className={styles.setupHintNoBorder} style={{ marginBottom: 14 }}>
            These are your imported and hand-written deadlines.{' '}
            <a href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer">Add the Canvas extension</a> to pull your assignments in too.
          </div>
        )}

        {loading && <DeadlinesSkeleton />}

        {!loading && (
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

            <WhatChanged />

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

            {statusFilter !== 'done' && unsorted.length > 0 && (
              <section className={styles.unsorted} aria-labelledby="unsorted-heading">
                <div className={styles.dateGroupHeader}>
                  <h2 id="unsorted-heading" className={styles.dateGroupLabel}>Not sorted</h2>
                  <span className={styles.dateGroupCount}>{unsorted.length}</span>
                  <button
                    type="button"
                    className={styles.unsortedToggle}
                    aria-expanded={showUnsorted}
                    aria-controls="unsorted-list"
                    onClick={() => setShowUnsorted(v => !v)}
                  >{showUnsorted ? 'Hide' : 'Show'}</button>
                </div>
                <p className={styles.unsortedHint}>
                  These have a due date, but Soma doesn't know whether you hand them in.
                  Hand in adds one to your deadlines; Prepare takes it off this page.
                  Tasks from a course site also sort when you <a href="/settings">re-import the course site</a>.
                </p>
                {showUnsorted && (
                  <div id="unsorted-list" className={styles.assignmentList}>
                    {unsorted.map(({ todo: t, subject }) => (
                      <div key={t.id} className={styles.unsortedRow}>
                        <span className={styles.dot} style={{ background: subject?.color ?? '#888' }} />
                        <div className={styles.assignmentInfo}>
                          <span className={styles.assignmentCourse}>{subject?.name ?? NO_COURSE}</span>
                          <span className={styles.assignmentName}>{t.text}</span>
                        </div>
                        <span className={styles.dueTime}>
                          {new Date(`${t.dueDate!.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </span>
                        <button type="button" className={styles.reviewBtn} aria-label={`Hand in: ${t.text}`} onClick={() => void sortTask(t.id, handInKind(t.text))}>Hand in</button>
                        <button type="button" className={styles.sortPrepareBtn} aria-label={`Prepare: ${t.text}`} onClick={() => void sortTask(t.id, 'other')}>Prepare</button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
