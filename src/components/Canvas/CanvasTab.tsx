import { useState, useEffect } from 'react';
import { storage } from '../../lib/storage';
import { CanvasCourse, CanvasAssignment, Todo } from '../../types';
import { getIcalAssignments } from '../../lib/canvas';
import { SkeletonBlock } from '../UI/Skeleton';
import styles from './CanvasTab.module.css';

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
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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

export default function CanvasTab() {
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
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [lastSynced, setLastSynced] = useState<number | null>(() => storage.getCacheTimestamp());
  const [statusFilter, setStatusFilter] = useState<'all' | 'not_started' | 'in_progress' | 'done'>('all');

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

  function getStatus(id: number) {
    return assignmentStatus[id] ?? 'not_started';
  }

  // ── Setup card ──────────────────────────────────────────────────────────────
  if (!icalUrl) {
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
  const archivedCourseNames = new Set(
    storage.getSubjects().filter(s => s.archived).map(s => s.name),
  );

  const courses: CanvasCourse[] = [...new Map(
    assignments
      .filter(a => a.courseId && a.courseName && !archivedCourseNames.has(a.courseName))
      .map(a => [a.courseId, { id: a.courseId, name: a.courseName, courseCode: '' } as CanvasCourse]),
  ).values()];

  const courseColorMap = Object.fromEntries(
    courses.map((c, i) => [c.id, COURSE_COLORS[i % COURSE_COLORS.length]]),
  );

  const activeAssignments = assignments.filter(a => !archivedCourseNames.has(a.courseName));

  const filtered = activeAssignments
    .filter(a => selectedCourseId === null || a.courseId === selectedCourseId)
    .filter(a => statusFilter === 'done' ? !!clearedAssignments[a.id] : !clearedAssignments[a.id])
    .filter(a => statusFilter === 'all' || statusFilter === 'done' || (assignmentStatus[a.id] ?? 'not_started') === statusFilter)
    .sort((a, b) => new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime());

  const subjectsByName = new Map(storage.getSubjects().map(s => [s.name, s]));
  const courseColor = (courseId: number, courseName: string) =>
    subjectsByName.get(courseName)?.color ?? courseColorMap[courseId] ?? '#888';

  // Group by due date (Today, Tomorrow, weekday...) so the page reads the
  // way Canvas's own dashboard does — what's due when — while course stays
  // visible per row via its subject color and a filter chip row above,
  // instead of owning the top-level grouping.
  const dateGroups = new Map<string, typeof filtered>();
  for (const a of filtered) {
    const key = dayKey(new Date(a.dueAt));
    if (!dateGroups.has(key)) dateGroups.set(key, []);
    dateGroups.get(key)!.push(a);
  }
  const orderedDateKeys = [...dateGroups.keys()].sort();

  function renderAssignmentRow(a: CanvasAssignment) {
    const status = getStatus(a.id);
    const done = status === 'done';
    const cleared = !!clearedAssignments[a.id];
    const color = courseColor(a.courseId, a.courseName);
    return (
      <div
        key={a.id}
        className={`${styles.assignmentCard}${done ? ` ${styles.done}` : ''}${cleared ? ` ${styles.cleared}` : ''}`}
        onClick={() => window.open(a.htmlUrl, '_blank', 'noopener,noreferrer')}
      >
        <span className={styles.dot} style={{ background: color, opacity: done ? 0.3 : 1 }} />
        <div className={styles.assignmentInfo}>
          <span className={styles.assignmentCourse}>{a.courseName}</span>
          <span className={styles.assignmentName}>{a.name}</span>
        </div>
        <span className={styles.dueTime}>{fmtDueTime(a.dueAt)}</span>
        <div className={styles.assignmentControls} onClick={e => e.stopPropagation()}>
          <select
            className={`${styles.statusSelect}${done ? ` ${styles.statusSelectDone}` : ''}`}
            value={status}
            onChange={e => updateStatus(a.id, e.target.value)}
          >
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
          </select>
          <a
            className={styles.externalLink}
            href={a.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Canvas"
          >↗</a>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div className={styles.subNav}>
          <button className={`${styles.subNavBtn} ${styles.subNavBtnActive}`}>Assignments</button>
        </div>
        <div className={styles.syncRow}>
          {lastSynced && (
            <span className={styles.syncLabel}>
              📅 Calendar Feed · Last synced: {fmtSynced(lastSynced)}
            </span>
          )}
          {icalError && <span className={styles.syncError}>{icalError}</span>}
          <button
            className={styles.refreshBtn}
            onClick={loadIcalData}
            disabled={icalSyncing}
            title="Refresh"
          >{icalSyncing ? '…' : '↻'}</button>
        </div>
        <button className={styles.disconnectLink} onClick={handleDisconnect}>Disconnect</button>
      </div>

      <div className={styles.main}>
        {icalSyncing && assignments.length === 0 && <AssignmentSkeleton />}

        {!icalSyncing && (
          <>
            <div className={styles.filterBar}>
              <select
                className={styles.filterSelect}
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
              >
                {(['all', 'not_started', 'in_progress', 'done'] as const).map(f => {
                  const doneCount = Object.keys(clearedAssignments).length;
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
                value={selectedCourseId ?? ''}
                onChange={e => setSelectedCourseId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">All courses</option>
                {courses.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {filtered.length === 0 ? (
              <div className={styles.empty}>
                {statusFilter === 'done' ? 'No completed assignments.' : 'No active assignments.'}
              </div>
            ) : (
              <div className={styles.dateGroups}>
                {orderedDateKeys.map(key => {
                  const dayAssignments = dateGroups.get(key) ?? [];
                  const { label, overdue } = assignmentDayLabel(key);
                  return (
                    <div key={key} className={styles.dateGroup}>
                      <div className={styles.dateGroupHeader}>
                        <span className={`${styles.dateGroupLabel}${overdue ? ` ${styles.dateGroupLabelOverdue}` : ''}`}>
                          {label}
                        </span>
                        <span className={styles.dateGroupCount}>{dayAssignments.length}</span>
                      </div>
                      <div className={styles.assignmentList}>
                        {dayAssignments.map(renderAssignmentRow)}
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
