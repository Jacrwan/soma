/**
 * Things Soma can get ready for the student to do in their own apps: an
 * email draft, a calendar event. Soma never sends or saves them itself. Each
 * becomes a card whose buttons open the student's mail or calendar with
 * everything filled in, and the student sends or saves it there. That click
 * is the approval.
 *
 * No new permissions: Google Calendar's "add event" link and an .ics file
 * work with read-only calendar access, and mailto: and Gmail's compose link
 * need none.
 *
 * Everything here comes from the model, so it's checked like anything
 * untrusted: known kinds only, real-looking addresses, lengths capped, dates
 * and times in their exact formats.
 */

export type EmailAction = { kind: 'email'; to: string; subject: string; body: string; why?: string };
export type CalendarAction = { kind: 'calendar'; title: string; date: string; start?: string; end?: string; details?: string };
export type AgentAction = EmailAction | CalendarAction;

const MAX_ACTIONS = 3;
const str = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '';
const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The actions in a reply, checked; anything malformed is left out. */
export function parseActions(raw: unknown): AgentAction[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || out.length >= MAX_ACTIONS) continue;
    const a = item as Record<string, unknown>;
    if (a.kind === 'email') {
      // Up to three addresses, only ones that look real; an empty "to" is
      // fine: the student fills it in.
      const to = str(a.to, 300).split(/[,;\s]+/).filter(x => EMAIL.test(x)).slice(0, 3).join(',');
      const subject = str(a.subject, 150), body = str(a.body, 3000);
      if (!subject || !body) continue;
      out.push({ kind: 'email', to, subject, body, ...(str(a.why, 200) ? { why: str(a.why, 200) } : {}) });
    } else if (a.kind === 'calendar') {
      const title = str(a.title, 120), date = str(a.date, 10);
      if (!title || !DATE.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00`))) continue;
      const start = CLOCK.test(str(a.start, 5)) ? str(a.start, 5) : undefined;
      const end = start && CLOCK.test(str(a.end, 5)) ? str(a.end, 5) : undefined;
      out.push({ kind: 'calendar', title, date, ...(start ? { start } : {}), ...(end ? { end } : {}), ...(str(a.details, 1000) ? { details: str(a.details, 1000) } : {}) });
    }
  }
  return out;
}

// ── Email ───────────────────────────────────────────────────────────────────

export function mailtoLink(a: EmailAction): string {
  const q = new URLSearchParams({ subject: a.subject, body: a.body }).toString().replace(/\+/g, '%20');
  return `mailto:${a.to.split(',').map(encodeURIComponent).join(',')}?${q}`;
}

export function gmailLink(a: EmailAction): string {
  const q = new URLSearchParams({ view: 'cm', fs: '1', to: a.to, su: a.subject, body: a.body });
  return `https://mail.google.com/mail/?${q.toString()}`;
}

// ── Calendar ────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
/** Local wall time as an iCalendar/Google "floating" stamp: 20261029T190000. */
const stamp = (date: string, clock: string) => `${date.replace(/-/g, '')}T${clock.replace(':', '')}00`;
const nextDay = (date: string) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + 1); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };
/** An event's start and end: a timed one an hour long unless an end is given; otherwise all day. */
function span(a: CalendarAction): [string, string] {
  if (!a.start) return [a.date.replace(/-/g, ''), nextDay(a.date)];
  if (a.end && a.end > a.start) return [stamp(a.date, a.start), stamp(a.date, a.end)];
  const [h, m] = a.start.split(':').map(Number);
  const endMin = Math.min(h * 60 + m + 60, 23 * 60 + 59);
  return [stamp(a.date, a.start), stamp(a.date, `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`)];
}

export function googleCalendarLink(a: CalendarAction): string {
  const [from, to] = span(a);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: a.title, dates: `${from}/${to}`, ...(a.details ? { details: a.details } : {}) });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** Text that is safe inside an .ics field: escaped, one line, folded at 74 characters. */
function icsText(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
function fold(line: string) {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 74) out.push((i ? ' ' : '') + line.slice(i, i + 74));
  return out.join('\r\n');
}

/** An .ics file for Apple Calendar, Outlook and anything else. */
export function icsFile(a: CalendarAction, uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@somastudy.app`): string {
  const [from, to] = span(a);
  const allDay = !a.start;
  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Soma//Study planner//EN', 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${dtstamp}`,
    allDay ? `DTSTART;VALUE=DATE:${from}` : `DTSTART:${from}`,
    allDay ? `DTEND;VALUE=DATE:${to}` : `DTEND:${to}`,
    fold(`SUMMARY:${icsText(a.title)}`),
    ...(a.details ? [fold(`DESCRIPTION:${icsText(a.details)}`)] : []),
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

/** "Thu, Oct 29, 7:00 PM" or "Thu, Oct 29 (all day)". */
export function whenLabel(a: CalendarAction): string {
  const d = new Date(`${a.date}T${a.start ?? '12:00'}:00`);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (!a.start) return `${day} (all day)`;
  const t = (c: string) => new Date(`${a.date}T${c}:00`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${t(a.start)}${a.end ? `–${t(a.end)}` : ''}`;
}
