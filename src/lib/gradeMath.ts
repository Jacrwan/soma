// No runtime imports, so tests can load it without the Supabase client.
import type { WeightedGrade } from './grades';
import type { ScaleStep } from './gradeBooks';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What a course graded by weights still needs, on everything not graded yet,
 * for each letter from its current one up: "Final 30% not graded yet; 88% on
 * it for an A-". Worked out here, not by Soma, which would guess the sums.
 * Null when nothing is graded, nothing is left, or there's no scale.
 */
export function stillNeeded(w: WeightedGrade | null, scale: ScaleStep[] | null): { ungraded: string[]; left: number; needs: { letter: string; percent: number }[] } | null {
  if (!w || w.mode !== 'weights' || w.percent === null || !scale?.length) return null;
  const left = round2(w.total - w.counted);
  if (left <= 0) return null;
  const ungraded = w.categories.filter(r => r.percent === null && r.category.weight > 0).map(r => `${r.category.name} ${r.category.weight}%`);
  const steps = [...scale].sort((a, b) => a.min - b.min);
  const current = steps.findIndex(s => s.letter === w.letter);
  const needs = steps.slice(Math.max(0, current)).map(s => ({ letter: s.letter, percent: Math.max(0, Math.ceil((s.min * w.total - w.percent! * w.counted) / left)) }));
  // Up to the first letter that would take more than a perfect score.
  const reach = needs.findIndex(n => n.percent > 100);
  return { ungraded, left, needs: (reach < 0 ? needs : needs.slice(0, reach + 1)).slice(0, 4) };
}
