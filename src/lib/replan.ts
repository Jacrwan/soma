// Kept free of runtime imports so tests can load it on its own (like taskScheduler.ts).

/**
 * Rescheduling, step by step (2026-11-17). Ask Soma and Accept both place work
 * in this order:
 *
 * 1. Understand: the model reports intent only — an ordered `sequence` ("math
 *    now for 2 hours, then oral presentations"), and `later` on a change
 *    ("push Project 4 for later").
 * 2. Freeze: calendar events the student attends, started/done/on-timer
 *    blocks, pinned blocks and work that outranks what's being placed never move.
 * 3. Lay out stated times and sequences: a sequence runs back to back from its
 *    anchor, flowing around frozen blocks (`layChain`).
 * 4. Place "later" work: the first open time today after the sequence, before
 *    its due time, leaving room for the task's later steps (`fitsAfter`). No
 *    room today → the student is asked about the first spot on another day.
 * 5. What was in the way moves, only ever down the priority list (`outranks`).
 * 6. Check the whole board (`overlaps`) before any card is shown.
 * 7. The reply must not claim a move that has no card (`unbackedClaims`).
 *
 * Times here are absolute minutes from day 0's midnight (day * 1440 + minute).
 */

export type Span = [number, number];

/** A sequence laid back to back from `anchor`. Each item starts where the one
 *  before ended; an item that would run into a frozen span starts after it. */
export function layChain(anchor: number, lengths: number[], frozen: Span[]): Span[] {
  const blocks = [...frozen].filter(([a, z]) => z > a).sort((x, y) => x[0] - y[0]);
  const out: Span[] = [];
  let cursor = anchor;
  for (const length of lengths) {
    for (let moved = true; moved; ) {
      moved = false;
      for (const [a, z] of blocks) if (a < cursor + length && z > cursor) { cursor = z; moved = true; }
    }
    out.push([cursor, cursor + length]);
    cursor += length;
  }
  return out;
}

/**
 * Whether work ending at `from` still leaves room for the task's later steps,
 * each whole and in order, in `free` before `due`. A step already placed after
 * `from` keeps its own time (`placed`), so it needs no free time.
 */
export function fitsAfter(from: number, steps: { minutes: number; placedAt?: number }[], free: Span[], due: number): boolean {
  const segs = free.map(([a, z]) => [Math.max(a, from), Math.min(z, due)] as Span).filter(([a, z]) => z > a).sort((x, y) => x[0] - y[0]);
  let cursor = from;
  for (const step of steps) {
    if (step.placedAt !== undefined && step.placedAt >= cursor) { cursor = step.placedAt + step.minutes; continue; }
    const seg = segs.find(([a, z]) => Math.min(z, due) - Math.max(a, cursor) >= step.minutes);
    if (!seg) return false;
    cursor = Math.max(seg[0], cursor) + step.minutes;
  }
  return cursor <= due;
}

/**
 * Whether `mine` may push `theirs` aside. Lower rank is more important (the
 * task scheduler's silent priority). Unknown ranks (no due date) keep the old
 * rule: anything Soma placed can move.
 */
export const outranks = (mine: number | undefined, theirs: number | undefined) =>
  mine === undefined || theirs === undefined || theirs > mine;

/** Pairs of entries whose spans overlap: the whole-board check. */
export function overlaps<T extends { span: Span }>(entries: T[]): [T, T][] {
  const sorted = [...entries].sort((a, b) => a.span[0] - b.span[0]);
  const out: [T, T][] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].span[0] < sorted[i].span[1]; j++) out.push([sorted[i], sorted[j]]);
  }
  return out;
}

const MOVE_WORDS = /\b(mov(e|ed|es|ing)|push(ed|es|ing)?|shift(ed|s|ing)?|reschedul(e|ed|es|ing)|bump(ed|s|ing)?|put(ting)?|plac(e|ed|es|ing)|slot(ted|ting)?|sen(d|t|ding))\b/i;
const words = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/** The words that name an entry in a sentence: up to its first number ("Project
 *  4", "Math 53"), else its first two words ("Oral Presentations"). */
export function keyOf(title: string): string[] {
  const w = words(title);
  const n = w.findIndex(x => /\d/.test(x));
  return n >= 0 && n < 3 ? w.slice(0, n + 1) : w.slice(0, 2);
}

/**
 * Sentences of `reply` that say an entry is moved or pushed when no card
 * changes it. On 2026-11-17 Soma said it moved Project 4 off tonight while the
 * cards left it there.
 */
export function unbackedClaims(reply: string, entries: { id: string | number; title: string }[], carded: Set<string | number>): { sentence: string; title: string }[] {
  const sentences = reply.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim());
  const out: { sentence: string; title: string }[] = [];
  for (const sentence of sentences) {
    if (!MOVE_WORDS.test(sentence)) continue;
    const said = ` ${words(sentence).join(' ')} `;
    for (const e of entries) {
      const key = keyOf(e.title);
      if (!key.length || carded.has(e.id) || !said.includes(` ${key.join(' ')} `)) continue;
      out.push({ sentence, title: e.title });
      break;
    }
  }
  return out;
}

/** The reply without the sentences that claim what no card does. */
export const withoutClaims = (reply: string, claims: { sentence: string }[]) =>
  claims.reduce((text, c) => text.replace(c.sentence, ''), reply).replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
