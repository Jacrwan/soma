import { sameWork } from './canvasDeepSync';

/**
 * Bringing scores into a grade book from a spreadsheet: a CSV or TSV file, an
 * .xlsx file (Google Sheets and Excel download both), or cells pasted from
 * Sheets, Excel or a Gradescope course page. No AI and no server: the columns
 * are found by their headers or their contents, and the student checks the
 * rows before anything is saved. Pure, apart from the browser's own
 * DecompressionStream for .xlsx.
 */

export type Table = string[][];
export type ColumnMap = { name: number; score: number; max: number | null; category: number | null; date: number | null };
export type ImportRow = {
  /** The row's place in the table, for a stable key. */
  line: number;
  name: string;
  score: number | null;
  max: number | null;
  category: string;
  date: string | null;
  /** What happens to it: added, replaces a typed-in score of the same name,
   *  or left out (no score yet, or a synced score already has it). */
  status: 'new' | 'update' | 'no-score' | 'synced';
  /** The existing entry it replaces. */
  entryId?: string;
};

const MAX_ROWS = 500;

/** Rows of a CSV or TSV (quotes, doubled quotes and newlines inside quotes allowed). */
export function parseDelimited(text: string): Table {
  const clean = text.replace(/^﻿/, '');
  const sample = clean.split(/\r?\n/).slice(0, 10).join('\n');
  const delimiter = sample.includes('\t') ? '\t' : (sample.match(/;/g)?.length ?? 0) > (sample.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: Table = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
      if (rows.length > MAX_ROWS) break;
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return tidy(rows);
}

/** Trimmed cells, no empty rows, at most MAX_ROWS. */
function tidy(rows: Table): Table {
  return rows.map(r => r.map(c => c.replace(/\s+/g, ' ').trim()))
    .filter(r => r.some(Boolean)).slice(0, MAX_ROWS + 1);
}

// ── .xlsx: a zip of XML files; the first sheet is read. ────────────────────

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files in a zip, by name, from its central directory. */
async function unzip(buf: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const bytes = new Uint8Array(buf), view = new DataView(buf);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('not a zip');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, string>();
  const text = new TextDecoder();
  for (let n = 0; n < count && at + 46 <= bytes.length; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = text.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name) || size > 20_000_000) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    out.set(name, text.decode(method === 0 ? raw : method === 8 ? await inflate(raw) : new Uint8Array()));
  }
  return out;
}

/** "C12" → column 2 (0-based). */
const columnOf = (ref: string) => [...(ref.match(/^[A-Z]+/)?.[0] ?? 'A')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export async function readXlsx(buf: ArrayBuffer): Promise<Table> {
  const files = await unzip(buf, n => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const sheetName = [...files.keys()].filter(n => n.startsWith('xl/worksheets/')).sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')))[0];
  if (!sheetName) throw new Error('no sheet');
  const parser = new DOMParser();
  const shared = files.has('xl/sharedStrings.xml')
    ? [...parser.parseFromString(files.get('xl/sharedStrings.xml')!, 'application/xml').getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent ?? '').join(''))
    : [];
  const sheet = parser.parseFromString(files.get(sheetName)!, 'application/xml');
  const rows: Table = [];
  for (const r of [...sheet.getElementsByTagName('row')].slice(0, MAX_ROWS + 1)) {
    const row: string[] = [];
    for (const c of r.getElementsByTagName('c')) {
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      const value = type === 's' ? shared[Number(v)] ?? ''
        : type === 'inlineStr' ? [...c.getElementsByTagName('t')].map(t => t.textContent ?? '').join('')
        : v;
      row[columnOf(c.getAttribute('r') ?? '')] = value;
    }
    rows.push(Array.from(row, c => c ?? ''));
  }
  return tidy(rows);
}

// ── Finding the columns ───────────────────────────────────────────────────

const HEADERS: Record<keyof ColumnMap, RegExp> = {
  name: /^(name|assignment|assignment name|title|item|task|work|activity)$/i,
  score: /^(score|points?|grade|earned|points earned|status|result|mark|your score)$/i,
  max: /^(out of|max|max points|maximum|possible|points possible|total|total points|max score|worth)$/i,
  category: /^(category|type|group|kind|section)$/i,
  date: /^(date|due|due date|submitted|released|graded|date graded)$/i,
};

/** "18.0 / 20.0", "18/20", "90%", "18". */
export function parseScore(cell: string): { score: number; max: number | null } | null {
  const c = cell.replace(/,/g, '').trim();
  // The whole cell: "9/1/2026" is a date, not 9 out of 1.
  const frac = c.match(/^(-?\d+(?:\.\d+)?)\s*(?:\/|out of|of)\s*(\d+(?:\.\d+)?)\s*(?:pts?|points?)?$/i);
  if (frac) return { score: Number(frac[1]), max: Number(frac[2]) };
  const pct = c.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (pct) return { score: Number(pct[1]), max: 100 };
  const n = c.match(/^-?\d+(?:\.\d+)?$/);
  return n ? { score: Number(c), max: null } : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-09-05", "9/5/2026", "Sep 05 at 11:59PM", or a spreadsheet day number → YYYY-MM-DD. */
export function parseDate(cell: string, year = new Date().getFullYear()): string | null {
  const c = cell.trim();
  let m = c.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = c.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m) return `${m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year}-${pad(+m[1])}-${pad(+m[2])}`;
  m = c.match(/^(?:[a-z]{3,9},?\s+)?([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i);
  if (m && MONTHS.includes(m[1].toLowerCase())) return `${m[3] ?? year}-${pad(MONTHS.indexOf(m[1].toLowerCase()) + 1)}-${pad(+m[2])}`;
  // Excel and Sheets store dates as days since 1899-12-30.
  if (/^\d{5}(\.\d+)?$/.test(c) && +c > 30000 && +c < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+c) * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return null;
}

/**
 * Which column is which. A header row is used when there is one; otherwise
 * the name is the first mostly-text column and the score the first that reads
 * as scores. `header` says whether row 0 is headers.
 */
export function detectColumns(table: Table): { map: ColumnMap | null; header: boolean } {
  const width = Math.max(0, ...table.map(r => r.length));
  const first = table[0] ?? [];
  const found: Partial<Record<keyof ColumnMap, number>> = {};
  first.forEach((cell, i) => {
    for (const key of Object.keys(HEADERS) as (keyof ColumnMap)[]) if (found[key] === undefined && HEADERS[key].test(cell)) { found[key] = i; break; }
  });
  const header = found.name !== undefined || found.score !== undefined;
  const body = header ? table.slice(1) : table;
  const share = (i: number, test: (c: string) => boolean) => {
    const cells = body.map(r => r[i] ?? '').filter(Boolean);
    return cells.length ? cells.filter(test).length / cells.length : 0;
  };
  const columns = Array.from({ length: width }, (_, i) => i);
  const name = found.name ?? columns.find(i => i !== found.score && share(i, c => !parseScore(c) && !parseDate(c)) >= 0.6);
  const score = found.score ?? columns.find(i => i !== name && share(i, c => !!parseScore(c)) >= 0.5);
  if (name === undefined || score === undefined) return { map: null, header };
  const date = found.date ?? columns.find(i => i !== name && i !== score && i !== found.max && share(i, c => !!parseDate(c)) >= 0.6);
  return { map: { name, score, max: found.max ?? null, category: found.category ?? null, date: date ?? null }, header };
}

/**
 * What importing would do, row by row. A typed-in score with the same name is
 * replaced; one Canvas (or Gradescope) already shows is left out, so it never
 * counts twice.
 */
export function planImport(
  table: Table, map: ColumnMap, header: boolean,
  existing: { entries: { id: string; name: string }[]; synced: string[] },
  year?: number,
): ImportRow[] {
  const rows = (header ? table.slice(1) : table).slice(0, MAX_ROWS);
  const seen = new Set<string>();
  return rows.flatMap((r, line) => {
    const name = (r[map.name] ?? '').slice(0, 120);
    if (!name) return [];
    const parsed = parseScore(r[map.score] ?? '');
    const maxCell = map.max !== null ? parseScore(r[map.max] ?? '') : null;
    const max = parsed?.max ?? maxCell?.score ?? null;
    const score = parsed && max && max > 0 && parsed.score >= 0 ? parsed.score : null;
    const key = name.toLowerCase();
    const entry = existing.entries.find(e => e.name.trim().toLowerCase() === key);
    const status: ImportRow['status'] = score === null ? 'no-score'
      : existing.synced.some(s => sameWork(s, name)) ? 'synced'
      : entry || seen.has(key) ? 'update' : 'new';
    seen.add(key);
    return [{
      line, name, score, max: score === null ? null : max, status, ...(entry ? { entryId: entry.id } : {}),
      category: map.category !== null ? (r[map.category] ?? '').slice(0, 60) : '',
      date: map.date !== null ? parseDate(r[map.date] ?? '', year) : null,
    }];
  });
}
