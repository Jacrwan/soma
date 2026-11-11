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
  actualSeconds?: number;
  note?: string;
  todoId?: string;
};

export function reclaimWindowEnd(settings: { studyWindow: { start: string; end: string; off?: boolean }; invadePersonalTime?: boolean }): number | null {
  if (settings.studyWindow.off || settings.invadePersonalTime) return null;
  return Math.min(24 * 60, windowOf(settings.studyWindow)[1]);
}

const priorityOf = (note?: string) => {
  const m = note?.match(/· p([1-5])\b/);
  return m ? Number(m[1]) : 3;
};

export function asDayBlocks(blocks: LiveDayBlock[], opts: { activeId?: string | number | null; pins: Set<string>; date: string }): DayBlock[] {
  return blocks.filter(b => b.day === 0 && b.state !== 'Proposal').map(b => {
    const start = b.time.split('–')[0];
    const pinned = !!b.todoId && !!start && opts.pins.has(pinKey(b.todoId, opts.date, start));
    const done = b.state === 'Completed';
    const started = done || b.state === 'Partially completed' || (b.actualSeconds ?? 0) > 0;
    const running = !done && opts.activeId != null && String(b.id) === String(opts.activeId);
    return {
      id: String(b.id),
      title: b.title,
      time: b.time,
      minutes: b.minutes || (b.time ? spanMinutes(...b.time.split('–') as [string, string]) : 0),
      priority: priorityOf(b.note),
      fixed: !!b.external || pinned,
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

export function planToday(blocks: LiveDayBlock[], nowMin: number, windowEnd: number | null, opts: { activeId?: string | number | null; pins: Set<string>; date: string }): ReclaimResult {
  return reclaimDay(asDayBlocks(blocks, opts), nowMin, windowEnd);
}

/** A check-off after the planned end. Null when they finished on time or early. */
export function overrunToday(blocks: LiveDayBlock[], completedId: string | number, endedAtMin: number, windowEnd: number | null, opts: { activeId?: string | number | null; pins: Set<string>; date: string }): ReclaimResult | null {
  const block = blocks.find(b => String(b.id) === String(completedId) && b.day === 0 && b.time);
  if (!block) return null;
  const [, end] = rangeOf(block.time);
  if (endedAtMin <= end) return null;
  return finishOverrun(asDayBlocks(blocks, opts), String(completedId), endedAtMin, windowEnd);
}

export const nowMinutes = (d = new Date()) => d.getHours() * 60 + d.getMinutes();
