import { useMemo, useState } from 'react';
import type React from 'react';
import { supabase } from '../../lib/supabase';
import { storage } from '../../lib/storage';
import { asTodoKind, type Subject } from '../../types';
import styles from './SettingsTab.module.css';

/**
 * Import deadlines from a course website, for classes that don't use Canvas
 * (cs61a.org keeps every homework and project date on its own site). The server
 * reads the page and proposes items; nothing is saved until the student picks
 * which ones to keep. Each imported item becomes a task on its due date.
 */

type Item = { title: string; type: string; due: string; time: string | null; evidence: string; unverified?: boolean };
type Result = { course: string | null; items: Item[]; source: string | null; truncated: boolean };
/** What an import actually did, shown back so the student can see it landed. */
type Receipt = { course: { id: string; name: string; color: string }; rows: { title: string; due: string; time: string | null; change: 'added' | 'updated' | 'unchanged' }[] };

const ERRORS: Record<string, string> = {
  https_required: 'Use a link that starts with https://.',
  private_address: "That link can't be read from Soma's servers.",
  host_not_found: "Couldn't find that website. Check the link.",
  invalid_url: "That doesn't look like a web address.",
  unsupported_content_type: "That link isn't a web page. Paste the page text instead.",
  too_large: 'That page is too large to read. Paste the schedule part instead.',
  page_empty: "The page didn't have any readable text. It may need a login — paste the page text instead.",
  fetch_timeout: 'The website took too long to answer. Try again, or paste the page text.',
  subscription_required: 'Importing from a website is part of Soma Premium.',
  rate_limit: 'Too many imports in a minute. Please wait and try again.',
  unreadable_response: "Soma couldn't read that schedule. Try again, or paste just the schedule table.",
  response_incomplete: 'That schedule is too long to read at once. Paste one part of it at a time.',
};
const explain = (code: string) => ERRORS[code] ?? (code.startsWith('upstream_') ? `The website answered with an error (${code.slice(9)}).` : 'Something went wrong. Please try again.');

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const pretty = (due: string, time: string | null) => {
  const d = new Date(`${due}T${time ?? '00:00'}:00`);
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return time ? `${date}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : date;
};

export default function CourseSiteImport({ courses, createCourse, onImported }: {
  courses: Subject[];
  createCourse: (name: string) => Subject;
  onImported?: (courseId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [pasteMode, setPasteMode] = useState(false);
  const [text, setText] = useState('');
  const [courseId, setCourseId] = useState('');
  const [newCourse, setNewCourse] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<Receipt | null>(null);
  const today = localToday();

  const creating = courseId === '__new__';
  const canRead = (pasteMode ? text.trim().length > 20 : /^https:\/\/\S+$/.test(url.trim())) && !busy;
  const selectedCount = chosen.size;
  const pastCount = useMemo(() => result?.items.filter(i => i.due < today).length ?? 0, [result, today]);

  async function read() {
    setBusy(true); setError(''); setResult(null); setDone(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sign in again to import.');
      const response = await fetch('/api/import-schedule', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(pasteMode ? { text, today } : { url: url.trim(), today }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(explain(body?.error ?? '')); return; }
      const data = body as Result;
      setResult(data);
      // Upcoming work is picked by default; anything already past is not.
      setChosen(new Set(data.items.map((item, i) => (item.due >= today ? i : -1)).filter(i => i >= 0)));
      // Suggest the course the page names, if the student already has it.
      if (!courseId && data.course) {
        const match = courses.find(c => c.name.toLowerCase().includes(data.course!.toLowerCase()) || data.course!.toLowerCase().includes(c.name.toLowerCase()));
        if (match) setCourseId(match.id); else { setCourseId('__new__'); setNewCourse(data.course); }
      }
    } catch (e) {
      setError(e instanceof Error && e.name !== 'TimeoutError' ? e.message : 'The import took too long. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function importChosen() {
    if (!result) return;
    const name = newCourse.trim();
    if (creating && !name) { setError('Name the new course.'); return; }
    if (!creating && !courseId) { setError('Choose which course these belong to.'); return; }
    setBusy(true); setError('');
    let created = 0, updated = 0;
    const rows: Receipt['rows'] = [];
    try {
      const subject = creating ? createCourse(name) : courses.find(c => c.id === courseId)!;
      await storage.fetchAllTodos();
      for (const [i, item] of result.items.entries()) {
        if (!chosen.has(i)) continue;
        // Re-importing updates a date rather than adding the same task twice.
        const existing = storage.getTodos().find(t => t.subjectId === subject.id && t.text.trim().toLowerCase() === item.title.trim().toLowerCase());
        if (existing) {
          if (existing.dueDate === item.due) {
            // Same date, but the row may predate the kind column: fill it in
            // so re-importing is how older tasks get classified.
            const kind = asTodoKind(item.type);
            if (kind && existing.kind !== kind) await storage.saveTodo({ ...existing, kind });
            rows.push({ title: item.title, due: item.due, time: item.time, change: 'unchanged' });
            continue;
          }
          await storage.saveTodo({ ...existing, dueDate: item.due, date: existing.date === existing.dueDate ? item.due : existing.date, kind: asTodoKind(item.type) ?? existing.kind });
          updated++;
          rows.push({ title: item.title, due: item.due, time: item.time, change: 'updated' });
        } else {
          await storage.saveTodo({ id: crypto.randomUUID(), text: item.title, status: 'nothing', subjectId: subject.id, dueDate: item.due, date: item.due, kind: asTodoKind(item.type) });
          created++;
          rows.push({ title: item.title, due: item.due, time: item.time, change: 'added' });
        }
      }
      await storage.fetchAllTodos();
      window.dispatchEvent(new Event('soma_todos_changed'));
      // Confirm against what is actually stored now, not just what was sent.
      const stored = storage.getTodos().filter(t => t.subjectId === subject.id);
      const confirmed = rows.filter(r => stored.some(t => t.text.trim().toLowerCase() === r.title.trim().toLowerCase() && t.dueDate === r.due));
      if (confirmed.length !== rows.length) throw new Error(`only ${confirmed.length} of ${rows.length} could be confirmed after saving`);
      setDone({ course: { id: subject.id, name: subject.name, color: subject.color }, rows });
      setResult(null);
      onImported?.(subject.id);
    } catch (e) {
      setError(`Saved ${created + updated} before an error stopped the import: ${e instanceof Error ? e.message : 'unknown error'}. Import again to finish — nothing will be duplicated.`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <button className={styles.neutralBtn} onClick={() => setOpen(true)}>Import deadlines from a course website</button>;
  }

  return (
    <section className={styles.siteImport} aria-label="Import from a course website">
      <h3 className={styles.archivedTitle}>Import from a course website</h3>
      <p className={styles.archivedEmpty}>
        For classes that don't use Canvas. Paste the course site's address and Soma will find the homework, labs, projects and exams with dates. You choose what to keep.
      </p>

      {pasteMode ? (
        <textarea className={styles.siteImportText} aria-label="Course page text" placeholder="Paste the schedule part of the course page here" value={text} onChange={e => setText(e.target.value)} />
      ) : (
        <input className={styles.courseNameInput} aria-label="Course website address" placeholder="https://cs61a.org" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && canRead) void read(); }} />
      )}
      <div className={styles.courseActions}>
        <button className={styles.restoreBtn} disabled={!canRead} onClick={() => void read()}>{busy && !result ? 'Reading…' : 'Find deadlines'}</button>
        <button className={styles.linkBtn} onClick={() => { setPasteMode(m => !m); setError(''); }}>
          {pasteMode ? 'Use a web address instead' : 'Site needs a login? Paste the page text'}
        </button>
        <button className={styles.linkBtn} onClick={() => { setOpen(false); setResult(null); setError(''); setDone(null); }}>Close</button>
      </div>

      {error && <p className={styles.courseError} role="alert">{error}</p>}
      {done && (() => {
        const added = done.rows.filter(r => r.change === 'added').length;
        const updated = done.rows.filter(r => r.change === 'updated').length;
        return (
          <div className={styles.importReceipt} role="status" aria-label={`Imported into ${done.course.name}`} style={{ '--course': done.course.color } as React.CSSProperties}>
            <div className={styles.importReceiptHead}>
              <span className={styles.importReceiptTick} aria-hidden="true">✓</span>
              <span>
                <strong>Added to <span className={styles.importReceiptCourse}><i style={{ background: done.course.color }} />{done.course.name}</span></strong>
                <small>Imported {added} new {added === 1 ? 'deadline' : 'deadlines'}{updated ? `, updated ${updated}` : ''} into {done.course.name}. Each shows on your dashboard on its due date.</small>
              </span>
            </div>
            <ul className={styles.importReceiptList}>
              {done.rows.map(r => (
                <li key={`${r.title}-${r.due}`}>
                  <span className={styles.importReceiptMark} data-change={r.change}>{r.change === 'added' ? 'Added' : r.change === 'updated' ? 'Date updated' : 'Already there'}</span>
                  <span className={styles.siteImportTitle}>{r.title}</span>
                  <span className={styles.siteImportDue}>{pretty(r.due, r.time)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {result && (
        result.items.length === 0 ? (
          <p className={styles.archivedEmpty} role="status">No dated homework, labs, projects or exams were found on that page. Try the course's schedule or calendar page.</p>
        ) : (
          <div className={styles.siteImportResults}>
            <div className={styles.courseActions}>
              <label className={styles.siteImportCourse}>
                Course
                <i className={styles.importCourseDot} aria-hidden="true" style={{ background: courses.find(c => c.id === courseId)?.color ?? 'transparent', borderStyle: courseId ? 'solid' : 'dashed' }} />
                <select aria-label="Course for these deadlines" value={courseId} onChange={e => setCourseId(e.target.value)}>
                  <option value="">Choose…</option>
                  {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="__new__">+ New course…</option>
                </select>
              </label>
              {creating && <input className={styles.courseNameInput} aria-label="New course name" value={newCourse} onChange={e => setNewCourse(e.target.value)} placeholder="Course name" />}
            </div>
            {result.truncated && <p className={styles.archivedEmpty}>That page was long, so only the first part was read. If something's missing, paste the rest of the schedule.</p>}
            {pastCount > 0 && <p className={styles.archivedEmpty}>{pastCount} already-past {pastCount === 1 ? 'item is' : 'items are'} left unticked.</p>}

            <ul className={styles.siteImportList} aria-label="Deadlines found">
              {result.items.map((item, i) => (
                <li key={`${item.title}-${item.due}`}>
                  <label>
                    <input type="checkbox" checked={chosen.has(i)} onChange={e => setChosen(prev => { const next = new Set(prev); if (e.target.checked) next.add(i); else next.delete(i); return next; })} />
                    <span className={styles.siteImportTitle}>{item.title}</span>
                    <span className={styles.courseSource}>{item.type}</span>
                    <span className={styles.siteImportDue}>{pretty(item.due, item.time)}</span>
                  </label>
                  {item.unverified && <small className={styles.siteImportWarn}>Couldn't find this date written on the page — check it before importing.</small>}
                </li>
              ))}
            </ul>

            <div className={styles.courseActions}>
              <button className={styles.restoreBtn} disabled={busy || selectedCount === 0} onClick={() => void importChosen()}>
                {busy ? 'Importing…' : `Import ${selectedCount} ${selectedCount === 1 ? 'deadline' : 'deadlines'}`}
              </button>
              <button className={styles.linkBtn} onClick={() => setChosen(new Set(result.items.map((_, i) => i)))}>Select all</button>
              <button className={styles.linkBtn} onClick={() => setChosen(new Set())}>Select none</button>
            </div>
          </div>
        )
      )}
    </section>
  );
}
