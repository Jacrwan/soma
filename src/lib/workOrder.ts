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

/**
 * Which blocks a change touches (2026-11-21). The schedule is never cleared
 * and redone: only these move, and everything else stays where it is. Times
 * are absolute minutes (day * 1440 + minute). `movable` is the caller's
 * rule for what may move at all: planned study, not started, not pinned, not
 * a class. Checked in order, and each block is returned once:
 *  1. covered: something with a stronger claim now sits on its time (a new or
 *     moved calendar event, a time the student stated, work put back first);
 *  2. missed: its time ended and nobody started it;
 *  3. order: work it should come after (comesBefore) now starts after it;
 *  4. late: it sits past its last day (due date or exam).
 */
export type BoardBlock = Work & { id: string | number; start: number; end: number; movable: boolean; lastDay?: number };
export type Change = { covered?: [number, number][]; missedBy?: number; moved?: (Work & { id: string | number; start: number })[] };
export type Affected = { id: string | number; reason: 'covered' | 'missed' | 'order' | 'late'; after?: string | number };

export function affected(board: BoardBlock[], change: Change, items: CourseItem[] = []): Affected[] {
  const out: Affected[] = [], seen = new Set<string>();
  const movedIds = new Set((change.moved ?? []).map(m => String(m.id)));
  const add = (b: BoardBlock, reason: Affected['reason'], after?: string | number) => {
    if (!b.movable || seen.has(String(b.id)) || movedIds.has(String(b.id))) return;
    seen.add(String(b.id)); out.push({ id: b.id, reason, ...(after !== undefined ? { after } : {}) });
  };
  for (const [a, z] of change.covered ?? []) for (const b of board) if (b.start < z && b.end > a) add(b, 'covered');
  if (change.missedBy !== undefined) for (const b of board) if (b.end <= change.missedBy) add(b, 'missed');
  for (const m of change.moved ?? []) for (const b of board) if (b.start < m.start && comesBefore(m, b, items)) add(b, 'order', m.id);
  for (const b of board) if (b.lastDay !== undefined && Math.floor(b.start / 1440) > b.lastDay) add(b, 'late');
  return out;
}
