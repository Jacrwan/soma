/// <reference types="node" />
import { getFreshAccessToken, type CalendarConnectionRow } from './_googleCalendarAuth';
import { zonedToUtc, type Busy } from './_placement';

/**
 * The student's Google Calendar events as busy time, for placing tasks Claude
 * adds (_connector.ts). The same calendars the dashboard shows: every one the
 * student selected, on every connected account. Only start and end are kept;
 * titles and details never leave this function.
 *
 * `complete` is false when any account or calendar could not be read. The app
 * refuses to accept an AI schedule in that state, and the connector does not
 * pick times in it either: a class it couldn't see is a class it would book over.
 */
export type CalendarRead = { busy: Busy[]; complete: boolean };

type Item = { status?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } };

async function eventsOf(accessToken: string, calendarId: string, timeMin: string, timeMax: string): Promise<Item[]> {
  const items: Item[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', fields: 'nextPageToken,items(status,start,end)', ...(pageToken ? { pageToken } : {}) });
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error('calendar_fetch_failed');
    const data = await res.json() as { items?: Item[]; nextPageToken?: string };
    items.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

export async function googleBusy(admin: any, userId: string, from: number, to: number, zone: string): Promise<CalendarRead> {
  const { data: connections, error } = await admin
    .from('google_calendar_connections')
    .select('id, user_id, google_email, refresh_token, access_token, access_token_expires_at, selected_calendars')
    .eq('user_id', userId);
  if (error) return { busy: [], complete: false };
  const busy: Busy[] = [];
  let complete = true;
  await Promise.all(((connections ?? []) as (CalendarConnectionRow & { selected_calendars: { id: string }[] | null })[]).map(async row => {
    const calendars = row.selected_calendars ?? [];
    if (!calendars.length) return;
    const accessToken = await getFreshAccessToken(admin, row).catch(() => null);
    if (!accessToken) { complete = false; return; }
    await Promise.all(calendars.map(async calendar => {
      const items = await eventsOf(accessToken, calendar.id, new Date(from).toISOString(), new Date(to).toISOString()).catch(() => { complete = false; return [] as Item[]; });
      for (const item of items) {
        if (item.status === 'cancelled') continue;
        // An all-day event has dates, not times: the dashboard draws it across the whole day.
        const start = item.start?.dateTime ? Date.parse(item.start.dateTime) : item.start?.date ? zonedToUtc(item.start.date, 0, zone) : NaN;
        const end = item.end?.dateTime ? Date.parse(item.end.dateTime) : item.end?.date ? zonedToUtc(item.end.date, 0, zone) : NaN;
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) busy.push([start, end]);
      }
    }));
  }));
  return { busy, complete };
}
