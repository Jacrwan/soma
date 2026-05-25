import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { storage } from '../../lib/storage';
import { supabase } from '../../lib/supabase';
import { getEvents, getWeekRange, isCacheStale } from '../../lib/googleCalendar';
import { TimeBlock, Subject, GoogleCalendarEvent } from '../../types';
import styles from './CalendarTab.module.css';

type ViewMode = 'month' | 'week';

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
const GCAL_COLOR = '#1a73e8';
const CANVAS_COLOR = '#f4511e';
const MAX_CHIPS = 3;
const FILTER_KEY = 'soma_calendar_filters';

const WEEK_SLOT_HEIGHT = 60;
const WEEK_TOTAL_HOURS = 24;
const WEEK_GRID_HEIGHT = WEEK_TOTAL_HOURS * WEEK_SLOT_HEIGHT;
const weekHourSlots = Array.from({ length: WEEK_TOTAL_HOURS }, (_, i) => {
  const ampm = i >= 12 ? 'PM' : 'AM';
  const h12 = i % 12 || 12;
  return { label: i === 0 ? '' : `${h12} ${ampm}` };
});

function weekMinToTop(clockMinutes: number): number {
  return (clockMinutes / 60) * WEEK_SLOT_HEIGHT;
}

function isOnDate(iso: string, date: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === date.getFullYear()
    && d.getMonth() === date.getMonth()
    && d.getDate() === date.getDate();
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
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

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function getSundayOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
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
  const [token, setToken] = useState(() => storage.getGoogleToken());
  const [gcalLoading, setGcalLoading] = useState(false);
  const [gcalError, setGcalError] = useState('');

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const d = new Date(selectedDate);
    d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });
  const [viewWeekStart, setViewWeekStart] = useState<Date>(() => getSundayOfWeek(selectedDate));
  const [filters, setFilters] = useState<Filters>(() => loadFilters());
  const [dataVersion, setDataVersion] = useState(0);

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

  const weekGridRef = useRef<HTMLDivElement>(null);
  const weekModalBoxRef = useRef<HTMLDivElement>(null);
  const preModalFocusRef = useRef<HTMLElement | null>(null);

  const isConnected = !!token;

  // On mount (and after OAuth redirect back), pull provider_token from session
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const pt = data.session?.provider_token;
      if (pt) {
        storage.setGoogleToken(pt);
        setToken(pt);
      }
    });
  }, []);

  useEffect(() => {
    const handler = () => setDataVersion(v => v + 1);
    window.addEventListener('soma_gcal_updated', handler);
    return () => window.removeEventListener('soma_gcal_updated', handler);
  }, []);

  useEffect(() => {
    if (!token) return;
    if (!isCacheStale(storage.getGoogleCacheTimestamp())) return;
    fetchGcalEvents(token);
  }, [token]);

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

  // Auto-scroll to current time when entering week view
  useEffect(() => {
    if (viewMode !== 'week' || !weekGridRef.current) return;
    const now = new Date();
    const scrollTop = Math.max(0, weekMinToTop(now.getHours() * 60 + now.getMinutes()) - 200);
    weekGridRef.current.scrollTop = scrollTop;
  }, [viewMode, viewWeekStart]);

  async function fetchGcalEvents(tk: string) {
    setGcalLoading(true);
    setGcalError('');
    try {
      const { timeMin, timeMax } = getWeekRange();
      const data = await getEvents(tk, timeMin, timeMax);
      storage.setCachedGoogleEvents(data);
      storage.setGoogleCacheTimestamp(Date.now());
      setDataVersion(v => v + 1);
      window.dispatchEvent(new CustomEvent('soma_gcal_updated'));
    } catch (err) {
      if (err instanceof Error && err.message === 'auth') {
        storage.setGoogleToken('');
        setToken('');
      } else {
        setGcalError('Could not load Google Calendar events.');
      }
    } finally {
      setGcalLoading(false);
    }
  }

  async function connectGcal() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/calendar.readonly',
        redirectTo: window.location.href,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
  }

  function handleDisconnect() {
    storage.setGoogleToken('');
    storage.setCachedGoogleEvents([]);
    storage.setGoogleCacheTimestamp(0);
    setToken('');
    setDataVersion(v => v + 1);
    window.dispatchEvent(new CustomEvent('soma_gcal_updated'));
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
        add(new Date(dt), { id: `gcal-${e.id}`, label: e.summary ?? '(No title)', bgColor: GCAL_COLOR, type: 'gcal', sortKey: new Date(dt).getTime() });
      }
    }
    if (filters.canvas) {
      for (const a of assignments) {
        if (!a.dueAt) continue;
        add(new Date(a.dueAt), { id: `canvas-${a.id}`, label: a.name, bgColor: CANVAS_COLOR, type: 'canvas', sortKey: new Date(a.dueAt).getTime() });
      }
    }
    if (filters.soma) {
      for (const b of blocks) {
        if (!b.startTime) continue;
        const subj = subjects.find(s => s.id === b.subjectId);
        add(new Date(b.startTime), { id: `soma-${b.id}`, label: b.task || subj?.name || 'Block', bgColor: subj?.color ?? '#9e9e9e', type: 'soma', sortKey: new Date(b.startTime).getTime() });
      }
    }
    for (const chips of map.values()) chips.sort((a, b) => a.sortKey - b.sortKey);
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, dataVersion]);

  const getPositionedEventsForDay = useCallback((day: Date): {
    events: PositionedEvent[];
    dots: { id: string; color: string; top: number }[];
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
    const dots: { id: string; color: string; top: number }[] = [];

    if (filters.soma) {
      for (const b of blocks) {
        if (!b.startTime || !isOnDate(b.startTime, day)) continue;
        if (b.source === 'canvas') continue;
        const start = new Date(b.startTime);
        const end = new Date(b.endTime);
        const startMin = start.getHours() * 60 + start.getMinutes();
        const endMin = end.getHours() * 60 + end.getMinutes();
        const durMin = endMin - startMin;

        if (durMin < 5) {
          const subject = subjects.find(s => s.id === b.subjectId);
          const dotColor = subject?.color ?? '#9e9e9e';
          dots.push({ id: `dot-soma-${b.id}`, color: dotColor, top: weekMinToTop(startMin) });
          continue;
        }

        const subject = subjects.find(s => s.id === b.subjectId);
        const baseColor = subject?.color ?? '#9e9e9e';
        const label = (subject?.name ?? b.task) || 'Block';
        const sublabel = b.task && b.task !== subject?.name ? b.task : undefined;

        events.push({
          id: `soma-${b.id}`,
          type: 'soma',
          label,
          sublabel,
          color: `${baseColor}26`,
          borderColor: baseColor,
          textColor: baseColor,
          startMin,
          endMin: endMin > startMin ? endMin : startMin + 30,
          block: b,
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

        if (durMin < 5) {
          dots.push({ id: `dot-gcal-${e.id}`, color: GCAL_COLOR, top: weekMinToTop(startMin) });
          continue;
        }

        events.push({
          id: `gcal-${e.id}`,
          type: 'gcal',
          label: e.summary ?? '(No title)',
          color: GCAL_COLOR,
          textColor: 'oklch(99% 0.003 0)',
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
      dots,
    };
  }, [filters]);

  function goToPrev() {
    if (viewMode === 'month') {
      setViewMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    } else {
      setViewWeekStart(d => addDays(d, -7));
    }
  }

  function goToNext() {
    if (viewMode === 'month') {
      setViewMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    } else {
      setViewWeekStart(d => addDays(d, 7));
    }
  }

  function goToToday() {
    const today = new Date();
    if (viewMode === 'month') {
      setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    } else {
      setViewWeekStart(getSundayOfWeek(today));
    }
  }

  function switchViewMode(mode: ViewMode) {
    if (mode === 'week') {
      setViewWeekStart(getSundayOfWeek(viewMonth));
    } else {
      setViewMonth(new Date(viewWeekStart.getFullYear(), viewWeekStart.getMonth(), 1));
    }
    setViewMode(mode);
  }

  function handleDayClick(date: Date) {
    onSelectDate(date);
    onSwitchToToday();
  }

  const headerTitle = viewMode === 'month'
    ? `${MONTH_NAMES[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`
    : (() => {
        const end = addDays(viewWeekStart, 6);
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
    () => Array.from({ length: 7 }, (_, i) => addDays(viewWeekStart, i)),
    [viewWeekStart],
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
          <button className={styles.navArrow} onClick={goToPrev} aria-label={viewMode === 'month' ? 'Previous month' : 'Previous week'}>‹</button>
          <button className={styles.navArrow} onClick={goToNext} aria-label={viewMode === 'month' ? 'Next month' : 'Next week'}>›</button>
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
        >Canvas</button>
        <button
          className={`${styles.filterPill}${filters.soma ? ` ${styles.filterPillActive}` : ''}`}
          onClick={() => toggleFilter('soma')}
          aria-pressed={filters.soma}
        >Soma</button>
        {isConnected && (
          <button className={styles.disconnectBtn} onClick={handleDisconnect}>Disconnect Google</button>
        )}
        {gcalLoading && <span className={styles.gcalLoading} role="status" aria-live="polite">↻ Syncing…</span>}
        {gcalError && (
          <>
            <span className={styles.gcalError} role="alert">{gcalError}</span>
            <button className={styles.gcalRetryBtn} onClick={() => token && fetchGcalEvents(token)}>Retry</button>
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

      {/* ── Week view ── */}
      {viewMode === 'week' && (
        <div className={styles.weekViewOuter}>

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

          {/* All-day row (Canvas assignments) */}
          {filters.canvas && (() => {
            const assignments = storage.getCachedAssignments();
            const hasAny = weekDays.some(day =>
              assignments.some(a => a.dueAt && isSameDay(new Date(a.dueAt), day))
            );
            if (!hasAny) return null;
            return (
              <div className={styles.weekViewAllDayRow}>
                <div className={styles.weekViewAllDayLabel}>all-day</div>
                {weekDays.map((day, i) => {
                  const chips = assignments.filter(a => a.dueAt && isSameDay(new Date(a.dueAt), day));
                  return (
                    <div key={i} className={styles.weekViewAllDayCell}>
                      {chips.map(a => (
                        <span key={a.id} className={styles.weekViewAllDayChip} title={a.name}>{a.name}</span>
                      ))}
                    </div>
                  );
                })}
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
                  const { events: posEvents, dots: posDots } = weekPositionedDays[dayIndex];

                  return (
                    <div
                      key={dayIndex}
                      className={`${styles.weekViewDayCol}${isToday ? ` ${styles.weekViewDayColToday}` : ` ${styles.weekViewDayColOther}`}`}
                      onClick={() => handleDayClick(day)}
                    >

                      {/* Short-session dots — stacked when within 5 min of each other */}
                      {(() => {
                        const sorted = [...posDots].sort((a, b) => a.top - b.top);
                        const positioned: { dot: typeof posDots[0]; renderTop: number }[] = [];
                        let groupBase = -Infinity;
                        let groupCount = 0;
                        for (const dot of sorted) {
                          if (dot.top - groupBase > 5) {
                            groupBase = dot.top;
                            groupCount = 0;
                          }
                          positioned.push({ dot, renderTop: groupBase + groupCount * 8 });
                          groupCount++;
                        }
                        return positioned.map(({ dot, renderTop }) => (
                          <div
                            key={dot.id}
                            className={styles.weekViewDot}
                            style={{ top: renderTop, background: dot.color }}
                          />
                        ));
                      })()}

                      {/* Event blocks */}
                      {posEvents.map(ev => (
                        <div
                          key={ev.id}
                          className={`${styles.weekViewBlock}${ev.type === 'soma' ? ` ${styles.weekViewBlockSoma}` : ` ${styles.weekViewBlockGcal}`}`}
                          style={{
                            top: ev.top,
                            height: ev.height,
                            left: `calc(${ev.left * 100}% + 1px)`,
                            width: `calc(${ev.width * 100}% - 2px)`,
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
                    {todayInWeek && (
                      <>
                        <div className={styles.weekViewNowLine} style={{ top: nowTop }} />
                        <div className={styles.weekViewNowDot} style={{ top: nowTop }} />
                      </>
                    )}
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
