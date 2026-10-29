import { useMemo, useState, type ChangeEvent } from 'react';
import { detectColumns, parseDelimited, planImport, readXlsx, type ColumnMap, type ImportRow, type Table } from '../../lib/gradeImport';
import { guessCategory, type GradeBook, type GradeEntry } from '../../lib/gradeBooks';
import { showScore, type GradeCourse } from '../../lib/grades';
import styles from './GradesTab.module.css';

/**
 * Scores from a spreadsheet: a .csv/.tsv/.xlsx file, or cells pasted from
 * Sheets, Excel or a Gradescope course page. The student sees which column is
 * which and what each row will do before anything is saved.
 */

type Props = {
  course: GradeCourse;
  onImport: (change: (book: GradeBook) => GradeBook) => Promise<void>;
  onDone: (message: string) => void;
  onCancel: () => void;
};

const MAX_BYTES = 5 * 1024 * 1024;
const letter = (i: number) => String.fromCharCode(65 + (i % 26));
const STATUS: Record<ImportRow['status'], string> = { new: 'New', update: 'Replaces yours', 'no-score': 'No score yet', synced: 'Already synced' };

export default function ScoreImport({ course, onImport, onDone, onCancel }: Props) {
  const [table, setTable] = useState<Table | null>(null);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [header, setHeader] = useState(false);
  const [paste, setPaste] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const categories = course.book?.categories ?? [];

  const take = (rows: Table, from: string) => {
    if (rows.length < 1) { setError('That has no rows Soma can read.'); return; }
    const found = detectColumns(rows);
    const width = Math.max(...rows.map(r => r.length));
    setTable(rows);
    setHeader(found.header);
    setMap(found.map ?? { name: 0, score: Math.min(1, width - 1), max: null, category: null, date: null });
    setSource(from);
    setError(found.map ? '' : 'Soma couldn’t tell which columns hold the names and scores. Pick them below.');
  };

  const readFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) { setError('That file is over 5 MB. Export just the grades.'); return; }
    setError('');
    try {
      if (/\.xlsx$/i.test(file.name)) take(await readXlsx(await file.arrayBuffer()), file.name);
      else if (/\.(xls|numbers|ods)$/i.test(file.name)) setError('Soma reads .xlsx, .csv and .tsv. Save it as one of those, or copy the cells and paste them.');
      else take(parseDelimited(await file.text()), file.name);
    } catch {
      setError('Soma couldn’t read that file. Try saving it as .csv, or copy the cells and paste them.');
    }
  };

  const synced = useMemo(() => course.items.filter(i => i.source !== 'manual').map(i => i.name), [course.items]);
  const rows = useMemo(() => table && map ? planImport(table, map, header, { entries: course.book?.entries ?? [], synced }) : [], [table, map, header, course.book, synced]);
  const importable = rows.filter(r => r.status === 'new' || r.status === 'update');
  const count = (s: ImportRow['status']) => rows.filter(r => r.status === s).length;
  /** The category a row names, when it names one of the syllabus's; else Soma picks by name later. */
  const categoryOf = (r: ImportRow) => r.category ? guessCategory(categories, r.category, r.category) : null;
  /** What the preview shows: the named category, else the one a replaced score already had, else Soma's guess. */
  const shownCategory = (r: ImportRow) => {
    const kept = r.entryId ? categories.find(c => c.id === course.book?.entries.find(e => e.id === r.entryId)?.categoryId) : undefined;
    return categoryOf(r) ?? kept ?? guessCategory(categories, r.name);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onImport(b => {
        const entries = [...b.entries];
        for (const r of importable) {
          const at = entries.findIndex(e => e.name.trim().toLowerCase() === r.name.toLowerCase());
          const entry: GradeEntry = { id: at >= 0 ? entries[at].id : crypto.randomUUID(), name: r.name, score: r.score as number, max: r.max as number, categoryId: categoryOf(r)?.id ?? (at >= 0 ? entries[at].categoryId : null), date: r.date };
          if (at >= 0) entries[at] = entry; else entries.push(entry);
        }
        return { ...b, entries };
      });
      onDone(`Imported ${importable.length} score${importable.length === 1 ? '' : 's'} from ${source}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Please retry.');
      setSaving(false);
    }
  };

  if (!table || !map) {
    return (
      <div className={styles.importBox}>
        <p className={styles.setupLead}>
          Bring in scores from a spreadsheet. In Google Sheets choose File → Download → .csv or .xlsx; or copy the cells (or the table on your Gradescope course page) and paste them below.
        </p>
        <div className={styles.setupRow}>
          <label className={styles.secondary}>
            Choose a file
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={readFile} className={styles.fileInput} aria-label="Spreadsheet file" />
          </label>
          <span className={styles.muted}>.csv, .tsv or .xlsx</span>
        </div>
        <textarea className={styles.textarea} rows={5} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'Or paste rows here, e.g.\nAssignment\tScore\tOut of\nHW 1\t18\t20'} aria-label="Pasted rows" />
        <div className={styles.setupRow}>
          <button type="button" className={styles.primary} disabled={!paste.trim()} onClick={() => take(parseDelimited(paste), 'pasted rows')}>Read pasted rows</button>
          <button type="button" className={styles.linkButton} onClick={onCancel}>Cancel</button>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    );
  }

  const width = Math.max(...table.map(r => r.length));
  const columnName = (i: number) => header && table[0][i] ? `${letter(i)}: ${table[0][i].slice(0, 30)}` : `Column ${letter(i)}`;
  const pick = (key: keyof ColumnMap, optional: boolean) => (
    <label className={styles.mapField}>
      <span>{{ name: 'Assignment', score: 'Score', max: 'Out of', category: 'Category', date: 'Date' }[key]}</span>
      <select className={styles.select} value={map[key] ?? ''} onChange={e => setMap({ ...map, [key]: e.target.value === '' ? null : Number(e.target.value) })}>
        {optional && <option value="">{key === 'max' ? 'In the score (18 / 20)' : 'None'}</option>}
        {Array.from({ length: width }, (_, i) => <option key={i} value={i}>{columnName(i)}</option>)}
      </select>
    </label>
  );

  return (
    <div className={styles.importBox}>
      <p className={styles.setupLead}>From {source}. Check the columns, then import.</p>
      <div className={styles.mapRow}>
        {pick('name', false)}{pick('score', false)}{pick('max', true)}{pick('category', true)}{pick('date', true)}
        <label className={styles.checkField}>
          <input type="checkbox" checked={header} onChange={e => setHeader(e.target.checked)} /> First row is headers
        </label>
      </div>
      <p className={styles.importSummary}>
        {[`${count('new')} new`, count('update') && `${count('update')} replace scores you added`, count('no-score') && `${count('no-score')} with no score yet, left out`, count('synced') && `${count('synced')} already synced from Canvas, left out`].filter(Boolean).join(' · ')}
      </p>
      <div className={styles.previewWrap}>
        <table className={styles.preview}>
          <thead><tr><th>Assignment</th><th className={styles.right}>Score</th><th>Category</th><th>Date</th><th /></tr></thead>
          <tbody>
            {rows.slice(0, 50).map(r => (
              <tr key={r.line} className={r.status === 'new' || r.status === 'update' ? '' : styles.skipped}>
                <td>{r.name}</td>
                <td className={styles.right}>{r.score !== null ? `${showScore(r.score)} / ${showScore(r.max as number)}` : '—'}</td>
                <td>{categories.length ? shownCategory(r)?.name ?? <span className={styles.muted}>Pick later</span> : <span className={styles.muted}>{r.category || '—'}</span>}</td>
                <td>{r.date ? new Date(`${r.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</td>
                <td className={styles.statusCell}>{STATUS[r.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 50 && <p className={styles.hint}>And {rows.length - 50} more rows.</p>}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.setupRow}>
        <button type="button" className={styles.primary} disabled={saving || !importable.length} onClick={save}>
          {saving ? 'Importing…' : `Import ${importable.length} score${importable.length === 1 ? '' : 's'}`}
        </button>
        <button type="button" className={styles.linkButton} disabled={saving} onClick={() => { setTable(null); setMap(null); setError(''); }}>Start over</button>
        <button type="button" className={styles.linkButton} disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
