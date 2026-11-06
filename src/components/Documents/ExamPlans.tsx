import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { storage } from '../../lib/storage';
import { loadCourseItems, isReading, type CourseItem } from '../../lib/courseItems';
import { addDays, dayKey, shortDay, MAX_STUDY_ITEMS, MAX_ITEM_MINUTES, type ExamPlan, type StudyDraft } from '../../lib/examPlan';
import { buildStudyList, deleteExamPlan, loadExamPlans, planExamDays, saveExamPlan, scheduleWeek, setItemDone, setStudyDays, EXAM_PLANS_CHANGED, MAX_DAYS_AHEAD } from '../../lib/examPlansStore';
import type { Subject, SomaDocument, Todo } from '../../types';
import docStyles from './DocumentsTab.module.css';
import list from './ReadingLists.module.css';
import styles from './ExamPlans.module.css';

const hours = (m: number) => m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
const EXAMISH = /\b(exam|midterm|final|quiz|test)\b/i;

/** Exams and quizzes coming up, from the student's tasks: what a plan can be for. */
export function examChoices(todos: Todo[], today: string): Todo[] {
  const last = addDays(today, MAX_DAYS_AHEAD);
  return todos.filter(t => t.status !== 'done' && t.subjectId && t.dueDate && t.dueDate.slice(0, 10) > today && t.dueDate.slice(0, 10) <= last
    && (t.kind === 'exam' || t.kind === 'quiz' || (!t.kind && EXAMISH.test(t.text))))
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
}

/**
 * Exam study plans (lib/examPlan.ts): for each exam, a concrete list made
 * from the student's uploads and grades, approved by them, then spread over
 * the days before the exam. A week at a time goes onto the plan to Accept.
 */
export default function ExamPlans({ subjects, docs }: { subjects: Subject[]; docs: SomaDocument[] }) {
  const [userId, setUserId] = useState('');
  const [plans, setPlans] = useState<ExamPlan[]>([]);
  const [items, setItems] = useState<CourseItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [builder, setBuilder] = useState<{ exam?: ExamPlan } | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
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

  const today = dayKey(new Date());
  const upcoming = plans.filter(p => p.examDate >= today);
  const past = plans.filter(p => p.examDate < today);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setError('');
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong. Please retry.'); }
    finally { setBusy(''); }
  }
  const replan = (exam: ExamPlan) => run(`replan:${exam.id}`, async () => {
    const left = items.filter(i => i.examId === exam.id && !i.doneAt).sort((a, b) => a.position - b.position);
    const plan = await planExamDays(userId, exam, left.map(i => ({ id: i.id, minutes: i.minutes ?? 45 })));
    await setStudyDays(userId, plan.assign);
    setReasons(r => ({ ...r, [exam.id]: plan.reason || 'Planned from today.' }));
    await reload(userId);
  });
  const addWeek = (exam: ExamPlan) => run(`week:${exam.id}`, async () => {
    const subject = subjects.find(s => s.id === exam.subjectId);
    if (!subject) throw new Error('This exam’s course is no longer one of your subjects.');
    const { count, missing } = await scheduleWeek(userId, exam, items, subject);
    const full = missing.length ? ` No open time on ${missing.map(d => shortDay(d)).join(', ')}: re-plan to move that work.` : '';
    setNotes(n => ({ ...n, [exam.id]: count
      ? { text: `${count} study ${count === 1 ? 'block is' : 'blocks are'} waiting on your plan. Accept ${count === 1 ? 'it' : 'them'} on the dashboard.${full}`, link: true }
      : { text: missing.length ? `Nothing fits this week.${full}` : 'Nothing left to plan this week: it’s done or already on your plan.' } }));
  });

  return (
    <section className={list.panel} aria-labelledby="exam-plans-heading">
      <div className={list.head}>
        <div>
          <h2 id="exam-plans-heading">Exam study plans</h2>
          <p>A concrete list for each exam, made from your materials and grades, spread over the days before it: less on busy days, more on open ones.</p>
        </div>
        <button type="button" className={list.build} onClick={() => setBuilder({})} disabled={!userId}>Plan an exam</button>
      </div>
      {error && <p role="alert" className={list.error}>{error}</p>}
      {upcoming.length === 0 ? (
        <p className={list.empty}>No exam plans yet. Upload worksheets, practice exams and study guides here, then plan an exam: Soma lists exactly what to do, and you approve it.</p>
      ) : (
        <ul className={list.courses}>
          {upcoming.map(exam => {
            const subject = subjects.find(s => s.id === exam.subjectId);
            const mine = items.filter(i => i.examId === exam.id).sort((a, b) => a.position - b.position);
            const done = mine.filter(i => i.doneAt).length;
            const missed = mine.filter(i => !i.doneAt && i.studyDay && i.studyDay < today);
            const days = [...new Set(mine.filter(i => i.studyDay && i.studyDay >= today).map(i => i.studyDay!))].sort();
            const unplanned = mine.filter(i => !i.doneAt && !i.studyDay);
            const expanded = open === exam.id;
            return (
              <li key={exam.id} className={list.course}>
                <button type="button" className={list.courseRow} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : exam.id)}>
                  <span className={list.courseName}><i style={{ background: subject?.color }} />{exam.title}</span>
                  <span className={list.summary}>{subject?.name} · {shortDay(exam.examDate)} · {done} of {mine.length} done</span>
                  {missed.length > 0 && <span className={list.behind}>{missed.length} missed</span>}
                  <span className={list.chevron} aria-hidden>{expanded ? '−' : '+'}</span>
                </button>
                {expanded && (
                  <div className={styles.body}>
                    {reasons[exam.id] && <p className={styles.reason}>{reasons[exam.id]}</p>}
                    {(missed.length > 0 || unplanned.length > 0) && (
                      <div className={styles.missed}>
                        <p>{missed.length > 0 ? `${missed.length} from earlier days ${missed.length === 1 ? 'isn’t' : 'aren’t'} done yet.` : `${unplanned.length} ${unplanned.length === 1 ? 'item has' : 'items have'} no day yet.`} Re-planning spreads what’s left over the days before the exam.</p>
                        <button type="button" className={list.build} onClick={() => void replan(exam)} disabled={!!busy}>{busy === `replan:${exam.id}` ? 'Planning…' : 'Re-plan from today'}</button>
                      </div>
                    )}
                    {[...(missed.length ? [['missed', missed] as const] : []), ...days.map(d => [d, mine.filter(i => i.studyDay === d)] as const)].map(([day, dayItems]) => (
                      <div key={day} className={styles.day}>
                        <h3>{day === 'missed' ? 'From earlier days' : day === today ? `Today · ${shortDay(day)}` : shortDay(day)} <small>{dayItems.every(i => i.doneAt) ? 'Done' : hours(dayItems.filter(i => !i.doneAt).reduce((n, i) => n + (i.minutes ?? 45), 0))}</small></h3>
                        <ol className={list.items}>
                          {dayItems.map(item => (
                            <li key={item.id} className={item.doneAt ? list.done : undefined}>
                              <label>
                                <input type="checkbox" aria-label={`Done: ${item.label}`} checked={!!item.doneAt} onChange={() => void run(`done:${item.id}`, async () => { await setItemDone(userId, item.id, !item.doneAt); await reload(userId); })} />
                                <strong>{item.label}</strong>
                                <span>{item.title}</span>
                              </label>
                              {item.todoId && !item.doneAt && <em className={list.tag}>Planned</em>}
                              <small>{item.minutes ?? 45} min</small>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                    <div className={styles.actions}>
                      <button type="button" className={styles.primary} onClick={() => void addWeek(exam)} disabled={!!busy}>{busy === `week:${exam.id}` ? 'Finding times…' : 'Add this week to my plan'}</button>
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
          onClose={() => setBuilder(null)}
          onSaved={(exam, reason) => { setBuilder(null); setOpen(exam.id); setReasons(r => ({ ...r, [exam.id]: reason })); void reload(userId); }} />
      )}
    </section>
  );
}

type ExamPick = { todoId?: string; title: string; subjectId: string; date: string };

function Builder({ userId, subjects, docs, items, preset, onClose, onSaved }: {
  userId: string; subjects: Subject[]; docs: SomaDocument[]; items: CourseItem[]; preset?: ExamPlan;
  onClose: () => void; onSaved: (exam: ExamPlan, reason: string) => void;
}) {
  const today = dayKey(new Date());
  const active = subjects.filter(s => !s.archived);
  const choices = examChoices(storage.getTodos(), today);
  const [choice, setChoice] = useState<string>(preset ? 'preset' : choices[0]?.id ?? 'other');
  const [other, setOther] = useState<ExamPick>({ title: '', subjectId: active[0]?.id ?? '', date: '' });
  const exam: ExamPick | null = preset ? { todoId: preset.todoId, title: preset.title, subjectId: preset.subjectId, date: preset.examDate }
    : choice === 'other' ? (other.title.trim() && other.subjectId && other.date ? { ...other, title: other.title.trim() } : null)
    : (t => t ? { todoId: t.id, title: t.text, subjectId: t.subjectId!, date: t.dueDate!.slice(0, 10) } : null)(choices.find(t => t.id === choice));
  const materials = docs.filter(d => d.subjectId === exam?.subjectId && d.extractedText);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = materials.filter(d => picked ? picked.has(d.id) : d.docType !== 'syllabus' || materials.length === 1);
  const [rows, setRows] = useState<StudyDraft[] | null>(null);
  const [busy, setBusy] = useState<'' | 'reading' | 'saving'>('');
  const [error, setError] = useState('');
  const course = subjects.find(s => s.id === exam?.subjectId);
  const tooFar = !!exam && exam.date > addDays(today, MAX_DAYS_AHEAD);
  const tooSoon = !!exam && exam.date <= today;

  async function make() {
    if (!exam || !course) return;
    setBusy('reading'); setError('');
    try {
      const reading = (await loadCourseItems(userId)).filter(i => isReading(i) && i.subjectId === exam.subjectId);
      setRows(await buildStudyList({ id: preset?.id ?? '', subjectId: exam.subjectId, title: exam.title, examDate: exam.date, todoId: exam.todoId }, course.name, chosen, reading));
    } catch (err) { setError(err instanceof Error ? err.message : 'Soma couldn’t make the list. Please try again.'); }
    finally { setBusy(''); }
  }
  async function approve() {
    if (!exam || !rows) return;
    const clean = rows.filter(r => r.label.trim()).map(r => ({ ...r, label: r.label.trim() }));
    if (!clean.length) return;
    setBusy('saving'); setError('');
    try {
      const plan: ExamPlan = { id: preset?.id ?? crypto.randomUUID(), subjectId: exam.subjectId, title: exam.title.slice(0, 120), examDate: exam.date, ...(exam.todoId ? { todoId: exam.todoId } : {}) };
      const previous = items.filter(i => i.examId === plan.id);
      const doneLabels = new Set(previous.filter(i => i.doneAt).map(i => i.label.toLowerCase()));
      // Days only for what's left; done items keep theirs.
      const left = clean.map((r, i) => ({ id: String(i), minutes: r.minutes, done: doneLabels.has(r.label.toLowerCase()) })).filter(r => !r.done);
      const days = await planExamDays(userId, plan, left);
      const byIndex = new Map<number, string>();
      for (const [i, day] of days.assign) byIndex.set(Number(i), day);
      clean.forEach((r, i) => { if (!byIndex.has(i)) { const old = previous.find(p => p.label.toLowerCase() === r.label.toLowerCase()); if (old?.studyDay) byIndex.set(i, old.studyDay); } });
      await saveExamPlan(userId, plan, clean, byIndex, previous);
      onSaved(plan, days.reason || 'Spread over the days before the exam.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); setBusy(''); }
  }
  const edit = (i: number, patch: Partial<StudyDraft>) => setRows(rs => rs && rs.map((r, k) => k === i ? { ...r, ...patch } : r));
  const total = rows?.reduce((n, r) => n + (r.label.trim() ? r.minutes : 0), 0) ?? 0;

  return (
    <div className={docStyles.modalOverlay} onClick={() => !busy && onClose()}>
      <div className={`${docStyles.modal} ${list.builder}`} role="dialog" aria-modal="true" aria-labelledby="exam-builder-title" onClick={e => e.stopPropagation()}>
        <span id="exam-builder-title" className={docStyles.modalTitle}>{preset ? `Rebuild the list for ${preset.title}` : 'Plan an exam'}</span>
        {!rows ? (
          <>
            {!preset && (
              <label className={docStyles.modalLabel}>
                Exam
                <select className={docStyles.modalSelect} value={choice} onChange={e => { setChoice(e.target.value); setPicked(null); }}>
                  {choices.map(t => <option key={t.id} value={t.id}>{t.text} · {subjects.find(s => s.id === t.subjectId)?.name} · {shortDay(t.dueDate!.slice(0, 10))}</option>)}
                  <option value="other">Another exam…</option>
                </select>
              </label>
            )}
            {!preset && choice === 'other' && (
              <div className={styles.otherExam}>
                <label className={docStyles.modalLabel}>Name<input className={docStyles.modalTextInput} value={other.title} maxLength={120} placeholder="Midterm 2" onChange={e => setOther(o => ({ ...o, title: e.target.value }))} /></label>
                <label className={docStyles.modalLabel}>Course
                  <select className={docStyles.modalSelect} value={other.subjectId} onChange={e => { setOther(o => ({ ...o, subjectId: e.target.value })); setPicked(null); }}>
                    {active.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className={docStyles.modalLabel}>Date<input className={docStyles.modalTextInput} type="date" min={addDays(today, 1)} max={addDays(today, MAX_DAYS_AHEAD)} value={other.date} onChange={e => setOther(o => ({ ...o, date: e.target.value }))} /></label>
              </div>
            )}
            {exam && (
              <fieldset className={styles.materials}>
                <legend>Materials for {course?.name ?? 'this course'}</legend>
                {materials.length === 0 ? (
                  <p className={list.note}>No readable files for this course yet. Upload worksheets, practice exams or a study guide on this page and give them this course; Soma can still list from your grades and reading list.</p>
                ) : materials.map(d => (
                  <label key={d.id}><input type="checkbox" checked={chosen.some(c => c.id === d.id)} onChange={e => setPicked(() => { const next = new Set(chosen.map(c => c.id)); if (e.target.checked) next.add(d.id); else next.delete(d.id); return next; })} />{d.fileName}</label>
                ))}
              </fieldset>
            )}
            {tooSoon && <span className={docStyles.modalError}>Pick an exam after today.</span>}
            {tooFar && <span className={docStyles.modalError}>Pick an exam in the next {MAX_DAYS_AHEAD} days.</span>}
            {error && <span className={docStyles.modalError}>{error}</span>}
            <button type="button" className={docStyles.modalUploadBtn} onClick={() => void make()} disabled={!exam || !course || tooSoon || tooFar || !!busy}>{busy === 'reading' ? 'Reading your materials…' : 'Make my list'}</button>
            <button type="button" className={docStyles.modalCancelBtn} onClick={onClose} disabled={!!busy}>Cancel</button>
          </>
        ) : (
          <>
            <p className={list.note}><strong>{exam?.title}</strong> · {rows.length} items · about {hours(total)}. Change anything that’s off, then approve: Soma spreads it over the days before the exam.</p>
            <div className={list.reviewWrap}>
              <table className={`${list.review} ${styles.review}`}>
                <thead><tr><th scope="col">What</th><th scope="col">Detail</th><th scope="col">Min</th><th scope="col"><span className={list.srOnly}>Remove</span></th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td><input aria-label="What" value={r.label} maxLength={40} onChange={e => edit(i, { label: e.target.value })} className={list.label} /></td>
                      <td><input aria-label={`Detail for ${r.label}`} value={r.detail ?? ''} maxLength={120} onChange={e => edit(i, { detail: e.target.value })} /></td>
                      <td><input aria-label={`Minutes for ${r.label}`} type="number" min={5} max={MAX_ITEM_MINUTES} step={5} value={r.minutes} onChange={e => edit(i, { minutes: Math.min(MAX_ITEM_MINUTES, Math.max(5, Number(e.target.value) || 5)) })} /></td>
                      <td><button type="button" className={list.remove} aria-label={`Remove ${r.label}`} onClick={() => setRows(rs => rs && rs.filter((_, k) => k !== i))}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length < MAX_STUDY_ITEMS && <button type="button" className={styles.addRow} onClick={() => setRows(rs => rs && [...rs, { label: '', minutes: 45 }])}>Add an item</button>}
            {error && <span className={docStyles.modalError}>{error}</span>}
            <button type="button" className={docStyles.modalUploadBtn} onClick={() => void approve()} disabled={!!busy || !rows.some(r => r.label.trim())}>{busy === 'saving' ? 'Planning the days…' : 'Approve list'}</button>
            <button type="button" className={docStyles.modalCancelBtn} onClick={() => setRows(null)} disabled={!!busy}>Back</button>
          </>
        )}
      </div>
    </div>
  );
}
