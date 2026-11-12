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

type ReadingItem = { label: string; documentId?: string; detail?: string; title?: string };

function readTitle(unit: string, range: string, part: string, original: string) {
  const verb = /\breread|\b(?:second|2nd) pass|\b(?:pass|round) 2\b/i.test(original) ? 'Reread' : 'Read';
  const prefix = unit === 'chapter' ? (range.includes('–') ? 'chapters ' : 'chapter ') : '';
  return `${verb} ${prefix}${range}${part}`;
}

// Recognize the generated suffix even when the old 40-character label cut the topic mid-word.
export function sittingLabel(label: string) {
  const old = label.match(/ · (section|chapter) (\d+(?:\.\d+)?(?:–\d+(?:\.\d+)?)?)(?: \((\d+\/\d+)\))?$/i);
  return old ? readTitle(old[1], old[2], old[3] ? ` (part ${old[3]})` : '', label) : label;
}

// The stored timer title is the join key for Focus history. Shorten it only for display.
export function examBlockLabel(block: { title: string; examPlanId?: string }) {
  if (!block.examPlanId) return block.title;
  const [heading] = block.title.split(' — ');
  const label = sittingLabel(heading);
  return label === heading ? block.title : label;
}

function readingPosition(item: ReadingItem, byDocument: boolean) {
  const label = sittingLabel(item.label);
  if (!/^(?:re)?read(?:ing)?\b|^textbook\b|^ch(?:apter)?s?\.?\s*\d/i.test(label)) return;
  const text = `${label} ${item.detail ?? item.title ?? ''}`;
  const section = /\b(\d{1,2})\.(\d{1,2})\b/.exec(text);
  const chapter = section ?? /\bch(?:apter)?s?\.?\s*(\d{1,3})/i.exec(text);
  if (!chapter) return;
  const part = Number(/\(part (\d+)\//.exec(label)?.[1] ?? 1);
  const group = JSON.stringify([byDocument ? item.documentId ?? '' : '', /^reread|\b(?:second|2nd) pass|\b(?:pass|round) 2\b/i.test(label)]);
  return { group, chapter: Number(chapter[1]), section: Number(section?.[2] ?? 0), part };
}

export function readingGroup(item: ReadingItem) { return readingPosition(item, true)?.group; }

// Sort only reading slots. Other work keeps its place. The scheduler can consider each book independently.
export function orderedReadings<T extends ReadingItem>(items: T[], byDocument = false): T[] {
  const groups = new Map<string, { item: T; chapter: number; section: number; part: number }[]>();
  const positions = items.map(item => readingPosition(item, byDocument));
  items.forEach((item, i) => {
    const pos = positions[i];
    if (!pos) return;
    if (!groups.has(pos.group)) groups.set(pos.group, []);
    groups.get(pos.group)!.push({ item, ...pos });
  });
  for (const list of groups.values()) list.sort((a, b) => a.chapter - b.chapter || a.section - b.section || a.part - b.part).reverse();
  return items.map((item, i) => positions[i] ? groups.get(positions[i]!.group)!.pop()!.item : item);
}

export function readingGaps<T extends ReadingItem>(items: T[]) {
  const chapters = new Map<string, Set<number>>();
  const gaps = new Map<T, string>();
  for (const item of items) {
    const pos = readingPosition(item, false);
    if (!pos) continue;
    let covered = chapters.get(pos.group);
    if (!covered) { covered = new Set(); chapters.set(pos.group, covered); }
    // A single row may cover multiple chapters, e.g. "Read chapters 1–5".
    const label = sittingLabel(item.label);
    const text = `${label} ${item.detail ?? item.title ?? ''}`;
    const included = [...numberedIds(text, unitMarkers.chapter), ...(text.match(/\b\d+\.\d+\b/g) ?? []).map(id => Number(id.split('.')[0]))];
    for (const ch of included) covered.add(ch);
  }
  const seen = new Map<string, number>();
  for (const item of items) {
    const pos = readingPosition(item, false);
    if (!pos) continue;
    const prev = seen.get(pos.group);
    if (prev !== undefined && pos.chapter > prev + 1) {
      const absent = Array.from({length: pos.chapter-prev-1}, (_, i) => prev+i+1).filter(ch => !chapters.get(pos.group)!.has(ch));
      if (absent.length) gaps.set(item, `No reading listed for chapter${absent.length === 1 ? '' : 's'} ${absent.join(', ')} in this sequence.`);
    }
    seen.set(pos.group, pos.chapter);
  }
  return gaps;
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
  const namedReading = (unit === 'section' || unit === 'chapter') && ids.length === count;
  if (paper && total <= 600 || total <= 60 && !namedReading) return [{ ...base, minutes: total }];
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
      const label = namedReading ? readTitle(unit, range, parts > 1 ? ` (part ${i + 1}/${parts})` : '', d.label) : d.label.slice(0, Math.max(1, 40 - suffix.length)) + suffix;
      result.push({
        ...base, label,
        detail: namedReading ? (chunks.length === 1 && d.detail && !/^(?:re)?read\s+(?:ch(?:apter)?s?\.?\s*)?[\d.,–—\s-]+$/i.test(d.detail) ? d.detail : undefined) : action ? `${phase === 'Learn' ? 'Study' : 'Complete'} ${action}${parts > 1 ? `, part ${i + 1} of ${parts}` : ''}`.slice(0, 120) : d.detail,
        minutes: duration, estimateBasis: sittingBasis
      });
    }
  }
  return result;
}
