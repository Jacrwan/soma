import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { storage, inferSubjectId } from '../../lib/storage';
import { sendMessage } from '../../lib/ai';
import { Subject, TimeBlock, SubjectColor, Todo, GoogleCalendarEvent } from '../../types';
import SubjectDot from '../shared/SubjectDot';
import TimerOverlay from '../Timer/TimerOverlay';
import styles from './DayView.module.css';

const SLOT_HEIGHT = 60;
const START_HOUR = 5;
const TOTAL_HOURS = 24;
const COLORS: SubjectColor[] = [
  '#ef5350', '#42a5f5', '#66bb6a', '#ab47bc',
  '#ffa726', '#26c6da', '#ec407a', '#8d6e63',
];
const DAY_ABBRS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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


interface PopoverState {
  block: TimeBlock;
  subject: Subject | undefined;
  x: number;
  y: number;
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
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [newTodoText, setNewTodoText] = useState('');
  const [todoPopoverId, setTodoPopoverId] = useState<string | null>(null);
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
  const todoPopoverRef = useRef<HTMLDivElement>(null);
  const statusPopoverRef = useRef<HTMLDivElement>(null);
  const pinPopoverRef = useRef<HTMLDivElement>(null);
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
    if (!todoPopoverId) return;
    const onDown = (e: MouseEvent) => {
      if (todoPopoverRef.current && !todoPopoverRef.current.contains(e.target as Node)) {
        setTodoPopoverId(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [todoPopoverId]);

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
    setAddingToGroup(groupId);
    setNewTodoText('');
    setCollapsedGroups(prev => { const next = new Set(prev); next.delete(groupId); return next; });
  }

  function addTodo(subjectId: string | undefined) {
    const text = newTodoText.trim();
    if (!text) { setAddingToGroup(null); return; }
    const newTodo: Todo = { id: crypto.randomUUID(), text, status: 'nothing', subjectId, date: selectedDateKey };
    const updated = [...todos, newTodo];
    storage.setTodos(updated);
    setTodos(updated);
    setNewTodoText('');
    setAddingToGroup(null);
  }

  function saveTodoEdit(id: string) {
    const text = editingTodoText.trim();
    if (!text) { setEditingTodoId(null); return; }
    const updated = todos.map(t => t.id === id ? { ...t, text } : t);
    storage.setTodos(updated);
    setTodos(updated);
    setEditingTodoId(null);
  }

  function openTimerFromTodo(subject: Subject, task: string) {
    setTodoPopoverId(null);
    setInitialTimerTask(task);
    setTimerSubject(subject);
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
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      source: 'manual',
    };
    storage.setTimeBlocks([...storage.getTimeBlocks(), block]);
    setBlocks(prev => [...prev, block]);
    setPinPopoverId(null);
  }

  function openPinPopover(todoId: string) {
    setStatusPopoverId(null);
    setTodoPopoverId(null);
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

  return (
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

          {blocks.map(block => {
            const subject = subjects.find(s => s.id === block.subjectId);
            const start = new Date(block.startTime);
            const end = new Date(block.endTime);
            const startMin = start.getHours() * 60 + start.getMinutes();
            const durMin = (end.getTime() - start.getTime()) / 60_000;
            if (durMin <= 0) return null;
            const blockTopPx = minToTop(startMin);
            const fullHeight = Math.max(durToHeight(durMin), 24);
            const nowLinePx = showCurrentTime ? minToTop(currentMinutes) : Infinity;
            // Cap height at the now line for any block whose natural height overshoots it.
            // This covers both mid-session blocks (end in future) and just-stopped short
            // sessions where the 24px minimum would extend past the now indicator.
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
                <span className={styles.blockSubject}>{subject?.name}</span>
                <span className={styles.blockTask}>{block.task}</span>
              </div>
            );
          })}

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

        </div>
      </div>

      <div className={styles.dividerHandle} onMouseDown={handleDividerMouseDown} />

      {/* ── Right panel ── */}
      <div className={styles.right}>
        {(() => {
          const weekday = selectedDate.toLocaleDateString('en-US', { weekday: 'long' });
          const monthDay = selectedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
          const pendingCount = dayTodos.filter(t => t.status !== 'done').length;
          const ch = Math.floor(currentMinutes / 60) % 12;
          const cm = currentMinutes % 60;
          const timeStr = `${ch || 12}:${String(cm).padStart(2, '0')} ${currentMinutes >= 12 * 60 ? 'PM' : 'AM'}`;
          const minAngle = (cm / 60) * 360;
          const hourAngle = ((ch + cm / 60) / 12) * 360;
          const toRad = (deg: number) => (deg * Math.PI) / 180;
          const mX = (20 + 13 * Math.sin(toRad(minAngle))).toFixed(2);
          const mY = (20 - 13 * Math.cos(toRad(minAngle))).toFixed(2);
          const hX = (20 + 8 * Math.sin(toRad(hourAngle))).toFixed(2);
          const hY = (20 - 8 * Math.cos(toRad(hourAngle))).toFixed(2);
          return (
            <>
              <div className={styles.dateHeader}>
                <div className={styles.dateHeaderText}>
                  <div className={styles.dateHeaderWeekday}>{weekday}</div>
                  <div className={styles.dateHeaderDate}>{monthDay}</div>
                  <div className={styles.dateHeaderCount}>{pendingCount} task{pendingCount !== 1 ? 's' : ''} today</div>
                </div>
                <div className={styles.dateHeaderRight}>
                  <div className={styles.clockWidget}>
                    <span className={styles.clockTime}>{timeStr}</span>
                    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                      <circle cx="20" cy="20" r="17" stroke="var(--accent)" strokeWidth="1.5"/>
                      <line x1="20" y1="20" x2={mX} y2={mY} stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
                      <line x1="20" y1="20" x2={hX} y2={hY} stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <button
                    className={styles.addSubjectBtn}
                    onClick={() => { setShowAddSubject(true); setEditSubject(null); }}
                    title="Add subject"
                  >+</button>
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
            onClick={() => {
              const next = !briefCollapsed;
              setBriefCollapsed(next);
              localStorage.setItem('soma_brief_collapsed', String(next));
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
          <div className={styles.dailyBriefBody} style={{ maxHeight: briefCollapsed ? 0 : 200 }}>
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

        {activeSubjects.length === 0 && (
          <div className={styles.emptySubjects}>Add a subject to get started.</div>
        )}

        {activeSubjects.map(subject => {
          const groupTodos = dayTodos.filter(t => t.subjectId === subject.id);
          const isCollapsed = collapsedGroups.has(subject.id);
          const isAdding = addingToGroup === subject.id;
          const showBody = !isCollapsed || isAdding;
          const pending = groupTodos.filter(t => t.status !== 'done').length;
          const isEditing = editSubject?.id === subject.id;

          return (
            <div key={subject.id} className={styles.subjectGroup}>
              <div
                className={styles.subjectGroupHeader}
                onClick={() => { if (!isEditing) toggleGroup(subject.id); }}
              >
                <button
                  className={styles.dotBtn}
                  style={{ background: subject.color }}
                  onClick={e => {
                    e.stopPropagation();
                    if (isEditing) return;
                    setInitialTimerTask('');
                    setTimerSubject(subject);
                  }}
                  title={`Start timer for ${subject.name}`}
                />
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
                  <div className={styles.btnRow}>
                    <button className={`${styles.btn} ${styles.btnAccent}`} onClick={saveEditSubject}>Save</button>
                    <button className={styles.btn} onClick={() => archiveSubject(subject.id)}>Archive</button>
                    <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => deleteSubject(subject.id)}>Delete</button>
                    <button className={styles.btn} onClick={() => setEditSubject(null)}>Cancel</button>
                  </div>
                </div>
              )}

              {!isEditing && showBody && (
                <div className={styles.todoGroupBody}>
                  {groupTodos.map(todo => (
                    <div key={todo.id} className={styles.todoItemWrap}>
                      <div className={`${styles.todoItem}${todo.status === 'done' ? ` ${styles.todoItemDone}` : ''}`}>
                        <button
                          className={todo.status === 'in_progress' ? styles.statusBtnInProgress : todo.status === 'done' ? styles.statusBtnDone : styles.statusBtn}
                          onClick={() => { setTodoPopoverId(null); setStatusPopoverId(prev => prev === todo.id ? null : todo.id); }}
                        >
                          {todo.status === 'in_progress' && (
                            <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="0,0 10,5 0,10" fill="currentColor" /></svg>
                          )}
                          {todo.status === 'done' && (
                            <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          )}
                        </button>
                        <div className={styles.todoContent}>
                          {editingTodoId === todo.id ? (
                            <div className={styles.todoEditMode}>
                              <input
                                className={styles.todoEditInput}
                                value={editingTodoText}
                                autoFocus
                                onChange={e => setEditingTodoText(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveTodoEdit(todo.id); if (e.key === 'Escape') setEditingTodoId(null); }}
                              />
                              <button className={styles.todoEditSave} onClick={() => saveTodoEdit(todo.id)}>✓</button>
                              <button className={styles.todoEditCancel} onClick={() => setEditingTodoId(null)}>×</button>
                            </div>
                          ) : (
                            <span
                              className={styles.todoText}
                              onClick={() => { setStatusPopoverId(null); setTodoPopoverId(prev => prev === todo.id ? null : todo.id); }}
                            >{todo.text}</span>
                          )}
                          {todo.dueDate && <span className={styles.todoDueDate}>{todo.dueDate}</span>}
                        </div>
                        <div className={styles.todoActions}>
                          <button
                            className={styles.editTodoBtn}
                            title="Edit"
                            onClick={e => { e.stopPropagation(); setEditingTodoId(todo.id); setEditingTodoText(todo.text); setTodoPopoverId(null); }}
                          >✎</button>
                          <button
                            className={styles.pinBtn}
                            title="Pin to schedule"
                            onClick={e => { e.stopPropagation(); openPinPopover(todo.id); }}
                          >⊕</button>
                        </div>
                      </div>
                      {statusPopoverId === todo.id && (
                        <div className={styles.statusPopover} ref={statusPopoverRef}>
                          <button className={`${styles.statusOption}${todo.status === 'nothing' ? ` ${styles.statusOptionActive}` : ''}`} onClick={() => setTodoStatus(todo.id, 'nothing')}>
                            <span className={styles.statusIcon}><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="#aaa" strokeWidth="1.5"/></svg></span> Nothing
                          </button>
                          <button className={`${styles.statusOption}${todo.status === 'in_progress' ? ` ${styles.statusOptionActive}` : ''}`} onClick={() => setTodoStatus(todo.id, 'in_progress')}>
                            <span className={`${styles.statusIcon} ${styles.statusIconInProgress}`}><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="0,0 10,5 0,10" fill="currentColor"/></svg></span> In Progress
                          </button>
                          <button className={`${styles.statusOption}${todo.status === 'done' ? ` ${styles.statusOptionActive}` : ''}`} onClick={() => setTodoStatus(todo.id, 'done')}>
                            <span className={`${styles.statusIcon} ${styles.statusIconDone}`}><svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L4 7L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span> Done
                          </button>
                        </div>
                      )}
                      {todoPopoverId === todo.id && (
                        <div className={styles.todoPopover} ref={todoPopoverRef}>
                          <div className={styles.popoverText}>{todo.text}</div>
                          <div className={styles.popoverActions}>
                            <button
                              className={styles.popoverStart}
                              onClick={() => openTimerFromTodo(subject, todo.text)}
                            >Start timer</button>
                            <button
                              className={styles.popoverDismiss}
                              onClick={() => setTodoPopoverId(null)}
                            >Dismiss</button>
                          </div>
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
                            <button className={`${styles.btn} ${styles.btnAccent}`} onClick={() => pinTodo(todo)}>Pin</button>
                            <button className={styles.pinCancel} onClick={() => setPinPopoverId(null)}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {isAdding && (
                    <div className={styles.todoAddRow}>
                      <input
                        className={styles.todoAddInput}
                        placeholder="New todo…"
                        value={newTodoText}
                        autoFocus
                        onChange={e => setNewTodoText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') addTodo(subject.id);
                          if (e.key === 'Escape') setAddingToGroup(null);
                        }}
                      />
                    </div>
                  )}
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
          const isAdding = addingToGroup === 'unassigned';
          if (unassigned.length === 0 && !isAdding) return null;
          const isCollapsed = collapsedGroups.has('unassigned');
          const showBody = !isCollapsed || isAdding;
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
                  {unassigned.map(todo => (
                    <div key={todo.id} className={styles.todoItemWrap}>
                      <div className={`${styles.todoItem}${todo.status === 'done' ? ` ${styles.todoItemDone}` : ''}`}>
                        <button
                          className={todo.status === 'in_progress' ? styles.statusBtnInProgress : todo.status === 'done' ? styles.statusBtnDone : styles.statusBtn}
                          onClick={() => { setTodoPopoverId(null); setStatusPopoverId(prev => prev === todo.id ? null : todo.id); }}
                        >
                          {todo.status === 'in_progress' && (
                            <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="0,0 10,5 0,10" fill="currentColor" /></svg>
                          )}
                          {todo.status === 'done' && (
                            <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          )}
                        </button>
                        <div className={styles.todoContent}>
                          {editingTodoId === todo.id ? (
                            <div className={styles.todoEditMode}>
                              <input
                                className={styles.todoEditInput}
                                value={editingTodoText}
                                autoFocus
                                onChange={e => setEditingTodoText(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveTodoEdit(todo.id); if (e.key === 'Escape') setEditingTodoId(null); }}
                              />
                              <button className={styles.todoEditSave} onClick={() => saveTodoEdit(todo.id)}>✓</button>
                              <button className={styles.todoEditCancel} onClick={() => setEditingTodoId(null)}>×</button>
                            </div>
                          ) : (
                            <span
                              className={styles.todoText}
                              onClick={() => { setStatusPopoverId(null); setTodoPopoverId(prev => prev === todo.id ? null : todo.id); }}
                            >{todo.text}</span>
                          )}
                          {todo.dueDate && <span className={styles.todoDueDate}>{todo.dueDate}</span>}
                        </div>
                        <div className={styles.todoActions}>
                          <button
                            className={styles.editTodoBtn}
                            title="Edit"
                            onClick={e => { e.stopPropagation(); setEditingTodoId(todo.id); setEditingTodoText(todo.text); setTodoPopoverId(null); }}
                          >✎</button>
                          <button
                            className={styles.pinBtn}
                            title="Pin to schedule"
                            onClick={e => { e.stopPropagation(); openPinPopover(todo.id); }}
                          >⊕</button>
                        </div>
                      </div>
                      {statusPopoverId === todo.id && (
                        <div className={styles.statusPopover} ref={statusPopoverRef}>
                          <button className={`${styles.statusOption}${todo.status === 'nothing' ? ` ${styles.statusOptionActive}` : ''}`} onClick={() => setTodoStatus(todo.id, 'nothing')}>
                            <span className={styles.statusIcon}><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="#aaa" strokeWidth="1.5"/></svg></span> Nothing
                          </button>
                          <button className={`${styles.statusOption}${todo.status === 'in_progress' ? ` ${styles.statusOptionActive}` : ''}`} onClick={() => setTodoStatus(todo.id, 'in_progress')}>
                            <span className={`${styles.statusIcon} ${styles.statusIconInProgress}`}><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="0,0 10,5 0,10" fill="currentColor"/></svg></span> In Progress
                          </button>
                          <button className={`${styles.statusOption}${todo.status === 'done' ? ` ${styles.statusOptionActive}` : ''}`} onClick={() => setTodoStatus(todo.id, 'done')}>
                            <span className={`${styles.statusIcon} ${styles.statusIconDone}`}><svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L4 7L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span> Done
                          </button>
                        </div>
                      )}
                      {todoPopoverId === todo.id && (
                        <div className={styles.todoPopover} ref={todoPopoverRef}>
                          <div className={styles.popoverText}>{todo.text}</div>
                          <div className={styles.popoverActions}>
                            <button
                              className={styles.popoverDismiss}
                              onClick={() => setTodoPopoverId(null)}
                            >Dismiss</button>
                          </div>
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
                            <button className={`${styles.btn} ${styles.btnAccent}`} onClick={() => pinTodo(todo)}>Pin</button>
                            <button className={styles.pinCancel} onClick={() => setPinPopoverId(null)}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {isAdding && (
                    <div className={styles.todoAddRow}>
                      <input
                        className={styles.todoAddInput}
                        placeholder="New todo…"
                        value={newTodoText}
                        autoFocus
                        onChange={e => setNewTodoText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') addTodo(undefined);
                          if (e.key === 'Escape') setAddingToGroup(null);
                        }}
                      />
                    </div>
                  )}
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
  );
}
