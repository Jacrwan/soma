import { daysBetween } from './sessionSpan';
export { daysBetween } from './sessionSpan';
import type { StudyDraft } from './examPlan';
import { examWorkload, numberedIds, readingSections, sectionIds } from './examWorkload';

export const stages = ['Learn', 'Practice', 'Final review'] as const;
export type ExamStage = typeof stages[number];
export const confidenceLevels = ['Got it', 'Shaky', 'Not started'] as const;
export type Confidence = typeof confidenceLevels[number];
export type ExamPreferences = { start: string; daily: number; confidence: Record<string, Confidence> };


export function milestoneDates(start: string, exam: string) {
  const days = Math.max(1, daysBetween(start, exam));
  const before = (n: number) => new Date(Date.parse(exam) - n * 86400000).toISOString().slice(0, 10);
  const learnDays = Math.min(Math.max(1, days - 2), Math.ceil(days * .7));
  return { Learn: before(days - learnDays + 1), Practice: before(Math.min(days, 2)), 'Final review': before(1) };
}
export function stageOf(text: string): ExamStage {
  if (/\b(practice|past|mock|timed|old)\s+(?:midterm|exam|final)|mistake|weak.spot|final (?:review|pass)|error log/i.test(text)) return 'Final review';
  return /\b(hw|ps)(?=\d|\b)|homework|worksheet|quiz|problem set|practice|redo|re-solve|drill/i.test(text) ? 'Practice' : 'Learn';
}
export const isTimedPaper = (text: string) => /\b(timed|practice|past|mock|old)\s+(midterm|exam|final)/i.test(text) && !/mistakes|error log/i.test(text);
const unitMarkers: Record<string, string> = { chapter: 'chapters?|chs?\\.?', problem: 'problems?|questions?', homework: 'homeworks?|hws?|problem sets?|psets?|ps', worksheet: 'worksheets?', page: 'pages?|pp?\\.', week: 'weeks?', quiz: 'quizzes|quiz' };

export function sizing(d: StudyDraft, reading: string[]) {
  const text = `${d.label} ${d.detail ?? ''}`;
  const catalog = readingSections(reading);
  const work = examWorkload(text, catalog);
  const [unit, count] = work?.units.entries().next().value ?? [isTimedPaper(text) ? 'exam' : 'task', 1];
  const ids = unit === 'section' ? sectionIds(text, catalog) : unitMarkers[unit] ? [...numberedIds(text, unitMarkers[unit])].map(String) : [];
  return { unit, count, ids: ids ?? [], rate: d.minutes / count };
}

export function prepareSittings(d: StudyDraft, reading: string[], confidence?: Confidence, calibrated?: number): StudyDraft[] {
  const { unit, count, ids, rate } = sizing(d, reading);
  const paper = isTimedPaper(d.label);
  const factor = paper ? 1 : confidence === 'Got it' ? .65 : confidence === 'Shaky' ? 1.2 : confidence === 'Not started' ? 1.3 : 1;
  const priority = confidence ? ({ 'Got it': 2, Shaky: 4, 'Not started': 5 })[confidence] : d.priority;
  const unitMinutes = Array.from({ length: count }, (_, i) => (calibrated ?? d.sectionMinutes?.[ids[i]] ?? rate) * factor);
  const total = Math.max(5, Math.round(unitMinutes.reduce((a, b) => a + b, 0) / 5) * 5);
  const fromHistory = !!d.estimateBasis && !/no comparable|estimate ·|provisional/i.test(d.estimateBasis);
  const provenance = calibrated ? 'Your estimate' : fromHistory ? 'From your history' : 'Estimate';
  const basis = !calibrated && fromHistory ? `${provenance} · ${d.estimateBasis}` : `${provenance} · ${count} × ${Math.round((calibrated ?? rate) * 10) / 10} min per ${unit}`;
  const explanation = factor === 1 ? basis : `${basis} · ${confidence} × ${factor}`;
  const phase = stageOf(`${d.label} ${d.detail ?? ''}`);
  const base = { ...d, priority, phase, topic: d.label, estimateBasis: explanation };
  if (paper && total <= 600 || total <= 60) return [{ ...base, minutes: total }];
  const chunks: { start: number; end: number; weight: number }[] = [];
  let start = 0, weight = 0;
  for (let i = 0; i < count; i++) {
    const newChapter = unit === 'section' && ids[i]?.split('.')[0] !== ids[start]?.split('.')[0];
    const notConsecutive = ids.length === count && i > start && Number(ids[i].split('.').pop()) !== Number(ids[i - 1].split('.').pop()) + 1;
    if (i > start && (weight + unitMinutes[i] > 60 || newChapter || notConsecutive)) {
      chunks.push({ start, end: i - 1, weight });
      start = i;
      weight = 0;
    }
    weight += unitMinutes[i];
  }
  chunks.push({ start, end: count - 1, weight });
  const result: StudyDraft[] = [];
  let accumulated = 0, assigned = 0;
  for (const chunk of chunks) {
    accumulated += chunk.weight;
    const minutes = Math.max(5, Math.round(accumulated / 5) * 5 - assigned);
    assigned += minutes;
    const parts = Math.ceil(minutes / (paper ? 600 : 90));
    const range = ids.length === count ? ids[chunk.start] + (chunk.end > chunk.start ? `–${ids[chunk.end]}` : '') : '';
    const amount = chunk.end - chunk.start + 1;
    const chunkRate = Math.round(chunk.weight / amount * 10) / 10;
    const sittingBasis = `${provenance} · ${amount} × ${chunkRate} min per ${unit}${factor === 1 ? '' : ` (${confidence})`}${parts > 1 ? ` across ${parts} sittings` : ''}`;
    const action = range ? `${unit} ${range}` : count > 1 ? `${amount} ${unit}${amount === 1 ? '' : 's'}` : '';
    for (let i = 0; i < parts; i++) {
      const duration = 5 * (Math.round((i + 1) * minutes / (5 * parts)) - Math.round(i * minutes / (5 * parts)));
      const suffix = action && range ? ` · ${action}${parts > 1 ? ` (${i + 1}/${parts})` : ''}` : ` · sitting ${result.length + 1}`;
      const stem = unit === 'section' ? d.label.replace(/\s*\d+\.\d+.*$/, '').trim() || 'Reading' : d.label;
      result.push({
        ...base, label: stem.slice(0, Math.max(1, 40 - suffix.length)) + suffix,
        detail: action ? `${phase === 'Learn' ? 'Study' : 'Complete'} ${action}${parts > 1 ? `, part ${i + 1} of ${parts}` : ''}`.slice(0, 120) : d.detail,
        minutes: duration, estimateBasis: sittingBasis
      });
    }
  }
  return result;
}
