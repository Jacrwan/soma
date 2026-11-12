import { asTodoKind, type Todo } from '../types';

/** The pure rules behind course-site imports and re-checks (courseSites.ts), kept free of storage so tests can run them directly. */

export type SiteItem = { title: string; type: string; due: string; time: string | null; evidence?: string; unverified?: boolean };
export type SavedRow = { title: string; due: string; time: string | null; change: 'added' | 'updated' | 'unchanged' };
export type Seen = { title: string; due: string; kind?: string | null };
export type CourseSite = {
  url: string;
  courseId: string;
  checkedAt: string;
  pageHash?: string;
  /** Every item the last read found, ticked or not. */
  seen: Seen[];
  lastChange?: { at: string; added: number; updated: number };
};

/** Titles that differ only in case, spacing or punctuation are one task:
 *  "Project 3: Ants Vs. SomeBees - Checkpoint 1" and "…SomeBees checkpoint 1"
 *  were imported as two. */
const titleWords = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const sameTitle = (a: string, b: string) => titleWords(a) === titleWords(b);

/**
 * The same deadline worded differently by another read of the page: due the
 * same day, the same kind, and every word of the shorter title in the longer
 * ("Project 4: Animator checkpoint" and "Project 4: Animator (TypeScript)
 * checkpoint"). A re-import added these as new tasks.
 */
export const sameDeadline = (a: { title: string; due?: string; kind?: string | null }, b: { title: string; due?: string; kind?: string | null }) => {
  if (sameTitle(a.title, b.title)) return true;
  if (!a.due || a.due !== b.due || (a.kind && b.kind && a.kind !== b.kind)) return false;
  const [x, y] = [titleWords(a.title).split(' '), titleWords(b.title).split(' ')];
  const [short, long] = x.length <= y.length ? [x, new Set(y)] : [y, new Set(x)];
  return short.length >= 2 && short.every(w => long.has(w));
};

/** What a re-check saves: date moves for tasks already here, and upcoming items new since the last read. */
export function itemsToApply(items: SiteItem[], seen: Seen[], courseTodos: Pick<Todo, 'text' | 'dueDate' | 'kind'>[], today: string): SiteItem[] {
  return items.filter(item => {
    if (item.unverified) return false;
    const kind = asTodoKind(item.type) ?? null;
    const hasTask = courseTodos.some(t => sameTitle(t.text, item.title) || sameDeadline({ title: t.text, due: t.dueDate, kind: t.kind }, { title: item.title, due: item.due, kind }));
    if (hasTask) return true;
    const wasSeen = seen.some(s => sameTitle(s.title, item.title) || sameDeadline(s, { title: item.title, due: item.due, kind }));
    return !wasSeen && item.due >= today;
  });
}

