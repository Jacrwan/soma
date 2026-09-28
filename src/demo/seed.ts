/**
 * A made-up pre-med sophomore's semester, built relative to today so the
 * demo always looks current: a college class schedule on Google Calendar,
 * 6+ hours of recorded study every day, a planned week ahead, Canvas
 * deadlines, documents and past AI chats.
 *
 * Everything is generated from a fixed seed, so every run of `npm run demo`
 * shows the same student.
 */
import type { CanvasAssignment, GoogleCalendarEvent, GoogleCalendarInfo, SubjectColor } from '../types';

export const DEMO_USER_ID = '00000000-0000-4000-8000-00000000d3e0';
export const DEMO_EMAIL = 'maya.chen@gmail.com';
export const DEMO_NAME = 'Maya Chen';

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

// ── helpers ───────────────────────────────────────────────────────────────
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mins = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
function dayAt(offset: number): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d;
}
function atMinute(day: Date, minute: number): Date {
  const d = new Date(day); d.setMinutes(minute); return d;
}
let idCounter = 0;
function uuid(prefix: string): string {
  idCounter++;
  const hex = (idCounter * 2654435761 >>> 0).toString(16).padStart(8, '0');
  return `${prefix.padEnd(8, '0').slice(0, 8)}-${hex.slice(0, 4)}-4${hex.slice(4, 7)}-8${String(idCounter).padStart(3, '0')}-${hex}${String(idCounter).padStart(4, '0')}`;
}

// ── subjects ──────────────────────────────────────────────────────────────
type SubjectKey = 'orgo' | 'calc' | 'phys' | 'bio' | 'psych' | 'mcat';
export const SUBJECTS: Record<SubjectKey, { id: string; name: string; color: SubjectColor; courseId?: number; weight: number }> = {
  orgo:  { id: 'a1000000-0000-4000-8000-000000000001', name: 'Organic Chemistry',   color: '#ef5350', courseId: 41021, weight: 27 },
  calc:  { id: 'a1000000-0000-4000-8000-000000000002', name: 'Calculus III',        color: '#42a5f5', courseId: 41188, weight: 18 },
  phys:  { id: 'a1000000-0000-4000-8000-000000000003', name: 'Physics II',          color: '#ab47bc', courseId: 41305, weight: 18 },
  bio:   { id: 'a1000000-0000-4000-8000-000000000004', name: 'Cell Biology',        color: '#66bb6a', courseId: 41422, weight: 15 },
  psych: { id: 'a1000000-0000-4000-8000-000000000005', name: 'Intro to Psychology', color: '#ffa726', courseId: 41560, weight: 9 },
  mcat:  { id: 'a1000000-0000-4000-8000-000000000006', name: 'MCAT Prep',           color: '#26c6da', weight: 13 },
};
const SUBJECT_KEYS = Object.keys(SUBJECTS) as SubjectKey[];

// ── calendars ─────────────────────────────────────────────────────────────
export const CONNECTIONS = [
  {
    id: 'c0000000-0000-4000-8000-000000000001',
    googleEmail: DEMO_EMAIL,
    selectedCalendars: [{ id: 'maya.chen@gmail.com', summary: 'Maya Chen', backgroundColor: '#9fc6e7', primary: true }] as GoogleCalendarInfo[],
    extraCalendars: [{ id: 'family', summary: 'Family', backgroundColor: '#fad165' }] as GoogleCalendarInfo[],
    createdAt: '2026-08-18T20:14:00.000Z',
  },
  {
    id: 'c0000000-0000-4000-8000-000000000002',
    googleEmail: 'mchen27@campus.edu',
    selectedCalendars: [
      { id: 'mchen27@campus.edu', summary: 'Fall 2026 Classes', backgroundColor: '#4986e7', primary: true },
      { id: 'clubs', summary: 'Clubs & Campus', backgroundColor: '#f691b2' },
    ] as GoogleCalendarInfo[],
    extraCalendars: [] as GoogleCalendarInfo[],
    createdAt: '2026-08-18T20:16:00.000Z',
  },
];
type CalKey = 'personal' | 'classes' | 'clubs';
const CAL: Record<CalKey, { conn: number; cal: number }> = {
  personal: { conn: 0, cal: 0 }, classes: { conn: 1, cal: 0 }, clubs: { conn: 1, cal: 1 },
};

type Recurring = { id: string; title: string; days: number[]; start: string; end: string; cal: CalKey };
// 0 = Sunday … 6 = Saturday. A pre-med sophomore's fall schedule.
const WEEKLY: Recurring[] = [
  { id: 'gym',       title: 'Gym — lift',                                   days: [1, 3, 5], start: '07:00', end: '08:00', cal: 'personal' },
  { id: 'chem-lec',  title: 'CHEM 2410 · Organic Chemistry I (Baker 200)',  days: [1, 3, 5], start: '09:05', end: '09:55', cal: 'classes' },
  { id: 'calc-lec',  title: 'MATH 2210 · Calculus III (Malott 251)',        days: [1, 3, 5], start: '11:15', end: '12:05', cal: 'classes' },
  { id: 'chem-lab',  title: 'CHEM 2410 · Orgo Lab (Baker 150)',             days: [1],       start: '14:00', end: '16:50', cal: 'classes' },
  { id: 'calc-rec',  title: 'MATH 2210 · Recitation',                       days: [3],       start: '16:00', end: '16:50', cal: 'classes' },
  { id: 'phys-lec',  title: 'PHYS 2213 · Physics II: E&M (Rockefeller 1)',  days: [2, 4],    start: '10:10', end: '11:25', cal: 'classes' },
  { id: 'bio-lec',   title: 'BIOL 2500 · Cell Biology (Stocking 218)',      days: [2, 4],    start: '13:00', end: '14:15', cal: 'classes' },
  { id: 'psych-lec', title: 'PSYC 1101 · Intro to Psychology (Uris Aud.)',  days: [2, 4],    start: '15:30', end: '16:45', cal: 'classes' },
  { id: 'phys-dis',  title: 'PHYS 2213 · Discussion',                       days: [5],       start: '13:25', end: '14:15', cal: 'classes' },
  { id: 'orgo-oh',   title: 'Orgo office hours — Prof. Alvarez',            days: [5],       start: '15:00', end: '15:45', cal: 'classes' },
  { id: 'run',       title: 'Run with Jess',                                days: [2, 4],    start: '07:15', end: '08:00', cal: 'personal' },
  { id: 'premed',    title: 'Pre-Med Society meeting',                      days: [3],       start: '19:00', end: '20:00', cal: 'clubs' },
  { id: 'library',   title: 'Work-study shift — Uris Library',              days: [6],       start: '10:00', end: '13:00', cal: 'clubs' },
  { id: 'dinner',    title: 'Dinner with roommates',                        days: [5],       start: '19:00', end: '20:30', cal: 'personal' },
  { id: 'soccer',    title: 'Intramural soccer',                            days: [0],       start: '17:00', end: '18:30', cal: 'clubs' },
  { id: 'call-mom',  title: 'Call Mom',                                     days: [0],       start: '20:30', end: '21:00', cal: 'personal' },
  { id: 'volunteer', title: 'Hospital volunteering — Cayuga Medical',       days: [6],       start: '15:00', end: '17:00', cal: 'clubs' },
];
// One-off events, by day offset from today.
const ONE_OFF: { offset: number; title: string; start: string; end: string; cal: CalKey }[] = [
  { offset: -9, title: 'PHYS 2213 Prelim 1 (Olin 155)',         start: '19:30', end: '21:00', cal: 'classes' },
  { offset: -6, title: 'Coffee with Priya',                     start: '16:00', end: '16:45', cal: 'personal' },
  { offset: -2, title: 'Academic advising — Dr. Okafor',        start: '15:00', end: '15:30', cal: 'clubs' },
  { offset: 1,  title: 'TA review session — Calc III',          start: '18:00', end: '19:00', cal: 'classes' },
  { offset: 3,  title: 'Orgo midterm review (Baker 200)',       start: '18:00', end: '19:30', cal: 'classes' },
  { offset: 5,  title: 'Health Careers Fair — Barton Hall',     start: '12:30', end: '14:00', cal: 'clubs' },
  { offset: 8,  title: 'CHEM 2410 Midterm 1 (Baker 200)',       start: '19:30', end: '21:30', cal: 'classes' },
  { offset: 11, title: 'PSYC 1101 Exam 1',                      start: '15:30', end: '16:45', cal: 'classes' },
  { offset: 13, title: 'Jess’s birthday dinner',                start: '19:00', end: '21:00', cal: 'personal' },
];

const SEMESTER_START = -63; // days from today
const SEMESTER_END = 80;

type Busy = { start: number; end: number };
function eventsOn(offset: number): { id: string; title: string; start: number; end: number; cal: CalKey }[] {
  if (offset < SEMESTER_START || offset > SEMESTER_END) return [];
  const dow = dayAt(offset).getDay();
  const out = WEEKLY.filter(r => r.days.includes(dow)).map(r => ({ id: r.id, title: r.title, start: mins(r.start), end: mins(r.end), cal: r.cal }));
  for (const e of ONE_OFF) if (e.offset === offset) out.push({ id: `once-${e.offset}`, title: e.title, start: mins(e.start), end: mins(e.end), cal: e.cal });
  return out;
}

/** Google Calendar events between two instants, shaped like the real aggregator's output. */
export function calendarEvents(timeMin: string, timeMax: string): GoogleCalendarEvent[] {
  const from = new Date(timeMin), to = new Date(timeMax);
  const first = Math.max(SEMESTER_START, Math.floor((+from - +dayAt(0)) / 86_400_000) - 1);
  const last = Math.min(SEMESTER_END, Math.ceil((+to - +dayAt(0)) / 86_400_000) + 1);
  const events: GoogleCalendarEvent[] = [];
  for (let offset = first; offset <= last; offset++) {
    const day = dayAt(offset);
    for (const e of eventsOn(offset)) {
      const start = atMinute(day, e.start), end = atMinute(day, e.end);
      if (end <= from || start >= to) continue;
      const { conn, cal } = CAL[e.cal];
      const c = CONNECTIONS[conn], info = c.selectedCalendars[cal];
      events.push({
        id: `${e.id}-${dateKey(day)}`,
        summary: e.title,
        htmlLink: 'https://calendar.google.com/calendar',
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        source: { connectionId: c.id, googleEmail: c.googleEmail, calendarId: info.id, calendarSummary: info.summary, color: info.backgroundColor },
      });
    }
  }
  return events.sort((a, b) => a.start.dateTime!.localeCompare(b.start.dateTime!));
}

// ── tasks ─────────────────────────────────────────────────────────────────
type Template = { text: (n: number) => string; kind: string; size: number };
const KLEIN = ['Alkanes & conformations', 'Stereoisomerism', 'Chemical reactivity', 'Substitution reactions', 'Elimination reactions', 'Addition reactions', 'Alkynes', 'Radical reactions', 'Synthesis'];
const LABS = ['Melting points', 'Recrystallization', 'Extraction', 'Distillation', 'TLC', 'SN1/SN2 kinetics'];
const PAPERS = ['Mitochondrial fission & fusion', 'CRISPR interference screens', 'ER stress and the UPR', 'Clathrin-mediated endocytosis'];
const TEMPLATES: Record<SubjectKey, Template[]> = {
  orgo: [
    { text: n => `Orgo Problem Set ${n}`, kind: 'homework', size: 260 },
    { text: n => `Klein Ch. ${n + 2}: ${KLEIN[n % KLEIN.length]} — read + notes`, kind: 'reading', size: 140 },
    { text: n => `Orgo mechanisms flashcards — lectures ${n * 3 - 2}–${n * 3}`, kind: 'other', size: 100 },
    { text: n => `Lab report ${n}: ${LABS[(n - 1) % LABS.length]}`, kind: 'lab', size: 210 },
  ],
  calc: [
    { text: n => `Calc III WebAssign ${n}`, kind: 'homework', size: 150 },
    { text: n => `Calc III written problem set ${n}`, kind: 'homework', size: 220 },
    { text: n => `Review §${12 + Math.floor(n / 3)}.${(n % 3) + 1} lecture notes`, kind: 'reading', size: 80 },
  ],
  phys: [
    { text: n => `Mastering Physics HW ${n}`, kind: 'homework', size: 190 },
    { text: n => `Young & Freedman Ch. ${20 + n} reading`, kind: 'reading', size: 120 },
    { text: n => `Physics lab ${n} write-up`, kind: 'lab', size: 150 },
  ],
  bio: [
    { text: n => `Alberts Ch. ${n + 8} reading + outline`, kind: 'reading', size: 150 },
    { text: n => `Cell Bio lecture ${n * 2 - 1}–${n * 2} notes review`, kind: 'other', size: 90 },
    { text: n => `Paper summary: ${PAPERS[(n - 1) % PAPERS.length]}`, kind: 'homework', size: 200 },
  ],
  psych: [
    { text: n => `Myers Ch. ${n + 1} reading`, kind: 'reading', size: 100 },
    { text: n => `Psych discussion post — week ${n}`, kind: 'homework', size: 60 },
    { text: n => `Psych Quizlet: Ch. ${n + 1} terms`, kind: 'other', size: 60 },
  ],
  mcat: [
    { text: n => `MCAT CARS — passage set ${n}`, kind: 'other', size: 90 },
    { text: n => `UWorld block ${n}: Chem/Phys`, kind: 'other', size: 120 },
    { text: n => `MCAT biochem Anki — deck ${n}`, kind: 'other', size: 75 },
  ],
};
// The week before the orgo midterm is spent preparing for it.
const MIDTERM_PREP: Template[] = [
  { text: n => `Orgo Midterm 1 — practice exam ${n}`, kind: 'exam', size: 150 },
  { text: n => `Orgo Midterm 1 — mechanism review ${n}`, kind: 'exam', size: 120 },
];

type Task = { id: string; subject: SubjectKey; text: string; kind: string; size: number; worked: number; planned: number; firstDay: number };

// ── Canvas deadlines ──────────────────────────────────────────────────────
export function canvasAssignments(): { assignments: CanvasAssignment[]; status: Record<number, string>; cleared: Record<number, boolean> } {
  const r = rng(77);
  const today = dayAt(0);
  const monday = (week: number) => { const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + week * 7); return d; };
  const semesterWeek = Math.floor(-SEMESTER_START / 7) + 1;
  const out: CanvasAssignment[] = [];
  const status: Record<number, string> = {};
  // Submitted work is cleared off the list, as a student would have done.
  const cleared: Record<number, boolean> = {};
  let id = 880100;
  const add = (key: SubjectKey, name: string, due: Date, points: number) => {
    const s = SUBJECTS[key];
    const past = due < new Date();
    const a: CanvasAssignment = {
      id: id++, name, courseId: s.courseId!, courseName: s.name, dueAt: due.toISOString(),
      htmlUrl: 'https://canvas.instructure.com/courses',
      status: past ? 'done' : 'not_started',
      pointsPossible: points,
      score: past ? Math.round(points * (0.84 + r() * 0.16)) : null,
      submittedAt: past ? new Date(+due - (2 + r() * 20) * 3_600_000).toISOString() : null,
    };
    out.push(a);
    if (past) { status[a.id] = 'done'; cleared[a.id] = true; }
  };
  const at = (week: number, weekday: number, hhmm: string) => atMinute((() => { const d = monday(week); d.setDate(d.getDate() + weekday); return d; })(), mins(hhmm));
  for (let w = -3; w <= 2; w++) {
    const n = semesterWeek + w;
    add('orgo', `Problem Set ${n}`, at(w, 4, '23:59'), 50);
    if (n % 2 === 0) add('orgo', `Lab Report ${n / 2}: ${LABS[(n / 2 - 1) % LABS.length]}`, at(w, 0, '13:59'), 40);
    add('calc', `WebAssign ${n}.1`, at(w, 1, '23:59'), 20);
    add('calc', `WebAssign ${n}.2`, at(w, 3, '23:59'), 20);
    if (n % 2 === 1) add('calc', `Written Problem Set ${Math.ceil(n / 2)}`, at(w, 4, '17:00'), 30);
    add('phys', `Mastering Physics HW ${n}`, at(w, 6, '23:59'), 25);
    add('phys', `Lab ${n}: ${['Electric fields', 'Capacitors', 'Ohm’s law', 'RC circuits', 'Magnetic force', 'Induction'][n % 6]}`, at(w, 4, '14:15'), 20);
    add('bio', `Reading Quiz — Ch. ${n + 6}`, at(w, 1, '12:59'), 10);
    add('psych', `Discussion Board: Week ${n}`, at(w, 2, '23:59'), 5);
  }
  add('bio', 'Paper Summary 2: CRISPR interference screens', atMinute(dayAt(6), mins('23:59')), 60);
  add('orgo', 'Midterm 1', atMinute(dayAt(8), mins('19:30')), 150);
  add('psych', 'Exam 1', atMinute(dayAt(11), mins('15:30')), 100);
  add('psych', 'Research participation (SONA) — 2 credits', atMinute(dayAt(12), mins('23:59')), 2);
  // One upcoming item is already underway, as it would be in real life.
  const started = out.find(a => a.name === 'Paper Summary 2: CRISPR interference screens');
  if (started) status[started.id] = 'in_progress';
  return { assignments: out.sort((a, b) => a.dueAt.localeCompare(b.dueAt)), status, cleared };
}

// ── the database ──────────────────────────────────────────────────────────
export function buildTables(): Tables {
  idCounter = 0;
  const r = rng(20260924);
  const between = (lo: number, hi: number) => lo + r() * (hi - lo);
  const round5 = (n: number) => Math.round(n / 5) * 5;
  const now = new Date();
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const u = DEMO_USER_ID;

  const tasks: Task[] = [];
  const counters: Record<string, number> = {};
  const current: Partial<Record<SubjectKey, Task>> = {};
  const templateIndex: Record<string, number> = {};
  function nextTask(key: SubjectKey, day: number): Task {
    const prep = key === 'orgo' && day >= 1 && day <= 8;
    const list = prep ? MIDTERM_PREP : TEMPLATES[key];
    const tk = prep ? 'prep' : key;
    const idx = templateIndex[tk] = ((templateIndex[tk] ?? -1) + 1) % list.length;
    const t = list[idx];
    // Named for the week of the semester; repeats within a week become parts.
    const week = prep ? 1 : Math.floor((day - SEMESTER_START) / 7) + 1;
    const ck = `${tk}:${idx}:${week}`;
    const part = counters[ck] = (counters[ck] ?? 0) + 1;
    const text = prep ? t.text(part) : `${t.text(week)}${part > 1 ? ` · part ${part}` : ''}`;
    const size = round5(t.size * between(0.8, 1.2));
    const task: Task = {
      id: uuid('b2000000'), subject: key, text, kind: t.kind, size,
      worked: 0, planned: 0, firstDay: day,
    };
    tasks.push(task);
    return task;
  }
  // Hand out time in proportion to each subject's weight, so the mix is
  // steady from week to week rather than whatever a dice roll gives.
  const spent: Record<SubjectKey, number> = { orgo: 0, calc: 0, phys: 0, bio: 0, psych: 0, mcat: 0 };
  function pickSubject(prev: SubjectKey | null, day: number, len: number): SubjectKey {
    const weight = (k: SubjectKey) => SUBJECTS[k].weight * (k === 'orgo' && day >= -10 && day <= 8 ? 1.6 : 1);
    const sum = SUBJECT_KEYS.reduce((n, k) => n + weight(k), 0);
    const total = SUBJECT_KEYS.reduce((n, k) => n + spent[k], 0) + len;
    let best: SubjectKey = 'orgo', score = -Infinity;
    for (const k of SUBJECT_KEYS) {
      if (k === prev) continue;
      const owed = (weight(k) / sum) * total - spent[k] + between(0, 40);
      if (owed > score) { score = owed; best = k; }
    }
    spent[best] += len;
    return best;
  }

  const timerSessions: Row[] = [];
  const todoSessions: Row[] = [];

  for (let offset = SEMESTER_START; offset <= 6; offset++) {
    const day = dayAt(offset);
    const dow = day.getDay();
    // Each day's work is its own set of tasks, so past days read as finished.
    for (const k of SUBJECT_KEYS) delete current[k];
    for (const k of SUBJECT_KEYS) spent[k] *= 0.75; // balance over the last few days, not all term
    const weekend = dow === 0 || dow === 6;
    const open = weekend ? mins('09:00') : mins('08:00');
    const close = mins('23:59');
    const busy: Busy[] = eventsOn(offset).map(e => ({ start: e.start, end: e.end + 5 }));
    busy.push({ start: mins('12:05'), end: mins('12:35') });  // lunch
    busy.push({ start: mins('18:00'), end: mins('18:45') });  // dinner
    busy.sort((a, b) => a.start - b.start);
    const windows: Busy[] = [];
    let cursor = open;
    for (const b of busy) {
      if (b.start > cursor) windows.push({ start: cursor, end: Math.min(b.start, close) });
      cursor = Math.max(cursor, b.end);
    }
    if (close > cursor) windows.push({ start: cursor, end: close });

    // Every day clears six hours; most clear seven or more.
    const target = offset <= 0 ? between(420, 560) : between(390, 470);
    let total = 0;
    let prev: SubjectKey | null = null;
    for (const w of windows) {
      let c = Math.ceil(w.start / 5) * 5;
      while (w.end - c >= 35 && total < target) {
        let len = round5(between(45, 110));
        const left = w.end - c;
        if (len > left || left - len < 30) len = Math.min(left, 120);
        len = Math.min(len, round5(target - total + 20));
        if (len < 30) break;
        const start = c, end = c + len;
        c = end + round5(between(5, 15));
        total += len;
        // Today: what has already happened is recorded; the block running
        // right now is left free for a live timer; the rest is still planned.
        const isPast = offset < 0 || (offset === 0 && end <= nowMinute);
        if (offset === 0 && start < nowMinute + 10 && end > nowMinute) continue;
        // Upcoming evenings stay open so the AI has room to plan on camera.
        if (!isPast && end > mins('19:30')) continue;
        const key = pickSubject(prev, offset, len);
        prev = key;
        let task = current[key];
        if (!task || task.worked + task.planned >= task.size || (!isPast && task.worked > 0) || (key === 'orgo' && offset >= 1 && task.kind !== 'exam')) {
          task = current[key] = nextTask(key, offset);
        }
        if (isPast) task.worked += len; else task.planned += len;
        const sStart = atMinute(day, start), sEnd = atMinute(day, end);
        todoSessions.push({
          id: uuid('c3000000'), user_id: u, todo_id: task.id, date: dateKey(day),
          start_time: sStart.toISOString(), end_time: sEnd.toISOString(),
        });
        if (isPast) {
          const lateStart = Math.floor(between(0, 4));
          const early = Math.floor(between(0, 5));
          const recStart = atMinute(day, start + lateStart);
          const recEnd = atMinute(day, end - early);
          timerSessions.push({
            id: uuid('d4000000'), user_id: u, subject_id: SUBJECTS[key].id, subject_name: SUBJECTS[key].name,
            task_text: task.text, start_time: recStart.toISOString(), end_time: recEnd.toISOString(),
            duration_seconds: (end - early - start - lateStart) * 60 - Math.floor(between(0, 50)),
            date: dateKey(day),
          });
        }
      }
    }
  }

  const todos: Row[] = tasks.map((t, i) => ({
    id: t.id, user_id: u, text: t.text, subject_id: SUBJECTS[t.subject].id,
    status: t.worked > 0 && t.planned === 0 ? 'done' : t.worked > 0 ? 'in_progress' : 'nothing',
    date: dateKey(dayAt(t.firstDay)), estimated_minutes: Math.max(15, round5((t.worked + t.planned) * between(0.82, 1.18))),
    due_date: null, kind: t.kind, notes: null, order: i, assignment_id: null,
  }));

  const subjects: Row[] = SUBJECT_KEYS.map((k, i) => ({
    id: SUBJECTS[k].id, user_id: u, name: SUBJECTS[k].name, color: SUBJECTS[k].color,
    source: SUBJECTS[k].courseId ? 'canvas' : 'manual', archived: false, order: i,
    total_time_today: 0, canvas_course_id: SUBJECTS[k].courseId ?? null,
  }));

  const settings: Row[] = [{ user_id: u, data: demoSettings() }];

  const docs: [string, SubjectKey | null, string, string, number, number, string][] = [
    ['CHEM 2410 Syllabus — Fall 2026.pdf', 'orgo', 'syllabus', 'application/pdf', 412_880, -60, 'CHEM 2410 Organic Chemistry I. Prof. Alvarez. Midterm 1 covers chapters 1–7. Problem sets due Fridays 11:59 PM. Lab reports due Mondays before lab.'],
    ['Orgo Lecture 18 — SN1 vs SN2.pdf', 'orgo', 'slides', 'application/pdf', 3_204_112, -4, 'Substitution reactions: SN1 proceeds through a carbocation, SN2 is concerted with backside attack and inversion of configuration.'],
    ['Midterm 1 practice exam (2025).pdf', 'orgo', 'guide', 'application/pdf', 988_441, -2, 'Practice midterm: nomenclature, stereochemistry, acid/base, substitution and elimination.'],
    ['Lab 4 — Extraction handout.pdf', 'orgo', 'assignment', 'application/pdf', 655_020, -8, 'Liquid–liquid extraction of benzoic acid and naphthalene.'],
    ['MATH 2210 Syllabus.pdf', 'calc', 'syllabus', 'application/pdf', 286_004, -60, 'Calculus III. Vectors, partial derivatives, multiple integrals. WebAssign due Tue/Thu.'],
    ['Calc III — §14.3 partial derivatives notes.pdf', 'calc', 'notes', 'application/pdf', 1_442_310, -3, 'Partial derivatives, Clairaut’s theorem, tangent planes.'],
    ['PHYS 2213 Syllabus.pdf', 'phys', 'syllabus', 'application/pdf', 301_557, -60, 'Physics II: Electricity & Magnetism. Prelims in weeks 5 and 10.'],
    ['PHYS 2213 Reading guide.pdf', 'phys', 'guide', 'application/pdf', 188_402, -20, READING_GUIDE_TEXT()],
    ['Gauss’s law worked examples.pdf', 'phys', 'guide', 'application/pdf', 2_115_870, -11, 'Gauss’s law for spherical, cylindrical and planar symmetry.'],
    ['BIOL 2500 Syllabus.pdf', 'bio', 'syllabus', 'application/pdf', 350_210, -60, 'Cell Biology. Reading quizzes Tuesdays. Paper summaries 2 and 3.'],
    ['Alberts Ch. 12 outline.docx', 'bio', 'notes', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 48_332, -5, 'Intracellular compartments and protein sorting.'],
    ['CRISPRi screens — Gilbert et al.pdf', 'bio', 'reading', 'application/pdf', 5_880_310, -1, 'Genome-scale CRISPR-mediated control of gene repression and activation.'],
    ['PSYC 1101 Exam 1 study guide.pdf', 'psych', 'guide', 'application/pdf', 512_098, -1, 'Exam 1: research methods, neuroscience, sensation and perception, learning.'],
    ['MCAT study schedule 2026–27.pdf', 'mcat', 'other', 'application/pdf', 120_774, -40, 'Content review through December, full-lengths from February.'],
  ];
  const documents: Row[] = docs.map(([name, key, type, mime, size, offset, text]) => {
    const id = uuid('e5000000');
    return {
      id, user_id: u, subject_id: key ? SUBJECTS[key].id : null, file_name: name,
      storage_path: `${u}/${id}-${name}`, file_type: mime, size_bytes: size, doc_type: type,
      created_at: atMinute(dayAt(offset), mins('21:14')).toISOString(),
      extraction_status: 'done', extracted_text: text,
    };
  });

  const chat = (offset: number, title: string, pairs: [string, string][]): Row => {
    const id = uuid('f6000000');
    return {
      id, user_id: u, date: dateKey(dayAt(offset)), title, subject_key: null,
      created_at: atMinute(dayAt(offset), mins('22:05')).toISOString(),
      messages: pairs.flatMap(([q, a], i) => [
        { id: `${id}-u${i}`, role: 'user', content: q },
        { id: `${id}-a${i}`, role: 'assistant', content: a },
      ]),
    };
  };
  const chatSessions: Row[] = [
    chat(-1, 'Plan my week around the orgo midterm', [
      ['My orgo midterm is next week and I still have calc and physics homework. Can you help me plan?',
        'Here’s how I’d split the next 7 days:\n\n- Orgo: 2 hours a day, mostly practice exams and mechanism review. Start with Prof. Alvarez’s 2025 practice exam since it’s already in your documents.\n- Calc III: WebAssign Tue/Thu nights (about 1 hour each), plus the written set on Wednesday.\n- Physics II: Mastering HW on Friday afternoon after discussion.\n- Keep Wednesday evening light — you have Pre-Med Society at 7.\n\nYou’ve been averaging just over 7 hours a day, so this fits without cutting into sleep.'],
    ]),
    chat(-4, 'SN1 vs SN2 — quick explanation', [
      ['explain sn1 vs sn2 like I have an exam tomorrow',
        'SN2: one step. The nucleophile attacks from the back as the leaving group leaves, so the stereocenter inverts. It’s fast with methyl/primary carbons, strong nucleophiles and polar aprotic solvents.\n\nSN1: two steps. The leaving group leaves first and makes a flat carbocation, then the nucleophile attacks from either side, so you get a racemic mix. It favours tertiary carbons, weak nucleophiles and polar protic solvents.\n\nQuick test: tertiary → SN1. Primary → SN2. Secondary → look at the nucleophile and the solvent.'],
    ]),
    chat(-9, 'How much did I study this week?', [
      ['how much did i study this week',
        'You logged 51 hours over the last 7 days, an average of 7.3 hours a day. Organic Chemistry took the most (14.2 h), then Calculus III and Physics II. Your most focused hours are 8–11 PM.'],
    ]),
  ];

  const courseItems = readingProgress(u, nowMinute, todos, todoSessions, timerSessions, documents);

  return {
    subjects, todos, todo_sessions: todoSessions, timer_sessions: timerSessions,
    settings, documents, chat_sessions: chatSessions, active_timer: [], elapsed_time: [],
    course_items: courseItems,
  };
}

// ── reading list ──────────────────────────────────────────────────────────
// Physics II's reading guide, section by section. The student is two readings
// behind: one block ended today without being checked off, and the next one
// is still ahead — so both "How far did you get?" and "Stopped at…" show.
const READINGS: [string, string, number][] = [
  ['21.1–21.4', 'Electric charge and Coulomb’s law', -8],
  ['21.5–21.7', 'Electric field and field lines', -6],
  ['22.1–22.5', 'Gauss’s law', -1],
  ['23.1–23.3', 'Electric potential energy', 1],
  ['23.4–23.6', 'Equipotential surfaces', 3],
  ['24.1–24.4', 'Capacitance and dielectrics', 6],
];
const sectionsOf = (range: string) => {
  const [a, b] = range.split('–'); const [ch, from] = a.split('.').map(Number); const to = Number(b.split('.')[1]);
  return Array.from({ length: to - from + 1 }, (_, i) => `${ch}.${from + i}`);
};
export const READING_GUIDE_TEXT = () => `PHYS 2213 — Reading guide, Fall 2026 (Young & Freedman, 15th ed.)\nRead each assignment before the lecture it is listed under.\n\n${READINGS.map(([range, topic, offset]) => `• ${range}  ${topic} — due ${dateKey(dayAt(offset))}`).join('\n')}\n\nProblem sets are listed on Canvas.`;

function readingProgress(u: string, nowMinute: number, todos: Row[], todoSessions: Row[], timerSessions: Row[], documents: Row[]): Row[] {
  const phys = SUBJECTS.phys.id;
  const guide = documents.find(d => d.file_name === 'PHYS 2213 Reading guide.pdf');
  const items: Row[] = [];
  let position = 0;
  for (const [range, topic, offset] of READINGS) for (const label of sectionsOf(range)) {
    items.push({ id: uuid('e7000000'), user_id: u, subject_id: phys, label, title: topic, due_date: dateKey(dayAt(offset)), position: position++, done_at: offset <= -8 ? atMinute(dayAt(offset - 1), mins('22:10')).toISOString() : null, todo_id: null, document_id: guide?.id ?? null, created_at: atMinute(dayAt(-20), mins('21:30')).toISOString() });
  }
  // A block that has already ended today (or last night, early in the morning),
  // and one still to come.
  const ended = nowMinute >= mins('09:40') ? { day: 0, start: Math.floor((nowMinute - 150) / 15) * 15 } : { day: -1, start: mins('21:00') };
  const aheadStart = Math.ceil((nowMinute + 30) / 15) * 15;
  const ahead = aheadStart + 60 <= mins('23:30') ? { day: 0, start: Math.max(aheadStart, mins('19:45')) } : { day: 1, start: mins('20:00') };
  const plan = (range: string, topic: string, at: { day: number; start: number }) => {
    const id = uuid('b2000000');
    const date = dateKey(dayAt(at.day));
    const from = atMinute(dayAt(at.day), at.start), to = atMinute(dayAt(at.day), at.start + 60);
    // Clear whatever the generator put in that hour so the block reads cleanly.
    const clash = (r: Row) => r.date === date && new Date(String(r.start_time)) < to && new Date(String(r.end_time)) > from;
    for (let i = todoSessions.length - 1; i >= 0; i--) if (clash(todoSessions[i])) todoSessions.splice(i, 1);
    for (let i = timerSessions.length - 1; i >= 0; i--) if (clash(timerSessions[i])) timerSessions.splice(i, 1);
    todos.push({ id, user_id: u, text: `Physics reading: ${range} ${topic}`, subject_id: phys, status: 'nothing', date, estimated_minutes: 60, due_date: null, kind: 'reading', notes: null, order: todos.length, assignment_id: null });
    todoSessions.push({ id: uuid('c3000000'), user_id: u, todo_id: id, date, start_time: from.toISOString(), end_time: to.toISOString() });
    for (const label of sectionsOf(range)) { const item = items.find(x => x.label === label); if (item) item.todo_id = id; }
  };
  plan('22.1–22.5', 'Gauss’s law', ended);
  // Worked on for a while, never checked off: the bookmark shows, and Soma asks.
  const from = atMinute(dayAt(ended.day), ended.start + 5);
  timerSessions.push({ id: uuid('d4000000'), user_id: u, subject_id: phys, subject_name: SUBJECTS.phys.name, task_text: 'Physics reading: 22.1–22.5 Gauss’s law', start_time: from.toISOString(), end_time: new Date(+from + 40 * 60000).toISOString(), duration_seconds: 40 * 60, date: dateKey(dayAt(ended.day)) });
  plan('21.5–21.7', 'Electric field and field lines', ahead);
  return items;
}

export function demoSettings() {
  return {
    studyWindow: { start: '07:00', end: '23:59' },
    theme: 'light' as 'light' | 'dark',
    timeFormat: '12h' as const,
    canvasIcalUrl: 'https://canvas.instructure.com/feeds/calendars/user_demo.ics',
    onboardingCompleted: true,
    educationLevel: 'college',
    birthYear: 2006,
  };
}
