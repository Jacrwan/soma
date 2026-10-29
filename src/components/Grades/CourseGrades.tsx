import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { headline, showPercent, showScore, type GradeCourse, type GradeItem } from '../../lib/grades';
import { byPoints, categoriesFromGroups, normalizeCategories, NOT_COUNTED, readGrading, type GradeBook, type GradeCategory, type GradeEntry, type ScaleStep } from '../../lib/gradeBooks';
import { getCachedDocuments, listDocuments } from '../../lib/documents';
import type { SomaDocument } from '../../types';
import ScoreImport from './ScoreImport';
import styles from './GradesTab.module.css';

/**
 * One course on the Grades page: its grade, how the course is graded (the
 * categories from its syllabus, their weights and what each covers), and
 * every score, synced or typed in, each in a category the student can change.
 */

type Props = {
  course: GradeCourse;
  title: string;
  code: string;
  /** Change the course's grade book and save it; resolves once saved. */
  onChange: (change: (book: GradeBook) => GradeBook) => Promise<void>;
  onBack: () => void;
  headingRef: React.Ref<HTMLHeadingElement>;
};

const fill = (percent: number | null) => `${Math.max(0, Math.min(100, percent ?? 0))}%`;
/** A score worth a second look. Only the number is coloured; nothing shouts. */
const LOW = 70;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function Bar({ percent, color }: { percent: number | null; color: string | null }) {
  return (
    <span className={styles.track} aria-hidden="true">
      <span className={styles.fill} style={{ width: fill(percent), background: color ?? 'var(--accent)' }} />
    </span>
  );
}

export function Grade({ course, large }: { course: GradeCourse; large?: boolean }) {
  const h = headline(course);
  const label = !h.big ? 'No grade yet'
    : h.kind === 'average' ? `Average ${h.big}`
    : `${h.kind !== 'weighted' ? 'Course grade' : course.weighted?.mode === 'points' ? 'Grade by points' : 'Weighted grade'} ${[h.big, h.small].filter(Boolean).join(', ')}`;
  return (
    <span className={`${styles.grade} ${large ? styles.gradeLarge : ''}`} role="img" aria-label={label}>
      <span className={styles.gradeBig}>{h.big ?? '–'}</span>
      {h.small && <span className={styles.gradeSmall}>{h.small}</span>}
    </span>
  );
}

/** "A 93, A- 90, B+ 87" ↔ the scale. */
const scaleText = (scale: ScaleStep[] | null) => (scale ?? []).map(s => `${s.letter} ${s.min}`).join(', ');
function parseScale(text: string): ScaleStep[] | null {
  const steps = [...text.matchAll(/([A-F][+-]?|P|NP)\s*[:=≥>]*\s*(\d+(?:\.\d+)?)/gi)]
    .map(m => ({ letter: m[1].toUpperCase(), min: Number(m[2]) }))
    .filter(s => s.min >= 0 && s.min <= 100000)
    .sort((a, b) => b.min - a.min);
  return steps.length ? steps : null;
}

/** "100 pts", "2.5 pts". */
const showPoints = (n: number) => `${showScore(n)} pt${n === 1 ? '' : 's'}`;

/** `amount` is the weight in percent, or in a points course the points. */
type Draft = { id: string; name: string; amount: string; covers: string; drop: string; match: string[] };
const toDraft = (c: GradeCategory): Draft => ({ id: c.id, name: c.name, amount: String(c.points ?? c.weight), covers: c.covers, drop: String(c.drop || ''), match: c.match });
const blankDraft = (): Draft => ({ id: crypto.randomUUID(), name: '', amount: '', covers: '', drop: '', match: [] });

/** The course's documents that Soma has read, the syllabus first. */
function readableDocs(docs: SomaDocument[], subjectId: string | null): SomaDocument[] {
  const rank = (d: SomaDocument) => (d.subjectId === subjectId && subjectId ? 0 : 2) + (d.docType === 'syllabus' ? 0 : 1);
  return docs.filter(d => d.extractionStatus === 'done' && d.extractedText?.trim())
    .filter(d => (subjectId && d.subjectId === subjectId) || d.docType === 'syllabus')
    .sort((a, b) => rank(a) - rank(b));
}

function GradingSetup({ course, onDraft, onCancel }: { course: GradeCourse; onDraft: (categories: GradeCategory[], scale: ScaleStep[] | null) => void; onCancel?: () => void }) {
  const [docs, setDocs] = useState(() => readableDocs(getCachedDocuments(), course.subjectId));
  const [docId, setDocId] = useState('');
  const [paste, setPaste] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    listDocuments().then(all => { if (live) setDocs(readableDocs(all, course.subjectId)); }).catch(() => {});
    return () => { live = false; };
  }, [course.subjectId]);
  const chosen = docs.find(d => d.id === docId) ?? docs[0];

  const read = async (text: string) => {
    setReading(true);
    setError('');
    try {
      const { categories, scale } = await readGrading(text, course.name);
      onDraft(categories, scale);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Soma couldn’t read this syllabus. Please try again.');
    } finally {
      setReading(false);
    }
  };

  return (
    <div className={styles.setup}>
      <p className={styles.setupLead}>
        Tell Soma how this course is graded and every score, from Canvas or typed in, adds up to one grade.
      </p>
      {paste === null ? (
        <div className={styles.setupRow}>
          {docs.length > 0 ? (
            <>
              {docs.length > 1 && (
                <select className={styles.select} value={chosen?.id ?? ''} onChange={e => setDocId(e.target.value)} aria-label="Document to read">
                  {docs.map(d => <option key={d.id} value={d.id}>{d.fileName}</option>)}
                </select>
              )}
              <button type="button" className={styles.primary} disabled={reading || !chosen} onClick={() => chosen?.extractedText && read(chosen.extractedText)}>
                {reading ? 'Reading…' : docs.length > 1 ? 'Read grading' : `Read grading from ${chosen.fileName}`}
              </button>
            </>
          ) : null}
          <button type="button" className={styles.secondary} disabled={reading} onClick={() => setPaste('')}>Paste the grading section</button>
          {course.canvasGroups.length > 0 && (
            <button type="button" className={styles.secondary} disabled={reading} onClick={() => onDraft(categoriesFromGroups(course.canvasGroups), null)}>Use Canvas’s weights</button>
          )}
          <button type="button" className={styles.linkButton} disabled={reading} onClick={() => onDraft([], null)}>Add them yourself</button>
          {onCancel && <button type="button" className={styles.linkButton} disabled={reading} onClick={onCancel}>Cancel</button>}
        </div>
      ) : (
        <form className={styles.pasteForm} onSubmit={e => { e.preventDefault(); if (paste.trim()) read(paste); }}>
          <textarea className={styles.textarea} value={paste} onChange={e => setPaste(e.target.value)} rows={6}
            placeholder="Paste the part of the syllabus that says how the course is graded" aria-label="Grading section of the syllabus" />
          <div className={styles.setupRow}>
            <button type="submit" className={styles.primary} disabled={reading || !paste.trim()}>{reading ? 'Reading…' : 'Read grading'}</button>
            <button type="button" className={styles.linkButton} disabled={reading} onClick={() => setPaste(null)}>Cancel</button>
          </div>
        </form>
      )}
      {!docs.length && paste === null && <p className={styles.hint}>Add the syllabus in Documents and Soma can read the weights from it.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}

function GradingEditor({ initial, scale: initialScale, onSave, onCancel }: {
  initial: GradeCategory[]; scale: ScaleStep[] | null;
  onSave: (categories: GradeCategory[], scale: ScaleStep[] | null) => Promise<void>; onCancel: () => void;
}) {
  const [rows, setRows] = useState<Draft[]>(() => initial.length ? initial.map(toDraft) : [blankDraft()]);
  const [mode, setMode] = useState<'weights' | 'points'>(() => byPoints(initial) ? 'points' : 'weights');
  const points = mode === 'points';
  const [scale, setScale] = useState(() => scaleText(initialScale));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const total = round2(rows.reduce((n, r) => n + (Number(r.amount) || 0), 0));
  const set = (id: string, patch: Partial<Draft>) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const filled = rows.filter(r => r.name.trim() || r.amount.trim());
    const bad = filled.find(r => !r.name.trim() || r.amount.trim() === '' || !(Number(r.amount) >= 0 && Number(r.amount) <= (points ? 100000 : 100)));
    if (bad) { setError(points ? 'Each category needs a name and its points.' : 'Each category needs a name and a weight from 0 to 100.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(normalizeCategories(filled.map(r => ({
        id: r.id, name: r.name.trim().slice(0, 60), covers: r.covers.trim().slice(0, 200),
        weight: points ? 0 : round2(Number(r.amount)), points: points ? round2(Number(r.amount)) : null,
        drop: Math.max(0, Math.min(20, Math.floor(Number(r.drop) || 0))), match: r.match,
      }))), parseScale(scale));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Please retry.');
      setSaving(false);
    }
  };

  return (
    <form className={styles.editor} onSubmit={save}>
      <div className={styles.modeRow} role="radiogroup" aria-label="How the course is graded">
        <span className={styles.muted}>Graded by</span>
        <span className={styles.segmented}>
          <button type="button" role="radio" aria-checked={!points} className={!points ? styles.segOn : ''} onClick={() => setMode('weights')}>Weights (%)</button>
          <button type="button" role="radio" aria-checked={points} className={points ? styles.segOn : ''} onClick={() => setMode('points')}>Total points</button>
        </span>
      </div>
      <div className={styles.editHead} aria-hidden="true">
        <span>Category</span><span>What counts</span><span className={styles.right}>{points ? 'Points' : 'Weight'}</span><span className={styles.right}>Drop lowest</span><span />
      </div>
      {rows.map((r, n) => (
        <div key={r.id} className={styles.editRow}>
          <input className={styles.input} value={r.name} onChange={e => set(r.id, { name: e.target.value })} placeholder={n === 0 ? 'Homework' : ''} aria-label={`Category ${n + 1} name`} />
          <input className={styles.input} value={r.covers} onChange={e => set(r.id, { covers: e.target.value })} placeholder={n === 0 ? 'e.g. Weekly problem sets' : ''} aria-label={`Category ${n + 1}: what counts`} />
          <span className={styles.withUnit}>
            <input className={`${styles.input} ${styles.num}`} inputMode="decimal" value={r.amount} onChange={e => set(r.id, { amount: e.target.value })} placeholder={points ? '100' : '20'} aria-label={points ? `Category ${n + 1} points` : `Category ${n + 1} weight in percent`} />{points ? 'pts' : '%'}
          </span>
          <input className={`${styles.input} ${styles.num}`} inputMode="numeric" value={r.drop} onChange={e => set(r.id, { drop: e.target.value })} placeholder="0" aria-label={`Category ${n + 1}: lowest scores dropped`} />
          <button type="button" className={styles.remove} onClick={() => setRows(rs => rs.filter(x => x.id !== r.id))} aria-label={`Remove ${r.name || `category ${n + 1}`}`}>×</button>
        </div>
      ))}
      <div className={styles.editFoot}>
        <button type="button" className={styles.linkButton} onClick={() => setRows(rs => [...rs, blankDraft()])}>+ Add category</button>
        {points
          ? <span className={styles.totalOk}>{showScore(total)} points in all</span>
          : <span className={total === 100 ? styles.totalOk : styles.totalOff}>Weights add up to {total}%</span>}
      </div>
      <label className={styles.scaleField}>
        <span>Letter grades <span className={styles.muted}>(optional)</span></span>
        <input className={styles.input} value={scale} onChange={e => setScale(e.target.value)} placeholder={points ? 'A 285, A- 270, B+ 250 (in points)' : 'A 93, A- 90, B+ 87, B 83'} aria-label="Letter grade cutoffs" />
      </label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.setupRow}>
        <button type="submit" className={styles.primary} disabled={saving}>{saving ? 'Saving…' : 'Save grading'}</button>
        <button type="button" className={styles.linkButton} disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** Whether a course's Grading is unfolded, remembered on this device only. */
const OPEN_KEY = 'soma_grading_open';
function readOpen(courseKey: string): boolean {
  try { return (JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as unknown[]).includes(courseKey); } catch { return false; }
}
function writeOpen(courseKey: string, open: boolean) {
  try {
    const keys = (JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as unknown[]).filter((k): k is string => typeof k === 'string' && k !== courseKey);
    localStorage.setItem(OPEN_KEY, JSON.stringify(open ? [...keys, courseKey].slice(-50) : keys));
  } catch { /* storage blocked: it just won't be remembered */ }
}

function Grading({ course, onChange }: Pick<Props, 'course' | 'onChange'>) {
  const book = course.book;
  const categories = book?.categories ?? [];
  const [draft, setDraft] = useState<{ categories: GradeCategory[]; scale: ScaleStep[] | null } | null>(null);
  const [again, setAgain] = useState(false);
  const [open, setOpen] = useState(() => readOpen(course.key));
  const w = course.weighted;
  const points = w?.mode === 'points';
  // Setting it up or editing always shows; once set up it folds to one line.
  const expanded = !categories.length || !!draft || again || open;
  const toggle = () => { const next = !open; setOpen(next); writeOpen(course.key, next); };
  const fold = categories.length > 0 && !draft && !again;

  const save = async (next: GradeCategory[], scale: ScaleStep[] | null) => {
    await onChange(b => {
      const ids = new Set(next.map(c => c.id));
      // A pick for a category that's gone falls back to Soma's guess.
      const picks = Object.fromEntries(Object.entries(b.picks).filter(([, v]) => v === NOT_COUNTED || ids.has(v)));
      const entries = b.entries.map(e => e.categoryId && e.categoryId !== NOT_COUNTED && !ids.has(e.categoryId) ? { ...e, categoryId: null } : e);
      return { ...b, categories: next, scale, picks, entries };
    });
    setDraft(null);
    // Just saved: stay open on what was saved.
    setOpen(true);
    writeOpen(course.key, true);
  };

  return (
    <section className={styles.section} aria-labelledby="grading-title">
      <div className={styles.sectionHead}>
        <h2 id="grading-title" className={styles.sectionTitle}>
          {fold ? (
            <button type="button" className={styles.foldButton} onClick={toggle} aria-expanded={expanded} aria-controls="grading-body">
              <span className={`${styles.foldChevron} ${expanded ? styles.foldOpen : ''}`} aria-hidden="true">›</span>
              Grading
            </button>
          ) : 'Grading'}
        </h2>
        {fold && !expanded && (
          <span className={styles.foldSummary}>
            {points ? `Total points · ${showScore(w?.total ?? 0)} pts` : 'Weights'} · {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}
          </span>
        )}
        {fold && expanded && (
          <span className={styles.headActions}>
            <button type="button" className={styles.linkButton} onClick={() => setAgain(true)}>Read again</button>
            <button type="button" className={styles.linkButton} onClick={() => setDraft({ categories, scale: book?.scale ?? null })}>Edit</button>
          </span>
        )}
      </div>
      <div id="grading-body">
        {!expanded ? null : draft ? (
          <GradingEditor initial={draft.categories} scale={draft.scale} onSave={save} onCancel={() => setDraft(null)} />
        ) : !categories.length || again ? (
          <GradingSetup course={course} onDraft={(c, scale) => { setAgain(false); setDraft({ categories: c, scale }); }} onCancel={again ? () => setAgain(false) : undefined} />
        ) : (
          <>
            <ul className={styles.categories}>
              {w?.categories.map(r => (
                <li key={r.category.id} className={styles.category}>
                  <span className={styles.categoryName}>
                    {r.category.name}
                    {(r.category.covers || r.category.drop > 0) && (
                      <span className={styles.itemMeta}>
                        {r.category.covers}
                        {r.category.drop > 0 && !/drop/i.test(r.category.covers) && `${r.category.covers ? ' · ' : ''}lowest ${r.category.drop} dropped`}
                      </span>
                    )}
                  </span>
                  <span className={styles.weight}>{points ? showPoints(r.category.points ?? 0) : showPercent(r.category.weight)}</span>
                  <Bar percent={r.percent} color={course.color} />
                  <span className={styles.categoryScore}>
                    {r.percent !== null ? showPercent(r.percent) : <span className={styles.muted}>—</span>}
                    <span className={styles.itemMeta}>
                      {!r.count ? 'nothing yet'
                        : points ? `${showScore(r.earned)} / ${showScore(r.possible)} pts${r.dropped ? `, ${r.dropped} dropped` : ''}`
                        : `${r.count} score${r.count === 1 ? '' : 's'}${r.dropped ? `, ${r.dropped} dropped` : ''}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <div className={styles.gradingNotes}>
              {w && !points && w.total !== 100 && <p className={styles.totalOff}>The weights add up to {round2(w.total)}%, not 100%.</p>}
              {w && !points && w.percent !== null && w.counted < w.total && (
                <p>Counting {round2(w.counted)}% of the grade so far; the rest isn’t graded yet.</p>
              )}
              {w && points && (
                <p>{showScore(round2(w.earned))} of {showScore(round2(w.counted))} points graded so far, out of {showScore(w.total)} in the course.</p>
              )}
              {w && w.uncategorized > 0 && (
                <p>{w.uncategorized} score{w.uncategorized === 1 ? ' isn’t' : 's aren’t'} in a category and {w.uncategorized === 1 ? 'doesn’t' : 'don’t'} count. Pick one below.</p>
              )}
              {book?.scale && <p className={styles.muted}>Letter grades: {book.scale.map(s => `${s.letter} ${showScore(s.min)}+${points ? ' pts' : ''}`).join(' · ')}</p>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

type EntryForm = { id: string | null; name: string; score: string; max: string; categoryId: string; date: string };
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const blankEntry = (): EntryForm => ({ id: null, name: '', score: '', max: '', categoryId: '', date: today() });

function EntryEditor({ initial, categories, onSave, onCancel }: {
  initial: EntryForm; categories: GradeCategory[];
  onSave: (entry: GradeEntry) => Promise<void>; onCancel: () => void;
}) {
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<EntryForm>) => setF(x => ({ ...x, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const score = Number(f.score), max = Number(f.max);
    if (!f.name.trim()) { setError('Give the assignment a name.'); return; }
    if (f.score.trim() === '' || !(score >= 0)) { setError('Enter the score you got.'); return; }
    if (!(max > 0)) { setError('Enter what it was out of.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave({ id: f.id ?? crypto.randomUUID(), name: f.name.trim().slice(0, 120), score, max, categoryId: f.categoryId || null, date: f.date || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Please retry.');
      setSaving(false);
    }
  };

  return (
    <form className={styles.entryForm} onSubmit={submit} aria-label={f.id ? 'Edit score' : 'Add a score'}>
      <input className={styles.input} value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Homework 3" aria-label="Assignment" autoFocus />
      <span className={styles.scoreInputs}>
        <input className={`${styles.input} ${styles.num}`} inputMode="decimal" value={f.score} onChange={e => set({ score: e.target.value })} placeholder="18" aria-label="Score" />
        <span className={styles.muted}>/</span>
        <input className={`${styles.input} ${styles.num}`} inputMode="decimal" value={f.max} onChange={e => set({ max: e.target.value })} placeholder="20" aria-label="Out of" />
      </span>
      {categories.length > 0 && (
        <select className={styles.select} value={f.categoryId} onChange={e => set({ categoryId: e.target.value })} aria-label="Category">
          <option value="">Soma picks</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value={NOT_COUNTED}>Not counted</option>
        </select>
      )}
      <input className={styles.input} type="date" value={f.date} onChange={e => set({ date: e.target.value })} aria-label="Date" />
      <span className={styles.entryActions}>
        <button type="submit" className={styles.primary} disabled={saving}>{saving ? 'Saving…' : f.id ? 'Save' : 'Add'}</button>
        <button type="button" className={styles.linkButton} disabled={saving} onClick={onCancel}>Cancel</button>
      </span>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </form>
  );
}

const SOURCE: Record<GradeItem['source'], string> = { canvas: 'Canvas', gradescope: 'Gradescope', manual: 'Added by you' };

function Row({ item, course, onPick, onEdit, onRemove }: {
  item: GradeItem; course: GradeCourse;
  onPick: (categoryId: string) => void; onEdit: () => void; onRemove: () => void;
}) {
  const low = item.percent !== null && item.percent < LOW;
  const categories = course.book?.categories ?? [];
  const value = item.categoryId ?? (item.picked ? NOT_COUNTED : '');
  return (
    <li className={styles.item}>
      <span className={styles.itemName}>
        {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a> : item.name}
        <span className={styles.itemMeta}>
          {SOURCE[item.source]}
          {item.dueAt && ` · ${new Date(item.dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
          {item.late && ' · Late'}
          {item.source === 'manual' && (
            <>
              {' · '}<button type="button" className={styles.inlineButton} onClick={onEdit}>Edit</button>
              {' · '}<button type="button" className={styles.inlineButton} onClick={onRemove}>Remove</button>
            </>
          )}
        </span>
      </span>
      {categories.length > 0 ? (
        <select className={`${styles.pick} ${item.categoryId ? '' : styles.pickEmpty}`} value={value} onChange={e => onPick(e.target.value)} aria-label={`Category for ${item.name}`}>
          {!item.categoryId && !item.picked && <option value="">Pick a category</option>}
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value={NOT_COUNTED}>Not counted</option>
        </select>
      ) : <span className={styles.muted}>{item.group ?? ''}</span>}
      {item.percent !== null ? <Bar percent={item.percent} color={course.color} /> : <span />}
      <span className={styles.itemScore}>
        {showScore(item.score)}{item.max ? <span className={styles.outOf}> / {showScore(item.max)}</span> : null}
      </span>
      <span className={`${styles.itemPercent} ${low ? styles.low : ''}`}>{item.percent !== null ? showPercent(item.percent) : ''}</span>
    </li>
  );
}

function Scores({ course, onChange }: Pick<Props, 'course' | 'onChange'>) {
  const [form, setForm] = useState<EntryForm | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const categories = course.book?.categories ?? [];

  const run = (change: (b: GradeBook) => GradeBook) => { setError(''); onChange(change).catch(e => setError(e instanceof Error ? e.message : 'Could not save. Please retry.')); };
  const pick = (item: GradeItem, categoryId: string) => run(b => item.source === 'manual'
    ? { ...b, entries: b.entries.map(e => `manual:${e.id}` === item.key ? { ...e, categoryId: categoryId || null } : e) }
    : { ...b, picks: { ...b.picks, [item.key]: categoryId } });
  const saveEntry = async (entry: GradeEntry) => {
    await onChange(b => ({ ...b, entries: b.entries.some(e => e.id === entry.id) ? b.entries.map(e => e.id === entry.id ? entry : e) : [...b.entries, entry] }));
    setForm(null);
  };
  const edit = (item: GradeItem) => {
    const e = course.book?.entries.find(x => `manual:${x.id}` === item.key);
    if (e) setForm({ id: e.id, name: e.name, score: String(e.score), max: String(e.max), categoryId: e.categoryId ?? '', date: e.date ?? '' });
  };
  const remove = (item: GradeItem) => {
    if (!window.confirm(`Remove ${item.name}?`)) return;
    run(b => ({ ...b, entries: b.entries.filter(e => `manual:${e.id}` !== item.key) }));
  };

  return (
    <section className={styles.section} aria-labelledby="scores-title">
      <div className={styles.sectionHead}>
        <h2 id="scores-title" className={styles.sectionTitle}>Scores</h2>
        {!form && !importing && (
          <span className={styles.headActions}>
            <button type="button" className={styles.secondary} onClick={() => { setNotice(''); setImporting(true); }}>Import spreadsheet</button>
            <button type="button" className={styles.secondary} onClick={() => { setNotice(''); setForm(blankEntry()); }}>+ Add a score</button>
          </span>
        )}
      </div>
      <p className={styles.hint}>Scores from Gradescope and other sites Soma can’t read: add them here, or import a spreadsheet, and they count with the rest.</p>
      {importing && <ScoreImport course={course} onImport={onChange} onCancel={() => setImporting(false)} onDone={m => { setImporting(false); setNotice(m); }} />}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {form && !form.id && <EntryEditor initial={form} categories={categories} onSave={saveEntry} onCancel={() => setForm(null)} />}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {course.items.length ? (
        <>
          <div className={styles.columns} aria-hidden="true">
            <span>Assignment</span><span>{categories.length ? 'Category' : 'Group'}</span><span /><span className={styles.right}>Score</span><span className={styles.right}>%</span>
          </div>
          <ul className={styles.items}>
            {course.items.map(i => form?.id && `manual:${form.id}` === i.key
              ? <li key={i.key} className={styles.itemEditing}><EntryEditor initial={form} categories={categories} onSave={saveEntry} onCancel={() => setForm(null)} /></li>
              : <Row key={i.key} item={i} course={course} onPick={c => pick(i, c)} onEdit={() => edit(i)} onRemove={() => remove(i)} />)}
          </ul>
        </>
      ) : !form && <p className={styles.none}>No scores yet.</p>}
    </section>
  );
}

export default function CourseGrades({ course, title, code, onChange, onBack, headingRef }: Props) {
  const h = headline(course);
  const outside = useMemo(() => course.items.filter(i => i.source !== 'canvas').length, [course.items]);
  const summary = [
    course.items.length ? `${course.items.length} score${course.items.length === 1 ? '' : 's'}` : '',
    h.kind === 'weighted' ? (course.weighted?.mode === 'points' ? `${showScore(round2(course.weighted.earned))} of ${showScore(round2(course.weighted.counted))} points so far` : 'weighted by the syllabus') : h.kind === 'canvas' ? 'grade from Canvas' : course.points ? `${showScore(course.points.earned)} of ${showScore(course.points.possible)} points` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className={styles.page}>
      <button type="button" className={styles.back} onClick={onBack}>← All courses</button>
      <header className={styles.detailHead}>
        <div className={styles.detailName}>
          <span className={styles.detailTitleRow}>
            {course.color && <span className={styles.dot} style={{ background: course.color }} aria-hidden="true" />}
            <span>
              {code && <span className={styles.code}>{code}</span>}
              <h1 ref={headingRef} tabIndex={-1} className={styles.detailTitle}>{title}</h1>
            </span>
          </span>
          {summary && <p className={styles.summary}>{summary}</p>}
          {h.kind === 'weighted' && course.percent !== null && Math.abs(course.percent - (course.weighted?.percent ?? 0)) >= 0.1 && (
            <p className={styles.summary}>Canvas shows {showPercent(course.percent)}{outside ? ', from its own scores only' : ''}.</p>
          )}
          {h.kind === 'canvas' && outside > 0 && (
            <p className={styles.summary}>Canvas’s grade leaves out {outside} score{outside === 1 ? '' : 's'} from elsewhere. Set up grading below to count them.</p>
          )}
        </div>
        <Grade course={course} large />
      </header>
      <Grading course={course} onChange={onChange} />
      <Scores course={course} onChange={onChange} />
    </div>
  );
}
