import { useState, useEffect, useRef, useMemo, useCallback, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { storage } from '../../lib/storage';
import { getWeekRange, isCacheStale } from '../../lib/googleCalendar';
import {
  listConnections, startConnectFlow, fetchAggregatedEvents, GoogleCalendarError,
} from '../../lib/googleCalendarConnections';
import { TimeBlock, Subject, GoogleCalendarEvent, GoogleCalendarConnection, TimerSession, Todo } from '../../types';
import { formatDateTime, formatHourLabel, useTimeFormat, type TimeFormat } from '../../lib/timeFormat';
import {
  addDays, getSundayOfWeek, getFirstOfMonth, startOfDay,
  nextAnchors, rangeLength, type CalendarView, type ViewAnchors,
} from '../../lib/calendarView';
import styles from './CalendarTab.module.css';

type ViewMode = CalendarView;

/** One drawn stretch of study time, from whichever source described it. */
interface StudySpan {
  id: string;
  subjectId: string;
  task: string;
  start: Date;
  end: Date;
  blockId?: string;
}

/**
 * Reconcile every record of study time into one span per stretch worked.
 *
 * Three things describe the same afternoon, and the calendar used to draw
 * whichever it knew about:
 *
 *  - a block in localStorage, which may be a plan or the timer's own copy;
 *  - one timer_sessions row per sitting, since resuming a task writes another
 *    row and only extends the block it continues;
 *  - nothing at all, when time was added by hand, which writes no block.
 *
 * Counting them separately is what turned one afternoon into a stack of
 * slivers. Rather than special-case how each source links to the others —
 * blocks name at most their first session, and a planned block names none —
 * every record becomes a candidate span and overlapping candidates for the
 * same subject are merged. Anything describing the same stretch collapses,
 * whichever record it came from, and two sittings hours apart stay two.
 *
 * `sessionsLoaded` is false until the fetch settles, and stays false if it
 * failed. A block is only treated as a ghost of a deleted session when the
 * sessions were actually read — an unreachable network must not empty the
 * calendar.
 */
function studySpans(sessions: TimerSession[], blocks: TimeBlock[], sessionsLoaded: boolean): StudySpan[] {
  const ms = (iso: string) => new Date(iso).getTime();
  const sessionEnd = (s: TimerSession) =>
    s.endTime ? ms(s.endTime) : ms(s.startTime) + s.durationSeconds * 1000;

  const candidates: StudySpan[] = [];

  for (const block of blocks) {
    if (!block.startTime || block.source === 'canvas') continue;

    if (block.timerSessionId && sessionsLoaded) {
      // The timer's own copy of a session. Size it to the sessions still
      // there, so a correction shrinks it and the last delete removes it.
      const from = ms(block.startTime), to = ms(block.endTime);
      const mine = sessions.filter(s =>
        s.id === block.timerSessionId ||
        (s.subjectId === block.subjectId && ms(s.startTime) >= from && ms(s.startTime) <= to));
      if (mine.length === 0) continue;
      candidates.push({
        id: `soma-${block.id}`,
        blockId: block.id,
        subjectId: block.subjectId,
        task: block.task,
        start: new Date(Math.min(...mine.map(s => ms(s.startTime)))),
        end: new Date(Math.max(...mine.map(sessionEnd))),
      });
      continue;
    }

    candidates.push({
      id: `soma-${block.id}`,
      blockId: block.id,
      subjectId: block.subjectId,
      task: block.task,
      start: new Date(block.startTime),
      end: new Date(block.endTime),
    });
  }

  if (sessionsLoaded) {
    for (const s of sessions) {
      candidates.push({
        id: `session-${s.id}`,
        subjectId: s.subjectId,
        task: s.task,
        start: new Date(s.startTime),
        end: new Date(sessionEnd(s)),
      });
    }
  }

  // Merge overlapping candidates for the same subject. Touching is not
  // overlapping: work that ends as the next begins stays two blocks.
  const merged: StudySpan[] = [];
  for (const span of [...candidates].sort((a, b) => +a.start - +b.start)) {
    const hit = merged.find(m =>
      m.subjectId === span.subjectId && +span.start < +m.end && +span.end > +m.start);
    if (!hit) { merged.push({ ...span }); continue; }
    if (+span.start < +hit.start) hit.start = span.start;
    if (+span.end > +hit.end) hit.end = span.end;
    // Keep whichever record can be opened, and a name over none.
    if (!hit.blockId && span.blockId) { hit.blockId = span.blockId; hit.id = span.id; }
    if (!hit.task && span.task) hit.task = span.task;
  }
  return merged;
}

interface Filters {
  gcal: boolean;
  canvas: boolean;
  soma: boolean;
}

interface Chip {
  id: string;
  label: string;
  bgColor: string;
  type: 'gcal' | 'canvas' | 'soma';
  sortKey: number;
}

interface CalendarTabProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onSwitchToToday: () => void;
}

interface WeekBlockEditForm {
  task: string;
  startHour: number;
  startMinute: number;
  startAmPm: 'AM' | 'PM';
  endHour: number;
  endMinute: number;
  endAmPm: 'AM' | 'PM';
}

interface PositionedEvent {
  id: string;
  type: 'soma' | 'gcal';
  label: string;
  sublabel?: string;
  color: string;
  borderColor?: string;
  textColor: string;
  top: number;
  height: number;
  left: number;
  width: number;
  block?: TimeBlock;
  gcalEvent?: GoogleCalendarEvent;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const GCAL_COLOR = '#9e9e9e';
const CANVAS_COLOR = '#f4511e';
const MAX_CHIPS = 3;
const FILTER_KEY = 'soma_calendar_filters';

const WEEK_SLOT_HEIGHT = 60;
const WEEK_TOTAL_HOURS = 24;
const WEEK_GRID_HEIGHT = WEEK_TOTAL_HOURS * WEEK_SLOT_HEIGHT;
const weekHourSlotsFor = (format: TimeFormat) =>
  Array.from({ length: WEEK_TOTAL_HOURS }, (_, i) => ({
    label: i === 0 ? '' : formatHourLabel(i, format),
  }));

function weekMinToTop(clockMinutes: number): number {
  return (clockMinutes / 60) * WEEK_SLOT_HEIGHT;
}

// Lightens a #rrggbb color into a translucent fill for an event's background,
// keeping the full color for its border/accent — same "tinted block, solid
// accent" look Soma's own time blocks already use.
function tint(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return `rgba(150, 150, 150, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isOnDate(iso: string, date: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === date.getFullYear()
    && d.getMonth() === date.getMonth()
    && d.getDate() === date.getDate();
}

function fmtTime(iso: string): string {
  return formatDateTime(new Date(iso));
}

function fmtDuration(startISO: string, endISO: string): string {
  const mins = Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      gcal: parsed.gcal ?? true,
      canvas: parsed.canvas ?? true,
      soma: parsed.soma ?? true,
    };
  } catch { return { gcal: true, canvas: true, soma: true }; }
}

function saveFilters(f: Filters) {
  localStorage.setItem(FILTER_KEY, JSON.stringify(f));
}

export default function CalendarTab({ selectedDate, onSelectDate, onSwitchToToday }: CalendarTabProps) {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<GoogleCalendarConnection[]>([]);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [gcalError, setGcalError] = useState('');

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [viewMonth, setViewMonth] = useState<Date>(() => getFirstOfMonth(selectedDate));
  const [originMonth, setOriginMonth] = useState<Date>(() => getFirstOfMonth(selectedDate));
  const [viewWeekStart, setViewWeekStart] = useState<Date>(() => getSundayOfWeek(selectedDate));
  const dayColumns = rangeLength(viewMode) || 7;
  const [filters, setFilters] = useState<Filters>(() => loadFilters());
  const [dataVersion, setDataVersion] = useState(0);

  // Recorded study time, read from Supabase rather than the localStorage
  // blocks: a session added by hand, corrected or deleted never reached those,
  // so the calendar showed the timer's sessions only and kept ghosts of
  // deleted ones.
  const [sessions, setSessions] = useState<TimerSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  // Deadlines from a course website are tasks with a due date, and belong in
  // the all-day row beside the Canvas ones.
  const [dueTasks, setDueTasks] = useState<Todo[]>(() => storage.getTodos().filter(t => !!t.dueDate));

  const [currentMinutes, setCurrentMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  const [weekBlockModal, setWeekBlockModal] = useState<{ block: TimeBlock; subject: Subject | undefined } | null>(null);
  const [weekBlockEditMode, setWeekBlockEditMode] = useState(false);
  const [weekBlockEditForm, setWeekBlockEditForm] = useState<WeekBlockEditForm>({
    task: '', startHour: 9, startMinute: 0, startAmPm: 'AM',
    endHour: 10, endMinute: 0, endAmPm: 'AM',
  });

  const timeFormat = useTimeFormat();
  const weekHourSlots = useMemo(() => weekHourSlotsFor(timeFormat), [timeFormat]);

  const weekGridRef = useRef<HTMLDivElement>(null);
  const weekModalBoxRef = useRef<HTMLDivElement>(null);
  const preModalFocusRef = useRef<HTMLElement | null>(null);

  const isConnected = connections.some(c => c.selectedCalendars.length > 0);

  const subjectName = (subjectId?: string) =>
    (subjectId ? storage.getSubjects().find(s => s.id === subjectId)?.name : '') ?? '';

  const loadConnections = useCallback(async () => {
    try {
      const fresh = await listConnections();
      setConnections(fresh);
      return fresh;
    } catch {
      return [];
    }
  }, []);

  // On mount (including right after the OAuth redirect back from the connect
  // flow, which lands here via /api/google-calendar-oauth-callback), load
  // the current set of connections.
  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    const handler = () => setDataVersion(v => v + 1);
    window.addEventListener('soma_gcal_updated', handler);
    return () => window.removeEventListener('soma_gcal_updated', handler);
  }, []);

  // saveTimerSession, updateTimerSessionDuration and deleteTimerSession all
  // dispatch soma_insights_changed, so adding, correcting or deleting a
  // session anywhere in the app redraws the calendar.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void storage.fetchTimerSessions()
        .then(rows => { if (!cancelled) { setSessions(rows); setSessionsLoaded(true); setDataVersion(v => v + 1); } })
        .catch(() => { /* leave sessionsLoaded false: blocks are drawn untouched */ });
    };
    refresh();
    window.addEventListener('soma_insights_changed', refresh);
    return () => { cancelled = true; window.removeEventListener('soma_insights_changed', refresh); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) { setDueTasks(storage.getTodos().filter(t => !!t.dueDate)); setDataVersion(v => v + 1); }
    };
    void storage.fetchAllTodos().then(refresh).catch(() => { /* non-fatal */ });
    void storage.whenTokensLoaded().then(refresh);
    window.addEventListener('soma_todos_changed', refresh);
    return () => { cancelled = true; window.removeEventListener('soma_todos_changed', refresh); };
  }, []);

  useEffect(() => {
    if (connections.length === 0) return;
    if (!isCacheStale(storage.getGoogleCacheTimestamp())) return;
    void fetchGcalEvents();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections]);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCurrentMinutes(now.getHours() * 60 + now.getMinutes());
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!weekBlockModal) return;
    // Save where focus was so we can restore it on close
    preModalFocusRef.current = document.activeElement as HTMLElement;
    // Move focus into the modal after paint
    const focusId = setTimeout(() => {
      weekModalBoxRef.current?.querySelector<HTMLElement>('button:not([disabled]), input')?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setWeekBlockModal(null); setWeekBlockEditMode(false); return; }
      if (e.key === 'Tab' && weekModalBoxRef.current) {
        const focusable = Array.from(weekModalBoxRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled])'
        ));
        if (focusable.length < 2) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(focusId);
      preModalFocusRef.current?.focus();
    };
  }, [weekBlockModal]);

  // Auto-scroll to current time when entering a timed day view
  useEffect(() => {
    if (viewMode === 'month' || !weekGridRef.current) return;
    const now = new Date();
    const scrollTop = Math.max(0, weekMinToTop(now.getHours() * 60 + now.getMinutes()) - 200);
    weekGridRef.current.scrollTop = scrollTop;
  }, [viewMode, viewWeekStart]);

  async function fetchGcalEvents() {
    setGcalLoading(true);
    setGcalError('');
    try {
      const { timeMin, timeMax } = getWeekRange();
      const data = await fetchAggregatedEvents(timeMin, timeMax);
      storage.setCachedGoogleEvents(data);
      storage.setGoogleCacheTimestamp(Date.now());
      setDataVersion(v => v + 1);
      window.dispatchEvent(new CustomEvent('soma_gcal_updated'));
    } catch (err) {
      if (err instanceof GoogleCalendarError && err.message === 'google_token_expired') {
        setGcalError('One of your Google Calendar connections expired — reconnect it in Settings.');
      } else {
        setGcalError('Could not load Google Calendar events.');
      }
    } finally {
      setGcalLoading(false);
    }
  }

  async function connectGcal() {
    await startConnectFlow();
  }

  function toggleFilter(key: keyof Filters) {
    setFilters(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveFilters(next);
      return next;
    });
  }

  function openWeekBlockEdit(block: TimeBlock) {
    const toForm = (d: Date) => {
      const h24 = d.getHours(), m = d.getMinutes();
      return { hour: h24 % 12 || 12, minute: m, ampm: (h24 >= 12 ? 'PM' : 'AM') as 'AM' | 'PM' };
    };
    const s = toForm(new Date(block.startTime));
    const e = toForm(new Date(block.endTime));
    setWeekBlockEditForm({
      task: block.task ?? '',
      startHour: s.hour, startMinute: s.minute, startAmPm: s.ampm,
      endHour: e.hour, endMinute: e.minute, endAmPm: e.ampm,
    });
    setWeekBlockEditMode(true);
  }

  function saveWeekBlockEdit() {
    if (!weekBlockModal) return;
    const toHour24 = (h: number, ampm: 'AM' | 'PM') => (h % 12) + (ampm === 'PM' ? 12 : 0);
    const blockDate = new Date(weekBlockModal.block.startTime);
    const start = new Date(
      blockDate.getFullYear(), blockDate.getMonth(), blockDate.getDate(),
      toHour24(weekBlockEditForm.startHour, weekBlockEditForm.startAmPm),
      weekBlockEditForm.startMinute,
    );
    const end = new Date(
      blockDate.getFullYear(), blockDate.getMonth(), blockDate.getDate(),
      toHour24(weekBlockEditForm.endHour, weekBlockEditForm.endAmPm),
      weekBlockEditForm.endMinute,
    );
    function toLocalISO(d: Date) {
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
    }
    const updated: TimeBlock = {
      ...weekBlockModal.block,
      task: weekBlockEditForm.task.trim() || weekBlockModal.block.task,
      startTime: toLocalISO(start),
      endTime: toLocalISO(end),
    };
    const allBlocks = storage.getTimeBlocks().map(b => b.id === updated.id ? updated : b);
    storage.setTimeBlocks(allBlocks);
    setWeekBlockModal({ block: updated, subject: weekBlockModal.subject });
    setWeekBlockEditMode(false);
    setDataVersion(v => v + 1);
  }

  function deleteWeekBlock(id: string) {
    storage.setTimeBlocks(storage.getTimeBlocks().filter(b => b.id !== id));
    setWeekBlockModal(null);
    setWeekBlockEditMode(false);
    setDataVersion(v => v + 1);
  }

  // Month view chip data
  const chipsByDate = useMemo(() => {
    const map = new Map<string, Chip[]>();
    const subjects = storage.getSubjects();
    const gcalEvents = storage.getCachedGoogleEvents();
    const assignments = storage.getCachedAssignments();
    const blocks = storage.getTimeBlocks();

    function add(date: Date, chip: Chip) {
      const k = dateKey(date);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(chip);
    }

    if (filters.gcal) {
      for (const e of gcalEvents) {
        const dt = e.start.dateTime ?? e.start.date;
        if (!dt) continue;
        add(new Date(dt), { id: `gcal-${e.id}`, label: e.summary ?? '(No title)', bgColor: e.source?.color ?? GCAL_COLOR, type: 'gcal', sortKey: new Date(dt).getTime() });
      }
    }
    if (filters.canvas) {
      for (const a of assignments) {
        if (!a.dueAt) continue;
        add(new Date(a.dueAt), { id: `canvas-${a.id}`, label: a.name, bgColor: CANVAS_COLOR, type: 'canvas', sortKey: new Date(a.dueAt).getTime() });
      }
      for (const t of dueTasks) {
        const due = new Date(`${t.dueDate}T23:59:00`);
        add(due, { id: `due-${t.id}`, label: t.text, bgColor: CANVAS_COLOR, type: 'canvas', sortKey: due.getTime() });
      }
    }
    if (filters.soma) {
      for (const span of studySpans(sessions, blocks, sessionsLoaded)) {
        const subj = subjects.find(s => s.id === span.subjectId);
        add(span.start, { id: span.id, label: span.task || subj?.name || 'Study', bgColor: subj?.color ?? '#9e9e9e', type: 'soma', sortKey: span.start.getTime() });
      }
    }
    for (const chips of map.values()) chips.sort((a, b) => a.sortKey - b.sortKey);
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, dataVersion, sessions, sessionsLoaded, dueTasks]);

  const getPositionedEventsForDay = useCallback((day: Date): {
    events: PositionedEvent[];
  } => {
    const subjects = storage.getSubjects();
    const gcalEvents = storage.getCachedGoogleEvents();
    const blocks = storage.getTimeBlocks();

    interface RawEvent {
      id: string;
      type: 'soma' | 'gcal';
      label: string;
      sublabel?: string;
      color: string;
      borderColor?: string;
      textColor?: string;
      startMin: number;
      endMin: number;
      block?: TimeBlock;
      gcalEvent?: GoogleCalendarEvent;
    }

    const events: RawEvent[] = [];

    if (filters.soma) {
      for (const span of studySpans(sessions, blocks, sessionsLoaded)) {
        if (!isOnDate(span.start.toISOString(), day)) continue;
        const startMin = span.start.getHours() * 60 + span.start.getMinutes();
        const endMin = span.end.getHours() * 60 + span.end.getMinutes();
        // Under five minutes is almost always a focus session stopped by
        // accident; it used to render as a dot, which added noise, not signal.
        if (endMin - startMin < 5) continue;
        const subject = subjects.find(s => s.id === span.subjectId);
        const baseColor = subject?.color ?? '#9e9e9e';
        const label = (subject?.name ?? span.task) || 'Study';
        const block = span.blockId ? blocks.find(b => b.id === span.blockId) : undefined;
        events.push({
          id: span.id,
          type: 'soma',
          label,
          sublabel: span.task && span.task !== subject?.name ? span.task : undefined,
          color: tint(baseColor, 0.3),
          borderColor: baseColor,
          textColor: 'var(--text-primary)',
          startMin,
          endMin: endMin > startMin ? endMin : startMin + 30,
          block,
        });
      }
    }

    if (filters.gcal) {
      for (const e of gcalEvents) {
        if (!e.start.dateTime || !isOnDate(e.start.dateTime, day)) continue;
        const start = new Date(e.start.dateTime);
        const end = new Date(e.end.dateTime ?? e.start.dateTime);
        const startMin = start.getHours() * 60 + start.getMinutes();
        const endMin = end.getHours() * 60 + end.getMinutes();
        const durMin = endMin - startMin;

        if (durMin < 5) continue;

        const gcalColor = e.source?.color ?? GCAL_COLOR;
        events.push({
          id: `gcal-${e.id}`,
          type: 'gcal',
          label: e.summary ?? '(No title)',
          sublabel: e.source?.calendarSummary,
          color: tint(gcalColor, 0.28),
          borderColor: gcalColor,
          textColor: 'var(--text-primary)',
          startMin,
          endMin: endMin > startMin ? endMin : startMin + 30,
          gcalEvent: e,
        });
      }
    }

    events.sort((a, b) => a.startMin - b.startMin);

    // Interval-graph coloring: assign each event the lowest column index
    // not used by any overlapping event already processed.
    const colAssign: number[] = new Array(events.length).fill(0);
    for (let i = 0; i < events.length; i++) {
      const used = new Set<number>();
      for (let j = 0; j < i; j++) {
        if (events[j].startMin < events[i].endMin && events[i].startMin < events[j].endMin) {
          used.add(colAssign[j]);
        }
      }
      let c = 0;
      while (used.has(c)) c++;
      colAssign[i] = c;
    }

    // numCols for each event = max col index of any concurrent event + 1
    const numColsArr = events.map((ev, i) => {
      let max = colAssign[i];
      for (let j = 0; j < events.length; j++) {
        if (i !== j && events[j].startMin < ev.endMin && ev.startMin < events[j].endMin) {
          max = Math.max(max, colAssign[j]);
        }
      }
      return max + 1;
    });

    // Propagate: overlapping events must share the same numCols so their widths
    // tile correctly. Without this, chained overlaps can give inconsistent values
    // (e.g. B=3-cols but D=2-cols when B and D overlap) causing visual collisions.
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < events.length; i++) {
        for (let j = i + 1; j < events.length; j++) {
          if (events[j].startMin < events[i].endMin && events[i].startMin < events[j].endMin) {
            const maxN = Math.max(numColsArr[i], numColsArr[j]);
            if (numColsArr[i] !== maxN) { numColsArr[i] = maxN; changed = true; }
            if (numColsArr[j] !== maxN) { numColsArr[j] = maxN; changed = true; }
          }
        }
      }
    }

    return {
      events: events.map((ev, i) => ({
        id: ev.id,
        type: ev.type,
        label: ev.label,
        sublabel: ev.sublabel,
        color: ev.color,
        borderColor: ev.borderColor,
        textColor: ev.textColor ?? ev.borderColor ?? 'var(--text-primary)',
        top: weekMinToTop(ev.startMin),
        height: Math.max(((ev.endMin - ev.startMin) / 60) * WEEK_SLOT_HEIGHT, 18),
        left: colAssign[i] / numColsArr[i],
        width: 1 / numColsArr[i],
        block: ev.block,
        gcalEvent: ev.gcalEvent,
      })),
    };
  }, [filters, sessions, sessionsLoaded]);

  function goToPrev() {
    if (viewMode === 'month') setViewMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    else setViewWeekStart(addDays(viewWeekStart, -dayColumns));
  }

  function goToNext() {
    if (viewMode === 'month') setViewMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    else setViewWeekStart(addDays(viewWeekStart, dayColumns));
  }

  function goToToday() {
    const now = new Date();
    if (viewMode === 'month') setViewMonth(getFirstOfMonth(now));
    // Week snaps to its Sunday; the three-day view starts on today.
    else setViewWeekStart(viewMode === 'week' ? getSundayOfWeek(now) : startOfDay(now));
  }

  function switchViewMode(mode: ViewMode) {
    if (mode === viewMode) return;
    const anchors: ViewAnchors = { month: viewMonth, rangeStart: viewWeekStart, originMonth };
    const next = nextAnchors(mode, viewMode, anchors, new Date());
    setViewMonth(next.month);
    setViewWeekStart(next.rangeStart);
    setOriginMonth(next.originMonth);
    setViewMode(mode);
  }

  function handleDayClick(date: Date) {
    onSelectDate(date);
    onSwitchToToday();
  }

  const headerTitle = viewMode === 'month'
    ? `${MONTH_NAMES[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`
    : (() => {
        const end = addDays(viewWeekStart, dayColumns - 1);
        const sm = MONTH_NAMES[viewWeekStart.getMonth()];
        const em = MONTH_NAMES[end.getMonth()];
        if (viewWeekStart.getMonth() === end.getMonth()) {
          return `${sm} ${viewWeekStart.getDate()}–${end.getDate()}, ${viewWeekStart.getFullYear()}`;
        }
        return `${sm} ${viewWeekStart.getDate()} – ${em} ${end.getDate()}`;
      })();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthCells = useMemo(() => {
    const firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const gridStart = getSundayOfWeek(firstOfMonth);
    return Array.from({ length: 42 }, (_, i) => {
      const date = addDays(gridStart, i);
      return { date, isCurrentMonth: date.getMonth() === viewMonth.getMonth() };
    });
  }, [viewMonth]);

  const weekDays = useMemo(
    () => Array.from({ length: dayColumns }, (_, i) => addDays(viewWeekStart, i)),
    [viewWeekStart, dayColumns],
  );

  // Computed once per data/filter/week change — not on every clock tick
  const weekPositionedDays = useMemo(
    () => weekDays.map(day => getPositionedEventsForDay(day)),
    [weekDays, dataVersion, getPositionedEventsForDay],
  );

  function renderDayNum(date: Date, isCurrentMonth = true) {
    const isToday = isSameDay(date, today);
    const isSelected = isSameDay(date, selectedDate);
    return (
      <span
        className={[
          styles.dateNum,
          isToday ? styles.dateNumToday : '',
          isSelected && !isToday ? styles.dateNumSelected : '',
          !isCurrentMonth ? styles.dateNumOtherMonth : '',
        ].filter(Boolean).join(' ')}
      >
        {date.getDate()}
      </span>
    );
  }

  function renderChips(date: Date, maxVisible = MAX_CHIPS) {
    const chips = chipsByDate.get(dateKey(date)) ?? [];
    const visible = chips.slice(0, maxVisible);
    const overflow = chips.length - maxVisible;
    return (
      <>
        {visible.map(chip => (
          <span key={chip.id} className={styles.chip} style={{ background: chip.bgColor }} title={chip.label}>
            {chip.label}
          </span>
        ))}
        {overflow > 0 && <span className={styles.overflowChip}>+{overflow} more</span>}
      </>
    );
  }

  const todayInWeek = weekDays.some(d => isSameDay(d, today));

  return (
    <div className={styles.container}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.navArrow} onClick={goToPrev} aria-label={viewMode === 'month' ? 'Previous month' : viewMode === 'week' ? 'Previous week' : 'Previous three days'}>‹</button>
          <button className={styles.navArrow} onClick={goToNext} aria-label={viewMode === 'month' ? 'Next month' : viewMode === 'week' ? 'Next week' : 'Next three days'}>›</button>
          <span className={styles.navTitle}>{headerTitle}</span>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.todayBtn} onClick={goToToday}>Today</button>
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewToggleBtn}${viewMode === 'month' ? ` ${styles.viewToggleBtnActive}` : ''}`}
              onClick={() => switchViewMode('month')}
              aria-pressed={viewMode === 'month'}
            >Month</button>
            <button
              className={`${styles.viewToggleBtn}${viewMode === 'week' ? ` ${styles.viewToggleBtnActive}` : ''}`}
              onClick={() => switchViewMode('week')}
              aria-pressed={viewMode === 'week'}
            >Week</button>
            <button
              className={`${styles.viewToggleBtn}${viewMode === 'threeDay' ? ` ${styles.viewToggleBtnActive}` : ''}`}
              onClick={() => switchViewMode('threeDay')}
              aria-pressed={viewMode === 'threeDay'}
            >3 days</button>
          </div>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className={styles.filterBar}>
        {isConnected ? (
          <button
            className={`${styles.filterPill}${filters.gcal ? ` ${styles.filterPillActive}` : ''}`}
            style={filters.gcal ? { background: GCAL_COLOR, borderColor: GCAL_COLOR } : {}}
            onClick={() => toggleFilter('gcal')}
            aria-pressed={filters.gcal}
          >Google Calendar</button>
        ) : (
          <button
            className={`${styles.filterPill} ${styles.filterPillConnect}`}
            onClick={connectGcal}
          >+ Connect Google Calendar</button>
        )}
        <button
          className={`${styles.filterPill}${filters.canvas ? ` ${styles.filterPillActive}` : ''}`}
          style={filters.canvas ? { background: CANVAS_COLOR, borderColor: CANVAS_COLOR } : {}}
          onClick={() => toggleFilter('canvas')}
          aria-pressed={filters.canvas}
        >Courses</button>
        <button
          className={`${styles.filterPill}${filters.soma ? ` ${styles.filterPillActive}` : ''}`}
          onClick={() => toggleFilter('soma')}
          aria-pressed={filters.soma}
        >Soma</button>
        {isConnected && (
          <button className={styles.disconnectBtn} onClick={() => navigate('/settings')}>Manage calendars</button>
        )}
        {gcalLoading && <span className={styles.gcalLoading} role="status" aria-live="polite">↻ Syncing…</span>}
        {gcalError && (
          <>
            <span className={styles.gcalError} role="alert">{gcalError}</span>
            <button className={styles.gcalRetryBtn} onClick={() => void fetchGcalEvents()}>Retry</button>
          </>
        )}
      </div>

      {/* ── Month view ── */}
      {viewMode === 'month' && (
        <>
          <div className={styles.dayHeaders}>
            {DAY_NAMES.map(d => (
              <div key={d} className={styles.dayHeaderCell}>{d}</div>
            ))}
          </div>
          <div className={styles.monthGrid}>
            {monthCells.map(({ date, isCurrentMonth }, i) => (
              <div
                key={i}
                className={[
                  styles.monthCell,
                  !isCurrentMonth ? styles.monthCellOther : '',
                  isSameDay(date, today) ? styles.monthCellToday : '',
                  isSameDay(date, selectedDate) ? styles.monthCellSelected : '',
                ].filter(Boolean).join(' ')}
                onClick={() => handleDayClick(date)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDayClick(date); } }}
                tabIndex={0}
                role="button"
                aria-current={isSameDay(date, today) ? 'date' : undefined}
              >
                {renderDayNum(date, isCurrentMonth)}
                <div className={styles.chipsArea}>{renderChips(date)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Week / three-day view ── */}
      {(viewMode === 'week' || viewMode === 'threeDay') && (
        <div
          className={styles.weekViewOuter}
          style={{ '--week-day-count': dayColumns } as CSSProperties}
        >

          {/* Day headers row */}
          <div className={styles.weekViewHeaderRow}>
            <div className={styles.weekViewGutterHeader} />
            {weekDays.map((day, i) => {
              const isToday = isSameDay(day, today);
              return (
                <div
                  key={i}
                  className={`${styles.weekViewDayHeader}${isToday ? '' : ` ${styles.weekViewDayHeaderDimmed}`}`}
                  onClick={() => handleDayClick(day)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDayClick(day); } }}
                  tabIndex={0}
                  role="button"
                >
                  <span className={styles.weekViewDayAbbr}>{DAY_NAMES[day.getDay()]}</span>
                  <span className={`${styles.weekViewDayNum}${isToday ? ` ${styles.weekViewDayNumToday}` : ''}`}>
                    {day.getDate()}
                  </span>
                </div>
              );
            })}
          </div>

          {/* All-day row: everything due that day, whatever its source. */}
          {filters.canvas && (() => {
            const assignments = storage.getCachedAssignments();
            type DueChip = { id: string; name: string; course: string; dueKey: string; url?: string };
            const chipsFor = (day: Date): DueChip[] => [
              ...assignments
                .filter(a => a.dueAt && isSameDay(new Date(a.dueAt), day))
                .map(a => ({ id: `canvas-${a.id}`, name: a.name, course: a.courseName, dueKey: a.dueAt, url: a.htmlUrl })),
              ...dueTasks
                .filter(t => isSameDay(new Date(`${t.dueDate}T12:00:00`), day))
                .map(t => ({
                  id: `due-${t.id}`,
                  name: t.text,
                  course: subjectName(t.subjectId),
                  dueKey: `${t.dueDate}T23:59:00`,
                })),
            ];
            if (!weekDays.some(day => chipsFor(day).length > 0)) return null;
            return (
              <div className={styles.weekViewAllDayRow}>
                <div className={styles.weekViewAllDayLabel}>all-day</div>
                {weekDays.map((day, i) => (
                  <div key={i} className={styles.weekViewAllDayCell}>
                    {chipsFor(day).map(chip => {
                      const dueFmt = new Date(chip.dueKey).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                      return (
                        <div key={chip.id} className={styles.weekViewAllDayChipWrap}>
                          <span className={styles.weekViewAllDayChip}>{chip.name}</span>
                          <div className={styles.weekViewAllDayChipPanel} onClick={e => e.stopPropagation()}>
                            <div className={styles.weekViewChipPanelName}>{chip.name}</div>
                            <div className={styles.weekViewChipPanelMeta}>Due {dueFmt}</div>
                            {chip.course && <div className={styles.weekViewChipPanelCourse}>{chip.course}</div>}
                            {chip.url && (
                              <a className={styles.weekViewChipPanelLink} href={chip.url} target="_blank" rel="noopener noreferrer">
                                Open in Canvas ↗
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Scrollable time grid */}
          <div className={styles.weekViewScrollArea} ref={weekGridRef}>
            <div className={styles.weekViewGrid} style={{ height: WEEK_GRID_HEIGHT }}>

              {/* Time label column */}
              <div className={styles.weekViewTimeCol}>
                {weekHourSlots.map((slot, i) => (
                  <div
                    key={i}
                    className={styles.weekViewTimeLabel}
                    style={{ top: i * WEEK_SLOT_HEIGHT }}
                  >
                    {slot.label}
                  </div>
                ))}
                {todayInWeek && (
                  <div className={styles.weekViewNowPill} style={{ top: weekMinToTop(currentMinutes) }}>
                    {`${Math.floor(currentMinutes / 60) % 12 || 12}:${String(currentMinutes % 60).padStart(2, '0')} ${currentMinutes >= 12 * 60 ? 'PM' : 'AM'}`}
                  </div>
                )}
              </div>

              {/* Day columns with hour lines */}
              <div className={styles.weekViewDayCols}>
                {/* Hour lines (rendered behind all columns via absolute positioning) */}
                {weekHourSlots.map((_, i) => (
                  <div
                    key={i}
                    className={styles.weekViewHourLine}
                    style={{ top: i * WEEK_SLOT_HEIGHT }}
                  />
                ))}

                {/* Day columns */}
                {(() => {
                  const nowTop = weekMinToTop(currentMinutes);
                  return (
                    <>
                    {weekDays.map((day, dayIndex) => {
                  const isToday = isSameDay(day, today);
                  const { events: posEvents } = weekPositionedDays[dayIndex];

                  return (
                    <div
                      key={dayIndex}
                      className={`${styles.weekViewDayCol}${isToday ? ` ${styles.weekViewDayColToday}` : ''}`}
                      onClick={() => handleDayClick(day)}
                    >
                      {/* Per-column time segment — faint on other days, full red on today */}
                      <div
                        className={styles.weekViewNowSegment}
                        style={{ top: nowTop, opacity: isToday ? 1 : 0.15 }}
                      />
                      {/* Dot only on today */}
                      {isToday && (
                        <div className={styles.weekViewNowDot} style={{ top: nowTop }} />
                      )}



                      {/* Event blocks */}
                      {posEvents.map(ev => (
                        <div
                          key={ev.id}
                          className={`${styles.weekViewBlock}${ev.type === 'soma' ? ` ${styles.weekViewBlockSoma}` : ` ${styles.weekViewBlockGcal}`}`}
                          style={{
                            top: ev.top,
                            height: ev.height,
                            left: `calc(${ev.left * 100}% + 2px)`,
                            width: `calc(${ev.width * 100}% - 3px)`,
                            background: ev.color,
                            borderColor: ev.borderColor,
                          }}
                          tabIndex={ev.type === 'soma' && ev.block ? 0 : undefined}
                          role={ev.type === 'soma' && ev.block ? 'button' : undefined}
                          onClick={e => {
                            e.stopPropagation();
                            if (ev.type === 'soma' && ev.block) {
                              const subjects = storage.getSubjects();
                              const subject = subjects.find(s => s.id === ev.block!.subjectId);
                              setWeekBlockModal({ block: ev.block, subject });
                              setWeekBlockEditMode(false);
                            }
                          }}
                          onKeyDown={e => {
                            if ((e.key === 'Enter' || e.key === ' ') && ev.type === 'soma' && ev.block) {
                              e.preventDefault();
                              e.stopPropagation();
                              const subjects = storage.getSubjects();
                              const subject = subjects.find(s => s.id === ev.block!.subjectId);
                              setWeekBlockModal({ block: ev.block, subject });
                              setWeekBlockEditMode(false);
                            }
                          }}
                          title={[ev.label, ev.sublabel].filter(Boolean).join(': ')}
                        >
                          <span className={styles.weekViewBlockLabel} style={{ color: ev.textColor }}>{ev.label}</span>
                          {ev.sublabel && ev.height >= 30 && (
                            <span className={styles.weekViewBlockSub} style={{ color: ev.textColor, opacity: 0.75 }}>{ev.sublabel}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
                    </>
                  );
              })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Week Block Modal ── */}
      {weekBlockModal && (
        <div className={styles.weekModalOverlay} onClick={() => { setWeekBlockModal(null); setWeekBlockEditMode(false); }}>
          <div
            className={styles.weekModalBox}
            onClick={e => e.stopPropagation()}
            ref={weekModalBoxRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="week-modal-title"
          >
            <div className={styles.weekModalHeader}>
              <span className={styles.weekModalTitle} id="week-modal-title">Time Block</span>
              {weekBlockModal.subject && (
                <span className={styles.weekModalSubjectChip}>
                  <span className={styles.weekModalSubjectDot} style={{ background: weekBlockModal.subject.color }} />
                  {weekBlockModal.subject.name}
                </span>
              )}
            </div>

            {weekBlockEditMode ? (
              <>
                <div className={styles.weekModalField}>
                  <label className={styles.weekModalLabel}>Task</label>
                  <input
                    className={styles.weekModalInput}
                    value={weekBlockEditForm.task}
                    placeholder="Task name"
                    autoFocus
                    onChange={e => setWeekBlockEditForm(f => ({ ...f, task: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') saveWeekBlockEdit(); }}
                  />
                </div>
                <div className={styles.weekModalField}>
                  <label className={styles.weekModalLabel}>Start</label>
                  <div className={styles.weekModalTimeRow}>
                    <input type="number" className={styles.weekModalTimeInput} value={weekBlockEditForm.startHour} min={1} max={12}
                      onChange={e => setWeekBlockEditForm(f => ({ ...f, startHour: Math.min(12, Math.max(1, Number(e.target.value) || 1)) }))} />
                    <span>:</span>
                    <input type="number" className={styles.weekModalTimeInput} value={String(weekBlockEditForm.startMinute).padStart(2, '0')} min={0} max={59}
                      onChange={e => setWeekBlockEditForm(f => ({ ...f, startMinute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) }))} />
                    <div className={styles.weekModalAmpm}>
                      <button className={`${styles.weekModalAmpmBtn}${weekBlockEditForm.startAmPm === 'AM' ? ` ${styles.weekModalAmpmBtnActive}` : ''}`}
                        onClick={() => setWeekBlockEditForm(f => ({ ...f, startAmPm: 'AM' }))}>AM</button>
                      <button className={`${styles.weekModalAmpmBtn}${weekBlockEditForm.startAmPm === 'PM' ? ` ${styles.weekModalAmpmBtnActive}` : ''}`}
                        onClick={() => setWeekBlockEditForm(f => ({ ...f, startAmPm: 'PM' }))}>PM</button>
                    </div>
                  </div>
                </div>
                <div className={styles.weekModalField}>
                  <label className={styles.weekModalLabel}>End</label>
                  <div className={styles.weekModalTimeRow}>
                    <input type="number" className={styles.weekModalTimeInput} value={weekBlockEditForm.endHour} min={1} max={12}
                      onChange={e => setWeekBlockEditForm(f => ({ ...f, endHour: Math.min(12, Math.max(1, Number(e.target.value) || 1)) }))} />
                    <span>:</span>
                    <input type="number" className={styles.weekModalTimeInput} value={String(weekBlockEditForm.endMinute).padStart(2, '0')} min={0} max={59}
                      onChange={e => setWeekBlockEditForm(f => ({ ...f, endMinute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) }))} />
                    <div className={styles.weekModalAmpm}>
                      <button className={`${styles.weekModalAmpmBtn}${weekBlockEditForm.endAmPm === 'AM' ? ` ${styles.weekModalAmpmBtnActive}` : ''}`}
                        onClick={() => setWeekBlockEditForm(f => ({ ...f, endAmPm: 'AM' }))}>AM</button>
                      <button className={`${styles.weekModalAmpmBtn}${weekBlockEditForm.endAmPm === 'PM' ? ` ${styles.weekModalAmpmBtnActive}` : ''}`}
                        onClick={() => setWeekBlockEditForm(f => ({ ...f, endAmPm: 'PM' }))}>PM</button>
                    </div>
                  </div>
                </div>
                <button className={styles.weekModalSubmit} onClick={saveWeekBlockEdit}>Save Changes</button>
                <button className={styles.weekModalCancel} onClick={() => setWeekBlockEditMode(false)}>Cancel</button>
              </>
            ) : (
              <>
                {weekBlockModal.block.task && (
                  <div className={styles.weekModalTask}>{weekBlockModal.block.task}</div>
                )}
                <div className={styles.weekModalInfo}>
                  <div className={styles.weekModalInfoRow}>
                    <span className={styles.weekModalInfoLabel}>Time</span>
                    <span className={styles.weekModalInfoValue}>
                      {fmtTime(weekBlockModal.block.startTime)} – {fmtTime(weekBlockModal.block.endTime)}
                    </span>
                  </div>
                  <div className={styles.weekModalInfoRow}>
                    <span className={styles.weekModalInfoLabel}>Duration</span>
                    <span className={styles.weekModalInfoValue}>
                      {fmtDuration(weekBlockModal.block.startTime, weekBlockModal.block.endTime)}
                    </span>
                  </div>
                </div>
                <div className={styles.weekModalActions}>
                  <button className={styles.weekModalEditBtn} onClick={() => openWeekBlockEdit(weekBlockModal.block)}>Edit</button>
                  <button className={styles.weekModalDeleteBtn} onClick={() => deleteWeekBlock(weekBlockModal.block.id)}>Delete</button>
                </div>
                <button className={styles.weekModalCancel} onClick={() => setWeekBlockModal(null)}>Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
