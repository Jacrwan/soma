import { GoogleCalendarEvent } from '../types';

const GCAL_CACHE_MAX_AGE = 15 * 60 * 1000;

export async function getEvents(
  token: string,
  timeMin: string,
  timeMax: string,
): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    if (res.status === 401) throw new Error('auth');
    throw new Error(`Google Calendar error: ${res.status}`);
  }
  const data = await res.json();
  return (data.items ?? []) as GoogleCalendarEvent[];
}

export function getWeekRange(): { timeMin: string; timeMax: string } {
  const now = new Date();
  const day = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 7);
  return { timeMin: mon.toISOString(), timeMax: sun.toISOString() };
}

export function isCacheStale(timestamp: number | null): boolean {
  if (!timestamp) return true;
  return Date.now() - timestamp > GCAL_CACHE_MAX_AGE;
}
