/**
 * Finding the parts of a student's documents that matter to a question, in
 * the browser, with no AI call and no new service.
 *
 * Soma used to paste every uploaded document into the prompt, cut off at
 * 45,000 characters. That missed anything past the cut, and because students
 * usually send one message and leave, the cached copy had expired by the next
 * message and was billed again at the cache-write price (1.25× input) nearly
 * every time. Now each document is split into passages, the passages are
 * ranked against the question with BM25 (the standard keyword ranking), and
 * only the best ones are sent: every document is searchable, and a message
 * costs a fraction of what it did.
 */

export type Passage = { docId: string; fileName: string; docType: string; subjectId: string | null; index: number; text: string };
export type SearchDoc = { id: string; fileName: string; docType: string; subjectId: string | null; extractedText: string | null };

const PASSAGE_CHARS = 1200;
const OVERLAP_CHARS = 200;

// Common words that say nothing about which passage is relevant.
const STOP = new Set(('a an and are as at be but by can do for from has have how i if in into is it its me my no not of on or our so than that the their them then there these they this to up us was we were what when where which who why will with you your about after all also am any been before being both could did does each had he her him his just more most much only other out over own same she should some such too under very would'
).split(' '));

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)*/g) ?? [])
    .filter(t => !STOP.has(t) && (t.length > 1 || /\d/.test(t)))
    // Plural and simple verb endings, so "vectors" finds "vector".
    .map(t => /\d/.test(t) ? t : t.replace(/(ies)$/, 'y').replace(/(?<=[a-z]{3})(es|s)$/, ''));
}

/** A document as passages of about PASSAGE_CHARS, broken at paragraph or sentence ends where it can. */
export function passages(doc: SearchDoc): Passage[] {
  const text = (doc.extractedText ?? '').replace(/\r/g, '').trim();
  if (!text) return [];
  const out: Passage[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + PASSAGE_CHARS);
    if (end < text.length) {
      const window = text.slice(start + PASSAGE_CHARS * 0.6, end);
      const brk = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf('. '));
      if (brk > 0) end = start + PASSAGE_CHARS * 0.6 + brk + 1;
    }
    out.push({ docId: doc.id, fileName: doc.fileName, docType: doc.docType, subjectId: doc.subjectId, index: out.length, text: text.slice(start, end).trim() });
    if (end >= text.length) break;
    // Back up a little for context, starting on a word.
    let next = Math.max(end - OVERLAP_CHARS, start + 1);
    const space = text.indexOf(' ', next);
    if (space > 0 && space < end) next = space + 1;
    start = next;
  }
  return out;
}

const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The days a passage mentions, as "10-27": "Oct 27 & 29", "27 October", "10/27", "2026-10-27". */
export function datesIn(text: string): Set<string> {
  const out = new Set<string>();
  const add = (month: number, day: number) => {
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) out.add(`${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  };
  const monthOf = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  for (const m of text.matchAll(new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?!\\d|[.:/]\\d)((?:\\s*(?:&|,|and|-|–|—)\\s*\\d{1,2}(?!\\d|[.:/]\\d))*)`, 'gi'))) {
    add(monthOf(m[1]), Number(m[2]));
    for (const more of m[3].match(/\d{1,2}/g) ?? []) add(monthOf(m[1]), Number(more));
  }
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})\\s+${MONTH}\\b`, 'gi'))) add(monthOf(m[2]), Number(m[1]));
  for (const m of text.matchAll(/(?<![\d/.])(\d{1,2})\/(\d{1,2})(?![\d])/g)) add(Number(m[1]), Number(m[2]));
  for (const m of text.matchAll(/\b\d{4}-(\d{2})-(\d{2})\b/g)) add(Number(m[1]), Number(m[2]));
  return out;
}

/** Every day of last week and this week (Monday to Sunday), as datesIn writes them. */
export function daysAround(now: Date): string[] {
  const d = new Date(now); d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
  return Array.from({ length: 14 }, (_, i) => {
    const x = new Date(d); x.setDate(d.getDate() + i);
    return `${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  });
}

/**
 * The passages that best answer `query`, best first, up to `budgetChars` in
 * all. Passages from the courses in `subjectIds` count a little more, and a
 * syllabus a little more for questions about grading, exams and policy.
 *
 * `dates` (from daysAround): a guide lists work by lecture date, and "last
 * week" isn't a word in it, so no ranking of words can find it. The best
 * matches keep the first half of the budget, then passages dated on these days
 * come next: from a course in `subjectIds` whatever their words, otherwise only
 * if they match at all.
 */
export function search(docs: SearchDoc[], query: string, opts: { budgetChars?: number; subjectIds?: string[]; max?: number; dates?: string[] } = {}): Passage[] {
  const budget = opts.budgetChars ?? 9000;
  const all = docs.flatMap(passages);
  if (!all.length) return [];
  const q = [...new Set(tokens(query))];
  // Small enough to send whole: no ranking can do better than everything.
  const total = all.reduce((n, p) => n + p.text.length, 0);
  if (!q.length || total <= budget) {
    return total <= budget ? all : [];
  }
  const docTokens = all.map(p => tokens(p.text));
  const avg = docTokens.reduce((n, t) => n + t.length, 0) / docTokens.length;
  const df = new Map<string, number>();
  for (const ts of docTokens) for (const t of new Set(ts)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = all.length, k1 = 1.4, b = 0.75;
  const policy = /\b(grade|grading|weight|percent|exam|midterm|final|quiz|late|policy|due|office|hours|attendance)\b/i.test(query);
  const scored = all.map((p, i) => {
    const tf = new Map<string, number>();
    for (const t of docTokens[i]) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * docTokens[i].length / avg));
    }
    if (score > 0 && opts.subjectIds?.length && p.subjectId && opts.subjectIds.includes(p.subjectId)) score *= 1.25;
    if (score > 0 && policy && p.docType === 'syllabus') score *= 1.3;
    return { p, score };
  }).sort((x, y) => y.score - x.score);
  const matched = scored.filter(x => x.score > 0);

  const picked = new Set<Passage>();
  let used = 0;
  const take = (rows: typeof scored, limit: number) => {
    for (const { p } of rows) {
      if (picked.size >= (opts.max ?? 12)) return;
      if (picked.has(p) || used + p.text.length > limit) continue;
      picked.add(p);
      used += p.text.length;
    }
  };
  if (opts.dates?.length) {
    const wanted = new Set(opts.dates);
    const focus = opts.subjectIds ?? [];
    take(matched, budget / 2);
    take(scored.filter(x => (x.score > 0 || (!!x.p.subjectId && focus.includes(x.p.subjectId))) && [...datesIn(x.p.text)].some(d => wanted.has(d))), budget);
  }
  take(matched, budget);
  return [...picked];
}
