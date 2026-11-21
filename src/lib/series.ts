import type { CourseItem } from './courseItems';

/**
 * Series (2026-11-22): work that comes as an ordered list. Twenty "Review:
 * Physics lecture from <date>" blocks, the CS lecture reviews, a reading guide's
 * sections, "Homework 9, 10, 11". On 2026-11-21 the order check moved such blocks
 * one at a time "to come after" another, which scrambled them and pushed nine
 * past the student's Tuesday deadline. A series keeps its slots, the times the
 * student already has, and only changes which item sits in which slot: the
 * earliest slot gets the earliest item. Nothing new lands anywhere.
 *
 * Order: a reading guide's position (course_items) when the block covers
 * sections; else the date in "from <date>"; else the first number in the title.
 */

export type SeriesBlock = { id: string | number; subjectId?: string; title: string; covers?: string[]; start: number; end: number; movable: boolean };
export type SeriesMove = { id: string | number; from: [number, number]; to: [number, number] };

const DATE = /\bfrom\s+(?:[a-z]{3,9},?\s+)?(\d{1,2})[-/](\d{1,2})\b/i;

/** Which series a block belongs to, and where it falls in it. Undefined: it isn't part of one. */
export function placeInSeries(b: Pick<SeriesBlock, 'subjectId' | 'title' | 'covers'>, items: CourseItem[] = []): { key: string; at: number } | undefined {
  if (!b.subjectId) return undefined;
  const covered = (b.covers ?? []).map(id => items.find(i => i.id === id)).filter((i): i is CourseItem => !!i).sort((x, y) => x.position - y.position)[0];
  if (covered) return { key: `${b.subjectId}|list|${covered.subjectId}|${covered.examId ?? ''}`, at: covered.position };
  const date = b.title.match(DATE);
  if (date) return { key: `${b.subjectId}|date|${b.title.slice(0, date.index).toLowerCase().trim()}`, at: Number(date[1]) * 100 + Number(date[2]) };
  const num = b.title.match(/\d+(?:\.\d+)?/);
  if (num && num.index! > 0) {
    // "12.7–12.11" and "13, 14": the first number orders them (12.7 < 13).
    const prefix = b.title.slice(0, num.index).toLowerCase().replace(/[\s:#-]+$/, '').trim();
    if (prefix.length >= 3) return { key: `${b.subjectId}|num|${prefix}`, at: Number(num[0]) };
  }
  return undefined;
}

/** Blocks grouped by series, each sorted by where it falls (oldest first). */
export function seriesOf<T extends Pick<SeriesBlock, 'subjectId' | 'title' | 'covers'>>(blocks: T[], items: CourseItem[] = []): { key: string; members: (T & { at: number })[] }[] {
  const groups = new Map<string, (T & { at: number })[]>();
  for (const b of blocks) {
    const p = placeInSeries(b, items);
    if (!p) continue;
    groups.set(p.key, [...(groups.get(p.key) ?? []), { ...b, at: p.at }]);
  }
  return [...groups.entries()].filter(([, m]) => m.length > 1).map(([key, members]) => ({ key, members: members.sort((a, b) => a.at - b.at) }));
}

/**
 * Puts each series back in order without changing any time: its movable
 * blocks trade slots so the earliest slot holds the earliest item. Blocks that
 * can't move (started, pinned, past) keep their slot. Only blocks of the same
 * length trade, so every block still fits where it lands. `newest` runs the
 * series the other way, when the student asked for that.
 */
export function reorderSeries(blocks: SeriesBlock[], items: CourseItem[] = [], newest = false): SeriesMove[] {
  const out: SeriesMove[] = [];
  for (const { members } of seriesOf(blocks, items)) {
    const free = members.filter(m => m.movable);
    const byLength = new Map<number, typeof free>();
    for (const m of free) byLength.set(m.end - m.start, [...(byLength.get(m.end - m.start) ?? []), m]);
    for (const same of byLength.values()) {
      if (same.length < 2) continue;
      const slots = same.map(m => [m.start, m.end] as [number, number]).sort((a, b) => a[0] - b[0]);
      const ordered = [...same].sort((a, b) => newest ? b.at - a.at : a.at - b.at);
      ordered.forEach((m, i) => { if (slots[i][0] !== m.start) out.push({ id: m.id, from: [m.start, m.end], to: slots[i] }); });
    }
  }
  return out;
}
