import { useState, useEffect, useRef, useMemo } from 'react';
import { storage } from '../../lib/storage';
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
  const [clientId, setClientId] = useState(() => storage.getGoogleClientId());
  const [setupClientId, setSetupClientId] = useState('');
  const [showConnect, setShowConnect] = useState(false);
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

  const isConnected = !!token;

  useEffect(() => {
    const messageHandler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'soma_google_auth' && e.data.token) {
        storage.setGoogleToken(e.data.token);
        setToken(e.data.token);
        setShowConnect(false);
      }
    };
    const customHandler = (e: Event) => {
      const t = (e as CustomEvent).detail?.token;
      if (t) { setToken(t); setShowConnect(false); }
    };
    window.addEventListener('message', messageHandler);
    window.addEventListener('soma_google_auth', customHandler);
    return () => {
      window.removeEventListener('message', messageHandler);
      window.removeEventListener('soma_google_auth', customHandler);
    };
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setWeekBlockModal(null); setWeekBlockEditMode(false); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
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

  function openOAuthPopup() {
    const id = setupClientId.trim() || clientId;
    if (!id) return;
    storage.setGoogleClientId(id);
    setClientId(id);
    const params = new URLSearchParams({
      client_id: id,
      redirect_uri: window.location.origin,
      response_type: 'token',
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      include_granted_scopes: 'true',
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    const popup = window.open(url, 'google_oauth', 'width=500,height=600,left=200,top=100');
    if (!popup) window.location.href = url;
  }

  function handleDisconnect() {
    storage.setGoogleToken('');
    storage.setGoogleClientId('');
    storage.setCachedGoogleEvents([]);
    storage.setGoogleCacheTimestamp(0);
    setToken('');
    setClientId('');
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

  function getPositionedEventsForDay(day: Date): PositionedEvent[] {
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
      startMin: number;
      endMin: number;
      block?: TimeBlock;
      gcalEvent?: GoogleCalendarEvent;
      col?: number;
    }

    const events: RawEvent[] = [];

    if (filters.soma) {
      for (const b of blocks) {
        if (!b.startTime || !isOnDate(b.startTime, day)) continue;
        const start = new Date(b.startTime);
        const end = new Date(b.endTime);
        const startMin = start.getHours() * 60 + start.getMinutes();
        let endMin = end.getHours() * 60 + end.getMinutes();
        if (endMin <= startMin) endMin = startMin + 30;
        const subject = subjects.find(s => s.id === b.subjectId);
        const baseColor = subject?.color ?? '#9e9e9e';
        events.push({
          id: `soma-${b.id}`,
          type: 'soma',
          label: subject?.name ?? 'Block',
          sublabel: b.task && b.task !== subject?.name ? b.task : undefined,
          color: `${baseColor}d9`,
          borderColor: baseColor,
          startMin,
          endMin,
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
        let endMin = end.getHours() * 60 + end.getMinutes();
        if (endMin <= startMin) endMin = startMin + 30;
        events.push({
          id: `gcal-${e.id}`,
          type: 'gcal',
          label: e.summary ?? '(No title)',
          color: GCAL_COLOR,
          startMin,
          endMin,
          gcalEvent: e,
        });
      }
    }

    events.sort((a, b) => a.startMin - b.startMin);

    // Greedy column placement for overlap layout
    const cols: RawEvent[][] = [];
    for (const ev of events) {
      let placed = false;
      for (let c = 0; c < cols.length; c++) {
        const last = cols[c][cols[c].length - 1];
        if (last.endMin <= ev.startMin) {
          cols[c].push(ev);
          ev.col = c;
          placed = true;
          break;
        }
      }
      if (!placed) {
        ev.col = cols.length;
        cols.push([ev]);
      }
    }

    const numCols = Math.max(cols.length, 1);
    return events.map(ev => ({
      id: ev.id,
      type: ev.type,
      label: ev.label,
      sublabel: ev.sublabel,
      color: ev.color,
      borderColor: ev.borderColor,
      top: weekMinToTop(ev.startMin),
      height: Math.max(((ev.endMin - ev.startMin) / 60) * WEEK_SLOT_HEIGHT, 18),
      left: (ev.col ?? 0) / numCols,
      width: 1 / numCols,
      block: ev.block,
      gcalEvent: ev.gcalEvent,
    }));
  }

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

  // Hour slots for the week time grid
  const weekHourSlots = Array.from({ length: WEEK_TOTAL_HOURS }, (_, i) => {
    const ampm = i >= 12 ? 'PM' : 'AM';
    const h12 = i % 12 || 12;
    return { label: i === 0 ? '' : `${h12} ${ampm}` };
  });

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
  const todayColIndex = weekDays.findIndex(d => isSameDay(d, today));

  return (
    <div className={styles.container}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.navArrow} onClick={goToPrev}>‹</button>
          <button className={styles.navArrow} onClick={goToNext}>›</button>
          <span className={styles.navTitle}>{headerTitle}</span>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.todayBtn} onClick={goToToday}>Today</button>
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewToggleBtn}${viewMode === 'month' ? ` ${styles.viewToggleBtnActive}` : ''}`}
              onClick={() => switchViewMode('month')}
            >Month</button>
            <button
              className={`${styles.viewToggleBtn}${viewMode === 'week' ? ` ${styles.viewToggleBtnActive}` : ''}`}
              onClick={() => switchViewMode('week')}
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
          >Google Calendar</button>
        ) : (
          <button
            className={`${styles.filterPill} ${styles.filterPillConnect}`}
            onClick={() => setShowConnect(v => !v)}
          >+ Connect Google Calendar</button>
        )}
        <button
          className={`${styles.filterPill}${filters.canvas ? ` ${styles.filterPillActive}` : ''}`}
          style={filters.canvas ? { background: CANVAS_COLOR, borderColor: CANVAS_COLOR } : {}}
          onClick={() => toggleFilter('canvas')}
        >Canvas</button>
        <button
          className={`${styles.filterPill}${filters.soma ? ` ${styles.filterPillActive}` : ''}`}
          onClick={() => toggleFilter('soma')}
        >Soma</button>
        {isConnected && (
          <button className={styles.disconnectBtn} onClick={handleDisconnect}>Disconnect Google</button>
        )}
        {gcalLoading && <span className={styles.gcalLoading}>↻ Syncing…</span>}
        {gcalError && <span className={styles.gcalError}>{gcalError}</span>}
      </div>

      {/* ── Connect card ── */}
      {showConnect && !isConnected && (
        <div className={styles.connectCard}>
          <span className={styles.connectTitle}>Connect Google Calendar</span>
          <div className={styles.connectRow}>
            <input
              className={styles.connectInput}
              placeholder="OAuth 2.0 Client ID"
              value={setupClientId || clientId}
              onChange={e => setSetupClientId(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') openOAuthPopup(); if (e.key === 'Escape') setShowConnect(false); }}
            />
            <button className={styles.connectBtn} onClick={openOAuthPopup} disabled={!setupClientId.trim() && !clientId}>Connect</button>
            <button className={styles.connectCancel} onClick={() => setShowConnect(false)}>✕</button>
          </div>
          <span className={styles.connectHint}>
            Google Cloud Console → APIs &amp; Services → Credentials → OAuth 2.0 Client ID (Web).
            Add <code>{window.location.origin}</code> as authorized redirect URI and enable the Calendar API.
          </span>
        </div>
      )}

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
                  className={styles.weekViewDayHeader}
                  onClick={() => handleDayClick(day)}
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
                {weekDays.map((day, dayIndex) => {
                  const isToday = isSameDay(day, today);
                  const posEvents = getPositionedEventsForDay(day);
                  const nowTop = weekMinToTop(currentMinutes);

                  return (
                    <div
                      key={dayIndex}
                      className={`${styles.weekViewDayCol}${isToday ? ` ${styles.weekViewDayColToday}` : ''}`}
                      onClick={() => handleDayClick(day)}
                    >
                      {/* Current time indicator */}
                      {isToday && todayInWeek && (
                        <div className={styles.weekViewNowLine} style={{ top: nowTop }}>
                          <div className={styles.weekViewNowDot} />
                        </div>
                      )}

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
                            borderLeftColor: ev.borderColor,
                          }}
                          onClick={e => {
                            e.stopPropagation();
                            if (ev.type === 'soma' && ev.block) {
                              const subjects = storage.getSubjects();
                              const subject = subjects.find(s => s.id === ev.block!.subjectId);
                              setWeekBlockModal({ block: ev.block, subject });
                              setWeekBlockEditMode(false);
                            }
                          }}
                          title={[ev.label, ev.sublabel].filter(Boolean).join(': ')}
                        >
                          <span className={styles.weekViewBlockLabel}>{ev.label}</span>
                          {ev.sublabel && ev.height >= 30 && (
                            <span className={styles.weekViewBlockSub}>{ev.sublabel}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}

                {/* Current time line extension — spans from today column to right edge */}
                {todayInWeek && (() => {
                  const leftPercent = (todayColIndex / 7) * 100;
                  return (
                    <div
                      className={styles.weekViewNowLineExtension}
                      style={{ top: weekMinToTop(currentMinutes), left: `${leftPercent}%` }}
                    />
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
          <div className={styles.weekModalBox} onClick={e => e.stopPropagation()}>
            <div className={styles.weekModalHeader}>
              <span className={styles.weekModalTitle}>Time Block</span>
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
