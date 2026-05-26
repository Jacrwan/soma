import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { storage, inferSubjectId } from '../../lib/storage';
import { sendMessage } from '../../lib/ai';
import { Subject, TimeBlock, SubjectColor, Todo, GoogleCalendarEvent, CanvasAssignment, CanvasCourse } from '../../types';
import TimerOverlay from '../Timer/TimerOverlay';
import AssignmentDetail from '../Canvas/AssignmentDetail';
import { SkeletonBlock } from '../UI/Skeleton';
import styles from './DayView.module.css';

function RightPanelSkeleton() {
  const row = (titleW: number, t1W: number, t2W: number) => (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <SkeletonBlock width={10} height={10} borderRadius="50%" />
        <SkeletonBlock width={titleW} height={13} />
        <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <SkeletonBlock width={36} height={11} />
        </div>
      </div>
      <div style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <SkeletonBlock width={t1W} height={12} />
        <SkeletonBlock width={t2W} height={12} />
      </div>
    </div>
  );
  return (
    <div style={{ padding: '20px 20px 0' }}>
      {row(148, 200, 136)}
      {row(118, 172, 220)}
      {row(168, 128, 156)}
    </div>
  );
}

const SLOT_HEIGHT = 60;
const START_HOUR = 0;
const TOTAL_HOURS = 24;

// Midnight–4:59 AM belongs to the previous logical day (day runs 5 AM → 5 AM).
function logicalToday(): Date {
  const now = new Date();
  const d = new Date(now);
  if (now.getHours() < START_HOUR) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}
const COLORS: SubjectColor[] = [
  '#ef5350', '#42a5f5', '#66bb6a', '#ab47bc',
  '#ffa726', '#26c6da', '#ec407a', '#8d6e63',
];
const DAY_ABBRS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function toLocalISO(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
}

function getTodayKey() {
  const d = logicalToday();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toISODateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function isOnDate(iso: string, date: Date): boolean {
  return isSameDay(new Date(iso), date);
}

function subjectSecsFromSessions(subjectId: string, date: Date): number {
  return storage.getTimerSessions()
    .filter(s => s.subjectId === subjectId && isOnDate(s.startTime, date))
    .reduce((acc, s) => acc + s.durationSeconds, 0);
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function minToTop(clockMinutes: number) {
  const startMinutes = START_HOUR * 60;
  const offset = clockMinutes >= startMinutes
    ? clockMinutes - startMinutes
    : clockMinutes + (24 * 60 - startMinutes);
  return (offset / 60) * SLOT_HEIGHT;
}

function durToHeight(minutes: number) {
  return (minutes / 60) * SLOT_HEIGHT;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
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

function getVisibleSubjects(): Subject[] {
  const currentCanvasCourseNames = new Set(storage.getCachedCourses().map(c => c.name));
  const knownCanvasCourseNames = new Set(storage.getCanvasCourseNames());

  return storage.getSubjects().filter(s => {
    if (s.archived) return false;
    if (currentCanvasCourseNames.size === 0) return true;
    if (currentCanvasCourseNames.has(s.name)) return true;
    if (isDefaultSubjectName(s.name)) return false;
    if (knownCanvasCourseNames.has(s.name)) return false;
    return !looksLikeCanvasCourseName(s.name);
  });
}

function fmtEstimated(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `~${h}h ${m}m`;
  if (h > 0) return `~${h}h`;
  return `~${m}m`;
}

function fmtTimeShort(mins: number): string {
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

function fmtDuration(startISO: string, endISO: string): string {
  const mins = Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function fmtElapsed(minutes: number): string {
  if (minutes === 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function computeElapsedTime(blocks: TimeBlock[], now: Date, viewDate: Date): Record<string, number> {
  const nowMs = now.getTime();
  const result: Record<string, number> = {};
  for (const block of blocks) {
    const blockStart = new Date(block.startTime);
    const blockEnd = new Date(block.endTime);
    // Blocks starting before START_HOUR belong to viewDate+1 (after-midnight wrap)
    const effectiveDate = blockStart.getHours() < START_HOUR ? addDays(viewDate, 1) : viewDate;
    const startMs = new Date(
      effectiveDate.getFullYear(), effectiveDate.getMonth(), effectiveDate.getDate(),
      blockStart.getHours(), blockStart.getMinutes(), blockStart.getSeconds(),
    ).getTime();
    const endMs = new Date(
      effectiveDate.getFullYear(), effectiveDate.getMonth(), effectiveDate.getDate(),
      blockEnd.getHours(), blockEnd.getMinutes(), blockEnd.getSeconds(),
    ).getTime();
    let elapsedMs: number;
    if (nowMs <= startMs) {
      elapsedMs = 0;
    } else if (nowMs >= endMs) {
      elapsedMs = endMs - startMs;
    } else {
      elapsedMs = nowMs - startMs;
    }
    const minutes = Math.floor(Math.max(0, elapsedMs) / 60_000);
    result[block.subjectId] = (result[block.subjectId] ?? 0) + minutes;
  }
  return result;
}

interface BlockEditForm {
  task: string;
  startHour: number;
  startMinute: number;
  startAmPm: 'AM' | 'PM';
  endHour: number;
  endMinute: number;
  endAmPm: 'AM' | 'PM';
}

interface DotGroup {
  subjectId: string;
  topPx: number;
  lane?: number;
  lanes?: number;
  label: string;
  count: number;
  blocks: TimeBlock[];
}

interface PositionedTimeBlock {
  block: TimeBlock;
  lane: number;
  lanes: number;
}

function getBlockMinutes(block: TimeBlock) {
  const start = new Date(block.startTime);
  const end = new Date(block.endTime);
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = startMin + Math.max((end.getTime() - start.getTime()) / 60_000, 1);
  return { startMin, endMin };
}

function layoutTimeBlocks(blocks: TimeBlock[]): PositionedTimeBlock[] {
  const sorted = [...blocks].sort((a, b) => {
    const aBounds = getBlockMinutes(a);
    const bBounds = getBlockMinutes(b);
    return aBounds.startMin - bBounds.startMin || aBounds.endMin - bBounds.endMin;
  });
  const positioned = new Map<string, { lane: number; lanes: number }>();
  let cluster: TimeBlock[] = [];
  let clusterEnd = -Infinity;

  function flushCluster() {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    let laneCount = 1;

    for (const block of cluster) {
      const { startMin, endMin } = getBlockMinutes(block);
      let lane = laneEnds.findIndex(lastEnd => lastEnd <= startMin);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = endMin;
      laneCount = Math.max(laneCount, laneEnds.length);
      positioned.set(block.id, { lane, lanes: laneCount });
    }

    for (const block of cluster) {
      const pos = positioned.get(block.id);
      if (pos) positioned.set(block.id, { ...pos, lanes: laneCount });
    }
  }

  for (const block of sorted) {
    const { startMin, endMin } = getBlockMinutes(block);
    if (cluster.length === 0 || startMin < clusterEnd) {
      cluster.push(block);
      clusterEnd = Math.max(clusterEnd, endMin);
    } else {
      flushCluster();
      cluster = [block];
      clusterEnd = endMin;
    }
  }
  flushCluster();

  return sorted.map(block => {
    const pos = positioned.get(block.id) ?? { lane: 0, lanes: 1 };
    return { block, lane: pos.lane, lanes: pos.lanes };
  });
}

function layoutDotGroups(groups: DotGroup[]): DotGroup[] {
  const sorted = [...groups].sort((a, b) => a.topPx - b.topPx);
  const positioned: DotGroup[] = [];
  let cluster: DotGroup[] = [];

  function flushCluster() {
    if (cluster.length === 0) return;
    const lanes = cluster.length;
    cluster.forEach((group, lane) => {
      positioned.push({ ...group, lane, lanes });
    });
  }

  for (const group of sorted) {
    const firstTop = cluster[0]?.topPx;
    if (cluster.length === 0 || Math.abs(group.topPx - firstTop) <= 12) {
      cluster.push(group);
    } else {
      flushCluster();
      cluster = [group];
    }
  }
  flushCluster();

  return positioned;
}

function laneStyle(lane = 0, lanes = 1, gapPx = 4): CSSProperties {
  const fraction = lane / lanes;
  const widthFraction = 1 / lanes;
  return {
    left: `calc(72px + ${fraction * 100}% - ${fraction * 80}px)`,
    width: `calc(${widthFraction * 100}% - ${widthFraction * 80 + gapPx}px)`,
    right: 'auto',
  };
}

function groupShortBlocks(shortBlocks: TimeBlock[]): DotGroup[] {
  const bySubject = new Map<string, TimeBlock[]>();
  for (const b of shortBlocks) {
    if (!bySubject.has(b.subjectId)) bySubject.set(b.subjectId, []);
    bySubject.get(b.subjectId)!.push(b);
  }
  const groups: DotGroup[] = [];
  for (const [subjectId, list] of bySubject) {
    const sorted = [...list].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
    let cluster: TimeBlock[] = [];
    for (const block of sorted) {
      if (cluster.length === 0) {
        cluster = [block];
      } else {
        const gapMin =
          (new Date(block.startTime).getTime() - new Date(cluster[0].startTime).getTime()) / 60_000;
        if (gapMin <= 5) {
          cluster.push(block);
        } else {
          groups.push(makeGroup(subjectId, cluster));
          cluster = [block];
        }
      }
    }
    if (cluster.length > 0) groups.push(makeGroup(subjectId, cluster));
  }
  return groups;
}

function makeGroup(subjectId: string, cluster: TimeBlock[]): DotGroup {
  const earliest = cluster[0];
  const mostRecent = cluster[cluster.length - 1];
  const s = new Date(earliest.startTime);
  const startMin = s.getHours() * 60 + s.getMinutes();
  return {
    subjectId,
    topPx: minToTop(startMin),
    label: mostRecent.task ?? '',
    count: cluster.length,
    blocks: cluster,
  };
}

interface SubjectEditState {
  id: string;
  name: string;
  color: SubjectColor;
}

interface AddSubjectForm {
  name: string;
  color: SubjectColor;
}

interface TaskFormState {
  text: string;
  hours: number;
  minutes: number;
  dueDate: string;
  notes: string;
  scheduleIt: boolean;
  startHour: number;
  startMinute: number;
  startAmPm: 'AM' | 'PM';
}

interface DayViewProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

export default function DayView({ selectedDate, onSelectDate }: DayViewProps) {
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [currentMinutes, setCurrentMinutes] = useState(0);
  const [viewWeekStart, setViewWeekStart] = useState<Date>(() => getMondayOfWeek(selectedDate));
  const [blockModal, setBlockModal] = useState<{ block: TimeBlock; subject: Subject | undefined } | null>(null);
  const [blockEditMode, setBlockEditMode] = useState(false);
  const [blockEditForm, setBlockEditForm] = useState<BlockEditForm>({
    task: '', startHour: 9, startMinute: 0, startAmPm: 'AM', endHour: 10, endMinute: 0, endAmPm: 'AM',
  });
  const [timerSubject, setTimerSubject] = useState<Subject | null>(null);
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [todos, setTodos] = useState<Todo[]>(() => {
    const existing = storage.getTodos();
    const subjects = storage.getSubjects();
    const assignments = storage.getCachedAssignments();
    const migrated = existing.map(t => {
      const legacyDone = (t as unknown as { done?: boolean }).done;
      const status: Todo['status'] = t.status ?? (legacyDone ? 'done' : 'nothing');
      const subjectId = t.subjectId ?? inferSubjectId(t.text, subjects, assignments);
      return { ...t, status, subjectId };
    });
    if (migrated.some((t, i) => t.status !== existing[i].status || t.subjectId !== existing[i].subjectId)) {
      storage.setTodos(migrated);
    }
    return migrated;
  });
  const [taskModal, setTaskModal] = useState<{ subjectId: string | undefined; editingTodo?: Todo } | null>(null);
  const [subjectPickerMode, setSubjectPickerMode] = useState<'timer' | 'task' | null>(null);
  const [taskDetailsOpen, setTaskDetailsOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<TaskFormState>({
    text: '', hours: 0, minutes: 0, dueDate: '', notes: '',
    scheduleIt: false, startHour: 9, startMinute: 0, startAmPm: 'AM',
  });
  const [statusPopoverId, setStatusPopoverId] = useState<string | null>(null);
  const [pinPopoverId, setPinPopoverId] = useState<string | null>(null);
  const [pinForm, setPinForm] = useState<{ hour: number; minute: number; ampm: 'AM' | 'PM'; durationHours: number; durationMinutes: number }>(
    { hour: 9, minute: 0, ampm: 'AM', durationHours: 1, durationMinutes: 0 }
  );
  const [initialTimerTask, setInitialTimerTask] = useState('');
  const [addSubjectForm, setAddSubjectForm] = useState<AddSubjectForm>({ name: '', color: COLORS[0] });
  const [editSubject, setEditSubject] = useState<SubjectEditState | null>(null);
  const [gcalEvents, setGcalEvents] = useState<GoogleCalendarEvent[]>([]);
  const [dueAssignments, setDueAssignments] = useState<{ assignment: CanvasAssignment; course: CanvasCourse | undefined; color: string }[]>([]);
  const [deadlineDetail, setDeadlineDetail] = useState<{ courseId: number; assignmentId: number } | null>(null);
  const [dueTagPopover, setDueTagPopover] = useState<{ mfm: number; top: number; right: number } | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedBySubject, setElapsedBySubject] = useState<Record<string, number>>({});
  const [briefCollapsed, setBriefCollapsed] = useState<boolean>(() => {
    const s = localStorage.getItem('soma_brief_collapsed');
    return s === null ? true : s === 'true';
  });
  const [briefText, setBriefText] = useState<string>(() =>
    localStorage.getItem('soma_brief_text') ?? ''
  );
  const [briefLoading, setBriefLoading] = useState(false);
  const [rightReady, setRightReady] = useState(false);
  const [panelRatio, setPanelRatio] = useState<number>(() => {
    const s = localStorage.getItem('soma_panel_ratio');
    return s ? Math.max(0.35, Math.min(0.75, parseFloat(s))) : 0.65;
  });
  const [dragSubjectId, setDragSubjectId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragTodoId, setDragTodoId] = useState<string | null>(null);
  const [dragTodoGroupId, setDragTodoGroupId] = useState<string | null>(null);
  const [dragTodoOverIndex, setDragTodoOverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dueTagPopoverRef = useRef<HTMLDivElement>(null);
  const statusPopoverRef = useRef<HTMLDivElement>(null);
  const pinPopoverRef = useRef<HTMLDivElement>(null);
  const subjectPickerRef = useRef<HTMLDivElement>(null);
  const touchStartXRef = useRef(0);
  const wheelCooldownRef = useRef(false);
  const prevSelectedDateRef = useRef(selectedDate);
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragPendingIdRef = useRef<string | null>(null);
  const wasInDragRef = useRef(false);
  const subjectGroupRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const activeSubjectsRef = useRef<Subject[]>([]);
  const subjectsRef = useRef<Subject[]>([]);
  const dragOverIndexRef = useRef<number | null>(null);
  const dragTodoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragTodoPendingRef = useRef<string | null>(null);
  const wasInTodoDragRef = useRef(false);
  const todoRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragTodoIdRef = useRef<string | null>(null);
  const dragTodoGroupIdRef = useRef<string | null>(null);
  const dragTodoOverIndexRef = useRef<number | null>(null);
  const todosRef = useRef<Todo[]>([]);
  const selectedDateKeyRef = useRef<string>('');
  const computeIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const prevLogicalTodayStrRef = useRef<string>(toISODateString(logicalToday()));

  // Sync week view when selectedDate changes from an external source (e.g. CalendarTab)
  useEffect(() => {
    if (!isSameDay(selectedDate, prevSelectedDateRef.current)) {
      prevSelectedDateRef.current = selectedDate;
      setViewWeekStart(getMondayOfWeek(selectedDate));
    }
  }, [selectedDate]);

  useEffect(() => {
    const visibleSubjects = getVisibleSubjects();
    if (visibleSubjects.length !== storage.getSubjects().length) {
      storage.setSubjects(visibleSubjects);
    }
    setSubjects(visibleSubjects);
    setRightReady(true);
    const tick = () => {
      const now = new Date();
      setCurrentMinutes(now.getHours() * 60 + now.getMinutes());
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const blocksForDate = storage.getTimeBlocks().filter(b => isOnDate(b.startTime, selectedDate));
    setBlocks(blocksForDate);
    setSubjects(prev => prev.map(s => ({
      ...s,
      totalTimeToday: subjectSecsFromSessions(s.id, selectedDate),
    })));
  }, [selectedDate]);

  useEffect(() => {
    const dateStr = toISODateString(selectedDate);
    const nextDateStr = toISODateString(addDays(selectedDate, 1));
    const todayStr = toISODateString(logicalToday());

    function compute() {
      const now = new Date();
      const dateBlocks = storage.getTimeBlocks().filter(b => isOnDate(b.startTime, selectedDate));
      const sameDayBlocks = dateBlocks.filter(b => new Date(b.startTime).getHours() >= START_HOUR);
      const nextDayBlocks = dateBlocks.filter(b => new Date(b.startTime).getHours() < START_HOUR);

      const sameDayResult = computeElapsedTime(sameDayBlocks, now, selectedDate);
      const nextDayResult = computeElapsedTime(nextDayBlocks, now, selectedDate);

      const combined: Record<string, number> = { ...sameDayResult };
      for (const [id, mins] of Object.entries(nextDayResult)) {
        combined[id] = (combined[id] ?? 0) + mins;
      }

      setElapsedBySubject(combined);
      // Guard: discard the write if selectedDate has changed since this effect started
      if (selectedDateKeyRef.current !== dateStr) return;
      localStorage.setItem(`soma_elapsed_${dateStr}`, JSON.stringify(sameDayResult));
      localStorage.setItem(`soma_elapsed_${nextDateStr}`, JSON.stringify(nextDayResult));
    }

    compute();
    if (dateStr !== todayStr) return;
    clearInterval(computeIntervalRef.current);
    computeIntervalRef.current = setInterval(compute, 60_000);
    return () => { clearInterval(computeIntervalRef.current); };
  }, [selectedDate, blocks]);

  // Detect midnight crossing: flush elapsed for old day, auto-advance to new day
  useEffect(() => {
    const id = setInterval(() => {
      const newTodayStr = toISODateString(logicalToday());
      if (newTodayStr === prevLogicalTodayStrRef.current) return;
      const oldDateStr = prevLogicalTodayStrRef.current;
      prevLogicalTodayStrRef.current = newTodayStr;
      const oldDate = new Date(`${oldDateStr}T00:00:00`);
      const oldBlocks = storage.getTimeBlocks().filter(b => isOnDate(b.startTime, oldDate));
      localStorage.setItem(
        `soma_elapsed_${oldDateStr}`,
        JSON.stringify(computeElapsedTime(oldBlocks, new Date(), oldDate)),
      );
      if (isSameDay(selectedDate, oldDate)) onSelectDate(logicalToday());
    }, 30_000);
    return () => clearInterval(id);
  }, [selectedDate, onSelectDate]);

  useEffect(() => {
    function loadGcal() {
      const cached = storage.getCachedGoogleEvents();
      setGcalEvents(cached.filter(e => !!e.start.dateTime && isOnDate(e.start.dateTime, selectedDate)));
    }
    loadGcal();
    window.addEventListener('soma_gcal_updated', loadGcal);
    return () => window.removeEventListener('soma_gcal_updated', loadGcal);
  }, [selectedDate]);

  useEffect(() => {
    const COURSE_COLORS = [
      '#ef5350', '#42a5f5', '#66bb6a', '#ab47bc',
      '#ffa726', '#26c6da', '#ec407a', '#8d6e63',
    ];
    const assignments = storage.getCachedAssignments();
    const courses = storage.getCachedCourses();
    const courseColorMap = Object.fromEntries(
      courses.map((c, i) => [c.id, COURSE_COLORS[i % COURSE_COLORS.length]])
    );
    const due = assignments
      .filter(a => a.dueAt && isOnDate(a.dueAt, selectedDate))
      .map(a => ({
        assignment: a,
        course: courses.find(c => c.id === a.courseId),
        color: courseColorMap[a.courseId] ?? '#888',
      }));
    setDueAssignments(due);
  }, [selectedDate]);

  useEffect(() => {
    if (!blockModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setBlockModal(null); setBlockEditMode(false); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [blockModal]);

  useEffect(() => {
    if (!editSubject) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditSubject(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editSubject]);

  useEffect(() => {
    if (!statusPopoverId) return;
    const onDown = (e: MouseEvent) => {
      if (statusPopoverRef.current && !statusPopoverRef.current.contains(e.target as Node)) {
        setStatusPopoverId(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [statusPopoverId]);

  useEffect(() => {
    if (!pinPopoverId) return;
    const onDown = (e: MouseEvent) => {
      if (pinPopoverRef.current && !pinPopoverRef.current.contains(e.target as Node)) {
        setPinPopoverId(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pinPopoverId]);

  useEffect(() => {
    if (!dueTagPopover) return;
    const onDown = (e: MouseEvent) => {
      if (dueTagPopoverRef.current && !dueTagPopoverRef.current.contains(e.target as Node)) {
        setDueTagPopover(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [dueTagPopover]);

  useEffect(() => {
    if (!taskModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTaskModal(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [taskModal]);

  useEffect(() => {
    if (!subjectPickerMode) return;
    const onDown = (e: MouseEvent) => {
      if (subjectPickerRef.current && !subjectPickerRef.current.contains(e.target as Node)) {
        setSubjectPickerMode(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [subjectPickerMode]);

  useEffect(() => {
    if (!dragSubjectId) return;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    function onMove(e: PointerEvent) {
      const subjects = activeSubjectsRef.current;
      const y = e.clientY;
      let best = 0, bestDist = Infinity;
      subjects.forEach((s, i) => {
        const el = subjectGroupRefs.current.get(s.id);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const dist = Math.abs(y - (rect.top + rect.height / 2));
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      setDragOverIndex(prev => prev === best ? prev : best);
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const overIndex = dragOverIndexRef.current;
      const subjects = activeSubjectsRef.current;
      if (overIndex !== null) {
        const from = subjects.findIndex(s => s.id === dragSubjectId);
        if (from !== -1 && from !== overIndex) {
          const reordered = [...subjects];
          const [item] = reordered.splice(from, 1);
          reordered.splice(overIndex, 0, item);
          const updated = reordered.map((s, i) => ({ ...s, order: i }));
          storage.setSubjects(updated);
          setSubjects(updated);
        }
      }
      setTimeout(() => { wasInDragRef.current = false; }, 0);
      setDragSubjectId(null);
      setDragOverIndex(null);
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragSubjectId]);

  useEffect(() => {
    if (!dragTodoId || !dragTodoGroupId) return;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    function onMove(e: PointerEvent) {
      const groupId = dragTodoGroupIdRef.current;
      if (!groupId) return;
      const allTodos = todosRef.current;
      const dateKey = selectedDateKeyRef.current;
      const groupTodos = groupId === 'unassigned'
        ? allTodos.filter(t => t.date === dateKey && !t.subjectId)
        : allTodos.filter(t => t.date === dateKey && t.subjectId === groupId);
      const ordered = [...groupTodos].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const y = e.clientY;
      let best = 0, bestDist = Infinity;
      ordered.forEach((t, i) => {
        const el = todoRowRefs.current.get(t.id);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const dist = Math.abs(y - (rect.top + rect.height / 2));
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      setDragTodoOverIndex(prev => prev === best ? prev : best);
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const overIndex = dragTodoOverIndexRef.current;
      const todoId = dragTodoIdRef.current;
      const groupId = dragTodoGroupIdRef.current;

      if (overIndex !== null && todoId && groupId) {
        const allTodos = storage.getTodos();
        const dateKey = selectedDateKeyRef.current;
        const groupTodos = groupId === 'unassigned'
          ? allTodos.filter(t => t.date === dateKey && !t.subjectId)
          : allTodos.filter(t => t.date === dateKey && t.subjectId === groupId);
        const ordered = [...groupTodos].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const from = ordered.findIndex(t => t.id === todoId);
        if (from !== -1 && from !== overIndex) {
          const reordered = [...ordered];
          const [item] = reordered.splice(from, 1);
          reordered.splice(overIndex, 0, item);
          const reorderedWithOrder = reordered.map((t, i) => ({ ...t, order: i }));
          const updated = allTodos.map(t => reorderedWithOrder.find(rt => rt.id === t.id) ?? t);
          storage.setTodos(updated);
          setTodos(updated);
        }
      }

      setTimeout(() => { wasInTodoDragRef.current = false; }, 0);
      setDragTodoId(null);
      setDragTodoGroupId(null);
      setDragTodoOverIndex(null);
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragTodoId, dragTodoGroupId]);

  const slots = Array.from({ length: TOTAL_HOURS }, (_, i) => {
    const hourOfDay = (START_HOUR + i) % 24;
    const minutes = hourOfDay * 60;
    const ampm = hourOfDay >= 12 ? 'PM' : 'AM';
    const h12 = hourOfDay % 12 || 12;
    return { minutes, label: `${h12}:00 ${ampm}` };
  });

  const isViewingToday = isSameDay(selectedDate, logicalToday());
  const showCurrentTime = isViewingToday;

  function deleteBlock(id: string) {
    storage.setTimeBlocks(storage.getTimeBlocks().filter(b => b.id !== id));
    setBlocks(prev => prev.filter(b => b.id !== id));
    setBlockModal(null);
    setBlockEditMode(false);
  }

  function openBlockEdit(block: TimeBlock) {
    const toForm = (d: Date) => {
      const h24 = d.getHours(), m = d.getMinutes();
      return { hour: h24 % 12 || 12, minute: m, ampm: (h24 >= 12 ? 'PM' : 'AM') as 'AM' | 'PM' };
    };
    const s = toForm(new Date(block.startTime));
    const e = toForm(new Date(block.endTime));
    setBlockEditForm({
      task: block.task ?? '',
      startHour: s.hour, startMinute: s.minute, startAmPm: s.ampm,
      endHour: e.hour, endMinute: e.minute, endAmPm: e.ampm,
    });
    setBlockEditMode(true);
  }

  function saveBlockEdit() {
    if (!blockModal) return;
    const toHour24 = (h: number, ampm: 'AM' | 'PM') => (h % 12) + (ampm === 'PM' ? 12 : 0);
    const start = new Date(
      selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(),
      toHour24(blockEditForm.startHour, blockEditForm.startAmPm), blockEditForm.startMinute,
    );
    const end = new Date(
      selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(),
      toHour24(blockEditForm.endHour, blockEditForm.endAmPm), blockEditForm.endMinute,
    );
    const updated: TimeBlock = {
      ...blockModal.block,
      task: blockEditForm.task.trim() || blockModal.block.task,
      startTime: toLocalISO(start),
      endTime: toLocalISO(end),
    };
    const allBlocks = storage.getTimeBlocks().map(b => b.id === updated.id ? updated : b);
    storage.setTimeBlocks(allBlocks);
    const blocksForDate = allBlocks.filter(b => isOnDate(b.startTime, selectedDate));
    setBlocks(blocksForDate);
    const updatedSubjects = subjects.map(s => ({
      ...s,
      totalTimeToday: subjectSecsFromSessions(s.id, selectedDate),
    }));
    storage.setSubjects(updatedSubjects);
    setSubjects(updatedSubjects);
    setBlockModal({ block: updated, subject: blockModal.subject });
    setBlockEditMode(false);
  }

  function saveNewSubject() {
    if (!addSubjectForm.name.trim()) return;
    const s: Subject = {
      id: crypto.randomUUID(),
      name: addSubjectForm.name.trim(),
      color: addSubjectForm.color,
      totalTimeToday: 0,
    };
    const updated = [...subjects, s];
    storage.setSubjects(updated);
    setSubjects(updated);
    setShowAddSubject(false);
    setAddSubjectForm({ name: '', color: COLORS[0] });
  }

  function saveEditSubject() {
    if (!editSubject) return;
    const updated = subjects.map(s =>
      s.id === editSubject.id ? { ...s, name: editSubject.name, color: editSubject.color } : s,
    );
    storage.setSubjects(updated);
    setSubjects(updated);
    setEditSubject(null);
  }

  function deleteSubject(id: string) {
    const updated = subjects.filter(s => s.id !== id);
    storage.setSubjects(updated);
    setSubjects(updated);
    setEditSubject(null);
  }

  function handleSessionSaved(updatedSubjects: Subject[], updatedBlocks: TimeBlock[]) {
    setSubjects(updatedSubjects);
    setBlocks(updatedBlocks.filter(b => isOnDate(b.startTime, selectedDate)));
  }

  function handleRunningChange(isRunning: boolean) {
    setTimerRunning(isRunning);
  }

  function setTodoStatus(id: string, status: Todo['status']) {
    const updated = todos.map(t => t.id === id ? { ...t, status } : t);
    storage.setTodos(updated);
    setTodos(updated);
    setStatusPopoverId(null);

    const todo = todos.find(t => t.id === id);
    if (todo?.assignmentId !== undefined) {
      const linked = updated.filter(t => t.assignmentId === todo.assignmentId);
      let assignmentStatus: string;
      if (linked.every(t => t.status === 'done')) {
        assignmentStatus = 'done';
      } else if (linked.some(t => t.status === 'in_progress' || t.status === 'done')) {
        assignmentStatus = 'in_progress';
      } else {
        assignmentStatus = 'not_started';
      }
      storage.setAssignmentStatus({ ...storage.getAssignmentStatus(), [String(todo.assignmentId)]: assignmentStatus });
    }
  }

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const onMove = (me: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const leftPx = me.clientX - rect.left;
      const ratio = Math.max(400, Math.min(rect.width - 300, leftPx)) / rect.width;
      setPanelRatio(ratio);
      localStorage.setItem('soma_panel_ratio', String(ratio));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);


  const generateBrief = useCallback(async () => {
    setBriefLoading(true);
    try {
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      const todayKey = getTodayKey();
      const threeDaysMs = now.getTime() + 3 * 24 * 60 * 60 * 1000;
      const allSubjects = storage.getSubjects();
      const soonAssignments = storage.getCachedAssignments().filter(a => new Date(a.dueAt).getTime() <= threeDaysMs);
      const assignmentsStr = soonAssignments.length > 0
        ? soonAssignments.map(a => `• ${a.name} (${a.courseName}) — due ${new Date(a.dueAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`).join('\n')
        : 'None';
      const allTodos = storage.getTodos().filter(t => t.date === getTodayKey() && t.status !== 'done');
      const incompleteTodos = allTodos.length;
      const topTodos = allTodos.slice(0, 5)
        .map(t => {
          const subj = allSubjects.find(s => s.id === t.subjectId);
          return `• ${t.text}${subj ? ` (${subj.name})` : ''}`;
        }).join('\n');
      const todayGcal = storage.getCachedGoogleEvents().filter(e => !!e.start.dateTime && isOnDate(e.start.dateTime, now));
      const gcalStr = todayGcal.length > 0
        ? todayGcal.map(e => `• ${e.summary ?? '(No title)'}${e.start.dateTime ? ` (${fmtTime(e.start.dateTime)})` : ''}`).join('\n')
        : 'None';
      const userMsg = `Today is ${dateStr}.

Assignments due within 3 days:
${assignmentsStr}

Today's schedule:
${gcalStr}

Incomplete todos: ${incompleteTodos} total
${topTodos || '(none)'}

Write a brief daily summary with bullet points highlighting what to focus on today.`;
      const text = await sendMessage(
        [{ role: 'user', content: userMsg }],
        'You are a concise daily assistant for a student. Generate a focused daily briefing. Use 1 short sentence of context, then bullet points for today\'s priorities. Keep it under 6 bullet points. No markdown headers, no bold, just plain bullet points with • character. Be warm and direct.',
      );
      setBriefText(text);
      localStorage.setItem('soma_brief_text', text);
      localStorage.setItem('soma_brief_date', todayKey);
    } catch {
      // fail silently — no API server or request error
    } finally {
      setBriefLoading(false);
    }
  }, []);

  useEffect(() => {
    const cachedDate = localStorage.getItem('soma_brief_date');
    const cachedText = localStorage.getItem('soma_brief_text');
    if (cachedDate === getTodayKey() && cachedText) {
      setBriefText(cachedText);
    } else {
      generateBrief();
    }
  }, [generateBrief]);

  useEffect(() => {
    setBriefCollapsed(!isViewingToday);
  }, [isViewingToday]);



  function handleSubjectPointerDown(e: React.PointerEvent, subjectId: string) {
    if (e.button !== 0) return;
    dragPendingIdRef.current = subjectId;
    dragTimerRef.current = setTimeout(() => {
      if (dragPendingIdRef.current !== subjectId) return;
      dragTimerRef.current = null;
      wasInDragRef.current = true;
      setDragSubjectId(subjectId);
    }, 200);
  }

  function handleSubjectPointerUp() {
    if (dragTimerRef.current) {
      clearTimeout(dragTimerRef.current);
      dragTimerRef.current = null;
      dragPendingIdRef.current = null;
    }
  }

  function handleTodoPointerDown(e: React.PointerEvent, todoId: string, groupId: string) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    dragTodoPendingRef.current = todoId;
    dragTodoTimerRef.current = setTimeout(() => {
      if (dragTodoPendingRef.current !== todoId) return;
      dragTodoTimerRef.current = null;
      wasInTodoDragRef.current = true;
      setDragTodoId(todoId);
      setDragTodoGroupId(groupId);
    }, 200);
  }

  function handleTodoPointerUp() {
    if (dragTodoTimerRef.current) {
      clearTimeout(dragTodoTimerRef.current);
      dragTodoTimerRef.current = null;
      dragTodoPendingRef.current = null;
    }
  }

  function startAdding(groupId: string) {
    const subjectId = groupId === 'unassigned' ? undefined : groupId;
    let startHour = 9, startMinute = 0;
    let startAmPm: 'AM' | 'PM' = 'AM';
    if (isViewingToday) {
      const now = new Date();
      const h = now.getHours(), m = now.getMinutes();
      const hour24 = Math.min(m >= 30 ? h + 1 : h, 23);
      startMinute = m < 30 ? 30 : 0;
      startAmPm = hour24 >= 12 ? 'PM' : 'AM';
      startHour = hour24 % 12 || 12;
    }
    setTaskForm({ text: '', hours: 0, minutes: 0, dueDate: '', notes: '', scheduleIt: false, startHour, startMinute, startAmPm });
    setTaskDetailsOpen(false);
    setTaskModal({ subjectId });
  }

  function saveTaskFromModal(startTimer = false) {
    if (!taskModal) return;
    const text = taskForm.text.trim();
    if (!text) { setTaskModal(null); return; }
    const estimatedMinutes = taskForm.hours * 60 + taskForm.minutes;

    if (taskModal.editingTodo) {
      const updated = todos.map(t => t.id === taskModal.editingTodo!.id ? {
        ...t,
        text,
        dueDate: taskForm.dueDate || undefined,
        notes: taskForm.notes.trim() || undefined,
        estimatedMinutes: estimatedMinutes > 0 ? estimatedMinutes : undefined,
      } : t);
      storage.setTodos(updated);
      setTodos(updated);
    } else {
      const newTodo: Todo = {
        id: crypto.randomUUID(),
        text,
        status: 'nothing',
        subjectId: taskModal.subjectId,
        dueDate: taskForm.dueDate || undefined,
        notes: taskForm.notes.trim() || undefined,
        estimatedMinutes: estimatedMinutes > 0 ? estimatedMinutes : undefined,
        date: selectedDateKey,
      };
      storage.setTodos([...todos, newTodo]);
      setTodos(prev => [...prev, newTodo]);
    }

    if (taskForm.scheduleIt) {
      const hour24 = (taskForm.startHour % 12) + (taskForm.startAmPm === 'PM' ? 12 : 0);
      const durMins = Math.max(estimatedMinutes, 30);
      const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), hour24, taskForm.startMinute);
      const end = new Date(start.getTime() + durMins * 60_000);
      const block: TimeBlock = {
        id: crypto.randomUUID(),
        subjectId: taskModal.subjectId ?? '',
        task: text,
        startTime: toLocalISO(start),
        endTime: toLocalISO(end),
        source: 'manual',
      };
      storage.setTimeBlocks([...storage.getTimeBlocks(), block]);
      setBlocks(prev => [...prev, block]);
    }
    setTaskModal(null);
    if (startTimer && taskModal.subjectId) {
      const subject = subjects.find(s => s.id === taskModal.subjectId);
      if (subject) {
        setInitialTimerTask(text);
        setTimerSubject(subject);
      }
    }
  }

  function openEditTodo(todo: Todo) {
    const hours = Math.floor((todo.estimatedMinutes ?? 0) / 60);
    const minutes = (todo.estimatedMinutes ?? 0) % 60;
    setTaskForm({ text: todo.text, hours, minutes, dueDate: todo.dueDate ?? '', notes: todo.notes ?? '', scheduleIt: false, startHour: 9, startMinute: 0, startAmPm: 'AM' });
    setTaskDetailsOpen(true);
    setTaskModal({ subjectId: todo.subjectId, editingTodo: todo });
  }

  function startTimerForTodo(todo: Todo) {
    const subject = subjects.find(s => s.id === todo.subjectId);
    if (!subject) return;
    setTodoStatus(todo.id, 'in_progress');
    setInitialTimerTask(todo.text);
    setTimerSubject(subject);
  }

  function getActualMinutesForTodo(todo: Todo): number {
    const sessions = storage.getTimerSessions();
    const total = sessions
      .filter(s =>
        s.task === todo.text &&
        s.subjectId === todo.subjectId &&
        isOnDate(s.startTime, selectedDate)
      )
      .reduce((sum, s) => sum + s.durationSeconds, 0);
    return Math.floor(total / 60);
  }

  function pinTodo(todo: Todo) {
    const hour24 = (pinForm.hour % 12) + (pinForm.ampm === 'PM' ? 12 : 0);
    const totalDurMins = pinForm.durationHours * 60 + pinForm.durationMinutes;
    const start = new Date(
      selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(),
      hour24, pinForm.minute,
    );
    const end = new Date(start.getTime() + Math.max(totalDurMins, 1) * 60_000);
    const block: TimeBlock = {
      id: crypto.randomUUID(),
      subjectId: todo.subjectId ?? '',
      task: todo.text,
      startTime: toLocalISO(start),
      endTime: toLocalISO(end),
      source: 'manual',
    };
    storage.setTimeBlocks([...storage.getTimeBlocks(), block]);
    setBlocks(prev => [...prev, block]);
    setPinPopoverId(null);
  }

  function openPinPopover(todoId: string) {
    setStatusPopoverId(null);
    const now = new Date();
    let hour24 = 9, minute = 0;
    if (isViewingToday) {
      const h = now.getHours(), m = now.getMinutes();
      hour24 = Math.min(m >= 30 ? h + 1 : h, 23);
      minute = m < 30 ? 30 : 0;
    }
    const ampm: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM';
    const hour = hour24 % 12 || 12;
    setPinForm({ hour, minute, ampm, durationHours: 1, durationMinutes: 0 });
    setPinPopoverId(prev => prev === todoId ? null : todoId);
  }

  function handleDateBarWheel(e: React.WheelEvent) {
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
    if (wheelCooldownRef.current) return;
    if (Math.abs(e.deltaX) < 30) return;
    wheelCooldownRef.current = true;
    setViewWeekStart(d => addDays(d, e.deltaX > 0 ? 7 : -7));
    setTimeout(() => { wheelCooldownRef.current = false; }, 500);
  }

  function handleDateBarTouchStart(e: React.TouchEvent) {
    touchStartXRef.current = e.touches[0].clientX;
  }

  function handleDateBarTouchEnd(e: React.TouchEvent) {
    const diff = touchStartXRef.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      setViewWeekStart(d => addDays(d, diff > 0 ? 7 : -7));
    }
  }

  const activeSubjects = subjects.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const selectedDateKey = toISODateString(selectedDate);

  // Keep refs in sync for use inside pointer/drag event handlers
  activeSubjectsRef.current = activeSubjects;
  subjectsRef.current = subjects;
  dragOverIndexRef.current = dragOverIndex;
  dragTodoIdRef.current = dragTodoId;
  dragTodoGroupIdRef.current = dragTodoGroupId;
  dragTodoOverIndexRef.current = dragTodoOverIndex;
  todosRef.current = todos;
  selectedDateKeyRef.current = selectedDateKey;

  // Live preview order while dragging
  const orderedActiveSubjects = (() => {
    if (dragSubjectId === null || dragOverIndex === null) return activeSubjects;
    const from = activeSubjects.findIndex(s => s.id === dragSubjectId);
    if (from === -1) return activeSubjects;
    const result = [...activeSubjects];
    const [item] = result.splice(from, 1);
    result.splice(dragOverIndex, 0, item);
    return result;
  })();
  const dayTodos = todos.filter(t => t.date === selectedDateKey);

  function getOrderedGroupTodos(groupId: string): Todo[] {
    const groupTodos = groupId === 'unassigned'
      ? dayTodos.filter(t => !t.subjectId)
      : dayTodos.filter(t => t.subjectId === groupId);
    const sorted = [...groupTodos].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (dragTodoId === null || dragTodoOverIndex === null || dragTodoGroupId !== groupId) return sorted;
    const from = sorted.findIndex(t => t.id === dragTodoId);
    if (from === -1) return sorted;
    const result = [...sorted];
    const [item] = result.splice(from, 1);
    result.splice(dragTodoOverIndex, 0, item);
    return result;
  }

  function selectDate(date: Date) {
    onSelectDate(date);
    prevSelectedDateRef.current = date;
    setViewWeekStart(getMondayOfWeek(date));
  }

  const isCurrentWeek = isSameDay(viewWeekStart, getMondayOfWeek(logicalToday()));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(viewWeekStart, i));

  const assignmentCountByDay = new Map<string, number>();
  storage.getCachedAssignments().forEach(a => {
    if (a.dueAt) {
      const k = dayKey(new Date(a.dueAt));
      assignmentCountByDay.set(k, (assignmentCountByDay.get(k) ?? 0) + 1);
    }
  });

  const todoCountByDay = new Map<string, number>();
  todos.forEach(t => {
    if (t.date) {
      const k = dayKey(new Date(t.date + 'T00:00:00'));
      todoCountByDay.set(k, (todoCountByDay.get(k) ?? 0) + 1);
    }
  });

  const itemsByDayKey = new Map<string, Array<{ name: string; color: string; type: 'todo' | 'assignment' }>>();
  todos.forEach(t => {
    if (t.date) {
      const k = dayKey(new Date(t.date + 'T00:00:00'));
      if (!itemsByDayKey.has(k)) itemsByDayKey.set(k, []);
      const subj = subjects.find(s => s.id === t.subjectId);
      itemsByDayKey.get(k)!.push({ name: t.text, color: subj?.color ?? '#888', type: 'todo' });
    }
  });
  const WEEK_COURSE_COLORS = ['#ef5350', '#42a5f5', '#66bb6a', '#ab47bc', '#ffa726', '#26c6da', '#ec407a', '#8d6e63'];
  const weekCourses = storage.getCachedCourses();
  const weekCourseColorMap = Object.fromEntries(weekCourses.map((c, i) => [c.id, WEEK_COURSE_COLORS[i % WEEK_COURSE_COLORS.length]]));
  storage.getCachedAssignments().forEach(a => {
    if (a.dueAt) {
      const k = dayKey(new Date(a.dueAt));
      if (!itemsByDayKey.has(k)) itemsByDayKey.set(k, []);
      itemsByDayKey.get(k)!.push({ name: a.name, color: weekCourseColorMap[a.courseId] ?? '#888', type: 'assignment' });
    }
  });

  const gridHeight = TOTAL_HOURS * SLOT_HEIGHT;

  function renderTodoItem(todo: Todo, groupId: string) {
    const actualMins = getActualMinutesForTodo(todo);
    const hasEstimate = (todo.estimatedMinutes ?? 0) > 0;
    const isTodoDragging = dragTodoId === todo.id;

    return (
      <div
        key={todo.id}
        className={`${styles.todoItemWrap}${isTodoDragging ? ` ${styles.todoItemWrapDragging}` : ''}`}
        ref={el => { if (el) todoRowRefs.current.set(todo.id, el); else todoRowRefs.current.delete(todo.id); }}
        onPointerDown={e => handleTodoPointerDown(e, todo.id, groupId)}
        onPointerUp={handleTodoPointerUp}
        onPointerCancel={handleTodoPointerUp}
      >
        <div className={`${styles.todoItem}${todo.status === 'done' ? ` ${styles.todoItemDone}` : ''}`}>
          <button
            className={todo.status === 'in_progress' ? styles.statusBtnInProgress : todo.status === 'done' ? styles.statusBtnDone : styles.statusBtn}
            onClick={() => setStatusPopoverId(prev => prev === todo.id ? null : todo.id)}
          >
            {todo.status === 'in_progress' && (
              <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="0,0 10,5 0,10" fill="currentColor" /></svg>
            )}
            {todo.status === 'done' && (
              <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
          </button>
          <div className={styles.todoContent}>
            <span className={styles.todoText} onClick={() => { if (wasInTodoDragRef.current) { wasInTodoDragRef.current = false; return; } openEditTodo(todo); }}>{todo.text}</span>
            {hasEstimate && (
              <span className={styles.todoEstBadge}>{fmtEstimated(todo.estimatedMinutes!)}</span>
            )}
            {todo.dueDate && <span className={styles.todoDueDate}>{todo.dueDate}</span>}
          </div>
          {(hasEstimate || actualMins > 0) && (
            <span className={styles.todoTimeDisplay}>
              {hasEstimate
                ? `${fmtTimeShort(actualMins)} / ${fmtTimeShort(todo.estimatedMinutes!)}`
                : fmtTimeShort(actualMins)
              }
            </span>
          )}
          <div className={styles.todoActions}>
            {todo.subjectId && todo.status !== 'done' && (
              <button
                className={styles.startTodoBtn}
                title="Start timer for this task"
                onClick={e => { e.stopPropagation(); startTimerForTodo(todo); }}
              >
                Start
              </button>
            )}
            <button
              className={styles.editTodoBtn}
              title="Edit"
              onClick={e => { e.stopPropagation(); openEditTodo(todo); }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M7.5 1.5l2 2L3 10H1V8L7.5 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <button
              className={styles.pinBtn}
              title="Pin to schedule"
              onClick={e => { e.stopPropagation(); openPinPopover(todo.id); }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.3"/><line x1="5.5" y1="3" x2="5.5" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="3" y1="5.5" x2="8" y2="5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>
        {statusPopoverId === todo.id && (
          <div className={styles.statusPopover} ref={statusPopoverRef}>
            <button data-status="nothing" className={`${styles.statusOption}${todo.status === 'nothing' ? ` ${styles.statusOptionActive}` : ''}`} onClick={() => setTodoStatus(todo.id, 'nothing')}>
              <span className={styles.statusIcon}><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.5"/></svg></span>
              Nothing
            </button>
            <button data-status="in_progress" className={`${styles.statusOption}${todo.status === 'in_progress' ? ` ${styles.statusOptionActive}` : ''}`} onClick={() => setTodoStatus(todo.id, 'in_progress')}>
              <span className={`${styles.statusIcon} ${styles.statusIconInProgress}`}><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5"/><polygon points="5,4 10,6.5 5,9" fill="currentColor"/></svg></span>
              In progress
            </button>
            <button data-status="done" className={`${styles.statusOption}${todo.status === 'done' ? ` ${styles.statusOptionActive}` : ''}`} onClick={() => setTodoStatus(todo.id, 'done')}>
              <span className={`${styles.statusIcon} ${styles.statusIconDone}`}><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5"/><path d="M4 6.5L6 8.5L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
              Done
            </button>
          </div>
        )}
        {pinPopoverId === todo.id && (
          <div className={styles.pinPopover} ref={pinPopoverRef}>
            <div className={styles.pinFormRow}>
              <label className={styles.pinLabel}>Start</label>
              <div className={styles.pinTimeSelects}>
                <input
                  type="number"
                  className={styles.pinTimeInput}
                  value={pinForm.hour}
                  min={1}
                  max={12}
                  onChange={e => setPinForm(f => ({ ...f, hour: Math.min(12, Math.max(1, Number(e.target.value) || 1)) }))}
                />
                <span className={styles.pinTimeSep}>:</span>
                <input
                  type="number"
                  className={styles.pinTimeInput}
                  value={String(pinForm.minute).padStart(2, '0')}
                  min={0}
                  max={59}
                  onChange={e => setPinForm(f => ({ ...f, minute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) }))}
                />
                <div className={styles.pinAmpmToggle}>
                  <button
                    className={`${styles.pinAmpmBtn}${pinForm.ampm === 'AM' ? ` ${styles.pinAmpmBtnActive}` : ''}`}
                    onClick={() => setPinForm(f => ({ ...f, ampm: 'AM' }))}
                  >AM</button>
                  <button
                    className={`${styles.pinAmpmBtn}${pinForm.ampm === 'PM' ? ` ${styles.pinAmpmBtnActive}` : ''}`}
                    onClick={() => setPinForm(f => ({ ...f, ampm: 'PM' }))}
                  >PM</button>
                </div>
              </div>
            </div>
            <div className={styles.pinFormRow}>
              <label className={styles.pinLabel}>Duration</label>
              <input
                type="number"
                className={styles.pinTimeInput}
                value={pinForm.durationHours}
                min={0}
                onChange={e => setPinForm(f => ({ ...f, durationHours: Math.max(0, Number(e.target.value) || 0) }))}
              />
              <span className={styles.pinDurationUnit}>h</span>
              <input
                type="number"
                className={styles.pinTimeInput}
                value={String(pinForm.durationMinutes).padStart(2, '0')}
                min={0}
                max={59}
                onChange={e => setPinForm(f => ({ ...f, durationMinutes: Math.min(59, Math.max(0, Number(e.target.value) || 0)) }))}
              />
              <span className={styles.pinDurationUnit}>m</span>
            </div>
            <div className={styles.pinActions}>
              <button className={styles.pinSubmitBtn} onClick={() => pinTodo(todo)}>Pin to schedule</button>
              <button className={styles.pinCancel} onClick={() => setPinPopoverId(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
    <div className={styles.wrapper}>
      {timerRunning && <div className={styles.focusBannerSpacer} />}
      {/* ── Date bar ── */}
      <div
        className={styles.dateBar}
        onWheel={handleDateBarWheel}
        onTouchStart={handleDateBarTouchStart}
        onTouchEnd={handleDateBarTouchEnd}
      >
        <div className={styles.weekNav}>
          <button className={styles.weekArrow} onClick={() => setViewWeekStart(d => addDays(d, -7))}>←</button>
          <button className={styles.weekArrow} onClick={() => setViewWeekStart(d => addDays(d, 7))}>→</button>
          {!isCurrentWeek && (
            <button className={styles.todayBtn} onClick={() => selectDate(logicalToday())}>Today</button>
          )}
        </div>
        <div className={styles.daysRow}>
          {weekDays.map((day, i) => {
            const isToday = isSameDay(day, logicalToday());
            const isSelected = isSameDay(day, selectedDate);
            const k = dayKey(day);
            const todoCount = todoCountByDay.get(k) ?? 0;
            const assignmentCount = assignmentCountByDay.get(k) ?? 0;
            const badgeLabel = todoCount > 0 || assignmentCount > 0
              ? assignmentCount > 0 ? `${todoCount} • ${assignmentCount}` : `${todoCount}`
              : null;
            const dayItems = itemsByDayKey.get(k) ?? [];
            const isSingleItem = dayItems.length === 1;
            const isMultiItem = dayItems.length > 1;
            return (
              <div
                key={i}
                className={[
                  styles.dayCol,
                  isSelected ? styles.dayColSelected : '',
                  isToday && !isSelected ? styles.dayColToday : '',
                ].filter(Boolean).join(' ')}
                onClick={() => selectDate(day)}
              >
                <span className={styles.dayAbbr}>{DAY_ABBRS[i]}</span>
                <span className={styles.dayCircle}>
                  <span className={styles.dayNum}>{day.getDate()}</span>
                </span>
                <div className={styles.dayBadgeWrap}>
                  <span className={[
                    styles.dayBadge,
                    !badgeLabel ? styles.dayBadgeEmpty : '',
                    isSingleItem ? styles.dayBadgeSingle : '',
                  ].filter(Boolean).join(' ')}>
                    {isSingleItem ? (
                      <>
                        <span className={styles.dayBadgeCount}>{badgeLabel}</span>
                        <span className={styles.dayBadgeInline}>
                          <span className={styles.dayBadgeItemDot} style={{ background: dayItems[0].color }} />
                          {dayItems[0].name}
                        </span>
                      </>
                    ) : (
                      badgeLabel
                    )}
                  </span>
                  {isMultiItem && (
                    <div className={styles.dayBadgePanel} onClick={e => e.stopPropagation()}>
                      {(() => {
                        const todoItems = dayItems.filter(item => item.type === 'todo');
                        const assignmentItems = dayItems.filter(item => item.type === 'assignment');
                        const hasBoth = todoItems.length > 0 && assignmentItems.length > 0;
                        return (
                          <>
                            {todoItems.length > 0 && (
                              <div>
                                {hasBoth && <div className={styles.dayBadgePanelLabel}>Tasks</div>}
                                {todoItems.map((item, idx) => (
                                  <div key={idx} className={styles.dayBadgePanelRow}>
                                    <span className={styles.dayBadgePanelDot} style={{ background: item.color }} />
                                    <span className={styles.dayBadgePanelName}>{item.name}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {hasBoth && <div className={styles.dayBadgePanelDivider} />}
                            {assignmentItems.length > 0 && (
                              <div>
                                {hasBoth && <div className={styles.dayBadgePanelLabelDue}>Due</div>}
                                {assignmentItems.map((item, idx) => (
                                  <div key={idx} className={styles.dayBadgePanelRow}>
                                    <span className={styles.dayBadgePanelDot} style={{ background: item.color }} />
                                    <span className={styles.dayBadgePanelName}>{item.name}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    <div className={styles.container} ref={containerRef}>
      {/* ── Left panel ── */}
      <div className={styles.left} style={{ flex: `0 0 ${(panelRatio * 100).toFixed(1)}%` }}>

        <div className={styles.gridWrapper} style={{ height: gridHeight }}>

          {slots.map(slot => (
            <div
              key={slot.minutes}
              className={styles.slot}
              style={{ top: minToTop(slot.minutes), height: SLOT_HEIGHT }}
            >
              <span className={styles.timeLabel}>{slot.label}</span>
              <div className={styles.slotArea} />
            </div>
          ))}

          {showCurrentTime && (
            <div className={styles.currentTimeLine} style={{ top: minToTop(currentMinutes) }}>
              <div className={styles.nowPill}>
                {`${Math.floor(currentMinutes / 60) % 12 || 12}:${String(currentMinutes % 60).padStart(2, '0')} ${currentMinutes >= 12 * 60 ? 'PM' : 'AM'}`}
              </div>
            </div>
          )}

          {(() => {
            const shortBlocks: TimeBlock[] = [];
            const regularBlocks: TimeBlock[] = [];
            for (const block of blocks) {
              const durMin = (new Date(block.endTime).getTime() - new Date(block.startTime).getTime()) / 60_000;
              if (durMin <= 0) continue;
              if (durMin < 5) shortBlocks.push(block);
              else regularBlocks.push(block);
            }
            const dotGroups = layoutDotGroups(groupShortBlocks(shortBlocks));
            const positionedBlocks = layoutTimeBlocks(regularBlocks);
            return (
              <>
                {positionedBlocks.map(({ block, lane, lanes }) => {
                  const subject = subjects.find(s => s.id === block.subjectId);
                  const start = new Date(block.startTime);
                  const startMin = start.getHours() * 60 + start.getMinutes();
                  const durMin = (new Date(block.endTime).getTime() - start.getTime()) / 60_000;
                  const blockTopPx = minToTop(startMin);
                  const height = Math.max(durToHeight(durMin), 2);
                  return (
                    <div
                      key={block.id}
                      className={styles.block}
                      style={{
                        top: blockTopPx,
                        height,
                        ...laneStyle(lane, lanes),
                        borderLeftColor: subject?.color ?? '#ccc',
                        backgroundColor: subject ? `${subject.color}1f` : '#f5f5f5',
                      }}
                      onClick={e => {
                        e.stopPropagation();
                        setBlockModal({ block, subject });
                      }}
                    >
                      {height >= 38 && (
                        <>
                          <span className={styles.blockSubject}>{subject?.name}</span>
                          {block.task && block.task !== subject?.name && (
                            <span className={styles.blockTask}>{block.task}</span>
                          )}
                        </>
                      )}
                      {height >= 18 && height < 38 && (
                        <span className={styles.blockCompactText}>
                          {block.task && block.task !== subject?.name
                            ? `${subject?.name ?? ''} - ${block.task}`
                            : subject?.name}
                        </span>
                      )}
                    </div>
                  );
                })}
                {dotGroups.map((group, i) => {
                  const subject = subjects.find(s => s.id === group.subjectId);
                  const displayLabel = group.label && group.label !== subject?.name
                    ? group.label
                    : (subject?.name ?? '');
                  const labelWithCount = group.count > 1
                    ? `${displayLabel} ×${group.count}`
                    : displayLabel;
                  return (
                    <div
                      key={`dot-${group.subjectId}-${i}`}
                      className={styles.blockDot}
                      style={{ top: group.topPx, ...laneStyle(group.lane, group.lanes, 8) }}
                      onClick={e => {
                        e.stopPropagation();
                        setBlockModal({ block: group.blocks[group.blocks.length - 1], subject });
                      }}
                    >
                      <span className={styles.blockDotCircle} style={{ background: subject?.color ?? '#ccc' }} />
                      {labelWithCount && <span className={styles.blockDotLabel}>{labelWithCount}</span>}
                    </div>
                  );
                })}
              </>
            );
          })()}

          {gcalEvents.map(event => {
            if (!event.start.dateTime) return null;
            const start = new Date(event.start.dateTime);
            const end = new Date(event.end.dateTime ?? event.start.dateTime);
            const startMin = start.getHours() * 60 + start.getMinutes();
            const durMin = Math.max((end.getTime() - start.getTime()) / 60_000, 15);
            const height = Math.max(durToHeight(durMin), 2);
            const fmtHm = (d: Date) => {
              const h = d.getHours(), m = d.getMinutes();
              return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
            };
            const timeStr = `${fmtHm(start)} – ${fmtHm(end)}`;
            return (
              <div
                key={event.id}
                className={styles.gcalBlock}
                style={{ top: minToTop(startMin), height }}
              >
                {height >= 38 && (
                  <>
                    <span className={styles.gcalBlockTitle}>{event.summary ?? '(No title)'}</span>
                    <span className={styles.gcalBlockTime}>{timeStr}</span>
                  </>
                )}
                {height >= 18 && height < 38 && (
                  <span className={styles.gcalBlockCompact}>{event.summary ?? '(No title)'}</span>
                )}
                {event.htmlLink && (
                  <a
                    href={event.htmlLink}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.gcalBlockLink}
                    onClick={e => e.stopPropagation()}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M4 2H2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                      <path d="M6 1h3v3M9 1L5.5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </a>
                )}
              </div>
            );
          })}

          {(() => {
            const grouped = new Map<number, typeof dueAssignments>();
            for (const item of dueAssignments) {
              const d = new Date(item.assignment.dueAt);
              const mfm = d.getHours() * 60 + d.getMinutes();
              if (!grouped.has(mfm)) grouped.set(mfm, []);
              grouped.get(mfm)!.push(item);
            }
            return Array.from(grouped.entries()).map(([mfm, items]) => {
              const topPx = (mfm - START_HOUR * 60) * (SLOT_HEIGHT / 60) - 10;
              const isOpen = dueTagPopover?.mfm === mfm;
              const isSingle = items.length === 1;
              const { assignment: firstA, color: firstColor } = items[0];
              return (
                <div
                  key={`due-pill-${mfm}`}
                  className={[styles.duePill, !isSingle ? styles.duePillMulti : ''].filter(Boolean).join(' ')}
                  style={{
                    position: 'absolute',
                    top: topPx,
                    right: 0,
                    ...(isSingle
                      ? { background: firstColor + '26', borderColor: firstColor, color: firstColor }
                      : { background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                    ),
                  }}
                  onClick={isSingle ? (e => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setDueTagPopover(prev => prev?.mfm === mfm ? null : {
                      mfm,
                      top: rect.top,
                      right: window.innerWidth - rect.right,
                    });
                  }) : (e => e.stopPropagation())}
                >
                  {isSingle ? firstA.name : (
                    <>
                      <span style={{ marginRight: 4 }}>{items.length} due</span>
                      {items.map(({ color: c, assignment: a }) => (
                        <span key={a.id} className={styles.duePillDot} style={{ background: c }} />
                      ))}
                      <div className={styles.duePillHoverPanel} onClick={e => e.stopPropagation()}>
                        {items.map(({ assignment: a, color: c }) => (
                          <div key={a.id} className={styles.duePillHoverRow}>
                            <span className={styles.duePillHoverDot} style={{ background: c }} />
                            <span className={styles.duePillHoverName}>{a.name}</span>
                            {a.htmlUrl && (
                              <a className={styles.duePillHoverLink} href={a.htmlUrl} target="_blank" rel="noreferrer">↗</a>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {isSingle && isOpen && (
                    <div
                      className={styles.duePillPopover}
                      ref={dueTagPopoverRef}
                      style={{ top: dueTagPopover!.top, right: dueTagPopover!.right }}
                      onClick={e => e.stopPropagation()}
                    >
                      {items.map(({ assignment: a, color: c }) => (
                        <div key={a.id} className={styles.duePillPopoverRow}>
                          <span className={styles.duePillDot} style={{ background: c }} />
                          <span className={styles.duePillPopoverName}>{a.name}</span>
                          {a.htmlUrl && (
                            <a className={styles.duePillPopoverLink} href={a.htmlUrl} target="_blank" rel="noreferrer">
                              Open in Canvas ↗
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            });
          })()}

        </div>
      </div>

      <div className={styles.dividerHandle} onMouseDown={handleDividerMouseDown} />

      {/* ── Right panel ── */}
      <div className={styles.right}>
        {(() => {
          const weekday = selectedDate.toLocaleDateString('en-US', { weekday: 'long' });
          const monthDay = selectedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
          const pendingCount = dayTodos.filter(t => t.status !== 'done').length;
          return (
            <>
              <div className={styles.dateHeader}>
                <div className={styles.dateHeaderText}>
                  <div className={styles.dateHeaderWeekday}>{weekday}</div>
                  <div className={styles.dateHeaderDate}>{monthDay}</div>
                  <div className={styles.dateHeaderCount}>{pendingCount} task{pendingCount !== 1 ? 's' : ''} today</div>
                </div>
                <div className={styles.dateHeaderRight}>
                  <div className={styles.headerBtns} ref={subjectPickerRef}>
                    <button
                      className={`${styles.headerIconBtn}${subjectPickerMode === 'task' ? ` ${styles.headerIconBtnActive}` : ''}`}
                      title="Add task"
                      onClick={() => setSubjectPickerMode(prev => prev === 'task' ? null : 'task')}
                    >
                      <span className={styles.headerBtnSymbol}>+</span>
                      <span>Add Task</span>
                    </button>
                    {subjectPickerMode && (
                      <div className={styles.subjectPicker}>
                        <div className={styles.subjectPickerTitle}>
                          Add Task
                        </div>
                        {activeSubjects.map(subject => (
                          <button
                            key={subject.id}
                            className={styles.subjectPickerItem}
                            onClick={() => {
                              setSubjectPickerMode(null);
                              if (subjectPickerMode === 'timer') {
                                setInitialTimerTask('');
                                setTimerSubject(subject);
                              } else {
                                startAdding(subject.id);
                              }
                            }}
                          >
                            <span className={styles.subjectPickerDot} style={{ background: subject.color }} />
                            {subject.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className={styles.dateHeaderDivider} />
            </>
          );
        })()}

        {/* ── Daily Brief ── */}
        <div className={styles.dailyBrief}>
          <div
            className={styles.dailyBriefHeader}
            role="button"
            tabIndex={0}
            onClick={() => {
              const next = !briefCollapsed;
              setBriefCollapsed(next);
              localStorage.setItem('soma_brief_collapsed', String(next));
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const next = !briefCollapsed;
                setBriefCollapsed(next);
                localStorage.setItem('soma_brief_collapsed', String(next));
              }
            }}
          >
            <span className={styles.dailyBriefLabel}>Daily Brief</span>
            <div className={styles.dailyBriefControls}>
              {isViewingToday && (
                <button
                  className={styles.dailyBriefRefresh}
                  title="Refresh"
                  onClick={e => { e.stopPropagation(); generateBrief(); }}
                >↻</button>
              )}
              <span className={styles.dailyBriefChevron}>{briefCollapsed ? '▸' : '▾'}</span>
            </div>
          </div>
          <div className={`${styles.dailyBriefBody}${briefCollapsed ? ` ${styles.dailyBriefBodyCollapsed}` : ''}`}>
            <div className={styles.dailyBriefBodyInner}>
              {briefLoading
                ? <span className={styles.dailyBriefLoading}>Generating your brief…</span>
                : briefText
                  ? <div className={styles.dailyBriefText}>
                      {briefText.split(/(?=•)/).map((line, i) => {
                        const trimmed = line.trim();
                        return trimmed ? <div key={i} className={styles.dailyBriefLine}>{trimmed}</div> : null;
                      })}
                    </div>
                  : null
              }
            </div>
          </div>
        </div>

        {!rightReady ? <RightPanelSkeleton /> : (
        <>

        {activeSubjects.length === 0 && (
          <div className={styles.emptySubjects}>Add a subject to get started.</div>
        )}

        {orderedActiveSubjects.map(subject => {
          const groupTodos = dayTodos.filter(t => t.subjectId === subject.id);
          const pending = groupTodos.filter(t => t.status !== 'done').length;
          const isDragging = dragSubjectId === subject.id;

          return (
            <div
              key={subject.id}
              className={`${styles.subjectGroup}${isDragging ? ` ${styles.subjectGroupDragging}` : ''}`}
              ref={el => { if (el) subjectGroupRefs.current.set(subject.id, el); else subjectGroupRefs.current.delete(subject.id); }}
            >
              <div
                className={styles.subjectGroupHeader}
                onPointerDown={e => handleSubjectPointerDown(e, subject.id)}
                onPointerUp={handleSubjectPointerUp}
                onPointerCancel={handleSubjectPointerUp}
              >
                <span className={styles.dotIndicator} style={{ background: subject.color }} />
                <span className={styles.subjectName}>{subject.name}</span>
                <span className={styles.subjectTime}>{fmtElapsed(elapsedBySubject[subject.id] ?? 0)}</span>
                {groupTodos.length > 0 && (
                  <span className={styles.todoBadge}>{pending}/{groupTodos.length}</span>
                )}
                <button
                  className={styles.todoGroupAdd}
                  onClick={e => { e.stopPropagation(); startAdding(subject.id); }}
                >Add task</button>
                <button
                  className={styles.editIcon}
                  onClick={e => {
                    e.stopPropagation();
                    setEditSubject({ id: subject.id, name: subject.name, color: subject.color });
                  }}
                >✎</button>
              </div>

              <div className={styles.todoGroupBody}>
                {getOrderedGroupTodos(subject.id).map(todo => renderTodoItem(todo, subject.id))}
              </div>
            </div>
          );
        })}

        {(() => {
          const unassigned = dayTodos.filter(t => !t.subjectId);
          if (unassigned.length === 0) return null;
          const pending = unassigned.filter(t => t.status !== 'done').length;
          return (
            <div className={styles.subjectGroup}>
              <div className={styles.subjectGroupHeader}>
                <span className={styles.subjectName}>Unassigned</span>
                {unassigned.length > 0 && (
                  <span className={styles.todoBadge}>{pending}/{unassigned.length}</span>
                )}
                <button
                  className={styles.todoGroupAdd}
                  onClick={e => { e.stopPropagation(); startAdding('unassigned'); }}
                >Add task</button>
              </div>
              <div className={styles.todoGroupBody}>
                {getOrderedGroupTodos('unassigned').map(todo => renderTodoItem(todo, 'unassigned'))}
              </div>
            </div>
          );
        })()}

        </>
        )}
      </div>

      {/* ── Timer Overlay ── */}
      {timerSubject && (
        <TimerOverlay
          subject={timerSubject}
          onClose={() => { setTimerSubject(null); setInitialTimerTask(''); }}
          onSessionSaved={handleSessionSaved}
          onRunningChange={handleRunningChange}
          initialTask={initialTimerTask}
        />
      )}

      {/* ── Task Creation Modal ── */}
      {taskModal && (
        <div className={styles.modalOverlay} onClick={() => setTaskModal(null)}>
          <div className={styles.taskModalBox} onClick={e => e.stopPropagation()}>
            <div className={styles.taskModalHeader}>
              <span className={styles.taskModalTitle}>{taskModal.editingTodo ? 'Edit Task' : 'New Task'}</span>
              {(() => {
                const subject = taskModal.subjectId ? subjects.find(s => s.id === taskModal.subjectId) : null;
                return subject ? (
                  <span
                    className={styles.taskModalSubjectChip}
                    style={{
                      background: `${subject.color}1a`,
                      borderColor: `${subject.color}4d`,
                    }}
                  >
                    <span className={styles.taskModalSubjectDot} style={{ background: subject.color }} />
                    {subject.name}
                  </span>
                ) : null;
              })()}
            </div>

            <input
              className={styles.taskModalInput}
              placeholder="What do you need to do?"
              value={taskForm.text}
              autoFocus
              onChange={e => setTaskForm(f => ({ ...f, text: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter' && taskForm.text.trim()) saveTaskFromModal(); }}
            />

            <button
              className={styles.taskDetailsToggle}
              onClick={() => setTaskDetailsOpen(open => !open)}
            >
              {taskDetailsOpen ? 'Hide details' : '+ Details'}
            </button>

            {taskDetailsOpen && (
              <>
                <div className={styles.taskModalField}>
                  <label className={styles.taskModalLabel}>Estimated time</label>
                  <div className={styles.taskModalTimeRow}>
                    <input
                      type="number"
                      className={styles.taskModalTimeInput}
                      value={taskForm.hours}
                      min={0}
                      max={23}
                      onChange={e => setTaskForm(f => ({ ...f, hours: Math.min(23, Math.max(0, Number(e.target.value) || 0)) }))}
                    />
                    <span className={styles.taskModalTimeUnit}>h</span>
                    <input
                      type="number"
                      className={styles.taskModalTimeInput}
                      value={taskForm.minutes}
                      min={0}
                      max={59}
                      onChange={e => setTaskForm(f => ({ ...f, minutes: Math.min(59, Math.max(0, Number(e.target.value) || 0)) }))}
                    />
                    <span className={styles.taskModalTimeUnit}>m</span>
                  </div>
                </div>

                <div className={styles.taskModalField}>
                  <label className={styles.taskModalLabel}>Due date</label>
                  <input
                    type="date"
                    className={styles.taskModalInput}
                    value={taskForm.dueDate}
                    onChange={e => setTaskForm(f => ({ ...f, dueDate: e.target.value }))}
                  />
                </div>

                <div className={styles.taskModalField}>
                  <label className={styles.taskModalLabel}>Notes</label>
                  <textarea
                    className={styles.taskModalTextarea}
                    rows={3}
                    placeholder="Any notes..."
                    value={taskForm.notes}
                    onChange={e => setTaskForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>

                <div className={styles.taskModalToggleRow}>
                  <span className={styles.taskModalToggleLabel}>Schedule it</span>
                  <label className={styles.toggleSwitch}>
                    <input
                      type="checkbox"
                      checked={taskForm.scheduleIt}
                      onChange={e => setTaskForm(f => ({ ...f, scheduleIt: e.target.checked }))}
                    />
                    <span className={styles.toggleTrack} />
                  </label>
                </div>

                {taskForm.scheduleIt && (
                  <div className={styles.scheduleExpanded}>
                    <div className={styles.taskModalField}>
                      <label className={styles.taskModalLabel}>Start time</label>
                      <div className={styles.taskModalTimeRow}>
                        <input
                          type="number"
                          className={styles.taskModalTimeInput}
                          value={taskForm.startHour}
                          min={1}
                          max={12}
                          onChange={e => setTaskForm(f => ({ ...f, startHour: Math.min(12, Math.max(1, Number(e.target.value) || 1)) }))}
                        />
                        <span className={styles.pinTimeSep}>:</span>
                        <input
                          type="number"
                          className={styles.taskModalTimeInput}
                          value={String(taskForm.startMinute).padStart(2, '0')}
                          min={0}
                          max={59}
                          onChange={e => setTaskForm(f => ({ ...f, startMinute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) }))}
                        />
                        <div className={styles.pinAmpmToggle}>
                          <button
                            className={`${styles.pinAmpmBtn}${taskForm.startAmPm === 'AM' ? ` ${styles.pinAmpmBtnActive}` : ''}`}
                            onClick={() => setTaskForm(f => ({ ...f, startAmPm: 'AM' }))}
                          >AM</button>
                          <button
                            className={`${styles.pinAmpmBtn}${taskForm.startAmPm === 'PM' ? ` ${styles.pinAmpmBtnActive}` : ''}`}
                            onClick={() => setTaskForm(f => ({ ...f, startAmPm: 'PM' }))}
                          >PM</button>
                        </div>
                      </div>
                    </div>
                    <p className={styles.scheduleHint}>This will pin a time block on the schedule automatically when saved.</p>
                  </div>
                )}
              </>
            )}

            <div className={styles.taskModalActions}>
              <button
                className={styles.taskModalSubmit}
                onClick={() => saveTaskFromModal(false)}
                disabled={!taskForm.text.trim()}
              >{taskModal.editingTodo ? 'Save Changes' : 'Add Task'}</button>
              {!taskModal.editingTodo && taskModal.subjectId && (
                <button
                  className={styles.taskModalStart}
                  onClick={() => saveTaskFromModal(true)}
                  disabled={!taskForm.text.trim()}
                >Add & Start Timer</button>
              )}
              <button className={styles.taskModalCancel} onClick={() => setTaskModal(null)}>Cancel</button>
            </div>
            {taskModal.editingTodo && (
              <button
                className={styles.taskModalDelete}
                onClick={() => {
                  const updated = todos.filter(t => t.id !== taskModal.editingTodo!.id);
                  storage.setTodos(updated);
                  setTodos(updated);
                  setTaskModal(null);
                }}
              >Delete task</button>
            )}
          </div>
        </div>
      )}

      {/* ── Add Subject Modal ── */}
      {showAddSubject && (
        <div className={styles.modalOverlay} onClick={() => setShowAddSubject(false)}>
          <div className={styles.modalBox} onClick={e => e.stopPropagation()}>
            <span className={styles.modalTitle}>Add Subject</span>
            <input
              className={styles.modalInput}
              placeholder="Subject name"
              value={addSubjectForm.name}
              autoFocus
              onChange={e => setAddSubjectForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') saveNewSubject(); if (e.key === 'Escape') setShowAddSubject(false); }}
            />
            <div className={styles.colorPicker}>
              {COLORS.map(c => (
                <button
                  key={c}
                  className={`${styles.colorCircle}${addSubjectForm.color === c ? ` ${styles.colorCircleSelected}` : ''}`}
                  style={{ background: c }}
                  onClick={() => setAddSubjectForm(f => ({ ...f, color: c }))}
                />
              ))}
            </div>
            <div className={styles.modalActions}>
              <button
                className={`${styles.btn} ${styles.btnAccent}`}
                onClick={saveNewSubject}
                disabled={!addSubjectForm.name.trim()}
              >Save</button>
              <button className={styles.btn} onClick={() => setShowAddSubject(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>

      {/* ── Subject Edit Modal ── */}
      {editSubject && (
        <div className={styles.modalOverlay} onClick={() => setEditSubject(null)}>
          <div className={styles.taskModalBox} onClick={e => e.stopPropagation()}>
            <div className={styles.taskModalHeader}>
              <span className={styles.taskModalTitle}>Edit Subject</span>
              <span className={styles.taskModalSubjectChip}>
                <span className={styles.taskModalSubjectDot} style={{ background: editSubject.color }} />
                {editSubject.name || 'Untitled'}
              </span>
            </div>
            <input
              className={styles.taskModalInput}
              placeholder="Subject name"
              value={editSubject.name}
              autoFocus
              onChange={e => setEditSubject(s => s && { ...s, name: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter' && editSubject.name.trim()) saveEditSubject(); }}
            />
            <div className={styles.taskModalField}>
              <label className={styles.taskModalLabel}>Color</label>
              <div className={styles.colorPicker}>
                {COLORS.map(c => (
                  <button
                    key={c}
                    className={`${styles.colorCircle}${editSubject.color === c ? ` ${styles.colorCircleSelected}` : ''}`}
                    style={{ background: c }}
                    onClick={() => setEditSubject(s => s && { ...s, color: c })}
                  />
                ))}
              </div>
            </div>
            <button
              className={styles.taskModalSubmit}
              onClick={saveEditSubject}
              disabled={!editSubject.name.trim()}
            >Save</button>
            <button className={styles.taskModalCancel} onClick={() => setEditSubject(null)}>Cancel</button>
            <div className={styles.subjectModalDestructive}>
              <button className={styles.editDeleteBtn} onClick={() => deleteSubject(editSubject.id)}>Delete subject</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Block Modal ── */}
      {blockModal && (
        <div className={styles.modalOverlay} onClick={() => { setBlockModal(null); setBlockEditMode(false); }}>
          <div className={styles.taskModalBox} onClick={e => e.stopPropagation()}>
            <div className={styles.taskModalHeader}>
              <span className={styles.taskModalTitle}>Time Block</span>
              {blockModal.subject && (
                <span className={styles.taskModalSubjectChip}>
                  <span className={styles.taskModalSubjectDot} style={{ background: blockModal.subject.color }} />
                  {blockModal.subject.name}
                </span>
              )}
            </div>

            {blockEditMode ? (
              <>
                <div className={styles.taskModalField}>
                  <label className={styles.taskModalLabel}>Task</label>
                  <input
                    className={styles.taskModalInput}
                    value={blockEditForm.task}
                    placeholder="Task name"
                    autoFocus
                    onChange={e => setBlockEditForm(f => ({ ...f, task: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') saveBlockEdit(); }}
                  />
                </div>
                <div className={styles.taskModalField}>
                  <label className={styles.taskModalLabel}>Start time</label>
                  <div className={styles.taskModalTimeRow}>
                    <input type="number" className={styles.pinTimeInput} value={blockEditForm.startHour} min={1} max={12}
                      onChange={e => setBlockEditForm(f => ({ ...f, startHour: Math.min(12, Math.max(1, Number(e.target.value) || 1)) }))} />
                    <span className={styles.pinTimeSep}>:</span>
                    <input type="number" className={styles.pinTimeInput} value={String(blockEditForm.startMinute).padStart(2, '0')} min={0} max={59}
                      onChange={e => setBlockEditForm(f => ({ ...f, startMinute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) }))} />
                    <div className={styles.pinAmpmToggle}>
                      <button className={`${styles.pinAmpmBtn}${blockEditForm.startAmPm === 'AM' ? ` ${styles.pinAmpmBtnActive}` : ''}`}
                        onClick={() => setBlockEditForm(f => ({ ...f, startAmPm: 'AM' }))}>AM</button>
                      <button className={`${styles.pinAmpmBtn}${blockEditForm.startAmPm === 'PM' ? ` ${styles.pinAmpmBtnActive}` : ''}`}
                        onClick={() => setBlockEditForm(f => ({ ...f, startAmPm: 'PM' }))}>PM</button>
                    </div>
                  </div>
                </div>
                <div className={styles.taskModalField}>
                  <label className={styles.taskModalLabel}>End time</label>
                  <div className={styles.taskModalTimeRow}>
                    <input type="number" className={styles.pinTimeInput} value={blockEditForm.endHour} min={1} max={12}
                      onChange={e => setBlockEditForm(f => ({ ...f, endHour: Math.min(12, Math.max(1, Number(e.target.value) || 1)) }))} />
                    <span className={styles.pinTimeSep}>:</span>
                    <input type="number" className={styles.pinTimeInput} value={String(blockEditForm.endMinute).padStart(2, '0')} min={0} max={59}
                      onChange={e => setBlockEditForm(f => ({ ...f, endMinute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) }))} />
                    <div className={styles.pinAmpmToggle}>
                      <button className={`${styles.pinAmpmBtn}${blockEditForm.endAmPm === 'AM' ? ` ${styles.pinAmpmBtnActive}` : ''}`}
                        onClick={() => setBlockEditForm(f => ({ ...f, endAmPm: 'AM' }))}>AM</button>
                      <button className={`${styles.pinAmpmBtn}${blockEditForm.endAmPm === 'PM' ? ` ${styles.pinAmpmBtnActive}` : ''}`}
                        onClick={() => setBlockEditForm(f => ({ ...f, endAmPm: 'PM' }))}>PM</button>
                    </div>
                  </div>
                </div>
                <button className={styles.taskModalSubmit} onClick={saveBlockEdit}>Save Changes</button>
                <button className={styles.taskModalCancel} onClick={() => setBlockEditMode(false)}>Cancel</button>
              </>
            ) : (
              <>
                {blockModal.block.task && (
                  <div className={styles.blockModalTask}>{blockModal.block.task}</div>
                )}
                <div className={styles.blockModalInfo}>
                  <div className={styles.blockModalInfoRow}>
                    <span className={styles.blockModalInfoLabel}>Time</span>
                    <span className={styles.blockModalInfoValue}>
                      {fmtTime(blockModal.block.startTime)} – {fmtTime(blockModal.block.endTime)}
                    </span>
                  </div>
                  <div className={styles.blockModalInfoRow}>
                    <span className={styles.blockModalInfoLabel}>Duration</span>
                    <span className={styles.blockModalInfoValue}>
                      {fmtDuration(blockModal.block.startTime, blockModal.block.endTime)}
                    </span>
                  </div>
                </div>
                <div className={styles.blockModalActions}>
                  <button className={styles.blockModalEditBtn} onClick={() => openBlockEdit(blockModal.block)}>Edit</button>
                  <button className={styles.blockModalDeleteBtn} onClick={() => deleteBlock(blockModal.block.id)}>Delete</button>
                </div>
                <button className={styles.taskModalCancel} onClick={() => setBlockModal(null)}>Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>

    {deadlineDetail && (
      <AssignmentDetail
        courseId={deadlineDetail.courseId}
        assignmentId={deadlineDetail.assignmentId}
        onClose={() => setDeadlineDetail(null)}
      />
    )}

    </>
  );
}
