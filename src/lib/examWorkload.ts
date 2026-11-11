// Quantities in timer titles and exam materials must use the same unit before
// their durations can be compared. A textbook section is an identifier (7.10
// comes after 7.9), never a decimal number.
import { kindOf } from './planIt';

type Workload = { kind: string; units: Map<string, number> };

const chapter = 'chapters?|chs?\\.?';
const homework = 'homeworks?|hws?|problem sets?|psets?|ps';
const worksheet = 'worksheets?';
const quiz = 'quizzes|quiz';
const dash = '\\s*[-–—]\\s*';

export function numberedIds(text: string, name: string): Set<number> {
  const marker = `(?:${name})\\s*#?\\s*`;
  const number = '(\\d{1,3})(?!\\d|\\.\\d)';
  const span = `${number}(?:${dash}(?:${marker})?${number})?`;
  const sequence = new RegExp(`\\b${marker}(${span}(?:\\s*(?:,|&|and)\\s*(?:${marker})?${span})*)`, 'gi');
  const ids = new Set<number>();
  for (const list of text.matchAll(sequence)) {
    for (const range of list[1].matchAll(new RegExp(span, 'gi'))) {
      const first = Number(range[1]), last = Number(range[2] ?? first);
      if (last < first) return new Set();
      for (let n = first; n <= last; n++) ids.add(n);
    }
  }
  return ids;
}

function numberedCount(text: string, name: string): number | undefined {
  const ids = numberedIds(text, name);
  if (ids.size) return ids.size;
  const quantity = text.match(new RegExp(`\\b(\\d{1,3})\\s+(?:${name})\\b`, 'i'));
  return Number(quantity?.[1]) || undefined;
}

type Section = { chapter: number; section: number };
export function readingSections(labels: string[]): Section[] {
  return labels.flatMap(label => {
    const m = label.trim().match(/^(\d{1,2})\.(\d{1,2})$/);
    return m ? [{ chapter: Number(m[1]), section: Number(m[2]) }] : [];
  });
}

export function sectionIds(text: string, catalog: Section[]): string[] | undefined {
  const ids = new Set<string>();
  const ranges = text.matchAll(/\b(\d{1,2})\.(\d{1,2})\b(?:\s*[–—-]\s*(?:(\d{1,2})\.)?(\d{1,2})\b)?/g);
  for (const range of ranges) {
    const c = Number(range[1]), start = Number(range[2]);
    const endChapter = Number(range[3] ?? c), end = Number(range[4] ?? start);
    if (c === endChapter) {
      if (end < start) return undefined;
      for (let i = start; i <= end; i++) ids.add(`${c}.${i}`);
    } else {
      // Only the assigned reading list can tell us what lies between 1.1 and 5.7.
      const assigned = catalog.filter(s => s.chapter >= c && s.chapter <= endChapter
        && (s.chapter !== c || s.section >= start) && (s.chapter !== endChapter || s.section <= end));
      if (new Set(assigned.map(s => s.chapter)).size !== endChapter - c + 1
        || !assigned.some(s => s.chapter === c && s.section === start)
        || !assigned.some(s => s.chapter === endChapter && s.section === end)) return undefined;
      for (const s of assigned) ids.add(`${s.chapter}.${s.section}`);
    }
  }
  if (ids.size) return [...ids];
  const chapters = numberedIds(text, chapter);
  if (!chapters.size) return undefined;
  const assigned = catalog.filter(s => chapters.has(s.chapter));
  if (new Set(assigned.map(s => s.chapter)).size !== chapters.size) return undefined;
  return [...new Set(assigned.map(s => `${s.chapter}.${s.section}`))];
}

export function examWorkload(text: string, catalog: Section[]): Workload | undefined {
  const units = new Map<string, number>();
  const add = (unit: string, count?: number) => { if (count) units.set(unit, count); };
  const weeklySet = /\b(quiz|worksheet|discussion)/i.test(text);
  if (weeklySet) add('week', numberedCount(text, 'weeks?'));
  const assignments = [
    ['homework', homework], ['worksheet', worksheet], ['quiz', quiz],
  ] as const;
  const named = assignments.filter(([, marker]) => new RegExp(`\\b(?:${marker})(?=\\b|\\d)`, 'i').test(text));
  if (named.length > 1) return { kind: 'mixed assignment', units };
  for (const [kind, marker] of named) {
    add('problem', numberedCount(text, 'problems?|questions?'));
    add(kind, numberedCount(text, marker) ?? units.get('week') ?? 1);
    return { kind, units };
  }
  if (/\b(problems?|questions?)\b/i.test(text)) {
    add('problem', numberedCount(text, 'problems?|questions?'));
    if (units.has('problem')) return { kind: 'problems', units };
  }
  if (weeklySet && units.has('week')) return { kind: 'discussion', units };

  if (/\b(read(?:ing)?|reread|textbook|chapters?|chs?\.?|pages?|pp\.)\b/i.test(text)
    || /(?:^|\b\w+\s+)\d{1,2}\.\d{1,2}\b/.test(text)) {
    add('section', sectionIds(text, catalog)?.length ?? numberedCount(text, 'sections?'));
    add('page', numberedCount(text, 'pages?|pp?\\.'));
    add('chapter', numberedCount(text, chapter));
    if (!units.size && !/\d/.test(text)) add('reading task', 1);
    return { kind: 'reading', units };
  }
  const kind = kindOf(text);
  if (kind && kind !== 'exam') {
    add(kind, numberedCount(text, `${kind}s?`) ?? 1);
    return { kind, units };
  }
  return undefined;
}
