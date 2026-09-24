/**
 * The demo student: a sophomore at the University of Michigan taking a
 * CS + pre-med-ish load. Everything is generated relative to today so the
 * demo always looks current.
 */
import type { CanvasAssignment, GoogleCalendarEvent } from '../types';

export const DEMO_USER = {
  id: 'demo-0000-4000-8000-soma',
  email: 'maya.demo@somastudy.app',
  name: 'Maya Chen',
};

// ── helpers ──────────────────────────────────────────────────────────────
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export function dayAt(offset: number, hhmm = '00:00'): Date {
  const d = today0();
  d.setDate(d.getDate() + offset);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let counter = 0;
const id = (p: string) => `${p}-${(++counter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ── courses ──────────────────────────────────────────────────────────────
export const SUBJECTS = [
  { id: 'sub-eecs281', name: 'EECS 281', long: 'Data Structures & Algorithms', color: '#42a5f5', courseId: 281001 },
  { id: 'sub-math215', name: 'MATH 215', long: 'Calculus III', color: '#ab47bc', courseId: 215001 },
  { id: 'sub-chem210', name: 'CHEM 210', long: 'Structure & Reactivity I (Orgo)', color: '#66bb6a', courseId: 210001 },
  { id: 'sub-chem211', name: 'CHEM 211', long: 'Orgo Lab', color: '#26c6da', courseId: 211001 },
  { id: 'sub-stats250', name: 'STATS 250', long: 'Intro to Statistics & Data Analysis', color: '#ffa726', courseId: 250001 },
  { id: 'sub-engl125', name: 'ENGLISH 125', long: 'Writing & Academic Inquiry', color: '#ec407a', courseId: 125001 },
] as const;
export type SubjectName = typeof SUBJECTS[number]['name'];
const sub = (name: SubjectName) => SUBJECTS.find(s => s.name === name)!;

// ── weekly calendar (Google, read-only) ──────────────────────────────────
type Recurring = { days: number[]; start: string; end: string; title: string; cal: 'classes' | 'personal' };
const WEEKLY: Recurring[] = [
  { days: [1, 3, 5], start: '09:00', end: '09:50', title: 'CHEM 210 Lecture · Chem 1800', cal: 'classes' },
  { days: [1, 3], start: '10:30', end: '12:00', title: 'EECS 281 Lecture · 1670 Beyster', cal: 'classes' },
  { days: [1, 3, 5], start: '13:00', end: '13:50', title: 'MATH 215 Lecture · East Hall 1360', cal: 'classes' },
  { days: [2, 4], start: '10:00', end: '11:30', title: 'STATS 250 Lecture · Angell Aud. A', cal: 'classes' },
  { days: [2, 4], start: '11:45', end: '13:15', title: 'ENGLISH 125 Seminar · Angell 2011', cal: 'classes' },
  { days: [2], start: '14:00', end: '17:00', title: 'CHEM 211 Lab · Chem B-level', cal: 'classes' },
  { days: [4], start: '14:00', end: '15:00', title: 'STATS 250 Lab · Mason 2325', cal: 'classes' },
  { days: [4], start: '16:00', end: '16:50', title: 'MATH 215 Discussion · East Hall 1084', cal: 'classes' },
  { days: [5], start: '14:30', end: '16:30', title: 'EECS 281 Lab · BBB 1695', cal: 'classes' },
  { days: [2], start: '19:00', end: '20:00', title: 'EECS 281 Office Hours · BBB 1637', cal: 'classes' },
  { days: [4], start: '19:00', end: '20:15', title: 'CHEM 210 SI Session · Chem 1210', cal: 'classes' },
  { days: [1], start: '18:30', end: '19:30', title: 'SWE General Meeting · Stamps Auditorium', cal: 'personal' },
  { days: [3], start: '17:00', end: '20:00', title: 'Shift — Shapiro Library front desk', cal: 'personal' },
  { days: [0], start: '13:00', end: '16:00', title: 'Shift — Shapiro Library front desk', cal: 'personal' },
  { days: [3], start: '20:30', end: '21:30', title: 'IM soccer vs. Theta Chi · Mitchell Field', cal: 'personal' },
  { days: [5], start: '19:30', end: '22:00', title: 'Dinner + movie w/ roommates', cal: 'personal' },
  { days: [6], start: '11:00', end: '16:00', title: 'Game day — tailgate + Big House', cal: 'personal' },
  { days: [0], start: '10:30', end: '11:30', title: 'Brunch w/ Priya & Jordan · Fleetwood', cal: 'personal' },
  { days: [2, 4], start: '07:15', end: '08:00', title: 'Gym — CCRB', cal: 'personal' },
];
const ONE_OFF: { day: number; start: string; end: string; title: string; cal: 'classes' | 'personal' }[] = [
  { day: 2, start: '12:15', end: '12:45', title: 'Coffee chat — Google STEP recruiter (Zoom)', cal: 'personal' },
  { day: 3, start: '17:30', end: '18:00', title: 'Flu shot — UHS', cal: 'personal' },
  { day: 4, start: '20:00', end: '21:30', title: 'MATH 215 Exam 1 Review · East Hall 1324', cal: 'classes' },
  { day: 5, start: '10:00', end: '12:30', title: 'Engineering Career Fair · Duderstadt', cal: 'personal' },
  { day: 6, start: '18:00', end: '20:00', title: 'MATH 215 Midterm 1 · Chem 1800', cal: 'classes' },
  { day: 9, start: '19:00', end: '21:00', title: 'CHEM 210 Exam 1 · Dow Auditorium', cal: 'classes' },
  { day: 11, start: '17:00', end: '18:00', title: 'Research lab interview — Prof. Kim (NCRC)', cal: 'personal' },
  { day: 12, start: '18:00', end: '21:00', title: 'MHacks info night · Duderstadt', cal: 'personal' },
];
const CALS = {
  classes: { calendarId: 'umich-classes', calendarSummary: 'UMich Classes', color: '#4285f4' },
  personal: { calendarId: 'primary', calendarSummary: 'Maya', color: '#33b679' },
};

export function calendarEvents(timeMin: string, timeMax: string): GoogleCalendarEvent[] {
  const from = new Date(timeMin), to = new Date(timeMax);
  const out: GoogleCalendarEvent[] = [];
  const startOff = Math.floor((+from - +today0()) / 86_400_000) - 1;
  const endOff = Math.ceil((+to - +today0()) / 86_400_000) + 1;
  const push = (off: number, e: { start: string; end: string; title: string; cal: 'classes' | 'personal' }, key: string) => {
    const s = dayAt(off, e.start), en = dayAt(off, e.end);
    if (en <= from || s >= to) return;
    out.push({
      id: `${key}-${ymd(s)}`,
      summary: e.title,
      start: { dateTime: s.toISOString() },
      end: { dateTime: en.toISOString() },
      source: { connectionId: 'demo-google', googleEmail: 'maya.chen.demo@gmail.com', ...CALS[e.cal] },
    });
  };
  for (let off = startOff; off <= endOff; off++) {
    const wd = dayAt(off).getDay();
    WEEKLY.forEach((e, i) => { if (e.days.includes(wd)) push(off, e, `w${i}`); });
    ONE_OFF.forEach((e, i) => { if (e.day === off) push(off, e, `o${i}`); });
  }
  return out;
}

// ── Canvas assignments (deadlines) ───────────────────────────────────────
const ASSIGNMENTS: { course: SubjectName; name: string; due: number; time: string; pts: number; desc?: string }[] = [
  { course: 'MATH 215', name: 'WebWork 5 — Partial Derivatives & Chain Rule', due: 0, time: '23:59', pts: 20 },
  { course: 'STATS 250', name: 'Lab 5 — Sampling Distributions (R)', due: 1, time: '10:00', pts: 15 },
  { course: 'ENGLISH 125', name: "Reading response: They Say / I Say ch. 4–5", due: 1, time: '11:45', pts: 5 },
  { course: 'EECS 281', name: 'Lab 4 — Heaps & Priority Queues (autograder)', due: 1, time: '23:59', pts: 10 },
  { course: 'CHEM 210', name: 'Mastering Chem — Ch. 5 Stereochemistry', due: 2, time: '23:59', pts: 12 },
  { course: 'ENGLISH 125', name: 'Essay 2 Draft — Rhetorical Analysis (1,800 words)', due: 2, time: '23:59', pts: 50 },
  { course: 'CHEM 211', name: 'Pre-lab: Extraction of Caffeine', due: 3, time: '14:00', pts: 10 },
  { course: 'MATH 215', name: 'Problem Set 4 — §14.3–14.7', due: 3, time: '16:00', pts: 40 },
  { course: 'EECS 281', name: 'Project 2 — Priority Queues (Zombie Defense)', due: 4, time: '23:59', pts: 100, desc: 'Implement Sorted, Binary, Pairing heaps; pass all autograder tests and memory checks.' },
  { course: 'CHEM 211', name: 'Lab Report 2 — Recrystallization of Acetanilide', due: 5, time: '23:59', pts: 40 },
  { course: 'STATS 250', name: 'Homework 4 — Confidence Intervals', due: 5, time: '23:59', pts: 30 },
  { course: 'MATH 215', name: 'Midterm 1 (Ch. 12–14)', due: 6, time: '18:00', pts: 150 },
  { course: 'ENGLISH 125', name: 'Peer review — Essay 2 (2 partners)', due: 6, time: '23:59', pts: 10 },
  { course: 'MATH 215', name: 'WebWork 6 — Lagrange Multipliers', due: 8, time: '23:59', pts: 20 },
  { course: 'CHEM 210', name: 'Exam 1 (Ch. 1–6)', due: 9, time: '19:00', pts: 200 },
  { course: 'STATS 250', name: 'Lab 6 — Hypothesis Testing', due: 8, time: '10:00', pts: 15 },
  { course: 'EECS 281', name: 'Project 3 — Hash Tables (Logman)', due: 18, time: '23:59', pts: 100 },
  { course: 'ENGLISH 125', name: 'Essay 2 Final + Reflection', due: 13, time: '23:59', pts: 100 },
];

export function canvasAssignments(): CanvasAssignment[] {
  return ASSIGNMENTS.map((a, i) => {
    const s = sub(a.course);
    const due = dayAt(a.due, a.time);
    const submitted = a.due < 0;
    return {
      id: 900100 + i,
      name: a.name,
      courseId: s.courseId,
      courseName: s.name,
      dueAt: due.toISOString(),
      htmlUrl: `https://umich.instructure.com/courses/${s.courseId}/assignments/${900100 + i}`,
      status: submitted ? 'done' : a.due <= 1 && i % 2 === 0 ? 'in_progress' : 'not_started',
      description: a.desc,
      submittedAt: submitted ? dayAt(a.due, '21:40').toISOString() : null,
      score: submitted ? Math.round(a.pts * (0.86 + (i % 3) * 0.05)) : null,
      pointsPossible: a.pts,
    };
  });
}

/** What each course expects before its next meeting — used by the demo AI. */
export const CLASS_PREP: Record<string, string> = {
  'CHEM 210': 'Skim Klein 5.3–5.5 (R/S + meso compounds) — there\'s an iClicker quiz in the first 5 min',
  'EECS 281': 'Read the Pairing Heap slides before lecture; bring P2 questions — Prof. Paoletti is doing live debugging',
  'MATH 215': 'Try §14.7 #11–19 (optimization) so discussion isn\'t the first time you see them',
  'STATS 250': 'Lab 5 is due at 10:00 before lecture — knit the R Markdown and upload the PDF to Gradescope',
  'ENGLISH 125': 'Reading response on They Say / I Say ch. 4–5 is due at the start of seminar; bring a printed essay draft outline',
  'CHEM 211': 'Pre-lab for caffeine extraction: safety table + flowchart in your notebook, or you can\'t start the lab',
};

// ── Supabase tables ──────────────────────────────────────────────────────
type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

// Study tasks the student has planned. day/start/end place them on the plan.
type Planned = { s: SubjectName; t: string; day: number; start?: string; end?: string; status?: 'done' | 'in_progress' | 'nothing'; est?: number; kind?: string };
const PLAN: Planned[] = [
  // past week
  { s: 'EECS 281', t: 'P2: implement SortedPQ + BinaryPQ', day: -6, start: '15:00', end: '17:30', status: 'done', est: 120 },
  { s: 'CHEM 210', t: 'Klein Ch. 4 practice problems 4.12–4.30', day: -6, start: '20:00', end: '21:15', status: 'done', est: 60 },
  { s: 'MATH 215', t: 'WebWork 4', day: -5, start: '14:30', end: '15:45', status: 'done', est: 60 },
  { s: 'ENGLISH 125', t: 'Essay 2: pick artifact + thesis brainstorm', day: -5, start: '20:30', end: '21:30', status: 'done', est: 45 },
  { s: 'STATS 250', t: 'Lab 4 — Normal distributions', day: -4, start: '08:15', end: '09:45', status: 'done', est: 75 },
  { s: 'EECS 281', t: 'P2: pairing heap — meld + updatePriorities', day: -4, start: '17:30', end: '20:00', status: 'in_progress', est: 120 },
  { s: 'CHEM 211', t: 'Lab Report 2 — data table + yield calc', day: -3, start: '18:00', end: '19:15', status: 'done', est: 60 },
  { s: 'EECS 281', t: 'Lab 3 — Stacks & Queues', day: -3, start: '21:00', end: '22:30', status: 'done', est: 60 },
  { s: 'CHEM 210', t: 'Mastering Chem Ch. 4', day: -2, start: '14:00', end: '15:10', status: 'done', est: 45 },
  { s: 'MATH 215', t: 'Problem Set 4 — §14.3 & 14.4', day: -2, start: '19:30', end: '21:30', status: 'in_progress', est: 90 },
  { s: 'ENGLISH 125', t: 'Essay 2: outline + 3 body paragraphs', day: -1, start: '14:00', end: '15:30', status: 'done', est: 90 },
  { s: 'EECS 281', t: 'P2: debug valgrind leaks', day: -1, start: '16:30', end: '18:30', status: 'done', est: 60 },
  { s: 'CHEM 210', t: 'Anki — reagents + mechanisms deck', day: -1, start: '22:00', end: '22:30', status: 'done', est: 20 },
  // today
  { s: 'MATH 215', t: 'WebWork 5 — first 8 problems', day: 0, start: '08:00', end: '08:55', status: 'done', est: 45 },
  { s: 'CHEM 211', t: 'Email Prof. Alvarez re: lab report regrade', day: 0, status: 'nothing', est: 10 },
  { s: 'CHEM 210', t: 'Anki — stereochem flashcards', day: 0, start: '22:30', end: '23:00', est: 20 },
  // coming up
  { s: 'EECS 281', t: 'P2: pass remaining autograder tests', day: 1, start: '20:30', end: '22:30', est: 120 },
  { s: 'CHEM 210', t: 'Mastering Chem Ch. 5 — Stereochemistry', day: 2, start: '15:00', end: '16:15', est: 60 },
  { s: 'ENGLISH 125', t: 'Essay 2 Draft — finish conclusion + cite sources', day: 2, start: '21:00', end: '22:30', est: 90 },
  { s: 'MATH 215', t: 'Midterm 1: redo practice exam Fall 2025', day: 3, start: '14:00', end: '16:00', est: 120 },
  { s: 'STATS 250', t: 'HW 4 — confidence intervals Q1–6', day: 4, start: '09:00', end: '10:30', est: 75 },
  { s: 'MATH 215', t: 'Midterm 1: formula sheet + weak topics', day: 5, start: '15:00', end: '17:00', est: 90 },
  { s: 'CHEM 210', t: 'Exam 1: redo SI worksheets 1–4', day: 7, start: '14:00', end: '16:30', est: 120 },
  { s: 'CHEM 211', t: 'Lab Report 2 — intro + methods', day: 1, start: '17:00', end: '18:00', est: 60 },
  { s: 'STATS 250', t: 'Review CLT lecture notes', day: 1, start: '08:15', end: '08:45', est: 30 },
  { s: 'EECS 281', t: 'P2: write test cases for pairing heap', day: 2, start: '19:00', end: '20:30', est: 90 },
  { s: 'MATH 215', t: 'PS4 §14.5 (#1–8)', day: 2, start: '10:00', end: '11:00', est: 60 },
  { s: 'CHEM 211', t: 'Pre-lab: caffeine extraction notebook', day: 3, start: '10:30', end: '11:15', est: 30 },
  { s: 'EECS 281', t: 'P2: final submit + valgrind check', day: 3, start: '19:30', end: '21:30', est: 90 },
  { s: 'ENGLISH 125', t: 'Essay 2 peer review — read partner drafts', day: 4, start: '15:15', end: '16:15', est: 60 },
  { s: 'CHEM 210', t: 'Exam 1: Klein Ch. 5 skill builders', day: 4, start: '21:30', end: '22:45', est: 75 },
  { s: 'STATS 250', t: 'HW 4 — Q7–12 + submit', day: 5, start: '17:30', end: '18:30', est: 60 },
  { s: 'MATH 215', t: 'Midterm 1: last-look formula sheet', day: 6, start: '15:00', end: '16:00', est: 45 },
  { s: 'CHEM 210', t: 'Exam 1: mechanisms + acid/base drills', day: 6, start: '20:30', end: '22:00', est: 90 },
];

// Extra history for Insights (older than the week of plans).
const HISTORY_TASKS: Record<SubjectName, string[]> = {
  'EECS 281': ['P1: Letterman — path search', 'P1: debug output mode', 'Lecture review — complexity analysis', 'Lab 2 — Big-O worksheet', 'P2: read spec + starter code'],
  'MATH 215': ['WebWork 3', 'Problem Set 3', 'Review §13.1–13.4 notes', 'Problem Set 2'],
  'CHEM 210': ['Klein Ch. 3 problems', 'SI worksheet 2', 'Mastering Chem Ch. 3', 'Molecular model kit practice'],
  'CHEM 211': ['Lab Report 1 — melting point', 'Pre-lab: recrystallization'],
  'STATS 250': ['Lab 3 — Describing data in R', 'Homework 3', 'Homework 2'],
  'ENGLISH 125': ['Essay 1 final revisions', 'Reading response — Bartholomae', 'Essay 1 draft'],
};
const HOURS = [8, 9, 14, 15, 16, 17, 19, 20, 21, 22];

export function buildTables(): Tables {
  counter = 0;
  const r = rng(20260924);
  const uid = DEMO_USER.id;
  const subjects = SUBJECTS.map((s, i) => ({
    id: s.id, user_id: uid, name: s.name, color: s.color, source: 'canvas', archived: false,
    order: i, total_time_today: 0, canvas_course_id: s.courseId,
  }));
  const todos: Row[] = [];
  const todoSessions: Row[] = [];
  const timerSessions: Row[] = [];
  const addTimer = (subject: SubjectName, task: string, start: Date, minutes: number) => {
    const end = new Date(+start + minutes * 60_000);
    timerSessions.push({
      id: id('ts'), user_id: uid, subject_id: sub(subject).id, subject_name: subject, task_text: task,
      start_time: start.toISOString(), end_time: end.toISOString(), duration_seconds: minutes * 60, date: ymd(start),
    });
  };

  for (const p of PLAN) {
    const todoId = id('todo');
    todos.push({
      id: todoId, user_id: uid, text: p.t, status: p.status ?? 'nothing', subject_id: sub(p.s).id,
      assignment_id: null, date: ymd(dayAt(p.day)), estimated_minutes: p.est ?? null, due_date: null,
      kind: p.kind ?? null, notes: null, order: null,
    });
    if (p.start && p.end) {
      const s = dayAt(p.day, p.start), e = dayAt(p.day, p.end);
      todoSessions.push({ id: id('tsn'), user_id: uid, todo_id: todoId, date: ymd(s), start_time: s.toISOString(), end_time: e.toISOString() });
      if (p.status === 'done' || p.status === 'in_progress') {
        const planned = (+e - +s) / 60_000;
        const worked = Math.round(planned * (p.status === 'done' ? 0.85 + r() * 0.3 : 0.45 + r() * 0.2));
        addTimer(p.s, p.t, s, worked);
      }
    }
  }

  // ~10 weeks of study history with a live streak.
  const names = SUBJECTS.map(s => s.name) as SubjectName[];
  for (let day = -70; day <= -1; day++) {
    const wd = dayAt(day).getDay();
    const skip = day < -14 && r() < (wd === 6 ? 0.55 : 0.12);
    if (skip) continue;
    const sessions = wd === 6 ? 1 : 1 + Math.floor(r() * 3);
    const hours = [...HOURS].sort(() => r() - 0.5).slice(0, sessions);
    for (const h of hours) {
      // Weight the heavier courses.
      const pick = r();
      const s = pick < 0.3 ? 'EECS 281' : pick < 0.52 ? 'CHEM 210' : pick < 0.72 ? 'MATH 215' : names[Math.floor(r() * names.length)];
      const tasks = HISTORY_TASKS[s];
      const task = tasks[Math.floor(r() * tasks.length)];
      const minutes = 25 + Math.round(r() * (s === 'EECS 281' ? 90 : 55));
      addTimer(s, task, dayAt(day, `${String(h).padStart(2, '0')}:${r() < 0.5 ? '00' : '30'}`), minutes);
    }
  }
  // Older finished tasks with estimates, so estimate accuracy has data.
  for (const [s, tasks] of Object.entries(HISTORY_TASKS) as [SubjectName, string[]][]) {
    for (const t of tasks) {
      if (todos.some(x => x.text === t)) continue;
      todos.push({
        id: id('todo'), user_id: uid, text: t, status: 'done', subject_id: sub(s).id, assignment_id: null,
        date: ymd(dayAt(-20 - Math.floor(r() * 40))),
        estimated_minutes: Math.max(20, Math.round(timerSessions.filter(x => x.task_text === t).reduce((n, x) => n + Number(x.duration_seconds), 0) / 60 * (0.75 + r() * 0.45) / 15) * 15),
        due_date: null, kind: null, notes: null, order: null,
      });
    }
  }

  const docs = [
    { name: 'EECS 281 Syllabus — Fall 2026.pdf', s: 'EECS 281', type: 'syllabus', text: 'EECS 281 Data Structures and Algorithms. Projects 40%, exams 50% (midterm + final), labs 10%. Late days: 2 per project. Office hours in BBB 1637.' },
    { name: 'MATH 215 Midterm 1 Practice (Fall 2025).pdf', s: 'MATH 215', type: 'guide', text: 'Practice midterm covering vectors, lines & planes, partial derivatives, chain rule, directional derivatives, tangent planes, optimization, Lagrange multipliers.' },
    { name: 'Klein Ch. 5 — Stereoisomerism notes.pdf', s: 'CHEM 210', type: 'notes', text: 'Chirality centers, CIP priority rules, R/S assignment, enantiomers vs diastereomers, meso compounds, optical activity, Fischer projections.' },
    { name: 'Essay 2 Prompt — Rhetorical Analysis.docx', s: 'ENGLISH 125', type: 'assignment', text: 'Choose a public artifact and analyze how it persuades a specific audience. 1,800 words, MLA, at least 4 sources.' },
    { name: 'CHEM 211 Lab Manual — Exp. 4 Caffeine.pdf', s: 'CHEM 211', type: 'reading', text: 'Liquid-liquid extraction of caffeine from tea using dichloromethane; sublimation; melting point.' },
    { name: 'STATS 250 Lecture 9 slides.pptx', s: 'STATS 250', type: 'slides', text: 'Sampling distributions, central limit theorem, standard error of the sample proportion and mean.' },
  ];
  const documents = docs.map((d, i) => ({
    id: id('doc'), user_id: uid, subject_id: sub(d.s as SubjectName).id, file_name: d.name,
    storage_path: `${uid}/${d.name}`, file_type: d.name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
    size_bytes: 180_000 + i * 97_000, doc_type: d.type, created_at: dayAt(-3 - i * 4, '20:00').toISOString(),
    extraction_status: 'done', extracted_text: d.text,
  }));

  return {
    subjects,
    todos,
    todo_sessions: todoSessions,
    timer_sessions: timerSessions,
    documents,
    chat_sessions: [],
    active_timer: [],
    elapsed_time: [],
    settings: [{ user_id: uid, data: demoSettings() }],
  };
}

export function demoSettings() {
  const day = { start: '07:00', end: '23:30', blocked: [] as { start: string; end: string }[] };
  const empty = { start: '', end: '', blocked: [] as { start: string; end: string }[] };
  const week = (d: typeof day) => ({ monday: d, tuesday: d, wednesday: d, thursday: d, friday: d, saturday: d, sunday: d });
  return {
    schoolHours: week(empty), workHours: week(empty), personalHours: week(day),
    schoolHoursEnabled: false, workHoursEnabled: false, personalHoursEnabled: true,
    studyPrefs: { defaultSessionMinutes: 50, defaultBreakMinutes: 10, preferredStartTime: '08:00' },
    aiPrefs: { verbosity: 'concise', defaultOutput: 'schedule' },
    theme: 'light', timeFormat: '12h', onboardingCompleted: true, educationLevel: 'college',
    canvasIcalUrl: 'https://umich.instructure.com/feeds/calendars/user_demo.ics',
  };
}
