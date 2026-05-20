import { useState, useEffect, useMemo } from 'react';
import { storage } from '../../lib/storage';
import { getEvents, getWeekRange, isCacheStale } from '../../lib/googleCalendar';
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

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const GCAL_COLOR = '#1a73e8';
const CANVAS_COLOR = '#f4511e';
const MAX_CHIPS = 3;
const FILTER_KEY = 'soma_calendar_filters';

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
  // Google auth state
  const [token, setToken] = useState(() => storage.getGoogleToken());
  const [clientId, setClientId] = useState(() => storage.getGoogleClientId());
  const [setupClientId, setSetupClientId] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [gcalError, setGcalError] = useState('');

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const d = new Date(selectedDate);
    d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });
  const [viewWeekStart, setViewWeekStart] = useState<Date>(() => getSundayOfWeek(selectedDate));
  const [filters, setFilters] = useState<Filters>(() => loadFilters());
  const [dataVersion, setDataVersion] = useState(0);

  const isConnected = !!token;

  // OAuth listeners
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

  // Auto-fetch gcal events on connect; listen for updates
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

  // Chips by date (useMemo re-runs when filters or data changes)
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
        add(new Date(dt), {
          id: `gcal-${e.id}`,
          label: e.summary ?? '(No title)',
          bgColor: GCAL_COLOR,
          type: 'gcal',
          sortKey: new Date(dt).getTime(),
        });
      }
    }

    if (filters.canvas) {
      for (const a of assignments) {
        if (!a.dueAt) continue;
        add(new Date(a.dueAt), {
          id: `canvas-${a.id}`,
          label: a.name,
          bgColor: CANVAS_COLOR,
          type: 'canvas',
          sortKey: new Date(a.dueAt).getTime(),
        });
      }
    }

    if (filters.soma) {
      for (const b of blocks) {
        if (!b.startTime) continue;
        const subj = subjects.find(s => s.id === b.subjectId);
        add(new Date(b.startTime), {
          id: `soma-${b.id}`,
          label: b.task || subj?.name || 'Block',
          bgColor: subj?.color ?? '#9e9e9e',
          type: 'soma',
          sortKey: new Date(b.startTime).getTime(),
        });
      }
    }

    for (const chips of map.values()) {
      chips.sort((a, b) => a.sortKey - b.sortKey);
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, dataVersion]);

  // Navigation
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

  // Header title
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

  // Month grid: 6 weeks × 7 days starting from the Sunday of the week containing month's 1st
  const monthCells = useMemo(() => {
    const firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const gridStart = getSundayOfWeek(firstOfMonth);
    return Array.from({ length: 42 }, (_, i) => {
      const date = addDays(gridStart, i);
      return {
        date,
        isCurrentMonth: date.getMonth() === viewMonth.getMonth(),
      };
    });
  }, [viewMonth]);

  // Week grid: 7 days starting from viewWeekStart (Sunday)
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(viewWeekStart, i)),
    [viewWeekStart],
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
          <span
            key={chip.id}
            className={styles.chip}
            style={{ background: chip.bgColor }}
            title={chip.label}
          >
            {chip.label}
          </span>
        ))}
        {overflow > 0 && (
          <span className={styles.overflowChip}>+{overflow} more</span>
        )}
      </>
    );
  }

  return (
    <div className={styles.container}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
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

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
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

      {/* ── Connect card ───────────────────────────────────────────────── */}
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
            <button
              className={styles.connectBtn}
              onClick={openOAuthPopup}
              disabled={!setupClientId.trim() && !clientId}
            >Connect</button>
            <button className={styles.connectCancel} onClick={() => setShowConnect(false)}>✕</button>
          </div>
          <span className={styles.connectHint}>
            Google Cloud Console → APIs &amp; Services → Credentials → OAuth 2.0 Client ID (Web).
            Add <code>{window.location.origin}</code> as authorized redirect URI and enable the Calendar API.
          </span>
        </div>
      )}

      {/* ── Day-of-week header ─────────────────────────────────────────── */}
      <div className={styles.dayHeaders}>
        {DAY_NAMES.map(d => (
          <div key={d} className={styles.dayHeaderCell}>{d}</div>
        ))}
      </div>

      {/* ── Month grid ─────────────────────────────────────────────────── */}
      {viewMode === 'month' && (
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
              <div className={styles.chipsArea}>
                {renderChips(date)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Week grid ──────────────────────────────────────────────────── */}
      {viewMode === 'week' && (
        <div className={styles.weekGrid}>
          {weekDays.map((day, i) => (
            <div
              key={i}
              className={[
                styles.weekCell,
                isSameDay(day, today) ? styles.weekCellToday : '',
                isSameDay(day, selectedDate) ? styles.weekCellSelected : '',
              ].filter(Boolean).join(' ')}
              onClick={() => handleDayClick(day)}
            >
              <div className={styles.weekCellHeader}>
                {renderDayNum(day)}
              </div>
              <div className={styles.weekChipsArea}>
                {renderChips(day, 999)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
