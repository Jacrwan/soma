import { useState, useEffect, useRef } from 'react';
import { storage, inferSubjectId } from '../../lib/storage';
import { Subject, TimeBlock, SubjectColor, Todo, GoogleCalendarEvent } from '../../types';
import SubjectDot from '../shared/SubjectDot';
import TimerOverlay from '../Timer/TimerOverlay';
import styles from './DayView.module.css';

const SLOT_HEIGHT = 40;
const START_HOUR = 6;
const END_HOUR = 24;
const TOTAL_SLOTS = (END_HOUR - START_HOUR) * 2;
const COLORS: SubjectColor[] = [
  '#ef5350', '#42a5f5', '#66bb6a', '#ab47bc',
  '#ffa726', '#26c6da', '#ec407a', '#8d6e63',
];
const DAY_ABBRS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

function minToTop(minutes: number) {
  return ((minutes - START_HOUR * 60) / 30) * SLOT_HEIGHT;
}

function durToHeight(minutes: number) {
  return (minutes / 30) * SLOT_HEIGHT;
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


interface AddBlockForm {
  slotMinutes: number;
  subjectId: string;
  task: string;
  durationMinutes: number;
}

interface PopoverState {
  block: TimeBlock;
  subject: Subject | undefined;
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
  const [addForm, setAddForm] = useState<AddBlockForm | null>(null);
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
    const existing = storage.getTodos();
    const withTodos = new Set(existing.map(t => t.subjectId ?? 'unassigned'));
    return new Set(storage.getSubjects().filter(s => !withTodos.has(s.id)).map(s => s.id));
  });
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [newTodoText, setNewTodoText] = useState('');
  const [todoPopoverId, setTodoPopoverId] = useState<string | null>(null);
  const [statusPopoverId, setStatusPopoverId] = useState<string | null>(null);
  const [pinPopoverId, setPinPopoverId] = useState<string | null>(null);
  const [pinForm, setPinForm] = useState({ hour: 9, minute: 0, durationMinutes: 60 });
  const [initialTimerTask, setInitialTimerTask] = useState('');
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [addSubjectForm, setAddSubjectForm] = useState<AddSubjectForm>({ name: '', color: COLORS[0] });
  const [editSubject, setEditSubject] = useState<SubjectEditState | null>(null);
  const [gcalEvents, setGcalEvents] = useState<GoogleCalendarEvent[]>([]);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingTodoText, setEditingTodoText] = useState('');
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

  const slots = Array.from({ length: TOTAL_SLOTS }, (_, i) => {
    const minutes = START_HOUR * 60 + i * 30;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return { minutes, label: `${h12}:${String(m).padStart(2, '0')} ${ampm}` };
  });

  const isViewingToday = isSameDay(selectedDate, new Date());
  const showCurrentTime = isViewingToday && currentMinutes >= START_HOUR * 60 && currentMinutes < END_HOUR * 60;

  function openAddForm(slotMinutes: number) {
    setPopover(null);
    setAddForm({
      slotMinutes,
      subjectId: activeSubjects[0]?.id ?? '',
      task: '',
      durationMinutes: 60,
    });
  }

  function saveBlock() {
    if (!addForm) return;
    const subject = subjects.find(s => s.id === addForm.subjectId);
    if (!subject) return;
    const start = new Date(
      selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(),
      Math.floor(addForm.slotMinutes / 60), addForm.slotMinutes % 60,
    );
    const end = new Date(start.getTime() + addForm.durationMinutes * 60_000);
    const block: TimeBlock = {
      id: crypto.randomUUID(),
      subjectId: addForm.subjectId,
      task: addForm.task,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      source: 'manual',
    };
    const all = [...storage.getTimeBlocks(), block];
    storage.setTimeBlocks(all);
    setBlocks(prev => [...prev, block]);
    setAddForm(null);
  }

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

  function handleLiveBlockUpdate(block: TimeBlock) {
    setBlocks(prev => prev.map(b => b.id === block.id ? block : b));
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
    const newTodo: Todo = { id: crypto.randomUUID(), text, status: 'nothing', subjectId };
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
    const start = new Date(
      selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(),
      pinForm.hour, pinForm.minute,
    );
    const end = new Date(start.getTime() + pinForm.durationMinutes * 60_000);
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
    const h = now.getHours(), m = now.getMinutes();
    const hour = isViewingToday ? Math.min(m >= 30 ? h + 1 : h, 23) : 9;
    const minute = isViewingToday ? (m < 30 ? 30 : 0) : 0;
    setPinForm({ hour, minute, durationMinutes: 60 });
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

  function selectDate(date: Date) {
    onSelectDate(date);
    prevSelectedDateRef.current = date;
    setViewWeekStart(getMondayOfWeek(date));
    setAddForm(null);
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

  const gridHeight = TOTAL_SLOTS * SLOT_HEIGHT;

  return (
    <div className={styles.wrapper}>
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

    <div className={styles.container}>
      {/* ── Left panel ── */}
      <div className={styles.left}>
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
              <div className={styles.slotArea} onClick={() => openAddForm(slot.minutes)} />
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
            return (
              <div
                key={block.id}
                className={styles.block}
                style={{
                  top: minToTop(startMin),
                  height: durToHeight(durMin),
                  borderLeftColor: subject?.color ?? '#ccc',
                  backgroundColor: subject ? `${subject.color}1f` : '#f5f5f5',
                }}
                onClick={e => {
                  e.stopPropagation();
                  setAddForm(null);
                  setPopover({ block, subject });
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
            if (startMin < START_HOUR * 60 || startMin >= END_HOUR * 60) return null;
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

          {addForm && (
            <div
              className={styles.addForm}
              style={{ top: minToTop(addForm.slotMinutes) }}
              onClick={e => e.stopPropagation()}
            >
              <select
                value={addForm.subjectId}
                onChange={e => setAddForm(f => f && { ...f, subjectId: e.target.value })}
              >
                {activeSubjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input
                placeholder="Task"
                value={addForm.task}
                autoFocus
                onChange={e => setAddForm(f => f && { ...f, task: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') saveBlock(); if (e.key === 'Escape') setAddForm(null); }}
              />
              <select
                value={addForm.durationMinutes}
                onChange={e => setAddForm(f => f && { ...f, durationMinutes: Number(e.target.value) })}
              >
                <option value={30}>30 min</option>
                <option value={60}>1 hour</option>
                <option value={90}>1.5 hours</option>
                <option value={120}>2 hours</option>
              </select>
              <div className={styles.btnRow}>
                <button className={`${styles.btn} ${styles.btnAccent}`} onClick={saveBlock}>Save</button>
                <button className={styles.btn} onClick={() => setAddForm(null)}>Cancel</button>
              </div>
            </div>
          )}

          {popover && (
            <div
              ref={popoverRef}
              className={styles.popover}
              style={{ top: minToTop(new Date(popover.block.startTime).getHours() * 60 + new Date(popover.block.startTime).getMinutes()) }}
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
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className={styles.right}>
        {(() => {
          const weekday = selectedDate.toLocaleDateString('en-US', { weekday: 'long' });
          const monthDay = selectedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
          const pendingCount = todos.filter(t => t.status !== 'done').length;
          return (
            <>
              <div className={styles.dateHeader}>
                <div className={styles.dateHeaderText}>
                  <div className={styles.dateHeaderWeekday}>{weekday}</div>
                  <div className={styles.dateHeaderDate}>{monthDay}</div>
                  <div className={styles.dateHeaderCount}>{pendingCount} task{pendingCount !== 1 ? 's' : ''} today</div>
                </div>
                <button
                  className={styles.addSubjectBtn}
                  onClick={() => { setShowAddSubject(true); setEditSubject(null); }}
                  title="Add subject"
                >+</button>
              </div>
              <div className={styles.dateHeaderDivider} />
            </>
          );
        })()}

        {activeSubjects.length === 0 && (
          <div className={styles.emptySubjects}>Add a subject to get started.</div>
        )}

        {activeSubjects.map(subject => {
          const groupTodos = todos.filter(t => t.subjectId === subject.id);
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
                              <select
                                className={styles.pinSelect}
                                value={pinForm.hour}
                                onChange={e => setPinForm(f => ({ ...f, hour: Number(e.target.value) }))}
                              >
                                {Array.from({ length: 18 }, (_, i) => i + 6).map(h => {
                                  const ampm = h >= 12 ? 'PM' : 'AM';
                                  const label = `${h % 12 || 12} ${ampm}`;
                                  return <option key={h} value={h}>{label}</option>;
                                })}
                              </select>
                              <select
                                className={styles.pinSelect}
                                value={pinForm.minute}
                                onChange={e => setPinForm(f => ({ ...f, minute: Number(e.target.value) }))}
                              >
                                <option value={0}>:00</option>
                                <option value={30}>:30</option>
                              </select>
                            </div>
                          </div>
                          <div className={styles.pinFormRow}>
                            <label className={styles.pinLabel}>Duration</label>
                            <input
                              type="number"
                              className={styles.pinDurationInput}
                              value={pinForm.durationMinutes}
                              min={15}
                              step={15}
                              onChange={e => setPinForm(f => ({ ...f, durationMinutes: Math.max(15, Number(e.target.value)) }))}
                            />
                            <span className={styles.pinDurationUnit}>min</span>
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
          const unassigned = todos.filter(t => !t.subjectId);
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
                              <select
                                className={styles.pinSelect}
                                value={pinForm.hour}
                                onChange={e => setPinForm(f => ({ ...f, hour: Number(e.target.value) }))}
                              >
                                {Array.from({ length: 18 }, (_, i) => i + 6).map(h => {
                                  const ampm = h >= 12 ? 'PM' : 'AM';
                                  const label = `${h % 12 || 12} ${ampm}`;
                                  return <option key={h} value={h}>{label}</option>;
                                })}
                              </select>
                              <select
                                className={styles.pinSelect}
                                value={pinForm.minute}
                                onChange={e => setPinForm(f => ({ ...f, minute: Number(e.target.value) }))}
                              >
                                <option value={0}>:00</option>
                                <option value={30}>:30</option>
                              </select>
                            </div>
                          </div>
                          <div className={styles.pinFormRow}>
                            <label className={styles.pinLabel}>Duration</label>
                            <input
                              type="number"
                              className={styles.pinDurationInput}
                              value={pinForm.durationMinutes}
                              min={15}
                              step={15}
                              onChange={e => setPinForm(f => ({ ...f, durationMinutes: Math.max(15, Number(e.target.value)) }))}
                            />
                            <span className={styles.pinDurationUnit}>min</span>
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
          onLiveBlockUpdate={handleLiveBlockUpdate}
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
    </div>
  );
}
