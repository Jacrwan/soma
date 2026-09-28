import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { loadCourseItems, saveCourseList, markDone, removeItems, extractItems, type CourseItem, type DraftItem } from '../../lib/courseItems';
import type { Subject, SomaDocument } from '../../types';
import docStyles from './DocumentsTab.module.css';
import styles from './ReadingLists.module.css';

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** "Done through 3.7 · Next 4.1 · 6 behind" for one course. */
export function summarize(items: CourseItem[], today: string) {
  const open = items.filter(i => !i.doneAt);
  const firstOpen = open[0];
  const doneBefore = firstOpen ? items.filter(i => i.position < firstOpen.position && i.doneAt) : items;
  return {
    done: doneBefore.length ? `Done through ${doneBefore[doneBefore.length - 1].label}` : 'Nothing done yet',
    next: firstOpen ? `Next ${firstOpen.label}${firstOpen.title ? ` ${firstOpen.title}` : ''}` : 'All done',
    behind: open.filter(i => i.due && i.due < today),
  };
}

/**
 * Each course's reading list: what's read, what's next, what's overdue. Built
 * once from a reading guide or syllabus and reviewed before it's saved; after
 * that, checking off blocks on the dashboard is what moves it forward.
 */
export default function ReadingLists({ subjects, docs }: { subjects: Subject[]; docs: SomaDocument[] }) {
  const [userId, setUserId] = useState('');
  const [items, setItems] = useState<CourseItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [builder, setBuilder] = useState(false);
  const [error, setError] = useState('');
  const reload = useCallback(async (uid: string) => { if (uid) setItems(await loadCourseItems(uid)); }, []);
  useEffect(() => {
    let live = true;
    void supabase.auth.getUser().then(({ data }) => { const uid = data.user?.id ?? ''; if (!live) return; setUserId(uid); void reload(uid); });
    const refresh = () => setUserId(uid => { void reload(uid); return uid; });
    window.addEventListener('soma_course_items_changed', refresh);
    window.addEventListener('focus', refresh);
    return () => { live = false; window.removeEventListener('soma_course_items_changed', refresh); window.removeEventListener('focus', refresh); };
  }, [reload]);

  const today = localToday();
  const courses = subjects.map(s => ({ subject: s, list: items.filter(i => i.subjectId === s.id) })).filter(c => c.list.length);
  const rank = { guide: 0, syllabus: 1, reading: 2 } as Record<string, number>;
  const sources = docs.filter(d => d.subjectId && d.extractedText && d.docType in rank).sort((a, b) => rank[a.docType] - rank[b.docType]);

  async function remove(item: CourseItem) {
    setError('');
    try { await removeItems(userId, [item.id]); await reload(userId); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not remove.'); }
  }
  async function toggle(item: CourseItem) {
    setError('');
    try { await markDone(userId, [item.id], !item.doneAt); await reload(userId); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
  }

  return (
    <section className={styles.panel} aria-labelledby="reading-heading">
      <div className={styles.head}>
        <div>
          <h2 id="reading-heading">Reading progress</h2>
          <p>Soma plans from where you actually are. A section counts as read only when you check it off here or on a block.</p>
        </div>
        <button type="button" className={styles.build} onClick={() => setBuilder(true)} disabled={!userId}>Build from a document</button>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {courses.length === 0 ? (
        <p className={styles.empty}>No reading lists yet. Build one from a course’s reading guide or syllabus, so Soma can pick up where you left off.</p>
      ) : (
        <ul className={styles.courses}>
          {courses.map(({ subject, list }) => {
            const sum = summarize(list, today);
            const expanded = open === subject.id;
            return (
              <li key={subject.id} className={styles.course}>
                <button type="button" className={styles.courseRow} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : subject.id)}>
                  <span className={styles.courseName}><i style={{ background: subject.color }} />{subject.name}</span>
                  <span className={styles.summary}>{sum.done} · {sum.next}</span>
                  {sum.behind.length > 0 && <span className={styles.behind}>{sum.behind.length} behind</span>}
                  <span className={styles.chevron} aria-hidden>{expanded ? '−' : '+'}</span>
                </button>
                {expanded && (
                  <ol className={styles.items}>
                    {list.map(item => {
                      const late = !item.doneAt && item.due && item.due < today;
                      return (
                        <li key={item.id} className={item.doneAt ? styles.done : undefined}>
                          <label>
                            <input type="checkbox" aria-label={`Read ${item.label}${item.title ? ` ${item.title}` : ''}`} checked={!!item.doneAt} onChange={() => void toggle(item)} />
                            <strong>{item.label}</strong>
                            <span>{item.title}</span>
                          </label>
                          {item.todoId && !item.doneAt && <em className={styles.tag}>Planned</em>}
                          {item.due && <small className={late ? styles.late : undefined}>{late ? 'Was due ' : 'Due '}{shortDate(item.due)}</small>}
                          <button type="button" className={styles.remove} aria-label={`Remove ${item.label} from the list`} title="Remove from list" onClick={() => void remove(item)}>×</button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {builder && <Builder userId={userId} subjects={subjects} sources={sources} existing={items} onClose={() => setBuilder(false)} onSaved={() => { setBuilder(false); void reload(userId); }} />}
    </section>
  );
}

function Builder({ userId, subjects, sources, existing, onClose, onSaved }: { userId: string; subjects: Subject[]; sources: SomaDocument[]; existing: CourseItem[]; onClose: () => void; onSaved: () => void }) {
  const [docId, setDocId] = useState(sources[0]?.id ?? '');
  const [rows, setRows] = useState<DraftItem[] | null>(null);
  const [busy, setBusy] = useState<'' | 'reading' | 'saving'>('');
  const [error, setError] = useState('');
  const doc = sources.find(d => d.id === docId);
  const subject = subjects.find(s => s.id === doc?.subjectId);
  const replacing = existing.filter(i => i.subjectId === subject?.id);

  async function read() {
    if (!doc?.extractedText || !subject) return;
    setBusy('reading'); setError('');
    try {
      const found = await extractItems(doc.extractedText, subject.name, new Date().getFullYear());
      if (!found.length) throw new Error('No numbered sections were found in this document.');
      // Rebuilding keeps what was already read.
      const done = new Set(replacing.filter(i => i.doneAt).map(i => i.label));
      setRows(found.map(r => ({ ...r, done: done.has(r.label) })));
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not read this document.'); }
    finally { setBusy(''); }
  }
  async function save() {
    if (!rows || !subject) return;
    const clean = rows.filter(r => r.label.trim());
    setBusy('saving'); setError('');
    try { await saveCourseList(userId, subject.id, clean, doc?.id); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); setBusy(''); }
  }
  const edit = (i: number, patch: Partial<DraftItem>) => setRows(rs => rs && rs.map((r, k) => k === i ? { ...r, ...patch } : r));
  // Checking a section also checks the ones before it: reading goes in order.
  const setDone = (i: number, done: boolean) => setRows(rs => rs && rs.map((r, k) => done ? (k <= i ? { ...r, done: true } : r) : (k === i ? { ...r, done: false } : r)));
  const doneCount = rows?.filter(r => r.done).length ?? 0;

  return (
    <div className={docStyles.modalOverlay} onClick={() => !busy && onClose()}>
      <div className={`${docStyles.modal} ${styles.builder}`} role="dialog" aria-modal="true" aria-labelledby="builder-title" onClick={e => e.stopPropagation()}>
        <span id="builder-title" className={docStyles.modalTitle}>Build a reading list</span>
        {!rows ? (
          <>
            {sources.length === 0 ? (
              <p className={styles.note}>Upload a reading guide or syllabus and give it a subject first. Soma turns its numbered sections into a checklist you can review.</p>
            ) : (
              <>
                <label className={docStyles.modalLabel}>
                  Document
                  <select className={docStyles.modalSelect} value={docId} onChange={e => setDocId(e.target.value)}>
                    {sources.map(d => <option key={d.id} value={d.id}>{d.fileName} · {subjects.find(s => s.id === d.subjectId)?.name}</option>)}
                  </select>
                </label>
                <p className={styles.note}>Soma lists each section in order with its due date. You check what you’ve already read before saving.{replacing.length ? ` This replaces the ${subject?.name} list and keeps what’s marked read.` : ''}</p>
              </>
            )}
            {error && <span className={docStyles.modalError}>{error}</span>}
            <button type="button" className={docStyles.modalUploadBtn} onClick={() => void read()} disabled={!doc || !!busy}>{busy === 'reading' ? 'Reading the document…' : 'Find sections'}</button>
            <button type="button" className={docStyles.modalCancelBtn} onClick={onClose} disabled={!!busy}>Cancel</button>
          </>
        ) : (
          <>
            <p className={styles.note}><strong>{subject?.name}</strong> · {rows.length} sections{doneCount ? ` · ${doneCount} already read` : ''}. Check what you’ve already read; checking one checks the ones before it.</p>
            <div className={styles.reviewWrap}>
              <table className={styles.review}>
                <thead><tr><th scope="col">Read</th><th scope="col">Section</th><th scope="col">Topic</th><th scope="col">Due</th><th scope="col"><span className={styles.srOnly}>Remove</span></th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={r.done ? styles.done : undefined}>
                      <td><input type="checkbox" aria-label={`Already read ${r.label}`} checked={!!r.done} onChange={e => setDone(i, e.target.checked)} /></td>
                      <td><input aria-label="Section" value={r.label} maxLength={40} onChange={e => edit(i, { label: e.target.value })} className={styles.label} /></td>
                      <td><input aria-label={`Topic of ${r.label}`} value={r.title ?? ''} maxLength={120} onChange={e => edit(i, { title: e.target.value })} /></td>
                      <td><input aria-label={`Due date of ${r.label}`} type="date" value={r.due ?? ''} onChange={e => edit(i, { due: e.target.value || undefined })} /></td>
                      <td><button type="button" className={styles.remove} aria-label={`Remove ${r.label}`} onClick={() => setRows(rs => rs && rs.filter((_, k) => k !== i))}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && <span className={docStyles.modalError}>{error}</span>}
            <button type="button" className={docStyles.modalUploadBtn} onClick={() => void save()} disabled={!!busy || !rows.some(r => r.label.trim())}>{busy === 'saving' ? 'Saving…' : 'Save reading list'}</button>
            <button type="button" className={docStyles.modalCancelBtn} onClick={() => setRows(null)} disabled={!!busy}>Back</button>
          </>
        )}
      </div>
    </div>
  );
}
