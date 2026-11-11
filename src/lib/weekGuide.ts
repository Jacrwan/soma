/**
 * Dated course guides, read as week rows. No model.
 *
 * A homework guide lists work by lecture date: "Nov 3, 5  15.6 3,5,7 … 15.7 …".
 * Keyword search can't tell which row "last week's homework" means: the row
 * has no words from the message, only dates and section numbers. On
 * 2026-11-10 Soma said it couldn't tell which sections were assigned, though
 * the guide was uploaded, and titled the block with a month-old task's
 * sections instead. Here a guide becomes rows (dates → sections), so the week
 * is picked in code.
 */

export type GuideRow = {
  /** Lecture days in the row, in order. */
  dates: Date[];
  /** The row's dates as written: "Nov 3, 5". */
  label: string;
  /** Section numbers in the row: "15.6", "15.7". */
  sections: string[];
};

export type Guide = { docId: string; fileName: string; subjectId: string; rows: GuideRow[] };

const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "Nov 3, 5", "Sept 29, Oct 1", "Oct 13 & 15": a month and day, then more days or month-days. */
const HEADER = new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?![\\d.:/])(?:\\s*(?:,|&|and|-|–)\\s*(?:${MONTH}\\.?\\s+)?\\d{1,2}(?![\\d.:/]))*`, 'gi');
/** Fewer rows than this and it's a syllabus that mentions a few dates, not a guide. */
const MIN_ROWS = 4;

/** The year that puts month/day nearest `now` (guides rarely write years). */
function nearest(month: number, day: number, now: Date): Date {
  const options = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => new Date(y, month - 1, day, 12));
  return options.sort((a, b) => Math.abs(+a - +now) - Math.abs(+b - +now))[0];
}

function datesOf(header: string, now: Date): Date[] {
  const out: Date[] = [];
  let month = 0;
  for (const m of header.matchAll(new RegExp(`${MONTH}\\.?\\s+(\\d{1,2})|(\\d{1,2})`, 'gi'))) {
    if (m[1]) month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const day = Number(m[2] ?? m[3]);
    if (month >= 1 && day >= 1 && day <= 31) out.push(nearest(month, day, now));
  }
  return out;
}

/** The rows of a dated guide, or none when the text isn't one. */
export function guideRows(text: string, now = new Date()): GuideRow[] {
  const headers = [...text.matchAll(HEADER)];
  const rows: GuideRow[] = [];
  headers.forEach((h, i) => {
    const body = text.slice(h.index! + h[0].length, i + 1 < headers.length ? headers[i + 1].index : text.length);
    // Ranges count in full: "11.1 - 11.3" is 11.1, 11.2 and 11.3.
    const sections = sectionsIn(body.replace(/\s+[-–]\s+/g, '–'));
    const dates = datesOf(h[0], now);
    if (sections.length && dates.length) rows.push({ dates, label: h[0].replace(/\s+/g, ' ').trim(), sections });
  });
  return rows.length >= MIN_ROWS ? rows : [];
}

/** Uploaded documents that are dated guides, by course. */
export function guidesOf(docs: { id: string; fileName: string; subjectId: string | null; extractedText?: string | null; extractionStatus?: string }[], now = new Date()): Guide[] {
  return docs.flatMap(d => {
    if (!d.subjectId || !d.extractedText || (d.extractionStatus && d.extractionStatus !== 'done')) return [];
    const rows = guideRows(d.extractedText, now);
    return rows.length ? [{ docId: d.id, fileName: d.fileName, subjectId: d.subjectId, rows }] : [];
  });
}

/** Monday 00:00 of the week `d` falls in (weeks run Monday to Sunday). */
export function mondayOf(d: Date): Date {
  const m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

/**
 * The week starting `monday`, as one row: a guide with a row per lecture
 * (Physics: "Nov 3 … 11.1 - 11.3", "Nov 5 … 11.3 - 11.4") is merged, so the
 * week is "Nov 3 & Nov 5: 11.1, 11.2, 11.3, 11.4", not just its first row.
 */
export function rowForWeek(guide: Guide, monday: Date): GuideRow | undefined {
  const end = new Date(monday); end.setDate(end.getDate() + 7);
  const rows = guide.rows.filter(r => r.dates[0] >= monday && r.dates[0] < end);
  if (rows.length <= 1) return rows[0];
  return { dates: rows.flatMap(r => r.dates), label: rows.map(r => r.label).join(' & '), sections: [...new Set(rows.flatMap(r => r.sections))] };
}

/** The row that lists `section`, first match. */
export function rowWithSection(guide: Guide, section: string): GuideRow | undefined {
  return guide.rows.find(r => r.sections.includes(section));
}

/** Section numbers a title names: "15.1–15.4" is 15.1 … 15.4; "14.7, 14.8" both. */
export function sectionsIn(title: string): string[] {
  const out: string[] = [];
  for (const m of title.matchAll(/(\d{1,2})\.(\d{1,2})(?:\s*[–-]\s*(?:(\d{1,2})\.)?(\d{1,2}))?/g)) {
    const chapter = Number(m[1]), from = Number(m[2]);
    const toChapter = m[3] ? Number(m[3]) : chapter, to = m[4] ? Number(m[4]) : from;
    if (toChapter !== chapter || to < from || to - from > 12) { out.push(`${chapter}.${from}`); continue; }
    for (let s = from; s <= to; s++) out.push(`${chapter}.${s}`);
  }
  return [...new Set(out)];
}
