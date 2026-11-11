import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { storage } from '../../lib/storage';
import { loadCourseItems, isReading, type CourseItem } from '../../lib/courseItems';
import { ACCEPT_ATTR, uploadDocument, extractDocumentText } from '../../lib/documents';
import { addDays, dayKey, draftsFromBraindump, historyEstimates, timedTaskName, shortDay, DEFAULT_PRIORITY, type ExamPlan, type StudyDraft } from '../../lib/examPlan';
import { loadInsights, getInsightsSnapshot } from '../../lib/insights';
import { buildStudyList, deleteExamPlan, loadExamPlans, saveExamPlan, scheduleHorizon, setItemDone, setItemPriority, EXAM_PLANS_CHANGED, MAX_DAYS_AHEAD } from '../../lib/examPlansStore';
import ExamReview from './ExamReview';
import ExamAgenda from './ExamAgenda';
import type { Confidence } from '../../lib/examSittings';
import PriorityBar from './PriorityBar';
import type { Subject, SomaDocument, Todo, DocumentType } from '../../types';
import docStyles from './DocumentsTab.module.css';
import list from './ReadingLists.module.css';
import styles from './ExamPlans.module.css';

const EXAMISH = /\b(exam|midterm|final|quiz|test)\b/i;
const guessType = (name: string): DocumentType => {
  const n = name.toLowerCase();
  if (/syllabus/.test(n)) return 'syllabus';
  if (/guide|practice|review/.test(n)) return 'guide';
  if (/read|chapter|ch\.?\s*\d/.test(n)) return 'reading';
  if (/worksheet|hw|homework|ps\d|assignment/.test(n)) return 'assignment';
  if (/\.pdf$/i.test(n) && /slide|lecture/.test(n)) return 'slides';
  return 'other';
};

/** Exams and quizzes coming up, from the student's tasks. */
export function examChoices(todos: Todo[], today: string): Todo[] {
  const last = addDays(today, MAX_DAYS_AHEAD);
  return todos.filter(t => t.status !== 'done' && t.subjectId && t.dueDate && t.dueDate.slice(0, 10) > today && t.dueDate.slice(0, 10) <= last
    && (t.kind === 'exam' || t.kind === 'quiz' || (!t.kind && EXAMISH.test(t.text))))
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
}

/**
 * Exam coverage lists: braindump and/or files → concrete study checklist with
 * a 1–5 priority bar → place ~today or ~this week onto the plan.
 */
export default function ExamPlans({ subjects, docs, onDocsChange }: {
  subjects: Subject[]; docs: SomaDocument[]; onDocsChange: () => Promise<void>;
}) {
  const [userId, setUserId] = useState('');
  const [plans, setPlans] = useState<ExamPlan[]>([]);
  const [items, setItems] = useState<CourseItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [builder, setBuilder] = useState<{ exam?: ExamPlan } | null>(null);
  const [notes, setNotes] = useState<Record<string, { text: string; link?: boolean }>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(async (uid: string) => {
    if (!uid) return;
    const loaded = await loadExamPlans(uid);
    setPlans(loaded.plans); setItems(loaded.items);
  }, []);
  useEffect(() => {
    let live = true;
    void supabase.auth.getUser().then(({ data }) => { const uid = data.user?.id ?? ''; if (!live) return; setUserId(uid); void reload(uid); });
    const refresh = () => setUserId(uid => { void reload(uid); return uid; });
    window.addEventListener(EXAM_PLANS_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    return () => { live = false; window.removeEventListener(EXAM_PLANS_CHANGED, refresh); window.removeEventListener('focus', refresh); };
  }, [reload]);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void storage.getSettings().then(account => {
      if (live && account.examPrep) {
        storage.setSomaSettings({ ...storage.getSomaSettings(), examPrep: account.examPrep });
        void reload(userId);
      }
    }).catch(() => {});
    return () => { live = false; };
  }, [userId, reload]);

  const today = dayKey(new Date());
  const upcoming = plans.filter(p => p.examDate >= today);
  const past = plans.filter(p => p.examDate < today);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setError('');
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong. Please retry.'); }
    finally { setBusy(''); }
  }

  const place = (exam: ExamPlan, horizon: 'today' | 'week', freshItems?: CourseItem[]) => run(`${horizon}:${exam.id}`, async () => {
    const subject = subjects.find(s => s.id === exam.subjectId) ?? storage.getSubjects().find(s => s.id === exam.subjectId);
    if (!subject) throw new Error('This exam’s course is no longer one of your subjects.');
    const { count, missing } = await scheduleHorizon(userId, exam, freshItems ?? items, subject, horizon);
    const label = horizon === 'today' ? 'today' : 'this week';
    const left = missing ? ` ${missing} ${missing === 1 ? 'item didn’t' : 'items didn’t'} fit before the exam — raise priority or free time.` : '';
    setNotes(n => ({ ...n, [exam.id]: count
      ? { text: `${count} study ${count === 1 ? 'block is' : 'blocks are'} waiting on your plan for ${label}. Accept ${count === 1 ? 'it' : 'them'} on the dashboard.${left}`, link: true }
      : { text: missing ? `Nothing fits ${label}.${left}` : `Nothing left to plan ${label}: it’s done or already on your plan.` } }));
  });

  return (
    <section className={list.panel} aria-labelledby="exam-plans-heading">
      <div className={list.head}>
        <div>
          <h2 id="exam-plans-heading">Exam study plans</h2>
          <p>Add your materials, check your pace, and plan study sittings before the exam.</p>
        </div>
        <button type="button" className={list.build} onClick={() => setBuilder({})} disabled={!userId}>Plan an exam</button>
      </div>
      {error && <p role="alert" className={list.error}>{error}</p>}
      {upcoming.length === 0 ? (
        <p className={list.empty}>No exam plans yet. Braindump what you’ll do, or drop worksheets and practice exams here, then plan an exam.</p>
      ) : (
        <ul className={list.courses}>
          {upcoming.map(exam => {
            const subject = subjects.find(s => s.id === exam.subjectId) ?? storage.getSubjects().find(s => s.id === exam.subjectId);
            const mine = items.filter(i => i.examId === exam.id).sort((a, b) => Number(!!a.doneAt)-Number(!!b.doneAt) || (b.priority ?? 3) - (a.priority ?? 3) || a.position - b.position);
            const done = mine.filter(i => i.doneAt).length;
            const openItems = mine.filter(i => !i.doneAt);
            const expanded = open === exam.id;
            return (
              <li key={exam.id} className={list.course}>
                <button type="button" className={list.courseRow} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : exam.id)}>
                  <span className={list.courseName}><i style={{ background: subject?.color }} />{exam.title}</span>
                  <span className={list.summary}>{subject?.name ?? 'Course'} · {shortDay(exam.examDate)}{exam.examTime ? ` ${exam.examTime}` : ''} · {done} of {mine.length} done</span>
                  {openItems.length > 0 && <span className={list.behind}>{openItems.length} left</span>}
                  <span className={list.chevron} aria-hidden>{expanded ? '−' : '+'}</span>
                </button>
                {expanded && (
                  <div className={styles.body}>
                    <ExamAgenda userId={userId} exam={exam} items={mine} subject={subject} onChange={()=>reload(userId)}/>
                    <div className={styles.examListHead}>
                      <span>Coverage · weakest first</span>
                      <span className={styles.examMeta}>
                        <span />
                        <span id={`exam-priority-${exam.id}`}>Priority <small>low to high</small></span>
                        <span className={styles.examMinutes}>Estimate</span>
                      </span>
                    </div>
                    {/* Name with the detail under it, and a fixed right column, so
                        names don't break mid-phrase ("Ch 7, / 9") and every
                        priority bar and length lines up (2026-11-10). */}
                    <ol className={styles.examItems}>
                      {mine.map(item => (
                        <li key={item.id} className={item.doneAt ? styles.examDone : undefined}>
                          <label className={styles.examText}>
                            <input type="checkbox" aria-label={`Done: ${item.label}`} checked={!!item.doneAt} onChange={() => void run(`done:${item.id}`, async () => { await setItemDone(userId, item.id, !item.doneAt); await reload(userId); })} />
                            <span>
                              <strong>{item.label}</strong>
                              {item.title && <span>{item.title}</span>}
                              {storage.getSomaSettings().examPrep?.[exam.id]?.confidence[item.label] && <small>{storage.getSomaSettings().examPrep?.[exam.id]?.confidence[item.label]}</small>}
                            </span>
                          </label>
                          <div className={styles.examMeta}>
                            <span className={styles.examTag}>{item.todoId && !item.doneAt ? <em className={list.tag}>Planned</em> : null}</span>
                            <span className={styles.examPriority}>
                              {!item.doneAt && (
                                <PriorityBar
                                  size="sm"
                                  labelledBy={`exam-priority-${exam.id}`}
                                  value={item.priority ?? DEFAULT_PRIORITY}
                                  disabled={!!busy}
                                  onChange={n => {
                                    setItems(current => current.map(row => row.id === item.id ? { ...row, priority: n } : row));
                                    void run(`prio:${item.id}`, async () => {
                                      try { await setItemPriority(userId, item.id, n); }
                                      finally { await reload(userId); }
                                    });
                                  }}
                                />
                              )}
                            </span>
                            <small className={styles.examMinutes}>{item.minutes ?? 45} min</small>
                          </div>
                        </li>
                      ))}
                    </ol>
                    <div className={styles.actions}>
                      <button type="button" className={styles.primary} onClick={() => void place(exam, 'today')} disabled={!!busy}>{busy === `today:${exam.id}` ? 'Finding times…' : 'Add today to my plan'}</button>
                      <button type="button" className={styles.primary} onClick={() => void place(exam, 'week')} disabled={!!busy}>{busy === `week:${exam.id}` ? 'Finding times…' : 'Add this week to my plan'}</button>
                      <button type="button" className={list.build} onClick={() => setBuilder({ exam })} disabled={!!busy}>Rebuild list</button>
                      <button type="button" className={styles.quiet} onClick={() => { if (window.confirm(`Remove the study plan for ${exam.title}? Blocks already on your plan stay.`)) void run(`rm:${exam.id}`, async () => { await deleteExamPlan(userId, exam); await reload(userId); }); }} disabled={!!busy}>Remove</button>
                    </div>
                    {notes[exam.id] && <p className={styles.note} role="status">{notes[exam.id].text}{notes[exam.id].link && <> <Link to="/dashboard">Open the dashboard</Link></>}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {past.length > 0 && (
        <p className={styles.past}>Past: {past.map(p => (
          <span key={p.id}>{p.title} <button type="button" className={list.remove} aria-label={`Remove the plan for ${p.title}`} onClick={() => void run(`rm:${p.id}`, async () => { await deleteExamPlan(userId, p); await reload(userId); })}>×</button></span>
        ))}</p>
      )}
      {builder && (
        <Builder userId={userId} subjects={subjects} docs={docs} items={items} preset={builder.exam}
          onDocsChange={onDocsChange}
          onClose={() => setBuilder(null)}
          onSaved={async (exam,horizon) => {
            setBuilder(null); setOpen(exam.id);
            const loaded=await loadExamPlans(userId); setPlans(loaded.plans); setItems(loaded.items);
            if(horizon!=='later') await place(exam,horizon,loaded.items);
          }} />
      )}
    </section>
  );
}

type ExamPick = { todoId?: string; title: string; subjectId: string; date: string; time?: string };

type ExamUpload = {
  key: string;
  file: File;
  subjectId: string;
  document?: SomaDocument;
  error?: string;
};

function Builder({ userId, subjects: subjectsProp, docs, items, preset, onClose, onSaved, onDocsChange }: {
  userId: string; subjects: Subject[]; docs: SomaDocument[]; items: CourseItem[]; preset?: ExamPlan;
  onClose: () => void; onSaved: (exam: ExamPlan,horizon:'today'|'week'|'later') => void; onDocsChange: () => Promise<void>;
}) {
  const today = dayKey(new Date());
  const [courses, setCourses] = useState(() => {
    const fromProp = subjectsProp.filter(s => !s.archived);
    return fromProp.length ? fromProp : storage.getSubjects().filter(s => !s.archived);
  });
  const [courseStatus, setCourseStatus] = useState<'loading' | 'ready' | 'error'>(courses.length ? 'ready' : 'loading');
  const [courseAttempt, setCourseAttempt] = useState(0);
  useEffect(() => {
    const sync = () => setCourses(prev => {
      const next = storage.getSubjects().filter(s => !s.archived);
      const merged = next.length ? next : subjectsProp.filter(s => !s.archived);
      return merged.length ? merged : prev;
    });
    sync();
    void storage.whenTokensLoaded().then(sync);
    window.addEventListener('soma_subjects_changed', sync);
    return () => window.removeEventListener('soma_subjects_changed', sync);
  }, [subjectsProp]);
  // The auth-time cache can be empty after a failed request. Opening the
  // planner should recover without requiring a full-page refresh.
  useEffect(() => {
    if (courses.length) return;
    let live = true;
    setCourseStatus('loading');
    const timeout = window.setTimeout(() => { if (live) setCourseStatus('error'); }, 10_000);
    void storage.fetchSubjects().then(subjects => {
      if (!live) return;
      setCourses(subjects.filter(s => !s.archived));
      setCourseStatus('ready');
      window.dispatchEvent(new Event('soma_subjects_changed'));
    }).catch(() => { if (live) setCourseStatus('error'); })
      .finally(() => window.clearTimeout(timeout));
    return () => { live = false; window.clearTimeout(timeout); };
  }, [courses.length, courseAttempt]);

  const choices = examChoices(storage.getTodos(), today);
  const [choice, setChoice] = useState<string>(preset ? 'preset' : choices[0]?.id ?? 'other');
  const [other, setOther] = useState<ExamPick>({ title: '', subjectId: '', date: '', time: '' });
  // Fill course once subjects arrive (empty list on first paint was disabling the button).
  useEffect(() => {
    if (!other.subjectId && courses[0]?.id) setOther(o => ({ ...o, subjectId: courses[0].id }));
  }, [courses, other.subjectId]);

  const [subjectFix, setSubjectFix] = useState('');
  const pickedTodo = choice !== 'other' && choice !== 'preset' ? choices.find(t => t.id === choice) : undefined;
  const exam: ExamPick | null = preset
    ? { todoId: preset.todoId, title: preset.title, subjectId: preset.subjectId, date: preset.examDate, time: preset.examTime }
    : choice === 'other'
      ? (other.title.trim() && other.subjectId && other.date ? { ...other, title: other.title.trim() } : null)
      : pickedTodo
        ? { todoId: pickedTodo.id, title: pickedTodo.text, subjectId: subjectFix || pickedTodo.subjectId!, date: pickedTodo.dueDate!.slice(0, 10) }
        : null;

  const course = courses.find(s => s.id === exam?.subjectId);
  const needsCoursePick = !!exam && !course && choice !== 'other';
  const materialSubjectId = exam?.subjectId || (choice === 'other' ? other.subjectId : '');
  const [uploads, setUploads] = useState<ExamUpload[]>([]);
  const [removedFileKeys, setRemovedFileKeys] = useState<Set<string>>(new Set());
  const [removalSelection, setRemovalSelection] = useState<Set<string> | null>(null);
  const removedFileKeysRef = useRef(removedFileKeys);
  // Keep the same row identity when a queued upload becomes a library document.
  const uploadKeysByDocId = new Map<string, string>();
  for (const entry of uploads) {
    if (entry.document) uploadKeysByDocId.set(entry.document.id, entry.key);
  }
  const materials = docs.filter(d => d.subjectId === materialSubjectId && d.extractedText
    && !removedFileKeys.has(uploadKeysByDocId.get(d.id) ?? d.id));
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = materials.filter(d => picked ? picked.has(d.id) : d.docType !== 'syllabus' || materials.length === 1);
  // Rebuild starts from the braindump saved with this exam.
  const [braindump, setBraindump] = useState(() => (preset ? storage.getSomaSettings().examBraindumps?.[preset.id] : '') ?? '');
  const braindumpEdited = useRef(false);
  const [planId] = useState(() => preset?.id ?? crypto.randomUUID());
  // A fresh browser may have no device cache. Load the account's saved text,
  // but don't overwrite anything the student has already started typing.
  useEffect(() => {
    if (!preset?.id) return;
    let live = true;
    void storage.getSettings().then(settings => {
      const saved = settings.examBraindumps?.[preset.id];
      if (live && !braindumpEdited.current && typeof saved === 'string') setBraindump(saved);
    }).catch(() => { /* The device copy remains available if the account is offline. */ });
    return () => { live = false; };
  }, [preset?.id]);
  const [rows, setRows] = useState<StudyDraft[] | null>(null);
  const [readingLabels,setReadingLabels] = useState<string[]>([]);
  const [confirmNote, setConfirmNote] = useState('');
  const [action, setAction] = useState<'' | 'reading' | 'saving'>('');
  const [pendingBatches, setPendingBatches] = useState(0);
  const uploadQueue = useRef(Promise.resolve());
  const busy = pendingBatches ? 'upload' : action;
  const courseUploads = uploads.filter(u => u.subjectId === materialSubjectId && !removedFileKeys.has(u.key));
  const libraryMaterials = materials.filter(d => !uploadKeysByDocId.has(d.id));
  const savedCount = courseUploads.filter(u => u.document).length;
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const tooFar = !!exam && exam.date > addDays(today, MAX_DAYS_AHEAD);
  const tooSoon = !!exam && exam.date <= today;
  const canMake = !!exam && !!course && !tooSoon && !tooFar && !busy && !removalSelection;
  const whyDisabled = !courses.length ? '' : !exam
    ? (choice === 'other'
      ? (!other.title.trim() ? 'Add an exam name to continue.' : !other.subjectId ? (courses.length ? 'Pick a course.' : '') : !other.date ? 'Pick an exam date to continue.' : 'Finish the exam details.')
      : 'Pick an exam.')
    : !course ? 'Pick which course this exam is for.'
    : tooSoon ? 'Pick an exam after today.'
    : tooFar ? `Pick an exam in the next ${MAX_DAYS_AHEAD} days.`
    : busy ? 'Working…' : '';

  function queueUploads(batch: ExamUpload[]) {
    setPendingBatches(n => n + 1);
    setError('');
    uploadQueue.current = uploadQueue.current.then(async () => {
      let needsRefresh = false;
      for (const entry of batch) {
        if (removedFileKeysRef.current.has(entry.key)) continue;
        try {
          const doc = entry.document ?? await uploadDocument(entry.file, entry.subjectId, guessType(entry.file.name));
          needsRefresh = true;
          setUploads(current => current.map(u => u.key === entry.key ? { ...u, document: doc, error: undefined } : u));
          if (!removedFileKeysRef.current.has(entry.key)) {
            setPicked(prev => new Set([...(prev ?? chosen.map(c => c.id)), doc.id]));
          }
          await extractDocumentText(doc);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Please try again.';
          setUploads(current => current.map(u => u.key === entry.key ? { ...u, error: message } : u));
        }
      }
      if (needsRefresh) await onDocsChange();
    }).catch(() => {
      setError('Couldn’t refresh the materials list. Retry reading the missing files.');
    }).finally(() => setPendingBatches(n => n - 1));
  }

  function ingestFiles(files: FileList) {
    if (action) return;
    if (!materialSubjectId) { setError('Pick a course before dropping files.'); return; }
    const batch = Array.from(files, file => ({ key: crypto.randomUUID(), file, subjectId: materialSubjectId }));
    if (!batch.length) return;
    setUploads(current => [...current, ...batch]);
    queueUploads(batch);
  }

  function removeSelectedFiles() {
    if (!removalSelection?.size) return;
    const next = new Set([...removedFileKeysRef.current, ...removalSelection]);
    removedFileKeysRef.current = next;
    setPicked(prev => new Set(prev ?? chosen.map(d => d.id)));
    setRemovedFileKeys(next);
    setRemovalSelection(null);
  }

  function removalCheckbox(key: string, name: string) {
    return (
      <label><input type="checkbox" aria-label={`Select ${name} for removal`}
        checked={removalSelection?.has(key) ?? false}
        onChange={e => {
          const next = new Set(removalSelection);
          if (e.target.checked) next.add(key); else next.delete(key);
          setRemovalSelection(next);
        }} />{name}</label>
    );
  }

  function inclusionCheckbox(doc: SomaDocument) {
    return (
      <label><input type="checkbox" checked={chosen.some(c => c.id === doc.id)} onChange={e => {
        const checked = e.target.checked;
        setPicked(prev => {
          const next = new Set(prev ?? chosen.map(c => c.id));
          if (checked) next.add(doc.id); else next.delete(doc.id);
          return next;
        });
      }} />{doc.fileName}</label>
    );
  }

  async function fromHistory(drafted: StudyDraft[], subjectId: string, subjectName: string, reading: CourseItem[]) {
    setReadingLabels(reading.map(i=>i.label));
    await loadInsights(userId);
    const snapshot = getInsightsSnapshot(userId);
    if (!snapshot.data && snapshot.error) {
      return { drafts: drafted, basis: 'Timer history could not load. These are provisional estimates.' };
    }
    const titles = new Map(snapshot.data?.todos.filter(t => t.subject_id === subjectId).map(t => [t.id, t.text]));
    const linkedReadings = new Map<string, string[]>();
    const titleOwners = new Map<string, Set<string>>();
    for (const [id,title] of titles) {
      const key=timedTaskName(title,subjectName);
      const owners=titleOwners.get(key) ?? new Set<string>(); owners.add(id); titleOwners.set(key,owners);
    }
    for (const item of reading) {
      const title = item.todoId && titles.get(item.todoId);
      if (!title) continue;
      const key = timedTaskName(title, subjectName);
      if ((titleOwners.get(key)?.size ?? 0) > 1) continue;
      linkedReadings.set(key, [...(linkedReadings.get(key) ?? []), item.label]);
    }
    return historyEstimates(drafted, snapshot.data?.sessions ?? [], subjectId, subjectName, reading.map(item => item.label), linkedReadings, true);
  }

  async function make() {
    if (!exam || !course) { setError(whyDisabled || 'Finish the exam details first.'); return; }
    if (!braindump.trim() && chosen.length === 0) {
      setError('Add a braindump of what you’ll study, drop files, or both — then Soma turns that into a checklist.');
      return;
    }
    setAction('reading'); setError('');
    try {
      const reading = (await loadCourseItems(userId)).filter(i => isReading(i) && i.subjectId === exam.subjectId);
      const { items: drafted, note } = await buildStudyList(
        { id: preset?.id ?? '', subjectId: exam.subjectId, title: exam.title, examDate: exam.date, examTime: exam.time, todoId: exam.todoId },
        course.name, chosen, reading, braindump,
      );
      const previous = items.filter(i => i.examId === (preset?.id ?? ''));
      const kept = new Map(previous.map(i => [i.label.toLowerCase(), i.priority]));
      const timed = await fromHistory(drafted, exam.subjectId, course.name, reading);
      setRows(timed.drafts.map(d => ({ ...d, priority: kept.get(d.label.toLowerCase()) ?? d.priority })));
      setConfirmNote([note, timed.basis].filter(Boolean).join(' '));
    } catch (err) { setError(err instanceof Error ? err.message : 'Soma couldn’t make the list. Please try again.'); }
    finally { setAction(''); }
  }

  async function useBraindumpOnly() {
    const drafted = draftsFromBraindump(braindump);
    if (!drafted.length) { setError('Add a few lines describing what you’ll study.'); return; }
    if (!exam || !course) return;
    setError(''); setAction('reading');
    try {
      const reading = (await loadCourseItems(userId)).filter(i => isReading(i) && i.subjectId === exam.subjectId);
      const timed = await fromHistory(drafted, exam.subjectId, course.name, reading);
      setRows(timed.drafts);
      setConfirmNote(['Structured from your braindump only.', timed.basis].join(' '));
    } catch {
      setError('Couldn’t prepare the checklist. Please try again.');
    } finally { setAction(''); }
  }

  async function approve(sittings: StudyDraft[], confidence: Record<string,Confidence>, daily:number,horizon:'today'|'week'|'later') {
    if (!exam) return;
    const clean = sittings.filter(r => r.label.trim()).map(r => ({ ...r, label: r.label.trim() }));
    if (!clean.length) return;
    setAction('saving'); setError('');
    try {
      const plan: ExamPlan = {
        id: planId, subjectId: exam.subjectId, title: exam.title.slice(0, 120), examDate: exam.date,
        ...(exam.time && /^\d{2}:\d{2}$/.test(exam.time) ? { examTime: exam.time } : {}),
        ...(exam.todoId ? { todoId: exam.todoId } : {}),
      };
      const previous = items.filter(i => i.examId === plan.id);
      await saveExamPlan(userId, plan, clean, previous);
      const account = await storage.getSettings();
      const dumps = { ...(storage.getSomaSettings().examBraindumps ?? {}), ...(account.examBraindumps ?? {}), [plan.id]: braindump };
      const prep = {...storage.getSomaSettings().examPrep,...account.examPrep,[plan.id]:{start:today,daily,
        confidence:{...confidence,...Object.fromEntries(clean.filter(d=>d.topic && confidence[d.topic]).map(d=>[d.label,confidence[d.topic!]]))}}};
      storage.setSomaSettings({ ...storage.getSomaSettings(), examBraindumps: dumps, examPrep:prep });
      try { await storage.saveSettings({ examBraindumps: dumps, examPrep:prep }); }
      catch { throw new Error('Your checklist was saved, but your brain dump could not sync. Please try saving again.'); }
      onSaved(plan,horizon);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); setAction(''); }
  }
  const dropZone = (subjectReady: boolean) => (
    <div
      className={`${styles.drop} ${dragOver ? styles.dropActive : ''}`}
      onDragEnter={e => { e.preventDefault(); setDragOver(true); }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={e => { e.preventDefault(); if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={e => {
        e.preventDefault(); setDragOver(false);
        if (!subjectReady) { setError('Pick a course before dropping files.'); return; }
        ingestFiles(e.dataTransfer.files);
      }}
    >
      <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} hidden onChange={e => { if (e.target.files) ingestFiles(e.target.files); e.target.value = ''; }} />
      <p>Drag files here, or <button type="button" className={styles.linkish} onClick={() => fileRef.current?.click()} disabled={!subjectReady || !!action}>browse</button></p>
      <small>Worksheets, practice exams, notes — Soma reads them to confirm your checklist.</small>
    </div>
  );

  return (
    <div className={docStyles.modalOverlay} onClick={() => !busy && onClose()}>
      <div className={`${docStyles.modal} ${list.builder} ${styles.builderWide}`} role="dialog" aria-modal="true" aria-labelledby="exam-builder-title" onClick={e => e.stopPropagation()}>
        <span id="exam-builder-title" className={docStyles.modalTitle}>{preset ? `Rebuild the list for ${preset.title}` : 'Plan an exam'}</span>
        {!rows ? (
          <>
            <p className={styles.note}>Add what you need to study. Review your checklist before placing it on your plan.</p>
            {!preset && (
              <label className={docStyles.modalLabel}>
                Exam
                <select className={docStyles.modalSelect} value={choice} disabled={!!busy} onChange={e => { setChoice(e.target.value); setPicked(null); setRemovalSelection(null); setSubjectFix(''); setError(''); }}>
                  {choices.map(t => <option key={t.id} value={t.id}>{t.text} · {courses.find(s => s.id === t.subjectId)?.name ?? 'course'} · {shortDay(t.dueDate!.slice(0, 10))}</option>)}
                  <option value="other">Another exam…</option>
                </select>
              </label>
            )}
            {!preset && choice === 'other' && (
              <div className={styles.otherExam}>
                <label className={docStyles.modalLabel}><span className={styles.fieldCaption}>Name</span><input className={docStyles.modalTextInput} value={other.title} maxLength={120} placeholder="Midterm 2" onChange={e => setOther(o => ({ ...o, title: e.target.value }))} /></label>
                <label className={docStyles.modalLabel}><span className={styles.fieldCaption}>Course</span>
                  <select className={docStyles.modalSelect} value={other.subjectId} disabled={!courses.length || !!busy} onChange={e => { setOther(o => ({ ...o, subjectId: e.target.value })); setPicked(null); setRemovalSelection(null); }}>
                    {!courses.length && <option value="">{courseStatus === 'loading' ? 'Loading courses…' : courseStatus === 'error' ? 'Courses unavailable' : 'No active courses'}</option>}
                    {courses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className={docStyles.modalLabel}><span className={styles.fieldCaption}>Date</span><input className={docStyles.modalTextInput} type="date" min={addDays(today, 1)} max={addDays(today, MAX_DAYS_AHEAD)} value={other.date} onChange={e => setOther(o => ({ ...o, date: e.target.value }))} /></label>
                <label className={docStyles.modalLabel}><span className={styles.fieldCaption}>Time <span className={styles.optional}>(optional)</span></span>
                  <input className={docStyles.modalTextInput} type="time" value={other.time ?? ''} onChange={e => setOther(o => ({ ...o, time: e.target.value }))} />
                </label>
              </div>
            )}
            {!courses.length && <p className={styles.note} role="status">
              {courseStatus === 'loading' ? 'Loading your courses…' : courseStatus === 'error'
                ? <>Couldn’t load your courses. <button type="button" className={styles.linkish} onClick={() => setCourseAttempt(n => n + 1)}>Retry courses</button></>
                : <>No active courses. Add one in <Link to="/settings">Settings → Courses</Link>, then return here.</>}
            </p>}
            {needsCoursePick && (
              <label className={docStyles.modalLabel}>
                Course for this exam
                <select className={docStyles.modalSelect} value={subjectFix} disabled={!!busy} onChange={e => { setSubjectFix(e.target.value); setPicked(null); setRemovalSelection(null); }}>
                  <option value="">Pick a course…</option>
                  {courses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
            {(exam && course) || (choice === 'other' && other.subjectId) ? (
              <>
                <label className={docStyles.modalLabel}>
                  Braindump what you’ll study
                  <textarea
                    className={styles.braindump}
                    value={braindump}
                    onChange={e => { braindumpEdited.current = true; setBraindump(e.target.value); }}
                    maxLength={8000}
                    rows={5}
                    placeholder={'e.g.\nRead Ch 4–5 on momentum\nDo Worksheet 3 problems 1–12\nTimed practice midterm A\nRedo missed quiz questions'}
                  />
                </label>
                <fieldset className={styles.materials}>
                  <legend>Materials{course ? ` for ${course.name}` : ''} (optional)</legend>
                  {dropZone(!!(exam?.subjectId || other.subjectId))}
                  {courseUploads.length > 0 && (
                    <p className={styles.uploadCount} role="status" aria-live="polite" aria-atomic="true">
                      {savedCount} / {courseUploads.length} {courseUploads.length === 1 ? 'file' : 'files'} uploaded{pendingBatches > 0 && ' · Processing…'}
                    </p>
                  )}
                  {(courseUploads.length > 0 || libraryMaterials.length > 0) && (
                    <div className={styles.fileActions}>
                      {removalSelection ? <>
                        <span>Select files to remove from this exam.</span>
                        <button type="button" className={styles.linkish} disabled={!removalSelection.size}
                          onClick={removeSelectedFiles}>Remove selected ({removalSelection.size})</button>
                        <button type="button" className={styles.linkish} onClick={() => setRemovalSelection(null)}>Cancel removal</button>
                      </> : <button type="button" className={styles.linkish} disabled={!!action}
                        onClick={() => setRemovalSelection(new Set())}>Remove files</button>}
                    </div>
                  )}
                  {courseUploads.map(entry => {
                    const saved = entry.document;
                    const doc = saved && docs.find(d => d.id === saved.id);
                    if (removalSelection) return <div key={entry.key}>{removalCheckbox(entry.key, entry.file.name)}</div>;
                    if (doc?.extractedText) return <div key={entry.key}>{inclusionCheckbox(doc)}</div>;
                    if (!entry.error && (!saved || pendingBatches)) return null;
                    const unsupported = doc?.extractionStatus === 'unsupported';
                    const reason = saved
                      ? (unsupported ? 'Soma can’t read this file type.' : 'Uploaded, but text is unavailable.')
                      : entry.error;
                    return (
                      <div key={entry.key} className={styles.uploadIssue}>
                        <span><strong>{entry.file.name}</strong> · {reason}</span>
                        {!unsupported && <button type="button" className={styles.linkish} disabled={!!busy}
                          aria-label={`${saved ? 'Retry reading' : 'Retry upload of'} ${entry.file.name}`}
                          onClick={() => queueUploads([entry])}>{saved ? 'Retry reading' : 'Retry upload'}</button>}
                      </div>
                    );
                  })}
                  {libraryMaterials.map(d => (
                    <div key={d.id}>{removalSelection ? removalCheckbox(d.id, d.fileName) : inclusionCheckbox(d)}</div>
                  ))}
                </fieldset>
              </>
            ) : null}
            {tooSoon && <span className={docStyles.modalError}>Pick an exam after today.</span>}
            {tooFar && <span className={docStyles.modalError}>Pick an exam in the next {MAX_DAYS_AHEAD} days.</span>}
            {error && <span role="alert" className={docStyles.modalError}>{error}</span>}
            {!canMake && whyDisabled && !error && <span className={styles.hintMute}>{whyDisabled}</span>}
            <div className={styles.builderActions}>
              <button type="button" className={styles.quiet} onClick={onClose} disabled={!!busy}>Cancel</button>
              {!!braindump.trim() && <button type="button" className={styles.secondary} onClick={useBraindumpOnly} disabled={!!busy || !!removalSelection || tooSoon || tooFar || !exam || !course}>Use braindump as-is</button>}
              <button type="button" className={styles.primary} onClick={() => void make()} disabled={!canMake}>{busy === 'reading' ? 'Reading…' : 'Make my study checklist'}</button>
            </div>
          </>
        ) : (
          <ExamReview userId={userId} date={exam!.date} title={exam!.title} topics={rows} reading={readingLabels} docs={docs}
            note={confirmNote} initialConfidence={storage.getSomaSettings().examPrep?.[planId]?.confidence ?? {}}
            initialDaily={storage.getSomaSettings().examPrep?.[planId]?.daily ?? 180} pending={!!busy} error={error}
            onBack={()=>{setRows(null);setConfirmNote('');}} onApprove={approve}/>
        )}
      </div>
    </div>
  );
}
