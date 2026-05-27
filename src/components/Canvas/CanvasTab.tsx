import { useState, useEffect } from 'react';
import { storage } from '../../lib/storage';
import { CanvasCourse, CanvasAssignment, CanvasAnnouncement, Subject, Todo } from '../../types';
import { getCourses, getActiveAssignments, getAssignments, getAnnouncements, getModules, getGrades } from '../../lib/canvas';
import { sendMessage } from '../../lib/ai';
import { CanvasGrade } from '../../types';
import AssignmentDetail from './AssignmentDetail';
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

function fmtPosted(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
    .filter(a => {
      const delta = daysFromToday(a.dueAt);
      return delta <= STUDY_PLAN_DAYS;
    })
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
    state,
    days,
    notice,
    generatedAt: Date.now(),
  }));
}

function looksLikeCanvasCourseName(name: string): boolean {
  return /\b(AP|Hon|Honors|Semester|Periods?|P\d|S[12]|Yr)\b/i.test(name)
    || /\bPer\s*:/i.test(name)
    || /-.+/.test(name)
    || /\(.+\bPeriods?\b.+\)/i.test(name);
}

function isDefaultSubjectName(name: string): boolean {
  return ['math', 'science', 'english', 'history', 'language', 'other'].includes(name.trim().toLowerCase());
}

function syncCoursesToSubjects(courses: CanvasCourse[]) {
  let subjects = storage.getSubjects();
  let changed = false;

  const currentCourseNames = new Set(courses.map(c => c.name));
  const knownCanvasCourseNames = new Set([
    ...storage.getCanvasCourseNames(),
    ...storage.getCachedCourses().map(c => c.name),
  ]);

  const prunedSubjects = subjects.filter(s =>
    currentCourseNames.has(s.name)
      || (!isDefaultSubjectName(s.name) && !knownCanvasCourseNames.has(s.name) && !looksLikeCanvasCourseName(s.name))
  );
  if (prunedSubjects.length !== subjects.length) {
    subjects = prunedSubjects;
    changed = true;
  }

  // Add subjects for current courses that don't exist yet
  for (const course of courses) {
    const matchIdx = subjects.findIndex(s => s.name === course.name);
    if (matchIdx === -1) {
      subjects = [...subjects, {
        id: crypto.randomUUID(),
        name: course.name,
        color: COURSE_COLORS[subjects.length % COURSE_COLORS.length] as Subject['color'],
        totalTimeToday: 0,
      }];
      changed = true;
    }
  }

  storage.setCanvasCourseNames([...currentCourseNames]);
  if (changed) storage.setSubjects(subjects);
}

function fmtSynced(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  return `${mins} mins ago`;
}

export default function CanvasTab() {
  const [initialStudyPlan] = useState(() => getCachedStudyPlan());
  const [token, setToken] = useState(() => storage.getCanvasToken());
  const [baseUrl, setBaseUrl] = useState(() => storage.getCanvasBaseUrl());
  const [setupUrl, setSetupUrl] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState('');

  const [courses, setCourses] = useState<CanvasCourse[]>(() => storage.getCachedCourses());
  const [assignments, setAssignments] = useState<CanvasAssignment[]>(() => storage.getCachedAssignments());
  const [announcements, setAnnouncements] = useState<CanvasAnnouncement[]>(
    () => storage.getCachedAnnouncements(),
  );
  const [assignmentStatus, setAssignmentStatus] = useState<Record<number, string>>(
    () => storage.getAssignmentStatus(),
  );
  const [clearedAssignments, setClearedAssignments] = useState<Record<number, boolean>>(
    () => storage.getClearedAssignments(),
  );
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [announcementsOpen, setAnnouncementsOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [lastSynced, setLastSynced] = useState<number | null>(() => storage.getCacheTimestamp());
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailAssignment, setDetailAssignment] = useState<CanvasAssignment | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'not_started' | 'in_progress' | 'done'>('all');
  const [sortBy, setSortBy] = useState<'due' | 'course'>('due');
  const [canvasView, setCanvasView] = useState<'assignments' | 'grades'>('assignments');
  const [grades, setGrades] = useState<CanvasGrade[]>([]);
  const [gradesLoading, setGradesLoading] = useState(false);
  const [studyPlanState, setStudyPlanState] = useState<StudyPlanState>(initialStudyPlan.state);
  const [studyPlanDays, setStudyPlanDays] = useState<StudyPlanDay[]>(initialStudyPlan.days);
  const [studyPlanNotice, setStudyPlanNotice] = useState(initialStudyPlan.notice);
  const [createdStudyTasks, setCreatedStudyTasks] = useState<Record<number, boolean>>({});

  const isConnected = !!token && !!baseUrl;

  useEffect(() => {
    if (!isConnected) return;
    const hasCachedAssignments = storage.getCachedAssignments().length > 0;
    const cacheTs = storage.getCacheTimestamp();
    const cacheFresh = !!cacheTs && Date.now() - cacheTs < CACHE_MAX_AGE;
    if (!hasCachedAssignments || !cacheFresh) {
      loadData(token, baseUrl, false, { includeHistory: false });
    }
  }, []);

  async function refreshSecondaryData(tk: string, url: string, coursesData: CanvasCourse[]) {
    const [announcementGroups, moduleGroups] = await Promise.all([
      Promise.all(coursesData.map(c => getAnnouncements(tk, url, c.id).catch(() => []))),
      Promise.all(coursesData.map(c => getModules(tk, url, c.id).catch(() => []))),
    ]);
    const flatAnnouncements = announcementGroups.flat();
    storage.setCachedAnnouncements(flatAnnouncements);
    setAnnouncements(flatAnnouncements);
    storage.setCachedModules(moduleGroups.flat());
  }

  async function loadData(
    tk: string,
    url: string,
    force = false,
    options: { includeHistory?: boolean } = {},
  ) {
    const includeHistory = options.includeHistory ?? force;
    const hasCachedAssignments = storage.getCachedAssignments().length > 0;
    if (force || hasCachedAssignments) setSyncing(true); else setLoading(true);
    setError('');
    try {
      const coursesData = await getCourses(tk, url);
      setCourses(coursesData);
      syncCoursesToSubjects(coursesData);
      storage.setCachedCourses(coursesData);
      const assignmentGroups = await Promise.all(
        coursesData.map(c => (
          includeHistory ? getAssignments(tk, url, c) : getActiveAssignments(tk, url, c)
        ).catch(() => [])),
      );
      const all = assignmentGroups.flat();
      all.sort((a, b) => new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime());

      // Auto-mark submitted assignments as done
      const currentStatus = storage.getAssignmentStatus();
      const updatedStatus = { ...currentStatus };
      let statusChanged = false;
      for (const a of all) {
        if (a.score != null && a.score > 0 && updatedStatus[a.id] !== 'done') {
          updatedStatus[a.id] = 'done';
          statusChanged = true;
        } else if (a.score === 0 && !a.submittedAt && updatedStatus[a.id] !== 'not_started') {
          updatedStatus[a.id] = 'not_started';
          statusChanged = true;
        } else if (a.submittedAt && a.score == null && updatedStatus[a.id] !== 'done') {
          updatedStatus[a.id] = 'done';
          statusChanged = true;
        }
      }
      if (statusChanged) {
        storage.setAssignmentStatus(updatedStatus);
        setAssignmentStatus(updatedStatus);
      }

      setAssignments(all);
      storage.setCachedAssignments(all);
      const now = Date.now();
      storage.setCacheTimestamp(now);
      setLastSynced(now);
      setSyncing(false);
      setLoading(false);
      refreshSecondaryData(tk, url, coursesData).catch(() => {});
    } catch {
      setError('Failed to load. Check your token and URL.');
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  }

  async function loadGrades() {
    setGradesLoading(true);
    try {
      const data = await getGrades(token, baseUrl);
      setGrades(data);
    } catch {
      // silently fail — grades are best-effort
    } finally {
      setGradesLoading(false);
    }
  }

  async function handleConnect() {
    const url = setupUrl.trim().replace(/\/$/, '');
    const tk = setupToken.trim();
    if (!url || !tk) return;
    setConnectLoading(true);
    setConnectError('');
    try {
      let res: Response;
      if (import.meta.env.DEV) {
        res = await fetch(`/canvas-api/api/v1/courses?per_page=1`, {
          headers: { Authorization: `Bearer ${tk}` },
        });
      } else {
        res = await fetch('/api/canvas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canvasUrl: url, token: tk, endpoint: '/api/v1/courses?per_page=1' }),
        });
      }
      if (!res.ok) throw new Error('bad');
      storage.setCanvasToken(tk);
      storage.setCanvasBaseUrl(url);
      setToken(tk);
      setBaseUrl(url);
      loadData(tk, url);
    } catch {
      setConnectError('Invalid token or URL.');
    } finally {
      setConnectLoading(false);
    }
  }

  function handleDisconnect() {
    storage.setCanvasToken('');
    storage.setCanvasBaseUrl('');
    setToken('');
    setBaseUrl('');
    setCourses([]);
    setAssignments([]);
    setSelectedCourseId(null);
    setSetupUrl('');
    setSetupToken('');
  }

  function updateStatus(id: number, status: string) {
    const updated = { ...assignmentStatus, [String(id)]: status };
    storage.setAssignmentStatus(updated);
    setAssignmentStatus(updated);

    if (status === 'done') {
      setAssignmentCleared(id, true);
      setStatusFilter('done');
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

  // ── Setup card ──────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className={styles.setupOverlay}>
        <div className={styles.setupCard}>
          <span className={styles.setupTitle}>Connect Canvas</span>
          <div className={styles.setupField}>
            <label className={styles.setupLabel}>Canvas URL</label>
            <input
              className={styles.setupInput}
              placeholder="https://school.instructure.com"
              value={setupUrl}
              onChange={e => setSetupUrl(e.target.value)}
            />
          </div>
          <div className={styles.setupField}>
            <label className={styles.setupLabel}>API Token</label>
            <input
              className={styles.setupInput}
              type="password"
              placeholder="Paste your token"
              value={setupToken}
              onChange={e => setSetupToken(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConnect(); }}
            />
          </div>
          {connectError && <span className={styles.setupError}>{connectError}</span>}
          <button
            className={styles.setupBtn}
            onClick={handleConnect}
            disabled={connectLoading || !setupUrl.trim() || !setupToken.trim()}
          >
            {connectLoading ? 'Connecting…' : 'Connect'}
          </button>
          <div className={styles.setupHint}>
            <strong>How to get your token:</strong><br />
            Canvas → Account → Settings →<br />
            Approved Integrations → New Access Token
          </div>
          <div className={styles.setupHint}>
            Soma does not store your Canvas API token on our servers. It stays in your browser and is only used for read-only Canvas requests.
          </div>
        </div>
      </div>
    );
  }

  // ── Main view ────────────────────────────────────────────────────────────
  const courseColorMap = Object.fromEntries(
    courses.map((c, i) => [c.id, COURSE_COLORS[i % COURSE_COLORS.length]]),
  );

  const filtered = assignments
    .filter(a => selectedCourseId === null || a.courseId === selectedCourseId)
    .filter(a => statusFilter === 'done' ? !!clearedAssignments[a.id] : !clearedAssignments[a.id])
    .filter(a => statusFilter === 'all' || statusFilter === 'done' || (assignmentStatus[a.id] ?? 'not_started') === statusFilter)
    .sort((a, b) => sortBy === 'due'
      ? new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime()
      : a.courseName.localeCompare(b.courseName)
    );

  const filteredAnnouncements = selectedCourseId === null
    ? announcements
    : announcements.filter(a => a.courseId === selectedCourseId);
  const studyPlanEligible = rankStudyAssignments(
    assignments,
    selectedCourseId,
    assignmentStatus,
    clearedAssignments,
  );

  function toggleExpanded(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div className={styles.subNav}>
          <button
            className={`${styles.subNavBtn}${canvasView === 'assignments' ? ` ${styles.subNavBtnActive}` : ''}`}
            onClick={() => setCanvasView('assignments')}
          >Assignments</button>
          <button
            className={`${styles.subNavBtn}${canvasView === 'grades' ? ` ${styles.subNavBtnActive}` : ''}`}
            onClick={() => { setCanvasView('grades'); if (!grades.length) loadGrades(); }}
          >Grades</button>
        </div>
        <div className={styles.syncRow}>
          {lastSynced && (
            <span className={styles.syncLabel}>Last synced: {fmtSynced(lastSynced)}</span>
          )}
          <button
            className={styles.refreshBtn}
            onClick={() => canvasView === 'grades' ? loadGrades() : loadData(token, baseUrl, true)}
            disabled={syncing || loading || gradesLoading}
            title="Refresh"
          >↻</button>
        </div>
        <button className={styles.disconnectLink} onClick={handleDisconnect}>Disconnect</button>
      </div>

      {canvasView === 'grades' && (
        <div className={styles.gradesView}>
          {gradesLoading && <div className={styles.loading}>Loading grades…</div>}
          {!gradesLoading && grades.length === 0 && (
            <div className={styles.empty}>No grade data available.</div>
          )}
          {!gradesLoading && grades.length > 0 && (() => {
            const GRADE_COLORS: Record<string, string> = {
              A: '#66bb6a', B: '#42a5f5', C: '#ffa726', D: '#ef5350', F: '#ef5350',
            };
            const scoreColor = (s: number | null) => {
              if (s === null) return 'var(--text-muted)';
              if (s >= 90) return '#66bb6a';
              if (s >= 80) return '#42a5f5';
              if (s >= 70) return '#ffa726';
              return '#ef5350';
            };
            return (
              <>
                <div className={styles.gradesList}>
                  {grades.map((g, i) => (
                    <div key={g.courseId} className={styles.gradesRow}>
                      <span className={styles.gradesDot} style={{ background: COURSE_COLORS[i % COURSE_COLORS.length] }} />
                      <div className={styles.gradesInfo}>
                        <span className={styles.gradesName}>{g.courseName}</span>
                        <span className={styles.gradesCode}>{g.courseCode}</span>
                      </div>
                      <div className={styles.gradesRight}>
                        {g.currentScore !== null ? (
                          <>
                            <span className={styles.gradesLetter} style={{ color: GRADE_COLORS[g.currentGrade?.[0] ?? ''] ?? 'var(--text-muted)' }}>
                              {g.currentGrade ?? '—'}
                            </span>
                            <span className={styles.gradesScore} style={{ color: scoreColor(g.currentScore) }}>
                              {g.currentScore.toFixed(1)}%
                            </span>
                          </>
                        ) : (
                          <span className={styles.gradesNoGrade}>No grade</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Per-course assignment scores */}
                {assignments.length > 0 && (
                  <div className={styles.assignmentScores}>
                    <div className={styles.scoresHeader}>Assignment Scores</div>
                    {assignments
                      .filter(a => a.score !== null && a.score !== undefined)
                      .map(a => (
                        <div key={a.id} className={styles.scoreRow}>
                          <span className={styles.scoreDot} style={{ background: COURSE_COLORS[courses.findIndex(c => c.id === a.courseId) % COURSE_COLORS.length] }} />
                          <div className={styles.scoreInfo}>
                            <span className={styles.scoreName}>{a.name}</span>
                            <span className={styles.scoreCourse}>{a.courseName}</span>
                          </div>
                          <span className={styles.scoreValue} style={{ color: scoreColor(a.pointsPossible ? (a.score! / a.pointsPossible) * 100 : null) }}>
                            {a.score}/{a.pointsPossible ?? '?'}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {canvasView === 'assignments' && <div className={styles.layout}>
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
          {loading && <AssignmentSkeleton />}

          {!loading && error && (
            <div className={styles.errorState}>
              <span>{error}</span>
              <button className={styles.retryBtn} onClick={() => loadData(token, baseUrl)}>Retry</button>
            </div>
          )}

          {!loading && !error && (
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
                      onClick={() => setDetailAssignment(a)}
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
                        <span className={styles.assignmentScore} style={{
                          visibility: a.score != null && a.pointsPossible != null ? 'visible' : 'hidden',
                          color: a.score != null && a.pointsPossible != null && a.pointsPossible > 0
                            ? (() => {
                                const pct = (a.score / a.pointsPossible!) * 100;
                                if (pct >= 90) return '#66bb6a';
                                if (pct >= 80) return '#42a5f5';
                                if (pct >= 70) return '#ffa726';
                                return '#ef5350';
                              })()
                            : 'var(--text-muted)',
                        }}>
                          {a.score ?? 0}/{a.pointsPossible ?? 0}
                        </span>
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

              <div className={styles.announcementsSection}>
                <button
                  className={styles.sectionHeader}
                  onClick={() => setAnnouncementsOpen(o => !o)}
                >
                  <span className={styles.sectionTitle}>Announcements</span>
                  <span className={styles.sectionRule} />
                  <span className={styles.caret}>{announcementsOpen ? '▾' : '▸'}</span>
                </button>
                {announcementsOpen && (
                  <div className={styles.announcementList}>
                    {filteredAnnouncements.length === 0 ? (
                      <div className={styles.announcementsEmpty}>No announcements.</div>
                    ) : filteredAnnouncements.map(a => {
                      const expanded = expandedIds.has(a.id);
                      const courseName = courses.find(c => c.id === a.courseId)?.name ?? '';
                      return (
                        <div
                          key={a.id}
                          className={styles.announcementCard}
                          onClick={() => toggleExpanded(a.id)}
                        >
                          <div className={styles.announcementTop}>
                            <span className={styles.announcementCourse}>{courseName}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span className={styles.announcementDate}>
                                {a.postedAt ? fmtPosted(a.postedAt) : ''}
                              </span>
                              {a.htmlUrl && (
                                <a
                                  className={styles.externalLink}
                                  href={a.htmlUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Open in Canvas"
                                  onClick={e => e.stopPropagation()}
                                >↗</a>
                              )}
                            </div>
                          </div>
                          <span className={styles.announcementTitle}>{a.title}</span>
                          <span className={expanded ? styles.announcementBodyExpanded : styles.announcementBody}>
                            {a.message}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
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
                                onClick={() => assignment && setDetailAssignment(assignment)}
                                role="button"
                                tabIndex={assignment ? 0 : -1}
                                onKeyDown={e => {
                                  if (assignment && (e.key === 'Enter' || e.key === ' ')) {
                                    e.preventDefault();
                                    setDetailAssignment(assignment);
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
      </div>}

      {detailAssignment && (
        <AssignmentDetail
          courseId={detailAssignment.courseId}
          assignmentId={detailAssignment.id}
          onClose={() => setDetailAssignment(null)}
        />
      )}
    </div>
  );
}
