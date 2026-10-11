/// <reference types="node" />
import { getFreshAccessToken, type CalendarConnectionRow } from './_googleCalendarAuth';
import { zonedToUtc } from './_placement';

/**
 * The student's Google Calendar events, for the Claude connector
 * (_connector.ts): shown to Claude in the plan, and treated as busy time when
 * Soma places a task Claude adds. The same calendars the dashboard shows:
 * every one the student selected, on every connected account. Only a title,
 * a start and an end are kept; descriptions, guests and locations are never
 * asked for.
 *
 * `complete` is false when any account or calendar could not be read. The app
 * refuses to accept an AI schedule in that state, and the connector does not
 * pick times in it either: a class it couldn't see is a class it would book over.
 */
export type CalendarEvent = { title: string; start: number; end: number; allDay?: boolean };
export type CalendarRead = { events: CalendarEvent[]; complete: boolean; connected: boolean };

type Item = { status?: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } };

async function eventsOf(accessToken: string, calendarId: string, timeMin: string, timeMax: string): Promise<Item[]> {
  const items: Item[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', fields: 'nextPageToken,items(status,summary,start,end)', ...(pageToken ? { pageToken } : {}) });
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error('calendar_fetch_failed');
    const data = await res.json() as { items?: Item[]; nextPageToken?: string };
    items.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

/** An event's name as one short line. It is someone else's text: shown, never obeyed. */
// eslint-disable-next-line no-control-regex
const titleOf = (summary: unknown) => (typeof summary === 'string' ? summary.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) : '') || 'Calendar commitment';

export async function googleEvents(admin: any, userId: string, from: number, to: number, zone: string): Promise<CalendarRead> {
  const { data: connections, error } = await admin
    .from('google_calendar_connections')
    .select('id, user_id, google_email, refresh_token, access_token, access_token_expires_at, selected_calendars')
    .eq('user_id', userId);
  if (error) return { events: [], complete: false, connected: true };
  const rows = ((connections ?? []) as (CalendarConnectionRow & { selected_calendars: { id: string }[] | null })[]).filter(row => row.selected_calendars?.length);
  const events: CalendarEvent[] = [];
  let complete = true;
  await Promise.all(rows.map(async row => {
    const accessToken = await getFreshAccessToken(admin, row).catch(() => null);
    if (!accessToken) { complete = false; return; }
    await Promise.all(row.selected_calendars!.map(async calendar => {
      const items = await eventsOf(accessToken, calendar.id, new Date(from).toISOString(), new Date(to).toISOString()).catch(() => { complete = false; return [] as Item[]; });
      for (const item of items) {
        if (item.status === 'cancelled') continue;
        // An all-day event has dates, not times: the dashboard draws it across the whole day.
        const allDay = !item.start?.dateTime && !!item.start?.date;
        const start = item.start?.dateTime ? Date.parse(item.start.dateTime) : item.start?.date ? zonedToUtc(item.start.date, 0, zone) : NaN;
        const end = item.end?.dateTime ? Date.parse(item.end.dateTime) : item.end?.date ? zonedToUtc(item.end.date, 0, zone) : NaN;
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) events.push({ title: titleOf(item.summary), start, end, ...(allDay ? { allDay: true } : {}) });
      }
    }));
  }));
  events.sort((a, b) => a.start - b.start || a.end - b.end);
  return { events, complete, connected: rows.length > 0 };
}
