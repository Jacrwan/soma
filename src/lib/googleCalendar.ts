import { GoogleCalendarEvent } from '../types';

const GCAL_CACHE_MAX_AGE = 86_400_000;

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
  const past = new Date(now);
  past.setFullYear(now.getFullYear() - 1);
  const future = new Date(now);
  future.setFullYear(now.getFullYear() + 1);
  return { timeMin: past.toISOString(), timeMax: future.toISOString() };
}

export function isCacheStale(timestamp: number | null): boolean {
  if (!timestamp) return true;
  return Date.now() - timestamp > GCAL_CACHE_MAX_AGE;
}
