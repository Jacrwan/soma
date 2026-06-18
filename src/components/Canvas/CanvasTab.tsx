import { useState, useEffect } from 'react';
import { storage } from '../../lib/storage';
import { CanvasCourse, CanvasAssignment, Subject, Todo } from '../../types';
import { getIcalAssignments } from '../../lib/canvas';
import { sendMessage } from '../../lib/ai';
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
const STUDY_PLAN_DAYS = 7;
const STUDY_PLAN_CACHE_KEY = 'soma_canvas_study_plan_preview';

interface StudyPlanItem {
  assignmentId: number;
  courseId: number;
  courseName: string;
  title: string;
  dueAt: string;
  suggestedAction: string;
  reason: string;
  estimatedMinutes: number;
}

interface StudyPlanDay {
  label: string;
  date: string;
  items: StudyPlanItem[];
}

type StudyPlanState = 'idle' | 'loading' | 'generated' | 'empty' | 'error';

interface StudyPlanSnapshot {
  state: Exclude<StudyPlanState, 'loading'>;
  days: StudyPlanDay[];
  notice: string;
  generatedAt: number;
}

function fmtDue(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
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

function daysFromToday(iso: string) {
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return STUDY_PLAN_DAYS + 1;
  const today = startOfLocalDay(new Date());
  const dueDay = startOfLocalDay(due);
  return Math.floor((dueDay.getTime() - today.getTime()) / 86_400_000);
}

function studyDayLabel(dateKey: string) {
  const today = startOfLocalDay(new Date());
  const tomorrow = addDays(today, 1);
  if (dateKey === dayKey(today)) return 'Today';
  if (dateKey === dayKey(tomorrow)) return 'Tomorrow';
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function compactDueLabel(iso: string) {
  const delta = daysFromToday(iso);
  if (delta < 0) return `Overdue by ${Math.abs(delta)} day${Math.abs(delta) === 1 ? '' : 's'}`;
  if (delta === 0) return 'Due today';
  if (delta === 1) return 'Due tomorrow';
  return `Due in ${delta} days`;
}

function studyReason(a: CanvasAssignment) {
  const parts = [compactDueLabel(a.dueAt)];
  if (a.pointsPossible != null) parts.push(`${a.pointsPossible} points`);
  return parts.join(', ');
}

function dueDateKey(iso: string) {
  const due = new Date(iso);
  return Number.isNaN(due.getTime()) ? dayKey(new Date()) : dayKey(due);
}

function findSubjectIdForCourse(courseName: string) {
  return storage.getSubjects().find(s => s.name === courseName)?.id;
}

function estimateStudyMinutes(a: CanvasAssignment) {
  const points = a.pointsPossible ?? 0;
  if (points >= 80) return 60;
  if (points >= 30) return 45;
  return 25;
}

function fallbackAction(a: CanvasAssignment) {
  const name = a.name.toLowerCase();
  if (name.includes('quiz') || name.includes('test') || name.includes('exam')) {
    return 'Review notes, redo missed examples, and make a quick formula or concept sheet.';
  }
  if (name.includes('essay') || name.includes('write') || name.includes('draft')) {
    return 'Outline the response, gather evidence, then write or revise the next section.';
  }
  if (name.includes('read')) {
    return 'Read the assigned section and write a short summary with key terms.';
  }
  return 'Open the assignment, identify the next concrete step, and work through it.';
}

function rankStudyAssignments(
  assignments: CanvasAssignment[],
  selectedCourseId: number | null,
  assignmentStatus: Record<number, string>,
  clearedAssignments: Record<number, boolean>,
) {
  return assignments
    .filter(a => selectedCourseId === null || a.courseId === selectedCourseId)
    .filter(a => !clearedAssignments[a.id])
    .filter(a => (assignmentStatus[a.id] ?? 'not_started') !== 'done')
    .filter(a => daysFromToday(a.dueAt) <= STUDY_PLAN_DAYS)
    .sort((a, b) => {
      const aDelta = daysFromToday(a.dueAt);
      const bDelta = daysFromToday(b.dueAt);
      if (aDelta !== bDelta) return aDelta - bDelta;
      const aStatus = assignmentStatus[a.id] ?? 'not_started';
      const bStatus = assignmentStatus[b.id] ?? 'not_started';
      if (aStatus !== bStatus) return aStatus === 'in_progress' ? -1 : 1;
      return (b.pointsPossible ?? 0) - (a.pointsPossible ?? 0);
    })
    .slice(0, 16);
}

function buildFallbackPlan(assignments: CanvasAssignment[]): StudyPlanDay[] {
  const buckets = new Map<string, StudyPlanItem[]>();
  for (const a of assignments) {
    const delta = daysFromToday(a.dueAt);
    const bucketDate = delta <= 0
      ? startOfLocalDay(new Date())
      : startOfLocalDay(new Date(a.dueAt));
    const key = dayKey(bucketDate);
    const item: StudyPlanItem = {
      assignmentId: a.id,
      courseId: a.courseId,
      courseName: a.courseName,
      title: a.name,
      dueAt: a.dueAt,
      suggestedAction: fallbackAction(a),
      reason: studyReason(a),
      estimatedMinutes: estimateStudyMinutes(a),
    };
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({
      label: studyDayLabel(date),
      date,
      items: items.slice(0, 4),
    }))
    .filter(day => day.items.length > 0);
}

function parseStudyPlanJson(raw: string, sourceAssignments: CanvasAssignment[]): StudyPlanDay[] | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { days?: StudyPlanDay[] };
    if (!Array.isArray(parsed.days)) return null;
    const assignmentMap = new Map(sourceAssignments.map(a => [a.id, a]));
    const days = parsed.days.map(day => {
      const date = typeof day.date === 'string' ? day.date : dayKey(new Date());
      const label = typeof day.label === 'string' ? day.label : studyDayLabel(date);
      const items = Array.isArray(day.items) ? day.items.flatMap(item => {
        const assignmentId = Number(item.assignmentId);
        const source = assignmentMap.get(assignmentId);
        if (!source) return [];
        return [{
          assignmentId,
          courseId: source.courseId,
          courseName: source.courseName,
          title: source.name,
          dueAt: source.dueAt,
          suggestedAction: String(item.suggestedAction || fallbackAction(source)).slice(0, 180),
          reason: studyReason(source),
          estimatedMinutes: Math.min(120, Math.max(15, Number(item.estimatedMinutes) || estimateStudyMinutes(source))),
        }];
      }).slice(0, 4) : [];
      return { label, date, items };
    }).filter(day => day.items.length > 0);
    return days.length > 0 ? days : null;
  } catch {
    return null;
  }
}

function getCachedStudyPlan(): StudyPlanSnapshot {
  const fallback: StudyPlanSnapshot = { state: 'idle', days: [], notice: '', generatedAt: 0 };
  const raw = localStorage.getItem(STUDY_PLAN_CACHE_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<StudyPlanSnapshot>;
    if (!Array.isArray(parsed.days)) return fallback;
    const state = parsed.state ?? 'idle';
    return {
      state,
      days: parsed.days,
      notice: typeof parsed.notice === 'string' ? parsed.notice : '',
      generatedAt: typeof parsed.generatedAt === 'number' ? parsed.generatedAt : 0,
    };
  } catch {
    return fallback;
  }
}

function setCachedStudyPlan(state: StudyPlanSnapshot['state'], days: StudyPlanDay[], notice = '') {
  localStorage.setItem(STUDY_PLAN_CACHE_KEY, JSON.stringify({
    state, days, notice, generatedAt: Date.now(),
  }));
}

function fmtSynced(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  return `${mins} mins ago`;
}

export default function CanvasTab() {
  const [initialStudyPlan] = useState(() => getCachedStudyPlan());
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
  const [sortBy, setSortBy] = useState<'due' | 'course'>('due');
  const [studyPlanState, setStudyPlanState] = useState<StudyPlanState>(initialStudyPlan.state);
  const [studyPlanDays, setStudyPlanDays] = useState<StudyPlanDay[]>(initialStudyPlan.days);
  const [studyPlanNotice, setStudyPlanNotice] = useState(initialStudyPlan.notice);
  const [createdStudyTasks, setCreatedStudyTasks] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!icalUrl) return;
    const cached = storage.getCachedIcalAssignments();
    const cacheTs = storage.getCacheTimestamp();
    const cacheFresh = !!cacheTs && Date.now() - cacheTs < CACHE_MAX_AGE;
    if (cached.length === 0 || !cacheFresh) {
      loadIcalData();
    }
  }, []);

  async function loadIcalData() {
    if (!icalUrl) return;
    setIcalSyncing(true);
    setIcalError('');
    try {
      const fetched = await getIcalAssignments(icalUrl);
      storage.setCachedIcalAssignments(fetched);
      storage.setCacheTimestamp(Date.now());
      setAssignments(fetched);
      setLastSynced(Date.now());
      // Sync course names to subjects
      const courseNames = [...new Set(fetched.map(a => a.courseName).filter(Boolean))];
      const existing = storage.getSubjects();
      let subjects = [...existing];
      let changed = false;
      for (const name of courseNames) {
        if (!subjects.find(s => s.name === name)) {
          subjects = [...subjects, {
            id: crypto.randomUUID(),
            name,
            color: COURSE_COLORS[subjects.length % COURSE_COLORS.length] as Subject['color'],
            totalTimeToday: 0,
            source: 'canvas' as const,
          }];
          changed = true;
        }
      }
      if (changed) storage.setSubjects(subjects);
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

  async function generateStudyPlan() {
    const eligible = rankStudyAssignments(assignments, selectedCourseId, assignmentStatus, clearedAssignments);
    setStudyPlanNotice('');

    if (eligible.length === 0) {
      setStudyPlanDays([]);
      setStudyPlanState('empty');
      setCachedStudyPlan('empty', []);
      return;
    }

    setStudyPlanState('loading');
    const fallbackPlan = buildFallbackPlan(eligible);
    const context = eligible.map(a => ({
      assignmentId: a.id,
      title: a.name,
      course: a.courseName,
      dueAt: a.dueAt,
      due: compactDueLabel(a.dueAt),
      status: assignmentStatus[a.id] ?? 'not_started',
      pointsPossible: a.pointsPossible ?? null,
      submitted: !!a.submittedAt,
    }));

    const systemPrompt = `You create practical student study plans from Canvas assignment data.
Return only valid JSON. Do not include markdown.
Use this shape:
{"days":[{"label":"Today","date":"YYYY-MM-DD","items":[{"assignmentId":123,"suggestedAction":"specific next study action","estimatedMinutes":30}]}]}
Rules:
- Group by day, using Today for overdue and due-today work.
- Include only assignment IDs from the provided data.
- Each day must have 1 to 4 items.
- Make actions concrete and short.
- Do not write due-date wording; Soma will calculate due labels from Canvas dates.
- estimatedMinutes must be between 15 and 120.`;

    try {
      const response = await sendMessage([
        {
          role: 'user',
          content: JSON.stringify({
            today: dayKey(new Date()),
            horizonDays: STUDY_PLAN_DAYS,
            selectedCourseId,
            assignments: context,
          }),
        },
      ], systemPrompt);
      const parsed = parseStudyPlanJson(response, eligible);
      if (!parsed) throw new Error('Invalid study plan JSON');
      setStudyPlanDays(parsed);
      setStudyPlanState('generated');
      setCachedStudyPlan('generated', parsed);
    } catch {
      setStudyPlanDays(fallbackPlan);
      const fallbackState = fallbackPlan.length > 0 ? 'generated' : 'error';
      const fallbackNotice = 'AI summary could not be generated, so Soma built a simple due-date plan instead.';
      setStudyPlanState(fallbackState);
      setStudyPlanNotice(fallbackNotice);
      setCachedStudyPlan(fallbackState, fallbackPlan, fallbackNotice);
    }
  }

  function createTaskFromStudyPlan(item: StudyPlanItem) {
    const existing = storage.getTodos();
    const duplicate = existing.some(t => t.assignmentId === item.assignmentId);
    if (duplicate) {
      setCreatedStudyTasks(prev => ({ ...prev, [item.assignmentId]: true }));
      return;
    }

    const todo: Todo = {
      id: crypto.randomUUID(),
      text: item.suggestedAction || item.title,
      status: 'nothing',
      subjectId: findSubjectIdForCourse(item.courseName),
      dueDate: dueDateKey(item.dueAt),
      assignmentId: item.assignmentId,
      date: dayKey(new Date()),
      estimatedMinutes: item.estimatedMinutes,
      notes: item.title,
    };
    storage.setTodos([...existing, todo]);
    setCreatedStudyTasks(prev => ({ ...prev, [item.assignmentId]: true }));
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
    .sort((a, b) => sortBy === 'due'
      ? new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime()
      : a.courseName.localeCompare(b.courseName)
    );

  const studyPlanEligible = rankStudyAssignments(
    activeAssignments, selectedCourseId, assignmentStatus, clearedAssignments,
  );

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

      <div className={styles.layout}>
        {/* ── Course sidebar ── */}
        <div className={styles.sidebar}>
          <button
            className={`${styles.pill}${selectedCourseId === null ? ` ${styles.pillActive}` : ''}`}
            onClick={() => setSelectedCourseId(null)}
          >All</button>
          {courses.map(c => (
            <button
              key={c.id}
              className={`${styles.pill}${selectedCourseId === c.id ? ` ${styles.pillActive}` : ''}`}
              onClick={() => setSelectedCourseId(c.id)}
            >{c.name}</button>
          ))}
        </div>

        {/* ── Assignment area ── */}
        <div className={styles.main}>
          {icalSyncing && assignments.length === 0 && <AssignmentSkeleton />}

          {!icalSyncing && (
            <>
              <div className={styles.filterBar}>
                <div className={styles.filterPills}>
                  {(['all', 'not_started', 'in_progress', 'done'] as const).map(f => {
                    const doneCount = Object.keys(clearedAssignments).length;
                    const label =
                      f === 'all' ? 'Active' :
                      f === 'not_started' ? 'Not started' :
                      f === 'in_progress' ? 'In progress' :
                      doneCount > 0 ? `Done (${doneCount})` : 'Done';
                    return (
                      <button
                        key={f}
                        className={`${styles.filterPill}${statusFilter === f ? ` ${styles.filterPillActive}` : ''}`}
                        onClick={() => setStatusFilter(f)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <button
                  className={styles.sortBtn}
                  onClick={() => setSortBy(s => s === 'due' ? 'course' : 'due')}
                  title="Toggle sort"
                >
                  {sortBy === 'due' ? 'By due date' : 'By course'} ↕
                </button>
              </div>
              <div className={styles.assignmentList}>
                {filtered.length === 0 ? (
                  <div className={styles.empty}>
                    {statusFilter === 'done' ? 'No completed assignments.' : 'No active assignments.'}
                  </div>
                ) : filtered.map(a => {
                  const status = getStatus(a.id);
                  const done = status === 'done';
                  const cleared = !!clearedAssignments[a.id];
                  const color = courseColorMap[a.courseId] ?? '#ccc';
                  return (
                    <div
                      key={a.id}
                      className={`${styles.assignmentRow}${done ? ` ${styles.done}` : ''}${cleared ? ` ${styles.cleared}` : ''}`}
                      onClick={() => window.open(a.htmlUrl, '_blank', 'noopener,noreferrer')}
                      style={{ cursor: 'pointer' }}
                    >
                      <span
                        className={styles.dot}
                        style={{ background: color, opacity: done ? 0.3 : 1 }}
                      />
                      <div className={styles.assignmentInfo}>
                        <span className={styles.assignmentName}>{a.name}</span>
                        <span className={styles.assignmentCourse}>{a.courseName}</span>
                      </div>
                      <div className={styles.assignmentRight}>
                        <span className={styles.assignmentDue}>Due: {fmtDue(a.dueAt)}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
                          <button
                            className={`${styles.doneToggle}${done ? ` ${styles.doneToggleActive}` : ''}`}
                            onClick={() => updateStatus(a.id, done ? 'not_started' : 'done')}
                            title={done ? 'Mark not started' : 'Mark done'}
                          >✓</button>
                          <select
                            className={styles.statusSelect}
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
                    </div>
                  );
                })}
              </div>

              <div className={styles.studyPlan}>
                <div className={styles.studyPlanHeader}>
                  <span className={styles.studyPlanTitle}>Study Plan</span>
                  <div className={styles.studyPlanRule} />
                </div>
                <div className={styles.studyPlanBody}>
                  <button
                    className={styles.generateBtn}
                    onClick={generateStudyPlan}
                    disabled={studyPlanState === 'loading' || studyPlanEligible.length === 0}
                  >
                    {studyPlanState === 'loading' ? 'Generating…' : 'Generate Study Plan'}
                  </button>
                  <span className={styles.studyPlanMeta}>
                    {studyPlanEligible.length > 0
                      ? `${studyPlanEligible.length} active item${studyPlanEligible.length === 1 ? '' : 's'} in the next 7 days`
                      : 'No active assignments due in the next 7 days'}
                  </span>
                </div>
                {studyPlanNotice && <div className={styles.studyPlanNotice}>{studyPlanNotice}</div>}
                {studyPlanState === 'empty' && (
                  <div className={styles.studyPlanEmpty}>Nothing urgent to plan right now.</div>
                )}
                {studyPlanState === 'error' && (
                  <div className={styles.studyPlanEmpty}>Could not generate a study plan. Try again after refreshing Canvas.</div>
                )}
                {studyPlanDays.length > 0 && (
                  <div className={styles.studyPlanDays}>
                    {studyPlanDays.map(day => (
                      <div key={`${day.date}-${day.label}`} className={styles.studyPlanDay}>
                        <div className={styles.studyPlanDayHeader}>
                          <span className={styles.studyPlanDayLabel}>{day.label}</span>
                          <span className={styles.studyPlanDayDate}>{day.date}</span>
                        </div>
                        <div className={styles.studyPlanItems}>
                          {day.items.map(item => {
                            const assignment = assignments.find(a => a.id === item.assignmentId);
                            const color = courseColorMap[item.courseId] ?? '#ccc';
                            return (
                              <div
                                key={`${day.date}-${item.assignmentId}`}
                                className={`${styles.studyPlanItem}${!assignment ? ` ${styles.studyPlanItemDisabled}` : ''}`}
                                onClick={() => {
                                  if (assignment) window.open(assignment.htmlUrl, '_blank', 'noopener,noreferrer');
                                }}
                                role="button"
                                tabIndex={assignment ? 0 : -1}
                                onKeyDown={e => {
                                  if (assignment && (e.key === 'Enter' || e.key === ' ')) {
                                    e.preventDefault();
                                    window.open(assignment.htmlUrl, '_blank', 'noopener,noreferrer');
                                  }
                                }}
                              >
                                <span className={styles.studyPlanDot} style={{ background: color }} />
                                <span className={styles.studyPlanItemMain}>
                                  <span className={styles.studyPlanItemTitle}>{item.title}</span>
                                  <span className={styles.studyPlanItemCourse}>{item.courseName}</span>
                                  <span className={styles.studyPlanAction}>{item.suggestedAction}</span>
                                  <span className={styles.studyPlanReason}>{item.reason}</span>
                                </span>
                                <span className={styles.studyPlanItemSide}>
                                  <span className={styles.studyPlanMinutes}>{item.estimatedMinutes}m</span>
                                  <button
                                    className={styles.studyPlanTaskBtn}
                                    onClick={e => {
                                      e.stopPropagation();
                                      createTaskFromStudyPlan(item);
                                    }}
                                    disabled={!!createdStudyTasks[item.assignmentId]}
                                  >
                                    {createdStudyTasks[item.assignmentId] ? 'Task created' : 'Create task'}
                                  </button>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
