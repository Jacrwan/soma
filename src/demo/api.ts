/**
 * Answers the app's `/api/*` requests in demo mode, so Stripe, Google
 * Calendar, Canvas and the AI all respond without a server or real account.
 */
import { calendarEvents, canvasAssignments, CONNECTIONS, SUBJECTS, dateKey, type Tables } from './seed';

type Json = Record<string, unknown>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export function installDemoApi(db: Tables) {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith('/') ? url : url.startsWith(location.origin) ? url.slice(location.origin.length) : '';
    if (!path.startsWith('/api/')) {
      if (url.includes('googleapis.com/oauth2')) return json({ expires_in: 3600 });
      return realFetch(input, init);
    }
    let body: Json = {};
    try { body = init?.body ? JSON.parse(String(init.body)) : {}; } catch { /* not JSON */ }
    const route = path.split('?')[0];

    switch (route) {
      case '/api/stripe':
        if (body.action === 'get-subscription') {
          const end = new Date(); end.setDate(end.getDate() + 84);
          return json({ status: 'active', plan: 'semester', currentPeriodEnd: end.toISOString(), cancelAtPeriodEnd: false });
        }
        return json({ error: 'Billing is disabled in the demo.' }, 400);

      case '/api/google-calendar-connections':
        await wait(150);
        if (body.action === 'list') {
          return json({ connections: CONNECTIONS.map(({ id, googleEmail, selectedCalendars, createdAt }) => ({ id, googleEmail, selectedCalendars, createdAt })) });
        }
        if (body.action === 'list_calendars') {
          const c = CONNECTIONS.find(x => x.id === body.connectionId);
          return json({ calendars: c ? [...c.selectedCalendars, ...c.extraCalendars] : [] });
        }
        return json({ ok: true });

      case '/api/google-calendar-events':
        await wait(250);
        return json({ events: calendarEvents(String(body.timeMin), String(body.timeMax)), incomplete: false });

      case '/api/canvas-ical':
        await wait(500);
        return json({ assignments: canvasAssignments().assignments });

      case '/api/memory':
        return json({
          revision: 3, enabled: true, entries: [
            { key: 'study-time', content: 'I focus best late at night, 8–11 PM.', category: 'preference', updatedAt: '2026-09-02T03:10:00Z', expiresAt: null, source: 'manual' },
            { key: 'goal', content: 'Pre-med. Keep a 3.8+ GPA and take the MCAT in spring 2027.', category: 'goal', updatedAt: '2026-08-20T18:00:00Z', expiresAt: null, source: 'auto' },
          ],
        });

      case '/api/chat': {
        await wait(1400 + Math.random() * 900);
        const text = reply(db, body);
        return json({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
      }

      case '/api/extract-document':
        return json({ ok: true });

      default:
        return json({ error: 'Not available in the demo.' }, 400);
    }
  };
}

// ── the demo AI ───────────────────────────────────────────────────────────
type Message = { role: string; content: string | { type: string; text?: string }[] };
type Context = {
  today: string;
  selectedDate: string;
  calendar: { date: string; weekday: string }[];
  freeTime: { date: string; free: string[] }[];
};
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const clock = (m: number) => { const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };

function lastUserText(body: Json): string {
  const messages = (body.messages ?? []) as Message[];
  const last = [...messages].reverse().find(m => m.role === 'user');
  if (!last) return '';
  return typeof last.content === 'string' ? last.content : last.content.map(b => b.text ?? '').join(' ');
}

/** The assistant's live CONTEXT JSON, in the shape the canned replies use. */
function readContext(context: string): Context | null {
  const json = context.match(/CONTEXT[^:]*: (\{[^\n]*\})/)?.[1];
  if (!json) return null;
  try {
    const c = JSON.parse(json) as { now: string; days: { d: string; w: string; sel?: boolean }[]; free: { d: string; slots: string[] }[] };
    return {
      today: c.now.slice(0, 10),
      selectedDate: (c.days.find(d => d.sel) ?? c.days[0]).d,
      calendar: c.days.map(d => ({ date: d.d, weekday: d.w })),
      freeTime: c.free.map(f => ({ date: f.d, free: f.slots })),
    };
  } catch { return null; }
}

function weekStats(db: Tables) {
  const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - 6);
  const key = dateKey(since);
  const recent = (db.timer_sessions ?? []).filter(s => String(s.date) >= key);
  const total = recent.reduce((n, s) => n + Number(s.duration_seconds), 0) / 3600;
  const bySubject = new Map<string, number>();
  for (const s of recent) bySubject.set(String(s.subject_name), (bySubject.get(String(s.subject_name)) ?? 0) + Number(s.duration_seconds) / 3600);
  const ranked = [...bySubject].sort((a, b) => b[1] - a[1]);
  return { total, days: new Set(recent.map(s => s.date)).size, ranked };
}

function upcoming(n: number) {
  return canvasAssignments().assignments.filter(a => new Date(a.dueAt) > new Date()).slice(0, n);
}
function when(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${clock(d.getHours() * 60 + d.getMinutes())}`;
}

// What to fill free time with, most urgent first.
const FOCUS: { subject: string; title: string; minutes: number }[] = [
  { subject: SUBJECTS.orgo.name, title: 'Orgo Midterm 1 — practice exam (timed)', minutes: 90 },
  { subject: SUBJECTS.calc.name, title: 'Calc III WebAssign', minutes: 60 },
  { subject: SUBJECTS.bio.name, title: 'Paper summary 2: CRISPRi screens — draft', minutes: 75 },
  { subject: SUBJECTS.orgo.name, title: 'Orgo mechanism review — SN1/SN2/E1/E2', minutes: 60 },
  { subject: SUBJECTS.phys.name, title: 'Mastering Physics HW', minutes: 60 },
];

function dashboardReply(db: Tables, text: string, ctx: Context): string {
  const lower = text.toLowerCase();
  const wantsPlan = /plan|schedule|block|study|fit|tonight|tomorrow|today|free|add|help|prep|midterm|exam|behind/.test(lower);
  if (!wantsPlan || /how much|how many hours|studied|progress|stats/.test(lower)) {
    const s = weekStats(db);
    return JSON.stringify({
      reply: `You’ve studied ${s.total.toFixed(1)} hours in the last 7 days, about ${(s.total / 7).toFixed(1)} hours a day.\n- ${s.ranked.slice(0, 3).map(([n, h]) => `${n}: ${h.toFixed(1)} h`).join('\n- ')}\nYour orgo midterm is the biggest thing coming up. Want me to block out prep time?`,
      blocks: [],
    });
  }
  let index = ctx.calendar.findIndex(d => d.date === ctx.selectedDate);
  if (/tomorrow/.test(lower)) index = 1;
  else if (/today|tonight/.test(lower)) index = 0;
  else {
    const named = ctx.calendar.findIndex(d => lower.includes(d.weekday.toLowerCase()));
    if (named >= 0) index = named;
  }
  if (index < 0) index = 0;
  let target = ctx.freeTime.find(f => f.date === ctx.calendar[index].date);
  const roomy = (f?: { free: string[] }) => f?.free.some(s => { const [a, b] = s.split('–'); return toMin(b) - toMin(a) >= 45; });
  if (!roomy(target)) target = ctx.freeTime.find((f, i) => i > index && roomy(f)) ?? target;
  if (!target) return JSON.stringify({ reply: 'Your calendar is full for that day. Want me to look at tomorrow instead?', blocks: [] });

  const evening = /tonight|evening/.test(lower);
  const blocks: Json[] = [];
  let f = 0;
  for (const slot of target.free) {
    let [a, b] = slot.split('–').map(toMin);
    if (evening) a = Math.max(a, 18 * 60);
    a = Math.ceil(a / 15) * 15;
    while (blocks.length < 3 && b - a >= 45) {
      const item = FOCUS[f % FOCUS.length];
      const len = Math.min(item.minutes, b - a);
      blocks.push({ title: item.title, subject: item.subject, date: target.date, start: hm(a), end: hm(a + len) });
      a += len + 15; f++;
    }
    if (blocks.length >= 3) break;
  }
  const day = ctx.calendar.find(d => d.date === target!.date)?.weekday ?? 'that day';
  const lines = blocks.map(bk => `- ${clock(toMin(String(bk.start)))}–${clock(toMin(String(bk.end)))}: ${bk.title}`);
  return JSON.stringify({
    reply: `Here’s a plan for ${target.date === ctx.today ? (evening ? 'tonight' : 'today') : day}, working around your classes and calendar:\n${lines.join('\n')}\nOrgo comes first because Midterm 1 is next week. Accept the blocks you want and they’ll go into your plan.`,
    blocks,
  });
}

function chatReply(db: Tables, text: string): string {
  const lower = text.toLowerCase();
  const s = weekStats(db);
  if (/how much|studied|hours|progress|stats|week/.test(lower) && !/plan|schedule/.test(lower)) {
    return `You studied ${s.total.toFixed(1)} hours over the last 7 days, an average of ${(s.total / 7).toFixed(1)} hours a day, and you studied every day.\n\n${s.ranked.map(([n, h]) => `- ${n}: ${h.toFixed(1)} h`).join('\n')}\n\n${s.ranked[0]?.[0]} is getting the most time, which is right with the orgo midterm coming up. ${s.ranked.filter(([n]) => n !== SUBJECTS.psych.name).slice(-1)[0]?.[0]} has had the least. One extra hour this weekend would keep it on track.`;
  }
  if (/midterm|exam|orgo|test|prep/.test(lower)) {
    return `Here’s a 7-day plan for CHEM 2410 Midterm 1. It covers chapters 1–7, per your syllabus.\n\n- Today: redo Problem Set 6 mechanisms without notes (90 min)\n- Tomorrow: Klein Ch. 6–7 summary sheet, then flashcards (2 h)\n- Day 3: timed practice exam, the 2025 one in your documents (90 min), then go over what you missed\n- Day 4: office hours with Prof. Alvarez, and bring your 3 weakest topics\n- Day 5: second practice exam plus the review session at 6 PM\n- Day 6: light review only, SN1/SN2/E1/E2 decision chart\n- Exam day: 20-minute warm-up, no new material\n\nThis still leaves room for Calc WebAssign and Physics HW each night. Want me to put these into your plan?`;
  }
  if (/due|deadline|assignment|homework|what.*(next|coming)/.test(lower)) {
    return `Coming up next:\n\n${upcoming(6).map(a => `- ${a.courseName}: ${a.name} (${when(a.dueAt)})`).join('\n')}\n\nThe CRISPRi paper summary is already in progress, so finishing it before the weekend frees up Sunday for orgo.`;
  }
  if (/plan|schedule|today|tonight|tomorrow/.test(lower)) {
    return `Here’s what I’d do with the rest of your day, around your classes:\n\n- Orgo Midterm 1 practice exam, timed (90 min)\n- Calc III WebAssign (60 min)\n- Paper summary 2 draft for Cell Bio (75 min)\n- 15-minute breaks in between, and stop by 11:30 PM\n\nThat puts you at about 7 hours for the day, in line with your average of ${(s.total / 7).toFixed(1)}.`;
  }
  return `Here’s where things stand. You’ve logged ${s.total.toFixed(1)} hours this week and studied every day. Your next deadlines are:\n\n${upcoming(3).map(a => `- ${a.courseName}: ${a.name} (${when(a.dueAt)})`).join('\n')}\n\nI can plan your evening, make a midterm study schedule, or explain a concept. What would help most?`;
}

/** Stands in for the AI reading a guide: each "a.b–a.c Topic — due date" line becomes its sections. */
function sectionList(text: string): string {
  const items: Json[] = [];
  for (const m of text.matchAll(/(\d+)\.(\d+)\s*[–-]\s*(?:\d+\.)?(\d+)\s+(.+?)\s+—\s+due\s+(\d{4}-\d{2}-\d{2})/g)) {
    for (let n = Number(m[2]); n <= Number(m[3]); n++) items.push({ label: `${m[1]}.${n}`, title: m[4].trim(), due: m[5] });
  }
  return JSON.stringify({ items });
}

type Course = { s: string; done: string; behind: number; open: { id: string; l: string; t?: string; due?: string; planned?: true | string }[]; unconfirmed?: string };
/** When the student asks about readings, plan from the reading list the way Soma is told to. */
function readingReply(context: string, text: string, ctx: Context): string | null {
  if (!/read|behind|physics|catch up|caught up|where (was|am) i|left off|got through|stopped at|\b\d+\.\d+\b/i.test(text)) return null;
  let courses: Course[] = [], plan: { id?: string; cov?: string }[] = [];
  try { const c = JSON.parse(context.match(/CONTEXT[^:]*: (\{[^\n]*\})/)?.[1] ?? '{}') as { courses?: Course[]; plan?: typeof plan }; courses = c.courses ?? []; plan = c.plan ?? []; } catch { return null; }
  const course = courses.find(c => c.open.length);
  if (!course) return null;
  // "I got through 22.3": record it, and hand the rest back.
  const said = text.match(/(?:through|up to|to|stopped at)\s+(\d+\.\d+)/i)?.[1];
  const through = said ? course.open.find(i => i.l === said) : undefined;
  if (through) {
    const num = (l: string) => { const [a, b] = l.split('.').map(Number); return a * 1000 + b; };
    const block = plan.find(p => { if (!p.id || !p.cov) return false; const [a, b = a] = p.cov.split('–'); return num(a) <= num(through.l) && num(through.l) <= num(b); });
    return JSON.stringify({ reply: `Got it — marking through ${through.l} as read.${block ? ` The rest of ${block.cov} goes back on your list; ask me to fit it in when you're ready.` : ''}`, changes: [{ action: 'progress', through: through.id, ...(block ? { id: block.id } : {}) }] });
  }
  if (course.unconfirmed && !/got through|stopped|didn.t|finished|read (it|all)/i.test(text)) {
    return JSON.stringify({ reply: `${course.s}: you're done through ${course.done.replace('through ', '')}. Your ${course.unconfirmed} block ended without being checked off — how far did you get? Once I know, I'll plan the rest from there.`, blocks: [] });
  }
  const run = course.open.filter(i => i.planned !== true).slice(0, 3);
  // The first evening hour that is actually free.
  let slot: { date: string } | undefined, start = 0;
  for (const f of ctx.freeTime) {
    const fit = f.free.map(x => x.split('–').map(toMin)).find(([a, b]) => b - Math.max(a, 19 * 60) >= 60);
    if (fit) { slot = f; start = Math.ceil(Math.max(fit[0], 19 * 60) / 15) * 15; if (start + 60 <= fit[1]) break; slot = undefined; }
  }
  if (!run.length || !slot) return null;
  const range = run.length > 1 ? `${run[0].l}–${run[run.length - 1].l}` : run[0].l;
  const late = run.filter(i => i.due && i.due < ctx.today).length;
  return JSON.stringify({
    reply: `${course.s}: you're done through ${course.done.replace('through ', '')}, so you pick up at ${run[0].l}. ${late ? `${late === run.length ? 'These are' : `${late} of these are`} overdue, so they go first.` : ''} I'll put ${range} in one hour ${slot.date === ctx.today ? 'tonight' : 'on ' + (ctx.calendar.find(d => d.date === slot!.date)?.weekday ?? 'that day')}.`,
    blocks: [{ title: `Physics reading: ${range} ${run[0].t ?? ''}`.trim(), subject: course.s, date: slot.date, start: hm(start), end: hm(start + 60), covers: [run[0].id, run[run.length - 1].id] }],
  });
}

function reply(db: Tables, body: Json): string {
  if (String(body.systemPrompt ?? '').startsWith('You turn a course reading guide')) return sectionList(String(body.context ?? ''));
  const text = lastUserText(body);
  const readCtx = readContext(String(body.context ?? ''));
  const reading = readCtx ? readingReply(String(body.context ?? ''), text, readCtx) : null;
  if (reading) return reading;
  const ctx = readContext(String(body.context ?? ''));
  return ctx ? dashboardReply(db, text, ctx) : chatReply(db, text);
}
