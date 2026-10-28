import { storage } from './storage';
import { canvasSnapshots, getLocalSnapshots, sameCourse, sameWork, subjectForCourse, GRADESCOPE_HOST, type SourceSnapshot, type GradescopeSnapshot } from './canvasDeepSync';

/**
 * The Grades page: one row per course, from what the extension synced.
 * Canvas gives the course grade and each score; Gradescope adds scores for
 * work Canvas doesn't track, under the Canvas course of the same department
 * and number when there is one. No AI, no server: it reads the local copy.
 */

export type GradeItem = {
  name: string;
  score: number;
  max: number | null;
  /** score / max in percent, when there is a max. */
  percent: number | null;
  source: 'canvas' | 'gradescope';
  /** Canvas's own letter for this score, when it gives one. */
  grade: string | null;
  late: boolean;
  dueAt: string | null;
  url: string;
};

export type GradeCourse = {
  key: string;
  name: string;
  /** The course grade as Canvas reports it. Gradescope has none. */
  percent: number | null;
  letter: string | null;
  /** The student's colour for this course in Soma, when it is one of their subjects. */
  color: string | null;
  items: GradeItem[];
  /** Points earned and possible over the scores that have a maximum; the grade when Canvas gives none. */
  points: { earned: number; possible: number; percent: number } | null;
};

const percentOf = (score: number, max: number | null) => max && max > 0 ? Math.round((score / max) * 1000) / 10 : null;
const byDueDesc = (a: GradeItem, b: GradeItem) => (b.dueAt ?? '').localeCompare(a.dueAt ?? '') || a.name.localeCompare(b.name);

function pointsOf(items: GradeItem[]): GradeCourse['points'] {
  const scored = items.filter(i => i.max && i.max > 0);
  const possible = scored.reduce((n, i) => n + (i.max as number), 0);
  if (!possible) return null;
  const earned = scored.reduce((n, i) => n + i.score, 0);
  return { earned, possible, percent: percentOf(earned, possible) as number };
}

/** A course's colour is the one on the student's subject for it (subjectForCourse). */
function colorOf(canvasId: number, name: string): string | null {
  const subject = subjectForCourse(storage.getSubjects(), canvasId, name);
  return subject && !subject.archived ? subject.color : null;
}

export function buildGrades(snapshots: Record<string, SourceSnapshot> = getLocalSnapshots()): GradeCourse[] {
  const courses: GradeCourse[] = [];
  const canvasIds = new Map<string, number>();

  for (const snap of canvasSnapshots(snapshots)) {
    for (const c of snap.courses) {
      const items: GradeItem[] = snap.assignments
        .filter(a => a.courseId === c.id && a.score !== null && !a.excused)
        .map(a => ({
          name: a.name, score: a.score as number, max: a.pointsPossible, percent: percentOf(a.score as number, a.pointsPossible),
          source: 'canvas' as const, grade: a.grade, late: a.late, dueAt: a.dueAt, url: a.htmlUrl,
        }));
      const course: GradeCourse = { key: `${snap.host}:${c.id}`, name: c.name, percent: c.currentScore ?? null, letter: c.currentGrade ?? null, color: colorOf(c.id, c.name), items, points: null };
      canvasIds.set(course.key, courses.push(course) - 1);
    }
  }

  const gradescope = Object.values(snapshots).find((s): s is GradescopeSnapshot => s.kind === 'gradescope' && s.host === GRADESCOPE_HOST);
  for (const gc of gradescope?.courses ?? []) {
    const label = gc.name || gc.shortName;
    const home = courses.find(c => sameCourse(c.name, label) || sameCourse(c.name, gc.shortName));
    const target = home ?? courses[courses.push({ key: `${GRADESCOPE_HOST}:${gc.id}`, name: label, percent: null, letter: null, color: null, items: [], points: null }) - 1];
    for (const a of gradescope!.assignments) {
      if (a.courseId !== gc.id || a.score === null) continue;
      // A Canvas entry linked to this Gradescope work already carries the score.
      if (target.items.some(i => i.source === 'canvas' && sameWork(i.name, a.name))) continue;
      target.items.push({
        name: a.name, score: a.score, max: a.maxScore, percent: percentOf(a.score, a.maxScore),
        source: 'gradescope', grade: null, late: false, dueAt: a.dueAt, url: a.htmlUrl,
      });
    }
  }

  return courses
    .filter(c => c.percent !== null || c.letter !== null || c.items.length > 0)
    .map(c => ({ ...c, items: [...c.items].sort(byDueDesc), points: pointsOf(c.items) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "95.7%" without a trailing .0. */
export const showPercent = (p: number) => `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
export const showScore = (n: number) => String(Math.round(n * 100) / 100);
