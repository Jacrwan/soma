import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { storage, inferSubjectId } from '../../lib/storage';
import { sendMessage } from '../../lib/ai';
import { Subject, TimeBlock, SubjectColor, Todo, GoogleCalendarEvent, CanvasAssignment, CanvasCourse } from '../../types';
import SubjectDot from '../shared/SubjectDot';
import TimerOverlay from '../Timer/TimerOverlay';
import AssignmentDetail from '../Canvas/AssignmentDetail';
import styles from './DayView.module.css';

const SLOT_HEIGHT = 60;
const START_HOUR = 5;
const TOTAL_HOURS = 24;
const COLORS: SubjectColor[] = [
  '#ef5350', '#42a5f5', '#66bb6a', '#ab47bc',
  '#ffa726', '#26c6da', '#ec407a', '#8d6e63',
];
const DAY_ABBRS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function toLocalISO(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
}

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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

function fmtSecs(s: number) {
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
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


interface PopoverState {
  block: TimeBlock;
  subject: Subject | undefined;
  x: number;
  y: number;
}

interface DotGroup {
  subjectId: string;
  topPx: number;
  label: string;
  count: number;
  blocks: TimeBlock[];
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
  const [popover, setPopover] = useState<PopoverState | null>(null);
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
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    const todayKey = getTodayKey();
    const todayTodos = storage.getTodos().filter(t => t.date === todayKey);
    const withTodos = new Set(todayTodos.map(t => t.subjectId ?? 'unassigned'));
    return new Set(storage.getSubjects().filter(s => !withTodos.has(s.id)).map(s => s.id));
  });
  const [taskModal, setTaskModal] = useState<{ subjectId: string | undefined; editingTodo?: Todo } | null>(null);
  const [subjectPickerMode, setSubjectPickerMode] = useState<'timer' | 'task' | null>(null);
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
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [addSubjectForm, setAddSubjectForm] = useState<AddSubjectForm>({ name: '', color: COLORS[0] });
  const [editSubject, setEditSubject] = useState<SubjectEditState | null>(null);
  const [gcalEvents, setGcalEvents] = useState<GoogleCalendarEvent[]>([]);
  const [dueAssignments, setDueAssignments] = useState<{ assignment: CanvasAssignment; course: CanvasCourse | undefined; color: string }[]>([]);
  const [deadlineDetail, setDeadlineDetail] = useState<{ courseId: number; assignmentId: number } | null>(null);
  const [quickAddHour, setQuickAddHour] = useState<number | null>(null);
  const [quickAddSubjectId, setQuickAddSubjectId] = useState<string>('');
  const [quickAddDuration, setQuickAddDuration] = useState<number>(60);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingTodoText, setEditingTodoText] = useState('');
  const [timerRunning, setTimerRunning] = useState(false);
  const [briefCollapsed, setBriefCollapsed] = useState<boolean>(() => {
    const s = localStorage.getItem('soma_brief_collapsed');
    return s === null ? true : s === 'true';
  });
  const [briefText, setBriefText] = useState<string>(() =>
    localStorage.getItem('soma_brief_text') ?? ''
  );
  const [briefLoading, setBriefLoading] = useState(false);
  const [panelRatio, setPanelRatio] = useState<number>(() => {
    const s = localStorage.getItem('soma_panel_ratio');
    return s ? Math.max(0.35, Math.min(0.75, parseFloat(s))) : 0.65;
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const statusPopoverRef = useRef<HTMLDivElement>(null);
  const pinPopoverRef = useRef<HTMLDivElement>(null);
  const subjectPickerRef = useRef<HTMLDivElement>(null);
  const touchStartXRef = useRef(0);
  const wheelCooldownRef = useRef(false);
  const prevSelectedDateRef = useRef(selectedDate);

  // Sync week view when selectedDate changes from an external source (e.g. CalendarTab)
  useEffect(() => {
    if (!isSameDay(selectedDate, prevSelectedDateRef.current)) {
      prevSelectedDateRef.current = selectedDate;
      setViewWeekStart(getMondayOfWeek(selectedDate));
    }
  }, [selectedDate]);

  useEffect(() => {
    setSubjects(storage.getSubjects());
    const tick = () => {
      const now = new Date();
      setCurrentMinutes(now.getHours() * 60 + now.getMinutes());
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setBlocks(storage.getTimeBlocks().filter(b => isOnDate(b.startTime, selectedDate)));
  }, [selectedDate]);

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
    if (!popover) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [popover]);

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

  const slots = Array.from({ length: TOTAL_HOURS }, (_, i) => {
    const hourOfDay = (START_HOUR + i) % 24;
    const minutes = hourOfDay * 60;
    const ampm = hourOfDay >= 12 ? 'PM' : 'AM';
    const h12 = hourOfDay % 12 || 12;
    return { minutes, label: `${h12}:00 ${ampm}` };
  });

  const isViewingToday = isSameDay(selectedDate, new Date());
  const showCurrentTime = isViewingToday;

  function deleteBlock(id: string) {
    storage.setTimeBlocks(storage.getTimeBlocks().filter(b => b.id !== id));
    setBlocks(prev => prev.filter(b => b.id !== id));
    setPopover(null);
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

  function archiveSubject(id: string) {
    const updated = subjects.map(s => s.id === id ? { ...s, archived: true } : s);
    storage.setSubjects(updated);
    setSubjects(updated);
    setEditSubject(null);
  }

  function restoreSubject(id: string) {
    const updated = subjects.map(s => s.id === id ? { ...s, archived: false } : s);
    storage.setSubjects(updated);
    setSubjects(updated);
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


  function toggleGroup(groupId: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
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
    setTaskModal({ subjectId });
  }

  function saveTaskFromModal() {
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
      // expand the group so the new todo is immediately visible
      const groupId = taskModal.subjectId ?? 'unassigned';
      setCollapsedGroups(prev => { const next = new Set(prev); next.delete(groupId); return next; });
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
  }

  function openEditTodo(todo: Todo) {
    const hours = Math.floor((todo.estimatedMinutes ?? 0) / 60);
    const minutes = (todo.estimatedMinutes ?? 0) % 60;
    setTaskForm({ text: todo.text, hours, minutes, dueDate: todo.dueDate ?? '', notes: todo.notes ?? '', scheduleIt: false, startHour: 9, startMinute: 0, startAmPm: 'AM' });
    setTaskModal({ subjectId: todo.subjectId, editingTodo: todo });
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

  function startStudyFromAssignment(assignment: CanvasAssignment) {
    const subs = storage.getSubjects();
    const matched = subs.find(s => {
      const sn = s.name.toLowerCase();
      const cn = assignment.courseName.toLowerCase();
      return cn.includes(sn) || sn.includes(cn);
    }) ?? subs[0] ?? null;
    if (!matched) return;
    setInitialTimerTask(assignment.name);
    setTimerSubject(matched);
  }

  function handleSlotClick(hour: number) {
    setQuickAddHour(hour);
    setQuickAddDuration(60);
    const subs = storage.getSubjects().filter(s => !s.archived);
    setQuickAddSubjectId(subs[0]?.id ?? '');
  }

  function commitQuickAdd() {
    if (quickAddHour === null || !quickAddSubjectId) return;
    const start = new Date(
      selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(),
      quickAddHour, 0,
    );
    const end = new Date(start.getTime() + quickAddDuration * 60_000);
    const block: TimeBlock = {
      id: crypto.randomUUID(),
      subjectId: quickAddSubjectId,
      task: '',
      startTime: toLocalISO(start),
      endTime: toLocalISO(end),
      source: 'manual',
    };
    storage.setTimeBlocks([...storage.getTimeBlocks(), block]);
    setBlocks(prev => [...prev, block]);
    setQuickAddHour(null);
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

  const activeSubjects = subjects.filter(s => !s.archived);
  const archivedSubjects = subjects.filter(s => s.archived);
  const selectedDateKey = toISODateString(selectedDate);
  const dayTodos = todos.filter(t => t.date === selectedDateKey);

  function selectDate(date: Date) {
    onSelectDate(date);
    prevSelectedDateRef.current = date;
    setViewWeekStart(getMondayOfWeek(date));
    setPopover(null);
  }

  const isCurrentWeek = isSameDay(viewWeekStart, getMondayOfWeek(new Date()));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(viewWeekStart, i));

  const assignmentCountByDay = new Map<string, number>();
  storage.getCachedAssignments().forEach(a => {
    if (a.dueAt) {
      const k = dayKey(new Date(a.dueAt));
      assignmentCountByDay.set(k, (assignmentCountByDay.get(k) ?? 0) + 1);
    }
  });

  const gridHeight = TOTAL_HOURS * SLOT_HEIGHT;

  function renderTodoItem(todo: Todo) {
    const actualMins = getActualMinutesForTodo(todo);
    const hasEstimate = (todo.estimatedMinutes ?? 0) > 0;

    return (
      <div key={todo.id} className={styles.todoItemWrap}>
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
            <span className={styles.todoText} onClick={() => openEditTodo(todo)}>{todo.text}</span>
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
            <button className={styles.todayBtn} onClick={() => selectDate(new Date())}>Today</button>
          )}
        </div>
        <div className={styles.daysRow}>
          {weekDays.map((day, i) => {
            const isToday = isSameDay(day, new Date());
            const isSelected = isSameDay(day, selectedDate);
            const count = assignmentCountByDay.get(dayKey(day)) ?? 0;
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
                <span className={styles.dayNum}>{day.getDate()}</span>
                {count > 0 && <span className={styles.dayBadge}>{count}</span>}
              </div>
            );
          })}
        </div>
      </div>

    <div className={styles.container} ref={containerRef}>
      {/* ── Left panel ── */}
      <div className={styles.left} style={{ flex: `0 0 ${(panelRatio * 100).toFixed(1)}%` }}>
        {blocks.length === 0 && (
          <div className={styles.emptyBlocks}>No blocks yet. Click a slot to add one.</div>
        )}
        <div className={styles.gridWrapper} style={{ height: gridHeight }}>

          {slots.map(slot => (
            <div
              key={slot.minutes}
              className={styles.slot}
              style={{ top: minToTop(slot.minutes), height: SLOT_HEIGHT }}
            >
              <span className={styles.timeLabel}>{slot.label}</span>
              <div
                className={styles.slotArea}
                onClick={() => handleSlotClick(slot.minutes / 60)}
              />
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
            const dotGroups = groupShortBlocks(shortBlocks);
            return (
              <>
                {regularBlocks.map(block => {
                  const subject = subjects.find(s => s.id === block.subjectId);
                  const start = new Date(block.startTime);
                  const startMin = start.getHours() * 60 + start.getMinutes();
                  const durMin = (new Date(block.endTime).getTime() - start.getTime()) / 60_000;
                  const blockTopPx = minToTop(startMin);
                  const fullHeight = Math.max(durToHeight(durMin), 2);
                  const nowLinePx = showCurrentTime ? minToTop(currentMinutes) : Infinity;
                  const height = blockTopPx < nowLinePx
                    ? Math.max(Math.min(fullHeight, nowLinePx - blockTopPx), 2)
                    : fullHeight;
                  return (
                    <div
                      key={block.id}
                      className={styles.block}
                      style={{
                        top: blockTopPx,
                        height,
                        borderLeftColor: subject?.color ?? '#ccc',
                        backgroundColor: subject ? `${subject.color}1f` : '#f5f5f5',
                      }}
                      onClick={e => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setPopover({ block, subject, x: rect.left, y: rect.top });
                      }}
                    >
                      {height >= 30 && (
                        <>
                          <span className={styles.blockSubject}>{subject?.name}</span>
                          {block.task && block.task !== subject?.name && (
                            <span className={styles.blockTask}>{block.task}</span>
                          )}
                        </>
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
                      style={{ top: group.topPx }}
                      onClick={e => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setPopover({ block: group.blocks[group.blocks.length - 1], subject, x: rect.left, y: rect.top });
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
            const durMin = Math.max((end.getTime() - start.getTime()) / 60_000, 30);
            return (
              <div
                key={event.id}
                className={styles.gcalBlock}
                style={{
                  top: minToTop(startMin),
                  height: durToHeight(durMin),
                }}
              >
                <span className={styles.gcalBadge}>G</span>
                <span className={styles.gcalTitle}>{event.summary ?? '(No title)'}</span>
              </div>
            );
          })}

          {dueAssignments.map(({ assignment, color }) => {
            const due = new Date(assignment.dueAt);
            const dueMin = due.getHours() * 60 + due.getMinutes();
            const topPx = minToTop(dueMin);
            const isPast = due.getTime() < Date.now() && isSameDay(selectedDate, new Date());
            return (
              <div
                key={`due-${assignment.id}`}
                className={styles.deadlineMarker}
                style={{ top: topPx, borderColor: color, opacity: isPast ? 0.45 : 1 }}
                onClick={() => setDeadlineDetail({ courseId: assignment.courseId, assignmentId: assignment.id })}
              >
                <span className={styles.deadlineDot} style={{ background: color }} />
                <span className={styles.deadlineName}>{assignment.name}</span>
                <span className={styles.deadlineTime}>
                  {due.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </span>
                <button
                  className={styles.deadlineStudyBtn}
                  onClick={e => { e.stopPropagation(); startStudyFromAssignment(assignment); }}
                  title="Start studying"
                >
                  ▶ Study
                </button>
              </div>
            );
          })}

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
                      className={`${styles.headerIconBtn}${subjectPickerMode === 'timer' ? ` ${styles.headerIconBtnActive}` : ''}`}
                      title="Start timer"
                      onClick={() => setSubjectPickerMode(prev => prev === 'timer' ? null : 'timer')}
                    >
                      <svg width="9" height="11" viewBox="0 0 9 11" fill="none">
                        <polygon points="0,0 9,5.5 0,11" fill="currentColor"/>
                      </svg>
                    </button>
                    <button
                      className={`${styles.headerIconBtn}${subjectPickerMode === 'task' ? ` ${styles.headerIconBtnActive}` : ''}`}
                      title="Add task"
                      onClick={() => setSubjectPickerMode(prev => prev === 'task' ? null : 'task')}
                    >+</button>
                    {subjectPickerMode && (
                      <div className={styles.subjectPicker}>
                        <div className={styles.subjectPickerTitle}>
                          {subjectPickerMode === 'timer' ? 'Start Timer' : 'Add Task'}
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

        {activeSubjects.length === 0 && (
          <div className={styles.emptySubjects}>Add a subject to get started.</div>
        )}

        {activeSubjects.map(subject => {
          const groupTodos = dayTodos.filter(t => t.subjectId === subject.id);
          const isCollapsed = collapsedGroups.has(subject.id);
          const showBody = !isCollapsed;
          const pending = groupTodos.filter(t => t.status !== 'done').length;
          const isEditing = editSubject?.id === subject.id;

          return (
            <div key={subject.id} className={styles.subjectGroup}>
              <div
                className={styles.subjectGroupHeader}
                onClick={() => { if (!isEditing) toggleGroup(subject.id); }}
              >
                <span className={styles.dotIndicator} style={{ background: subject.color }} />
                <span className={styles.subjectName}>{subject.name}</span>
                <span className={styles.subjectTime}>{fmtSecs(subject.totalTimeToday)}</span>
                {groupTodos.length > 0 && (
                  <span className={styles.todoBadge}>{pending}/{groupTodos.length}</span>
                )}
                <button
                  className={styles.todoGroupAdd}
                  onClick={e => { e.stopPropagation(); startAdding(subject.id); }}
                  title="Add todo"
                >+</button>
                <button
                  className={styles.editIcon}
                  onClick={e => {
                    e.stopPropagation();
                    if (isEditing) setEditSubject(null);
                    else setEditSubject({ id: subject.id, name: subject.name, color: subject.color });
                  }}
                >✎</button>
                {!isEditing && (
                  <span className={styles.subjectArrow}>{isCollapsed ? '▾' : '▴'}</span>
                )}
              </div>

              {isEditing && (
                <div className={styles.editSubjectForm} onClick={e => e.stopPropagation()}>
                  <input
                    className={styles.editSubjectInput}
                    value={editSubject!.name}
                    autoFocus
                    onChange={e => setEditSubject(s => s && { ...s, name: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') saveEditSubject(); if (e.key === 'Escape') setEditSubject(null); }}
                  />
                  <div className={styles.colorPicker}>
                    {COLORS.map(c => (
                      <button
                        key={c}
                        className={`${styles.colorCircle}${editSubject!.color === c ? ` ${styles.colorCircleSelected}` : ''}`}
                        style={{ background: c }}
                        onClick={() => setEditSubject(s => s && { ...s, color: c })}
                      />
                    ))}
                  </div>
                  <div className={styles.editFormActions}>
                    <button className={styles.editSaveBtn} onClick={saveEditSubject}>Save</button>
                    <button className={styles.editCancelBtn} onClick={() => setEditSubject(null)}>Cancel</button>
                  </div>
                  <div className={styles.editFormDestructive}>
                    <button className={styles.editArchiveBtn} onClick={() => archiveSubject(subject.id)}>Archive</button>
                    <button className={styles.editDeleteBtn} onClick={() => deleteSubject(subject.id)}>Delete</button>
                  </div>
                </div>
              )}

              {!isEditing && showBody && (
                <div className={styles.todoGroupBody}>
                  {groupTodos.map(todo => renderTodoItem(todo))}
                </div>
              )}
            </div>
          );
        })}

        {archivedSubjects.length > 0 && (
          <div className={styles.archivedSection}>
            <button
              className={styles.archivedToggle}
              onClick={() => setArchivedOpen(o => !o)}
            >
              Archived ({archivedSubjects.length}) {archivedOpen ? '▲' : '▾'}
            </button>
            {archivedOpen && archivedSubjects.map(subject => (
              <div key={subject.id} className={styles.archivedRow}>
                <SubjectDot color={subject.color} size={12} />
                <span className={styles.subjectName}>{subject.name}</span>
                <button
                  className={styles.restoreBtn}
                  onClick={() => restoreSubject(subject.id)}
                >Restore</button>
              </div>
            ))}
          </div>
        )}

        {(() => {
          const unassigned = dayTodos.filter(t => !t.subjectId);
          if (unassigned.length === 0) return null;
          const isCollapsed = collapsedGroups.has('unassigned');
          const showBody = !isCollapsed;
          const pending = unassigned.filter(t => t.status !== 'done').length;
          return (
            <div className={styles.subjectGroup}>
              <div
                className={styles.subjectGroupHeader}
                onClick={() => toggleGroup('unassigned')}
              >
                <span className={styles.subjectName}>Unassigned</span>
                {unassigned.length > 0 && (
                  <span className={styles.todoBadge}>{pending}/{unassigned.length}</span>
                )}
                <button
                  className={styles.todoGroupAdd}
                  onClick={e => { e.stopPropagation(); startAdding('unassigned'); }}
                  title="Add todo"
                >+</button>
                <span className={styles.subjectArrow}>{isCollapsed ? '▾' : '▴'}</span>
              </div>
              {showBody && (
                <div className={styles.todoGroupBody}>
                  {unassigned.map(todo => renderTodoItem(todo))}
                </div>
              )}
            </div>
          );
        })()}
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
                  <span className={styles.taskModalSubjectChip}>
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

            <button
              className={styles.taskModalSubmit}
              onClick={saveTaskFromModal}
              disabled={!taskForm.text.trim()}
            >{taskModal.editingTodo ? 'Save Changes' : 'Add Task'}</button>
            <button className={styles.taskModalCancel} onClick={() => setTaskModal(null)}>Cancel</button>
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

    {/* ── Block popover (portal — escapes overflow:hidden parents) ── */}
    {popover && createPortal(
      <div
        ref={popoverRef}
        className={styles.popover}
        style={{ left: popover.x, top: popover.y }}
      >
        <div className={styles.popoverHeader}>
          <SubjectDot color={popover.subject?.color ?? '#ccc'} size={12} />
          <span>{popover.subject?.name ?? 'Unknown'}</span>
        </div>
        {popover.block.task && <div className={styles.popoverTask}>{popover.block.task}</div>}
        <div className={styles.popoverTime}>
          {fmtTime(popover.block.startTime)} – {fmtTime(popover.block.endTime)}
        </div>
        <button
          className={`${styles.btn} ${styles.btnDanger}`}
          onClick={() => deleteBlock(popover.block.id)}
        >
          Delete
        </button>
      </div>,
      document.body
    )}
    </div>

    {deadlineDetail && (
      <AssignmentDetail
        courseId={deadlineDetail.courseId}
        assignmentId={deadlineDetail.assignmentId}
        onClose={() => setDeadlineDetail(null)}
      />
    )}

    {quickAddHour !== null && (
      <div className={styles.quickAddBackdrop} onClick={() => setQuickAddHour(null)}>
        <div className={styles.quickAddModal} onClick={e => e.stopPropagation()}>
          <span className={styles.quickAddTitle}>
            Add block at {quickAddHour % 12 || 12}:00 {quickAddHour >= 12 ? 'PM' : 'AM'}
          </span>
          <select
            className={styles.quickAddSelect}
            value={quickAddSubjectId}
            onChange={e => setQuickAddSubjectId(e.target.value)}
          >
            {subjects.filter(s => !s.archived).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select
            className={styles.quickAddSelect}
            value={quickAddDuration}
            onChange={e => setQuickAddDuration(Number(e.target.value))}
          >
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={45}>45 min</option>
            <option value={60}>1 hour</option>
            <option value={90}>1.5 hours</option>
            <option value={120}>2 hours</option>
            <option value={180}>3 hours</option>
          </select>
          <div className={styles.quickAddBtns}>
            <button className={styles.quickAddCancel} onClick={() => setQuickAddHour(null)}>Cancel</button>
            <button className={styles.quickAddConfirm} onClick={commitQuickAdd}>Add</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
