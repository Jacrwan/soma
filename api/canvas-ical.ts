/// <reference types="node" />
import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { isRateLimited } from './_rateLimit';

const ALLOWED_ORIGINS = [
  'https://somastudy.app',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173'] : []),
];

// Canvas calendar feeds all share the same path shape regardless of which
// university hosts them — e.g. school.instructure.com, bruinlearn.ucla.edu,
// canvas.harvard.edu. The hostname is not a reliable signal, so we identify a
// Canvas feed by its path (/feeds/calendars/user_<token>.ics) and rely on the
// HTTPS + public-IP (SSRF) checks below to keep the fetch safe.
const CANVAS_FEED_PATH_RE = /\/feeds\/calendars\/user_[^/]+\.ics$/i;

function isPrivateIp(address: string): boolean {
  const ipType = net.isIP(address);
  if (ipType === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (ipType === 6) {
    const lower = address.toLowerCase();
    return (
      lower === '::1' || lower === '::' ||
      lower.startsWith('fc') || lower.startsWith('fd') ||
      lower.startsWith('fe8') || lower.startsWith('fe9') ||
      lower.startsWith('fea') || lower.startsWith('feb') ||
      lower.startsWith('::ffff:10.') ||
      lower.startsWith('::ffff:127.') ||
      lower.startsWith('::ffff:192.168.')
    );
  }
  return true;
}

function applyCors(req: any, res: any): boolean {
  const origin = req.headers['origin'] as string | undefined;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

async function isPublicHost(hostname: string): Promise<boolean> {
  if (net.isIP(hostname)) return !isPrivateIp(hostname);

  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    return records.length > 0 && records.every(record => !isPrivateIp(record.address));
  } catch {
    return false;
  }
}

// ── iCal parser ──────────────────────────────────────────────────────────────

function unfold(raw: string): string {
  // RFC 5545: CRLF + single whitespace = line continuation
  return raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function unescape(val: string): string {
  return val
    .replace(/\\n/g, '\n')
    .replace(/\\N/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function parsePropLine(line: string): { name: string; value: string } | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx < 0) return null;
  // Property name is everything before the first colon, minus any parameters
  const namePart = line.slice(0, colonIdx).split(';')[0].toUpperCase();
  const value = line.slice(colonIdx + 1);
  return { name: namePart, value };
}

function parseIcalDate(raw: string): string {
  const v = raw.trim();
  // DATE-TIME with Z: 20240118T045900Z
  const dtMatch = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (dtMatch) {
    const [, yr, mo, dy, hr, mi, se, z] = dtMatch;
    return `${yr}-${mo}-${dy}T${hr}:${mi}:${se}.000${z ? 'Z' : 'Z'}`;
  }
  // DATE only: 20240118
  const dMatch = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dMatch) {
    const [, yr, mo, dy] = dMatch;
    return `${yr}-${mo}-${dy}T23:59:00.000Z`;
  }
  return new Date(v).toISOString();
}

interface IcalEvent {
  uid: string;
  summary: string;
  dtstart: string;
  due: string;
  url: string;
  description: string;
}

function parseEvents(raw: string): IcalEvent[] {
  const unfolded = unfold(raw);
  const lines = unfolded.split(/\r?\n/);
  const events: IcalEvent[] = [];
  let inEvent = false;
  let current: Partial<IcalEvent> = {};

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      inEvent = false;
      if (current.uid && current.summary) {
        events.push({
          uid: current.uid,
          summary: unescape(current.summary),
          dtstart: current.dtstart ?? '',
          due: current.due || current.dtstart || '',
          url: current.url ?? '',
          description: unescape(current.description ?? ''),
        });
      }
      continue;
    }
    if (!inEvent) continue;

    const parsed = parsePropLine(line);
    if (!parsed) continue;
    const { name, value } = parsed;

    if (name === 'UID')         current.uid = value.trim();
    if (name === 'SUMMARY')     current.summary = value;
    if (name === 'DTSTART')     current.dtstart = parseIcalDate(value);
    if (name === 'DUE')         current.due = parseIcalDate(value);
    if (name === 'URL')         current.url = value.trim();
    if (name === 'DESCRIPTION') current.description = value;
  }

  return events;
}

// ── Map iCal events → CanvasAssignment ──────────────────────────────────────

function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h);
}

function extractIds(event: IcalEvent): { assignmentId: number; courseId: number } {
  // Try UID: event_assignment_123@school or assignment_123@school
  const uidMatch = event.uid.match(/assignment_(\d+)/i);
  const assignmentId = uidMatch ? parseInt(uidMatch[1], 10) : simpleHash(event.uid);

  // Try URL path: /courses/123/assignments/456
  const urlPathMatch = event.url.match(/\/courses\/(\d+)\//);
  // Try URL query: include_contexts=course_21576
  const urlQueryMatch = event.url.match(/course_(\d+)/);
  const courseId = urlPathMatch ? parseInt(urlPathMatch[1], 10)
    : urlQueryMatch ? parseInt(urlQueryMatch[1], 10)
    : 0;

  return { assignmentId, courseId };
}

function parseSummary(summary: string): { courseName: string; assignmentName: string } {
  // Canvas often formats feed summaries as:
  // "Assignment [Course Name]" or "Assignment Group: Assignment [Course Name]".
  // Prefer the bracketed class name over the prefix so groups like "Extra Credit"
  // do not become fake courses.
  const colonIdx = summary.indexOf(': ');
  const rawCourseName = colonIdx > 0 ? summary.slice(0, colonIdx).trim() : '';
  let assignmentName = colonIdx > 0 ? summary.slice(colonIdx + 2).trim() : summary.trim();
  let courseName = rawCourseName;

  const bracketMatch = assignmentName.match(/\s+\[([^\]]+)\]\s*$/);
  if (bracketMatch) {
    courseName = bracketMatch[1].trim();
    assignmentName = assignmentName.slice(0, bracketMatch.index).trim();
  }

  return { courseName, assignmentName };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth
  const authHeader = req.headers['authorization'] as string | undefined;
  const sbToken = authHeader?.replace('Bearer ', '') ?? '';
  if (!sbToken) return res.status(401).json({ error: 'Unauthorized' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const supabase = createClient(
    supabaseUrl,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser(sbToken);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  // Rate limiting
  if (isRateLimited(req, 'canvas-ical', { max: 30, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Rate limited' });
  }

  // Parse body
  let body = req.body as Record<string, unknown> | string | undefined;
  if (typeof body === 'string') {
    try { body = JSON.parse(body) as Record<string, unknown>; } catch { body = {}; }
  }
  body = body ?? {};
  const icalUrl = typeof body?.icalUrl === 'string' ? body.icalUrl.trim() : '';
  if (!icalUrl) return res.status(400).json({ error: 'icalUrl is required' });

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(icalUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (parsedUrl.protocol !== 'https:') return res.status(400).json({ error: 'HTTPS required' });
  if (!CANVAS_FEED_PATH_RE.test(parsedUrl.pathname)) {
    return res.status(400).json({
      error: 'URL does not look like a Canvas calendar feed (expected .../feeds/calendars/user_….ics)',
    });
  }

  // DNS / SSRF check
  if (!await isPublicHost(parsedUrl.hostname)) {
    return res.status(400).json({ error: 'Calendar feed host must resolve to a public IP address' });
  }

  // Fetch iCal
  let icalText: string;
  try {
    const fetchRes = await fetch(icalUrl, {
      headers: { 'User-Agent': 'Soma/1.0 calendar-sync' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!fetchRes.ok) return res.status(502).json({ error: `Calendar feed returned ${fetchRes.status}` });
    icalText = await fetchRes.text();
  } catch (e) {
    console.error('[canvas-ical] fetch failed:', e);
    return res.status(502).json({ error: 'Failed to fetch calendar feed' });
  }

  if (!icalText.includes('BEGIN:VCALENDAR')) {
    return res.status(400).json({ error: 'Response does not appear to be a valid iCal feed' });
  }

  // Parse events
  const events = parseEvents(icalText);
  const now = Date.now();

  // Filter to upcoming + recent assignments only (not calendar events unrelated to assignments)
  const assignments = events
    .filter(e => {
      // Only include assignment-type events (UID contains "assignment" or URL points to an assignment)
      const isAssignment = /assignment/i.test(e.uid) || /\/assignments\//.test(e.url);
      if (!isAssignment) return false;
      // Include anything due in the past 7 days through future
      const dueTs = new Date(e.due || e.dtstart).getTime();
      if (Number.isNaN(dueTs)) return false;
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
      return dueTs >= sevenDaysAgo;
    })
    .map(e => {
      const { assignmentId, courseId } = extractIds(e);
      const { courseName, assignmentName } = parseSummary(e.summary);
      const resolvedCourseId = courseId || simpleHash(`course:${courseName || 'Canvas'}`);
      const dueDate = new Date(e.due || e.dtstart);
      const month = String(dueDate.getUTCMonth() + 1).padStart(2, '0');
      const year = dueDate.getUTCFullYear();
      const dateStr = `${year}-${month}-${String(dueDate.getUTCDate()).padStart(2, '0')}`;
      const htmlUrl = `https://${parsedUrl.hostname}/calendar?include_contexts=course_${courseId || resolvedCourseId}&month=${month}&year=${year}#view_name=day&view_start=${dateStr}`;
      return {
        id: assignmentId,
        name: assignmentName || e.summary,
        courseId: resolvedCourseId,
        courseName,
        dueAt: e.due || e.dtstart,
        htmlUrl,
        status: 'not_started' as const,
        submittedAt: null,
        score: null,
        pointsPossible: null,
        source: 'ical' as const,
      };
    })
    // Deduplicate by id
    .filter((a, idx, arr) => arr.findIndex(b => b.id === a.id) === idx);

  return res.status(200).json({ assignments });
}
