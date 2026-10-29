import { storage } from './storage';
import { canvasSnapshots, getLocalSnapshots, sameCourse, sameWork, subjectForCourse, GRADESCOPE_HOST, type SourceSnapshot, type GradescopeSnapshot } from './canvasDeepSync';
import { byPoints, cachedGradeBooks, guessCategory, NOT_COUNTED, type GradeBook, type GradeCategory } from './gradeBooks';
import type { Subject } from '../types';

/**
 * The Grades page: one row per course. Canvas gives the course grade and each
 * score; Gradescope (unpacked extension builds only) adds scores for work
 * Canvas doesn't track; the student types in the rest (gradeBooks.ts). All
 * of a course's scores land on one course: the student's Soma course when
 * there is one, so Canvas, Gradescope and typed-in scores make one grade.
 * When the course has a grade book with categories, that grade is weighted
 * the way its syllabus says. No AI here: the AI only reads the syllabus once.
 */

export type GradeItem = {
  /** "canvas:123", "gradescope:7001", "manual:<entry id>": what a category pick is saved under. */
  key: string;
  name: string;
  score: number;
  max: number | null;
  /** score / max in percent, when there is a max. */
  percent: number | null;
  source: 'canvas' | 'gradescope' | 'manual';
  /** Canvas's own letter for this score, when it gives one. */
  grade: string | null;
  late: boolean;
  dueAt: string | null;
  url: string;
  /** The Canvas assignment group it is in. */
  group: string | null;
  /** The category it counts in, when the course has categories. */
  categoryId: string | null;
  /** Whether the student chose that category, rather than Soma guessing it. */
  picked: boolean;
};

export type CategoryResult = {
  category: GradeCategory;
  /** The average in this category after drops; null with nothing graded yet. */
  percent: number | null;
  /** Points earned and graded in it after drops. In a points course, never more
   *  than the category is worth: a midterm scored out of 80 and worth 20 counts as 20. */
  earned: number;
  possible: number;
  count: number;
  dropped: number;
};

export type WeightedGrade = {
  /** Weighted over the categories that have scores; null when none do. */
  percent: number | null;
  /** From the syllabus's scale, when it gives one. */
  letter: string | null;
  categories: CategoryResult[];
  /** Scores in no category: not counted until the student picks one. */
  uncategorized: number;
  /** How the syllabus grades: percent weights, or a total of points. */
  mode: 'weights' | 'points';
  /** Weights: the weight of the categories with scores, out of their total.
   *  Points: the points graded so far, out of the course's total points. */
  counted: number;
  total: number;
  /** Points: what has been earned of `counted`. */
  earned: number;
};

export type GradeCourse = {
  /** What a new grade book is saved under: "subject:<id>", else the synced course. */
  key: string;
  /** Every key this course is known by, so a book saved under any of them is found. */
  aliases: string[];
  name: string;
  subjectId: string | null;
  archived: boolean;
  /** The course grade as Canvas reports it. Gradescope has none. */
  percent: number | null;
  letter: string | null;
  /** The student's colour for this course in Soma, when it is one of their subjects. */
  color: string | null;
  items: GradeItem[];
  /** Points earned and possible over the scores that have a maximum; the grade when Canvas gives none. */
  points: { earned: number; possible: number; percent: number } | null;
  /** Canvas's assignment groups, when the course weights them. */
  canvasGroups: { name: string; weight: number }[];
  book: GradeBook | null;
  weighted: WeightedGrade | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const percentOf = (score: number, max: number | null) => max && max > 0 ? round1((score / max) * 100) : null;
const byDueDesc = (a: GradeItem, b: GradeItem) => (b.dueAt ?? '').localeCompare(a.dueAt ?? '') || a.name.localeCompare(b.name);

function pointsOf(items: GradeItem[]): GradeCourse['points'] {
  const scored = items.filter(i => i.max && i.max > 0);
  const possible = scored.reduce((n, i) => n + (i.max as number), 0);
  if (!possible) return null;
  const earned = scored.reduce((n, i) => n + i.score, 0);
  return { earned, possible, percent: percentOf(earned, possible) as number };
}

/** The letter for a percent on a syllabus's scale (highest cutoff first). */
export function letterFor(percent: number, scale: { letter: string; min: number }[] | null): string | null {
  return scale?.find(s => percent >= s.min)?.letter ?? null;
}

/**
 * The grade the syllabus gives. Inside a category scores count by points
 * (earned over possible), after dropping its lowest. A course graded by
 * weights counts each category its weight, over the categories with a score
 * so far, the way a running course grade is worked out. A course graded by a
 * total of points adds the points up: the grade is the points earned over the
 * points graded so far, and its letter is where that pace lands on the total.
 */
export function weigh(items: GradeItem[], book: GradeBook): WeightedGrade {
  const points = byPoints(book.categories);
  const results: CategoryResult[] = book.categories.map(category => {
    const mine = items.filter(i => i.categoryId === category.id);
    const scored = mine.filter(i => i.max && i.max > 0).sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0));
    const dropped = scored.length > category.drop ? category.drop : 0;
    const lowest = new Set(scored.slice(0, dropped));
    const counted = mine.filter(i => !lowest.has(i));
    let possible = counted.reduce((n, i) => n + (i.max ?? 0), 0);
    let earned = counted.reduce((n, i) => n + i.score, 0);
    const worth = category.points;
    if (points && worth !== null && possible > worth) { earned = (earned / possible) * worth; possible = worth; }
    return { category, percent: possible > 0 ? round1((earned / possible) * 100) : null, earned, possible, count: mine.length, dropped };
  });
  const uncategorized = items.filter(i => !i.categoryId).length;
  if (points) {
    const earned = results.reduce((n, r) => n + r.earned, 0);
    const counted = results.reduce((n, r) => n + r.possible, 0);
    const total = book.categories.reduce((n, c) => n + (c.points as number), 0);
    const pace = counted > 0 ? earned / counted : null;
    // Cutoffs are points: the letter is the one this pace earns over the whole course.
    const letter = pace !== null && total > 0 ? book.scale?.find(s => pace * total >= s.min - 1e-9)?.letter ?? null : null;
    return { percent: pace !== null ? round1(pace * 100) : null, letter, categories: results, uncategorized, mode: 'points', counted, total, earned };
  }
  const live = results.filter(r => r.percent !== null && r.category.weight > 0);
  const counted = live.reduce((n, r) => n + r.category.weight, 0);
  const total = book.categories.reduce((n, c) => n + c.weight, 0);
  const percent = counted > 0 ? round1(live.reduce((n, r) => n + r.category.weight * (r.percent as number), 0) / counted) : null;
  return {
    percent, letter: percent !== null ? letterFor(percent, book.scale) : null, categories: results,
    uncategorized, mode: 'weights', counted, total, earned: 0,
  };
}

/** A course's colour is the one on the student's subject for it (subjectForCourse). */
const colorOf = (subject: Subject | undefined) => subject && !subject.archived ? subject.color : null;

export function buildGrades(
  snapshots: Record<string, SourceSnapshot> = getLocalSnapshots(),
  books: GradeBook[] = cachedGradeBooks(),
  subjects: Subject[] = storage.getSubjects(),
): GradeCourse[] {
  const courses: GradeCourse[] = [];
  /** Names a Gradescope course is matched against: the Canvas name and the student's own. */
  const names = new Map<GradeCourse, string[]>();
  const blank = (key: string, name: string, subject?: Subject): GradeCourse => ({
    key, aliases: [key], name, subjectId: subject?.id ?? null, archived: !!subject?.archived,
    percent: null, letter: null, color: colorOf(subject), items: [], points: null, canvasGroups: [], book: null, weighted: null,
  });

  for (const snap of canvasSnapshots(snapshots)) {
    for (const c of snap.courses) {
      const subject = subjectForCourse(subjects, c.id, c.name);
      const canvasKey = `${snap.host}:${c.id}`;
      const key = subject && !subject.archived ? `subject:${subject.id}` : canvasKey;
      let course = courses.find(x => x.key === key);
      if (!course) {
        course = blank(key, c.name, subject);
        courses.push(course);
        names.set(course, [c.name, ...(subject ? [subject.name] : [])]);
      }
      if (!course.aliases.includes(canvasKey)) course.aliases.push(canvasKey);
      course.percent ??= c.currentScore ?? null;
      course.letter ??= c.currentGrade ?? null;
      const groups = snap.groups.filter(g => g.courseId === c.id);
      if (c.weighted) course.canvasGroups.push(...groups.map(g => ({ name: g.name, weight: g.weight })));
      for (const a of snap.assignments) {
        if (a.courseId !== c.id || a.score === null || a.excused) continue;
        course.items.push({
          key: `canvas:${a.id}`, name: a.name, score: a.score, max: a.pointsPossible, percent: percentOf(a.score, a.pointsPossible),
          source: 'canvas', grade: a.grade, late: a.late, dueAt: a.dueAt, url: a.htmlUrl,
          group: groups.find(g => g.id === a.groupId)?.name ?? null, categoryId: null, picked: false,
        });
      }
    }
  }

  // Every course the student keeps in Soma can take scores, synced or not.
  for (const s of subjects) {
    if (s.archived || courses.some(c => c.key === `subject:${s.id}`)) continue;
    const course = blank(`subject:${s.id}`, s.name, s);
    courses.push(course);
    names.set(course, [s.name]);
  }

  const gradescope = Object.values(snapshots).find((s): s is GradescopeSnapshot => s.kind === 'gradescope' && s.host === GRADESCOPE_HOST);
  for (const gc of gradescope?.courses ?? []) {
    const label = gc.name || gc.shortName;
    const home = courses.find(c => (names.get(c) ?? [c.name]).some(n => sameCourse(n, label) || sameCourse(n, gc.shortName)));
    const target = home ?? courses[courses.push(blank(`${GRADESCOPE_HOST}:${gc.id}`, label)) - 1];
    if (home) home.aliases.push(`${GRADESCOPE_HOST}:${gc.id}`);
    for (const a of gradescope!.assignments) {
      if (a.courseId !== gc.id || a.score === null) continue;
      // A Canvas entry linked to this Gradescope work already carries the score.
      if (target.items.some(i => i.source === 'canvas' && sameWork(i.name, a.name))) continue;
      target.items.push({
        key: `gradescope:${a.id}`, name: a.name, score: a.score, max: a.maxScore, percent: percentOf(a.score, a.maxScore),
        source: 'gradescope', grade: null, late: false, dueAt: a.dueAt, url: a.htmlUrl, group: null, categoryId: null, picked: false,
      });
    }
  }

  for (const book of books) {
    const course = courses.find(c => c.aliases.includes(book.courseKey));
    if (!course || course.book) continue;
    course.book = book;
    for (const e of book.entries) {
      course.items.push({
        key: `manual:${e.id}`, name: e.name, score: e.score, max: e.max, percent: percentOf(e.score, e.max),
        source: 'manual', grade: null, late: false, dueAt: e.date ? `${e.date}T12:00:00` : null, url: '', group: null, categoryId: null, picked: false,
      });
    }
  }

  return courses
    .filter(c => (c.subjectId && !c.archived) || c.percent !== null || c.letter !== null || c.items.length > 0 || c.book)
    .map(c => {
      const book = c.book;
      const ids = new Set(book?.categories.map(x => x.id) ?? []);
      const items = c.items.map(i => {
        if (!book?.categories.length) return i;
        const entryPick = i.source === 'manual' ? book.entries.find(e => `manual:${e.id}` === i.key)?.categoryId : undefined;
        const chosen = book.picks[i.key] ?? entryPick ?? null;
        if (chosen === NOT_COUNTED) return { ...i, categoryId: null, picked: true };
        if (chosen && ids.has(chosen)) return { ...i, categoryId: chosen, picked: true };
        return { ...i, categoryId: guessCategory(book.categories, i.name, i.group)?.id ?? null };
      }).sort(byDueDesc);
      return { ...c, items, points: pointsOf(items), weighted: book?.categories.length ? weigh(items, book) : null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type Headline = { big: string | null; small: string | null; kind: 'weighted' | 'canvas' | 'average' | 'none' };

/**
 * The course's one grade. Weighted by the syllabus when the student has set
 * that up and something is graded; else Canvas's course grade; else the
 * points earned over the points possible.
 */
export function headline(c: GradeCourse): Headline {
  const w = c.weighted;
  if (w && w.percent !== null) return w.letter ? { big: w.letter, small: showPercent(w.percent), kind: 'weighted' } : { big: showPercent(w.percent), small: null, kind: 'weighted' };
  if (c.letter) return { big: c.letter, small: c.percent !== null ? showPercent(c.percent) : null, kind: 'canvas' };
  if (c.percent !== null) return { big: showPercent(c.percent), small: null, kind: 'canvas' };
  if (c.points) return { big: showPercent(c.points.percent), small: 'average', kind: 'average' };
  return { big: null, small: null, kind: 'none' };
}

/** "95.7%" without a trailing .0. */
export const showPercent = (p: number) => `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
export const showScore = (n: number) => String(Math.round(n * 100) / 100);
