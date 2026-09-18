import type { Subject, SubjectColor } from '../types';

/** The subject palette, shared by every surface that assigns a course colour. */
export const SUBJECT_COLORS: SubjectColor[] = [
  '#ef5350', '#42a5f5', '#66bb6a', '#ab47bc',
  '#ffa726', '#26c6da', '#ec407a', '#8d6e63',
];

/**
 * The first palette colour no existing course is using, so a new course is
 * visually distinct by default. Falls back to cycling once all are taken.
 */
export function nextUnusedColor(existing: Pick<Subject, 'color'>[]): SubjectColor {
  const taken = new Set(existing.map(s => s.color));
  return SUBJECT_COLORS.find(c => !taken.has(c)) ?? SUBJECT_COLORS[existing.length % SUBJECT_COLORS.length];
}
