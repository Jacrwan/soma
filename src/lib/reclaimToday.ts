import { rangeOf, spanMinutes, windowOf } from './clockRange';
import { finishOverrun, reclaimDay, type DayBlock, type ReclaimResult } from './dayReclaim';
import { pinKey } from './pinnedBlocks';
import type { VersionBlock } from './dayVersions';

/** A plan block, only the fields reclaim needs. */
export type LiveDayBlock = {
  id: string | number;
  title: string;
  subject: string;
  time: string;
  minutes: number;
  day: number;
  state: string;
  external?: boolean;
  examPlanId?: string;
  actualSeconds?: number;
  focusedSeconds?: number;
  priority?: number;
  note?: string;
  todoId?: string;
  subjectId?: string;
};

/**
 * `stuck`: blocks whose last move didn't stick (the plan read back still had
 * them at the old time). They are treated as fixed so the dashboard doesn't
 * save the same move again on every reload.
 */
export type ReclaimOpts = { activeId?: string | number | null; pins: Set<string>; date: string; stuck?: Set<string> };

export function reclaimWindowEnd(settings: { studyWindow: { start: string; end: string; off?: boolean }; invadePersonalTime?: boolean }): number | null {
  if (settings.studyWindow.off || settings.invadePersonalTime) return null;
  return Math.min(24 * 60, windowOf(settings.studyWindow)[1]);
}

const priorityOf = (note?: string) => {
  const m = note?.match(/· p([1-5])\b/);
  return m ? Number(m[1]) : 3;
};

export function asDayBlocks(blocks: LiveDayBlock[], opts: ReclaimOpts): DayBlock[] {
  return blocks.filter(b => b.day === 0 && b.state !== 'Proposal').map(b => {
    const start = b.time.split('–')[0];
    const pinned = !!b.todoId && !!start && opts.pins.has(pinKey(b.todoId, opts.date, start));
    const done = b.state === 'Completed';
    const started = done || b.state === 'Partially completed' || (b.focusedSeconds ?? b.actualSeconds ?? 0) > 0;
    const running = !done && opts.activeId != null && String(b.id) === String(opts.activeId);
    return {
      id: String(b.id),
      title: b.title,
      time: b.time,
      minutes: b.minutes || (b.time ? spanMinutes(...b.time.split('–') as [string, string]) : 0),
      priority: b.priority ?? priorityOf(b.note),
      fixed: !!b.external || !!b.examPlanId || pinned || !!opts.stuck?.has(String(b.id)),
      started,
      done,
      running,
    };
  });
}

export function toVersionBlocks(blocks: LiveDayBlock[]): VersionBlock[] {
  return blocks
    .filter(b => b.day === 0 && b.state !== 'Proposal')
    .map(b => ({ id: String(b.id), title: b.title, subject: b.subject, time: b.time, minutes: b.minutes }))
    .sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title));
}

export function planToday(blocks: LiveDayBlock[], nowMin: number, windowEnd: number | null, opts: ReclaimOpts): ReclaimResult {
  return reclaimDay(asDayBlocks(blocks, opts), nowMin, windowEnd);
}

/**
 * When Focus on this block ended, in minutes from midnight: now if it is
 * still running, else the latest Focus session recorded on it today. Null
 * when no Focus ran on it today.
 */
export function focusEndMinutes(block: Pick<LiveDayBlock, 'title' | 'subjectId'>, history: { subject_id: string; task_text: string; date: string; end_time?: string }[], date: string, runningNow: boolean, now = new Date()): number | null {
  if (runningNow) return nowMinutes(now);
  const ends = history
    .filter(h => h.date === date && h.task_text === block.title && (!block.subjectId || h.subject_id === block.subjectId) && h.end_time)
    // Stored times may lack a zone; they are UTC (liveData's utcIso).
    .map(h => new Date(/Z$|[+-]\d\d:\d\d$/.test(h.end_time!) ? h.end_time! : `${h.end_time}Z`))
    .filter(d => !Number.isNaN(+d));
  if (!ends.length) return null;
  const last = new Date(Math.max(...ends.map(d => +d)));
  return nowMinutes(last);
}

/**
 * A check-off after Focus ran past the planned end: the block ends when Focus
 * did, and the rest of today shifts. `focusEndMin` is from focusEndMinutes.
 * Null when no Focus ran (a late checkmark only marks it done, owner's
 * choice 2026-11-10) or when Focus ended on time or early.
 */
export function overrunToday(blocks: LiveDayBlock[], completedId: string | number, focusEndMin: number | null, windowEnd: number | null, opts: ReclaimOpts): ReclaimResult | null {
  if (focusEndMin == null) return null;
  const block = blocks.find(b => String(b.id) === String(completedId) && b.day === 0 && b.time);
  if (!block) return null;
  const [, end] = rangeOf(block.time);
  if (focusEndMin <= end) return null;
  return finishOverrun(asDayBlocks(blocks, opts), String(completedId), focusEndMin, windowEnd);
}

export const nowMinutes = (d = new Date()) => d.getHours() * 60 + d.getMinutes();
