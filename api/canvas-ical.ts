/// <reference types="node" />
import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { isRateLimited } from './_rateLimit';

const ALLOWED_ORIGINS = [
  'https://somastudy.app',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173'] : []),
];

// Only allow the Instructure/Canvas hosted service
const ALLOWED_HOSTNAME_RE = /^[a-z0-9-]+\.instructure\.com$/i;

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

  // Try URL: /courses/123/assignments/456
  const urlMatch = event.url.match(/\/courses\/(\d+)\//);
  const courseId = urlMatch ? parseInt(urlMatch[1], 10) : 0;

  return { assignmentId, courseId };
}

function parseSummary(summary: string): { courseName: string; assignmentName: string } {
  // Canvas format: "Course Name: Assignment Name" or just "Assignment Name"
  const colonIdx = summary.indexOf(': ');
  if (colonIdx > 0 && colonIdx < summary.length - 2) {
    return {
      courseName: summary.slice(0, colonIdx).trim(),
      assignmentName: summary.slice(colonIdx + 2).trim(),
    };
  }
  return { courseName: '', assignmentName: summary.trim() };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: { method?: string; body: unknown; headers: Record<string, string | string[] | undefined> },
  res: { status: (c: number) => { json: (b: unknown) => void; end: () => void } },
) {
  const origin = req.headers['origin'] as string | undefined;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.status(200); // set CORS headers below
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders).forEach(([k, v]) => res.status(204));
    return res.status(204).end();
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth
  const authHeader = req.headers['authorization'] as string | undefined;
  const sbToken = authHeader?.replace('Bearer ', '') ?? '';
  if (!sbToken) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser(sbToken);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  // Rate limiting
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? 'unknown';
  if (isRateLimited(ip, 30, 60_000)) return res.status(429).json({ error: 'Rate limited' });

  // Parse body
  const body = req.body as Record<string, unknown>;
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
  if (!ALLOWED_HOSTNAME_RE.test(parsedUrl.hostname)) {
    return res.status(400).json({ error: 'Only instructure.com calendar feeds are supported' });
  }
  if (!parsedUrl.pathname.includes('/feeds/calendars/')) {
    return res.status(400).json({ error: 'URL does not look like a Canvas calendar feed' });
  }

  // DNS / SSRF check
  try {
    const addresses = await dns.resolve4(parsedUrl.hostname).catch(() => [] as string[]);
    const v6 = await dns.resolve6(parsedUrl.hostname).catch(() => [] as string[]);
    const all = [...addresses, ...v6];
    if (all.length === 0) return res.status(400).json({ error: 'Could not resolve hostname' });
    if (all.some(isPrivateIp)) return res.status(400).json({ error: 'Disallowed IP range' });
  } catch {
    return res.status(400).json({ error: 'DNS resolution failed' });
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
      return {
        id: assignmentId,
        name: assignmentName || e.summary,
        courseId,
        courseName,
        dueAt: e.due || e.dtstart,
        htmlUrl: e.url,
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
