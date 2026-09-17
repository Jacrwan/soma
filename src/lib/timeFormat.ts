import { useEffect, useState } from 'react';

export type TimeFormat = '12h' | '24h';

// Read straight from localStorage rather than through `storage`. The standalone
// /dashboard-v2 mock renders without the app shell and must issue no backend
// requests, so this module must not pull in the Supabase client.
const SETTINGS_KEY = 'soma_settings';

/** Fired after the preference changes so open views re-render immediately. */
export const TIME_FORMAT_EVENT = 'soma_time_format_changed';

// Clock labels are rendered in tight loops (the calendar grid draws 24 of them
// per week view), so the preference is cached rather than re-read per call.
let cached: TimeFormat | null = null;

function read(): TimeFormat {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return '12h';
    return (JSON.parse(raw) as { timeFormat?: string }).timeFormat === '24h' ? '24h' : '12h';
  } catch {
    return '12h'; // unreadable or blocked storage falls back to the default
  }
}

export function getTimeFormat(): TimeFormat {
  if (cached === null) cached = read();
  return cached;
}

/** Update the cache and tell open views, after the caller has persisted it. */
export function applyTimeFormat(next: TimeFormat) {
  cached = next;
  window.dispatchEvent(new Event(TIME_FORMAT_EVENT));
}

/**
 * Format an hour and minute for display.
 *
 * Planned sessions store their times as canonical 24-hour `HH:MM` strings and
 * that representation is also parsed back (overlap grouping, saving a block,
 * `<input type="time">` values). Formatting therefore happens only at render
 * time — never by changing the stored value.
 */
export function formatHourMinute(hours: number, minutes: number, format = getTimeFormat()): string {
  const mm = String(minutes).padStart(2, '0');
  if (format === '24h') return `${String(hours).padStart(2, '0')}:${mm}`;
  return `${hours % 12 || 12}:${mm} ${hours >= 12 ? 'PM' : 'AM'}`;
}

/** `"13:30"` → `"1:30 PM"` or `"13:30"`. Unparseable input is returned as-is. */
export function formatClock(hhmm: string, format = getTimeFormat()): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return formatHourMinute(h, m, format);
}

/** `"13:00–14:00"` → `"1:00 PM–2:00 PM"`. Empty (unscheduled) stays empty. */
export function formatClockRange(range: string, format = getTimeFormat()): string {
  if (!range) return range;
  return range.split('–').map(part => formatClock(part, format)).join('–');
}

/** Whole-hour axis label, e.g. `"3 PM"` or `"15:00"`. */
export function formatHourLabel(hour: number, format = getTimeFormat()): string {
  if (format === '24h') return `${String(hour).padStart(2, '0')}:00`;
  return `${hour % 12 || 12} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function formatDateTime(date: Date, format = getTimeFormat()): string {
  return formatHourMinute(date.getHours(), date.getMinutes(), format);
}

/** The live header clock: seconds and time-zone abbreviation are required. */
export function formatClockWithSeconds(date: Date, format = getTimeFormat()): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'short', hour12: format === '12h',
  });
}

/** Re-renders the calling component when the preference changes. */
export function useTimeFormat(): TimeFormat {
  const [format, setFormat] = useState<TimeFormat>(getTimeFormat);
  useEffect(() => {
    const sync = () => { cached = read(); setFormat(cached); };
    window.addEventListener(TIME_FORMAT_EVENT, sync);
    window.addEventListener('storage', sync); // another tab changed it
    return () => {
      window.removeEventListener(TIME_FORMAT_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return format;
}
