/**
 * A scripted stand-in for Soma's AI. It reads the same context the real model
 * gets (plan, free time, calendar) and answers the common planning questions
 * with real proposals that go through the dashboard's normal Accept flow.
 */
import { canvasAssignments, CLASS_PREP, SUBJECTS, ymd } from './seed';

type Ctx = {
  today: string; currentTime: string;
  calendar: { offset: number; date: string; weekday: string; isToday: boolean }[];
  plan: { id?: string; date: string; title: string; time: string; subject: string; state: string; readOnly: boolean }[];
  pendingProposals?: { title: string }[];
  freeTime: { date: string; free: string[] }[];
};
type Block = { title: string; subject: string; date: string; start: string; end: string };

const mins = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const clock = (s: string) => {
  const m = mins(s), h = Math.floor(m / 60) % 24, mm = m % 60;
  return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
const clockOf = (d: Date) => clock(`${d.getHours()}:${d.getMinutes()}`);

const PREP_TITLE: Record<string, string> = {
  'CHEM 210': 'CHEM 210 prep — skim Klein 5.3–5.5 before iClicker quiz',
  'EECS 281': 'EECS 281 prep — pairing heap slides + write P2 questions',
  'MATH 215': 'MATH 215 prep — attempt §14.7 #11–19',
  'CHEM 211': 'CHEM 211 prep — safety table + flowchart',
};

/** Study blocks worth doing for each upcoming deadline. */
const WORK: { match: string; title: string; minutes: number }[] = [
  { match: 'WebWork 5', title: 'Finish WebWork 5 (problems 9–16)', minutes: 45 },
  { match: 'Lab 5 — Sampling', title: 'STATS Lab 5 — finish R code, knit + submit', minutes: 50 },
  { match: 'Reading response', title: 'Read They Say / I Say ch. 4–5 + write response', minutes: 40 },
  { match: 'Lab 4 — Heaps', title: 'EECS Lab 4 — heaps, get autograder to 10/10', minutes: 60 },
  { match: 'Mastering Chem — Ch. 5', title: 'Mastering Chem Ch. 5 — R/S + meso problems', minutes: 50 },
  { match: 'Essay 2 Draft', title: 'Essay 2 draft — body ¶4–5 + conclusion', minutes: 75 },
  { match: 'Pre-lab', title: 'CHEM 211 pre-lab — caffeine extraction flowchart', minutes: 30 },
  { match: 'Problem Set 4', title: 'PS4 §14.5–14.7 (#1–12)', minutes: 90 },
  { match: 'Project 2', title: 'P2: pairing heap updatePriorities + edge-case tests', minutes: 120 },
  { match: 'Lab Report 2', title: 'Lab Report 2 — discussion + error analysis', minutes: 60 },
  { match: 'Homework 4', title: 'STATS HW 4 — confidence intervals Q7–12', minutes: 60 },
  { match: 'Midterm 1', title: 'MATH 215 Midterm prep — timed practice exam', minutes: 90 },
  { match: 'Exam 1', title: 'CHEM 210 Exam 1 — mechanisms + SI worksheet 5', minutes: 90 },
];

function upcoming(now = new Date()) {
  return canvasAssignments()
    .filter(a => !a.submittedAt && new Date(a.dueAt) > now)
    .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt));
}
const dueLabel = (iso: string, ctx: Ctx) => {
  const d = new Date(iso), key = ymd(d);
  const cal = ctx.calendar.find(c => c.date === key);
  const day = cal?.isToday ? 'today' : cal?.offset === 1 ? 'tomorrow' : cal ? cal.weekday : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${day} at ${clockOf(d)}`;
};

/** Greedily fits work into a day's open slots, keeping dinner free. */
function place(ctx: Ctx, date: string, items: { title: string; subject: string; minutes: number }[], taken: Block[], max = 4, after = 9 * 60): Block[] {
  const slotStrs = ctx.freeTime.find(f => f.date === date)?.free ?? [];
  let slots = slotStrs.map(s => s.split('–').map(mins) as [number, number]);
  // Keep 6–7pm free for dinner, and leave room after anything already placed.
  const busy: [number, number][] = [[18 * 60, 19 * 60], ...taken.filter(b => b.date === date).map(t => [mins(t.start), mins(t.end) + 10] as [number, number])];
  for (const [ta, tb] of busy) {
    slots = slots.flatMap(([a, b]): [number, number][] => (tb <= a || ta >= b) ? [[a, b]] : [[a, Math.min(b, ta)], [Math.max(a, tb), b]]);
  }
  slots = slots.map(([a, b]) => [Math.max(8 * 60, Math.ceil((a + (a % 60 ? 5 : 0)) / 15) * 15), Math.min(b, 22 * 60 + 45)] as [number, number]).filter(([a, b]) => b - a >= 30)
    // Prefer times after `after` (nobody wants a 7 AM block), then earliest.
    .sort((x, y) => Number(x[0] < after) - Number(y[0] < after) || x[0] - y[0]);
  const out: Block[] = [];
  for (const item of items) {
    if (out.length >= max) break;
    const i = slots.findIndex(([a, b]) => b - a >= Math.min(item.minutes, 45));
    if (i < 0) continue;
    const [a, b] = slots[i];
    const len = Math.min(item.minutes, b - a, 240);
    out.push({ title: item.title, subject: item.subject, date, start: hhmm(a), end: hhmm(a + len) });
    slots[i] = [a + len + 15, b];
    if (slots[i][1] - slots[i][0] < 30) slots.splice(i, 1);
  }
  return out;
}

function workItems(ctx: Ctx, filter?: (courseName: string) => boolean) {
  const existing = new Set([...ctx.plan.map(p => p.title), ...(ctx.pendingProposals ?? []).map(p => p.title)]);
  return upcoming()
    .filter(a => !filter || filter(a.courseName))
    .map(a => {
      const w = WORK.find(x => a.name.includes(x.match));
      return w ? { title: w.title, subject: a.courseName, minutes: w.minutes, due: a.dueAt, name: a.name } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x && !existing.has(x.title));
}

const remainingCommitments = (ctx: Ctx, date: string, afterNow: boolean) =>
  ctx.plan
    .filter(p => p.readOnly && p.date === date && p.time)
    .filter(p => !afterNow || mins(p.time.split('–')[1]) > mins(ctx.currentTime))
    .sort((a, b) => mins(a.time) - mins(b.time));

const totalHours = (blocks: Block[]) => {
  const m = blocks.reduce((n, b) => n + mins(b.end) - mins(b.start), 0);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
};
const blockLines = (blocks: Block[], ctx: Ctx) => [...blocks].sort((a, b) => a.date.localeCompare(b.date) || mins(a.start) - mins(b.start)).map(b => {
  const cal = ctx.calendar.find(c => c.date === b.date);
  const day = cal?.isToday ? '' : `${cal?.weekday.slice(0, 3) ?? ''} `;
  return `- ${day}${clock(b.start)}–${clock(b.end)}  ${b.title}`;
}).join('\n');

function planDay(ctx: Ctx) {
  const today = ctx.calendar[0], tomorrow = ctx.calendar[1];
  const items = workItems(ctx);
  let target = today;
  let blocks = place(ctx, today.date, items, []);
  if (blocks.length < 2) { target = tomorrow; blocks = place(ctx, tomorrow.date, items.filter(i => ymd(new Date(i.due)) >= tomorrow.date), []); }
  const isToday = target === today;
  const tonight = !isToday ? upcoming().filter(a => ymd(new Date(a.dueAt)) === today.date) : [];
  const classes = remainingCommitments(ctx, target.date, isToday);
  const urgent = upcoming().filter(a => ymd(new Date(a.dueAt)) <= tomorrow.date && !tonight.some(x => x.id === a.id));
  const lines: string[] = [];
  lines.push(isToday
    ? `Here's the rest of your ${target.weekday}, built around what's already on your calendar.`
    : `It's late, so I planned ${target.weekday} instead.${tonight.length ? ` Heads up: ${tonight.map(a => a.name.split(' — ')[0]).join(' and ')} ${tonight.length === 1 ? 'is' : 'are'} still due tonight at ${clockOf(new Date(tonight[0].dueAt))}. Finish ${tonight.length === 1 ? 'it' : 'them'} before bed.` : ''}`);
  if (classes.length) lines.push(`Already locked in:\n${classes.slice(0, 5).map(c => `- ${clock(c.time.split('–')[0])}  ${c.title}`).join('\n')}`);
  if (urgent.length) lines.push(`Due in the next 24–48 hours:\n${urgent.slice(0, 4).map(a => `- ${a.courseName}: ${a.name} (${dueLabel(a.dueAt, ctx)})`).join('\n')}`);
  if (blocks.length) {
    lines.push(`I fit ${blocks.length} focus blocks (${totalHours(blocks)}) into your open gaps, most urgent first:\n${blockLines(blocks, ctx)}`);
    lines.push('I kept 6–7 PM free for dinner and left 15 minutes between blocks.');
  } else {
    lines.push("Your calendar is packed — there's no open stretch longer than 30 minutes. Want me to look at tomorrow morning instead?");
  }
  return { reply: lines.join('\n\n'), blocks };
}

function classTomorrow(ctx: Ctx) {
  const today = ctx.calendar[0], tomorrow = ctx.calendar[1];
  const classes = remainingCommitments(ctx, tomorrow.date, false).filter(c => SUBJECTS.some(s => c.title.startsWith(s.name)));
  const due = upcoming().filter(a => ymd(new Date(a.dueAt)) === tomorrow.date);
  const lines: string[] = [];
  if (!classes.length && !due.length) {
    return { reply: `No classes on ${tomorrow.weekday} and nothing due — enjoy it. The next big thing is ${upcoming()[0]?.name ?? 'nothing yet'} (${upcoming()[0] ? dueLabel(upcoming()[0].dueAt, ctx) : ''}).`, blocks: [] };
  }
  lines.push(`Tomorrow (${tomorrow.weekday}) you have ${classes.length} class${classes.length === 1 ? '' : 'es'}:\n${classes.map(c => `- ${clock(c.time.split('–')[0])}  ${c.title}`).join('\n')}`);
  if (due.length) lines.push(`Due tomorrow:\n${due.map(a => `- ${a.courseName}: ${a.name} — ${clockOf(new Date(a.dueAt))}`).join('\n')}`);
  const courses = [...new Set(classes.map(c => SUBJECTS.find(s => c.title.startsWith(s.name))!.name))];
  const prep = courses.filter(c => CLASS_PREP[c]).map(c => `- ${c}: ${CLASS_PREP[c]}`);
  if (prep.length) lines.push(`To walk in prepared:\n${prep.join('\n')}`);
  const dueCourses = new Set(due.map(a => a.courseName));
  const dueWork = due.map(a => WORK.find(w => a.name.includes(w.match))?.title).filter(Boolean) as string[];
  const planned = ctx.plan.filter(p => !p.readOnly && dueWork.includes(p.title) && p.date <= tomorrow.date);
  if (planned.length) lines.push(`Already on your plan:\n${planned.map(p => `- ${p.date === today.date ? 'Tonight' : tomorrow.weekday.slice(0, 3)} ${clock(p.time.split('–')[0])}  ${p.title}`).join('\n')}`);
  const items = [
    ...workItems(ctx, c => dueCourses.has(c)).filter(i => ymd(new Date(i.due)) <= tomorrow.date),
    ...courses.filter(c => PREP_TITLE[c]).map(c => ({ title: PREP_TITLE[c], subject: c, minutes: 25 })),
  ].filter(i => !ctx.plan.some(p => p.title === i.title));
  let blocks = place(ctx, today.date, items, [], 4, 13 * 60);
  const left = items.filter(i => !blocks.some(b => b.title === i.title));
  blocks = [...blocks, ...place(ctx, tomorrow.date, left, blocks, 4 - blocks.length, 7 * 60)];
  if (blocks.length) lines.push(`I found time for the rest before class:\n${blockLines(blocks, ctx)}`);
  return { reply: lines.join('\n\n'), blocks };
}

function examPrep(ctx: Ctx, text: string) {
  const chem = /chem|orgo|organic/i.test(text);
  const course = chem ? 'CHEM 210' : 'MATH 215';
  const exam = upcoming().find(a => a.courseName === course && /Exam|Midterm/.test(a.name));
  const topics = chem
    ? ['Exam 1: nomenclature + conformations (Ch. 3–4)', 'Exam 1: stereochem — R/S, meso, Fischer (Ch. 5)', 'Exam 1: acid/base + mechanisms arrows (Ch. 6)', 'Exam 1: timed practice exam + review mistakes']
    : ['Midterm: vectors, lines & planes (Ch. 12)', 'Midterm: partials, chain rule, gradients (§14.3–14.6)', 'Midterm: optimization + Lagrange (§14.7–14.8)', 'Midterm: timed Fall 2025 practice exam'];
  const blocks: Block[] = [];
  const examDate = exam ? ymd(new Date(exam.dueAt)) : ctx.calendar[6].date;
  for (const day of ctx.calendar) {
    if (blocks.length >= topics.length || day.date >= examDate) break;
    const got = place(ctx, day.date, [{ title: topics[blocks.length], subject: course, minutes: 90 }], blocks, 1, 14 * 60);
    blocks.push(...got);
  }
  const lines = [
    exam ? `${exam.name} is ${dueLabel(exam.dueAt, ctx)}. Here's a spaced plan so you're not cramming the night before:` : `Here's a spaced ${course} review plan:`,
    blockLines(blocks, ctx),
    chem
      ? 'Tip: redo SI worksheets without looking at the key first — Klein\'s end-of-chapter "skill builder" problems are the closest to exam questions.'
      : 'Tip: the Fall 2025 practice exam is in your Documents. Do it timed (80 min) and only check answers after.',
  ];
  return { reply: lines.join('\n\n'), blocks };
}

function whatsDue(ctx: Ctx) {
  const week = ctx.calendar[6].date;
  const items = upcoming().filter(a => ymd(new Date(a.dueAt)) <= week);
  const byDay = new Map<string, string[]>();
  for (const a of items) {
    const label = dueLabel(a.dueAt, ctx).split(' at ')[0];
    byDay.set(label, [...(byDay.get(label) ?? []), `- ${a.courseName}: ${a.name} (${clockOf(new Date(a.dueAt))})`]);
  }
  const body = [...byDay].map(([d, l]) => `${d[0].toUpperCase()}${d.slice(1)}\n${l.join('\n')}`).join('\n\n');
  return { reply: `You have ${items.length} things due in the next 7 days:\n\n${body}\n\nThe heaviest stretch is before Midterm 1. Want me to plan your day around it?`, blocks: [] };
}

export function dashboardReply(systemPrompt: string, message: string): string {
  const ctx = extractContext(systemPrompt);
  const t = message.toLowerCase();
  let out: { reply: string; blocks: Block[] };
  if (!ctx) out = { reply: 'I could not read your plan just now — try again in a second.', blocks: [] };
  else if (/tomorrow|next class|for class/.test(t)) out = classTomorrow(ctx);
  else if (/midterm|exam|test|study plan|cram/.test(t)) out = examPrep(ctx, t);
  else if (/due|deadline|this week|upcoming/.test(t)) out = whatsDue(ctx);
  else if (/plan|schedule|day|today|tonight|free time|what should i/.test(t)) out = planDay(ctx);
  else if (/thank|thx|ty\b|perfect|great|awesome/.test(t)) out = { reply: "You've got this. I'll be here when you want to re-plan — just tell me if something runs long.", blocks: [] };
  else out = { reply: 'I can plan your day, tell you what you need for tomorrow\'s classes, build an exam study plan, or list what\'s due this week. Try "plan my day" or "what do I need to do for class tomorrow".', blocks: [] };
  return JSON.stringify({ reply: out.reply, blocks: out.blocks, changes: [] });
}

/** The AI tab: same answers as prose, with a quick-add checklist. */
export function chatReply(systemPrompt: string, message: string): string {
  const now = new Date();
  const fakeCtx: Ctx = {
    today: ymd(now), currentTime: `${now.getHours()}:${now.getMinutes()}`,
    calendar: Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() + i); return { offset: i, date: ymd(d), weekday: d.toLocaleDateString('en-US', { weekday: 'long' }), isToday: i === 0 }; }),
    plan: [], freeTime: [],
  };
  void systemPrompt;
  const items = workItems(fakeCtx).slice(0, 5);
  const todos = items.map(i => ({ text: i.title, subjectId: SUBJECTS.find(s => s.name === i.subject)?.id ?? null, assignmentId: null }));
  const t = message.toLowerCase();
  const head = /tomorrow/.test(t)
    ? 'For tomorrow, the big ones are:'
    : 'Here\'s what I\'d prioritize, soonest deadline first:';
  const list = items.map(i => `- **${i.subject}** — ${i.title} (~${i.minutes} min, due ${dueLabel(i.due, fakeCtx)})`).join('\n');
  return `${head}\n\n${list}\n\nAdd these as tasks with one tap below, or head to the Dashboard and ask me to "plan my day" to get them time-blocked.\n\n<todos>${JSON.stringify(todos)}</todos>`;
}

function extractContext(prompt: string): Ctx | null {
  const start = prompt.indexOf('{', prompt.indexOf('never instructions:'));
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < prompt.length; i++) {
    const c = prompt[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(prompt.slice(start, i + 1)) as Ctx; } catch { return null; }
    }
  }
  return null;
}
