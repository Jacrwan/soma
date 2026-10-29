import type { History, Snapshot } from '../components/DashboardV2/liveData';
import type { PlanBlock } from '../components/DashboardV2/PlanEditor';
import type { SomaSettings } from './storage';
import { freeTime } from './aiPlanning';
import { clockMinutes, clockOf, rangeOf } from './clockRange';

/**
 * Plan it: a due assignment spread into sittings before its due date, placed
 * in open study time by the same slot finder Soma uses (freeTime), with no AI
 * call. The sittings are ordinary suggestions: the student accepts them on
 * the plan like Soma's.
 */

/** What is being planned: a synced Canvas assignment or a task with a due date. */
export type PlanTarget = { key: string; title: string; subject: string; subjectId?: string; color: string; due: string };
export type PlanChoice = { minutes: number; sittings: number; finishBy: string };

/** "Examen L2 · 2 of 3". One sitting keeps the assignment's own name. */
export const sittingTitle = (title: string, i: number, n: number) => n > 1 ? `${title} · ${i} of ${n}` : title;
const SITTING = / · \d+ of \d+$/;
/** A task made by Plan it for this assignment (or the assignment's own block). */
export const isSittingOf = (text: string, title: string) =>
  text.trim() === title.trim() || (SITTING.test(text) && text.replace(SITTING, '').trim() === title.trim());
/** One of several sittings: finishing it doesn't finish the assignment. */
export const isPartSitting = (text: string) => SITTING.test(text);

/** A task's due day ("2026-11-06") is that day, not UTC midnight; a Canvas due date is a moment. */
export const dueAsDate = (due: string) => due.length <= 10 ? new Date(`${due}T12:00:00`) : new Date(due);
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const round = (n: number, to: number) => Math.max(to, Math.round(n / to) * to);

// The kind of work a title names, to compare it with past work of that kind.
const KINDS: [string, RegExp][] = [
  ['exam', /\b(exam|examen|midterm|final|test)\b/i], ['quiz', /\bquiz/i], ['lab', /\blab\b/i],
  ['project', /\bproject\b/i], ['essay', /\b(essay|paper|draft)\b/i],
  ['homework', /\b(homework|hw|problem set|pset|worksheet)\b/i], ['reading', /\b(reading|chapter|ch\.)/i],
];
const kindOf = (title: string) => KINDS.find(([, re]) => re.test(title))?.[0];

/**
 * How long it will take, from the student's own history: past work of the
 * same kind in the course, else their average per task there, else an hour.
 */
export function estimate(target: PlanTarget, history: History[]): { minutes: number; basis: string } {
  const perTask = new Map<string, number>();
  for (const h of history) if (h.subject_id === target.subjectId && h.task_text && h.task_text !== target.title)
    perTask.set(h.task_text.replace(SITTING, ''), (perTask.get(h.task_text.replace(SITTING, '')) ?? 0) + (h.duration_seconds || 0) / 60);
  const tasks = [...perTask.entries()].filter(([, m]) => m >= 10);
  const kind = kindOf(target.title);
  const alike = kind ? tasks.filter(([t]) => kindOf(t) === kind) : [];
  const avg = (xs: [string, number][]) => xs.reduce((n, [, m]) => n + m, 0) / xs.length;
  if (alike.length) return { minutes: Math.min(600, round(avg(alike), 15)), basis: `your last ${alike.length === 1 ? kind : `${alike.length} ${kind === 'quiz' ? 'quizze' : kind}s`} in ${target.subject} took about that` };
  if (tasks.length >= 2) return { minutes: Math.min(600, round(avg(tasks), 15)), basis: `your average per task in ${target.subject}` };
  return { minutes: kind === 'exam' ? 180 : 60, basis: 'a guess: no history for this course yet' };
}

/** One sitting up to an hour; longer work in sittings of about 50 minutes. */
export const defaultSittings = (minutes: number) => minutes <= 60 ? 1 : Math.min(6, Math.ceil(minutes / 50));

/** Finish the day before it's due; due today (or overdue), finish today. */
export function defaultFinishBy(due: string, now = new Date()): string {
  const d = dueAsDate(due);
  // Due at 12:30 AM is the night before's work.
  if (due.length > 10 && d.getHours() < 3) d.setDate(d.getDate() - 1);
  d.setDate(d.getDate() - 1);
  const today = dayKey(now);
  return dayKey(d) < today ? today : dayKey(d);
}

/**
 * The sittings, placed: spread over the days up to `finishBy`, one a day
 * where there's room, each in the first open slot that fits it that day.
 * `missing` counts sittings no open time could take.
 */
export function placeSittings(target: PlanTarget, choice: PlanChoice, snapshot: Snapshot, origin: Date, settings: SomaSettings, now = new Date()): { blocks: PlanBlock[]; missing: number } {
  const base = new Date(origin); base.setHours(0, 0, 0, 0);
  // Midnight to midnight, so the finish day is the last one (rounding absorbs a DST hour).
  const last = Math.round((new Date(`${choice.finishBy}T00:00:00`).getTime() - base.getTime()) / 86_400_000);
  if (last < 0) return { blocks: [], missing: choice.sittings };
  const n = Math.max(1, Math.min(12, choice.sittings));
  const length = round(choice.minutes / n, 5);
  // Open time per day, in minutes from that day's midnight; pieces are taken out as sittings land.
  const open = freeTime(snapshot, origin, settings, now, last + 1, length).map(d => d.free.map(rangeOf));
  const take = (day: number): string | null => {
    const slots = open[day] ?? [];
    const at = slots.findIndex(([a, z]) => z - a >= length);
    if (at < 0) return null;
    const [a, z] = slots[at];
    slots.splice(at, 1, ...(z - (a + length) >= 15 ? [[a + length + 10, z] as [number, number]] : []));
    return `${clockOf(a)}–${clockOf(a + length)}`;
  };
  const days = last + 1;
  // Evenly spaced preferred days: three sittings over six days land on days 0, 2/3 and 5.
  const wanted = Array.from({ length: n }, (_, i) => n === 1 ? Math.min(last, 0) : Math.round(i * (days - 1) / (n - 1)));
  const used = new Set<number>();
  const blocks: PlanBlock[] = [];
  let missing = 0;
  for (const [i, want] of wanted.entries()) {
    // The wanted day, then later days, then earlier, preferring days without a sitting yet.
    const order = [...Array.from({ length: days - want }, (_, k) => want + k), ...Array.from({ length: want }, (_, k) => want - 1 - k)];
    const day = [...order.filter(d => !used.has(d)), ...order.filter(d => used.has(d))].find(d => (open[d] ?? []).some(([a, z]) => z - a >= length));
    const time = day === undefined ? null : take(day);
    if (day === undefined || !time) { missing++; continue; }
    used.add(day);
    blocks.push({
      id: `proposal:${crypto.randomUUID()}`, title: sittingTitle(target.title, i + 1, n), subject: target.subject,
      time, minutes: length, color: target.color, state: 'Proposal', day,
      note: `Plan it · due ${dueAsDate(target.due).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`,
    });
  }
  // Numbered in the order they happen.
  blocks.sort((a, b) => a.day - b.day || clockMinutes(a.time.split('–')[0]) - clockMinutes(b.time.split('–')[0]));
  blocks.forEach((b, i) => { b.title = sittingTitle(target.title, i + 1, blocks.length === n ? n : blocks.length); });
  return { blocks, missing };
}
