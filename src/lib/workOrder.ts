import { effectiveRank, guessRank } from './taskScheduler';
import type { CourseItem } from './courseItems';

/**
 * Which work goes first (2026-11-20). Two questions, no AI:
 *
 * priorityOf: how urgent a piece of work is, lower = sooner. Dated work keeps
 * the Tasks order (the silent rank). Missed work with no due date counts as
 * due the day it was planned, so yesterday's miss ranks like work due
 * yesterday. Undated work that hasn't come up yet goes after all dated work,
 * earlier-planned first.
 *
 * comesBefore: work that has to happen before other work in the same course.
 * Reading-list order, a smaller number in the same title ("Chapter 5" before
 * "Chapter 6"), or an earlier "from <date>" ("…lecture from Mon 11-09" before
 * "…from Wed 11-18").
 */

export const UNDATED = 1e6;

export type Ranked = { rank?: number; dueDate?: string; kind?: string; text: string };

/**
 * `plannedDate` (YYYY-MM-DD) is the day it was planned for; `day` is that day
 * as an offset from today, used to order undated work.
 */
export function priorityOf(t: Ranked, opts: { missed?: boolean; plannedDate?: string; day?: number } = {}): number {
  if (t.dueDate) return effectiveRank(t);
  if (opts.missed && opts.plannedDate) return guessRank({ ...t, dueDate: opts.plannedDate });
  return UNDATED + (opts.day ?? 0);
}

export type Work = { subjectId?: string; title: string; covers?: string[] };

const numbersOf = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
const shape = (s: string) => s.toLowerCase().replace(/\d+(?:\.\d+)?/g, '#').replace(/\s+/g, ' ').trim();
/** "from Mon 11-09" → 1109; "from 11/9" → 1109. */
function fromDate(s: string): number | undefined {
  const m = s.match(/\bfrom\s+(?:[a-z]{3,9},?\s+)?(\d{1,2})[-/](\d{1,2})\b/i);
  return m ? Number(m[1]) * 100 + Number(m[2]) : undefined;
}
/** The words around a "from <date>", so only the same kind of work is compared. */
const fromShape = (s: string) => s.toLowerCase().replace(/\bfrom\s+(?:[a-z]{3,9},?\s+)?\d{1,2}[-/]\d{1,2}\b.*$/i, '').trim();

/** Whether `a` should be done before `b`. Only within one course. */
export function comesBefore(a: Work, b: Work, items: CourseItem[] = []): boolean {
  if (!a.subjectId || a.subjectId !== b.subjectId) return false;
  // Reading list: the first section each covers, in the same list.
  const first = (w: Work) => (w.covers ?? []).map(id => items.find(i => i.id === id)).filter((i): i is CourseItem => !!i).sort((x, y) => x.position - y.position)[0];
  const ia = first(a), ib = first(b);
  if (ia && ib && ia.subjectId === ib.subjectId && (ia.examId ?? '') === (ib.examId ?? '')) return ia.position < ib.position;
  // "Review: … from Mon 11-09" before "Review: … from Wed 11-18".
  const da = fromDate(a.title), db = fromDate(b.title);
  if (da !== undefined && db !== undefined && fromShape(a.title) === fromShape(b.title)) return da < db;
  // Same title but for its numbers: the first number that differs decides.
  if (shape(a.title) === shape(b.title)) {
    const na = numbersOf(a.title), nb = numbersOf(b.title);
    for (let i = 0; i < Math.min(na.length, nb.length); i++) if (na[i] !== nb[i]) return na[i] < nb[i];
  }
  return false;
}
