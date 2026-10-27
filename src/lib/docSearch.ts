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

/**
 * The passages that best answer `query`, best first, up to `budgetChars` in
 * all. Passages from the courses in `subjectIds` count a little more, and a
 * syllabus a little more for questions about grading, exams and policy.
 */
export function search(docs: SearchDoc[], query: string, opts: { budgetChars?: number; subjectIds?: string[]; max?: number } = {}): Passage[] {
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
  }).filter(x => x.score > 0).sort((x, y) => y.score - x.score);

  const picked: Passage[] = [];
  let used = 0;
  for (const { p } of scored) {
    if (picked.length >= (opts.max ?? 12)) break;
    if (used + p.text.length > budget) continue;
    picked.push(p);
    used += p.text.length;
  }
  return picked;
}
