import { useEffect, useId, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { storage } from '../../lib/storage';
import { rescheduleTasks } from '../../lib/taskSchedule';
import { dueMoment } from '../../lib/taskScheduler';
import { parseLength, type TaskStep } from '../../lib/taskDetails';
import { kindOf } from '../../lib/planIt';
import { asTodoKind, type Todo, type TodoSession } from '../../types';
import styles from './TaskDetail.module.css';
import panelStyles from '../DashboardV2/DashboardV2.module.css';

/**
 * Task details (2026-11-15): open a task from its due card, the Tasks page,
 * or the brain dump to say how it should be scheduled. Your own deadline
 * ("due Wed" that's due Tue for you), the days to work on it, how many
 * sittings, or named steps that replace generic sittings (each step gets a
 * sitting of its own length, in order). Saving makes it a task Soma
 * schedules, and places it again at once (lib/taskScheduler.ts).
 */

/** `todo`: an existing task. `seed`: a new one (a Canvas assignment with no task yet, or a brain dump line). */
export type TaskDetailTarget = {
  todo?: Todo;
  seed?: { title: string; subjectId?: string; dueDate?: string; assignmentId?: number };
};
type Props = {
  userId: string;
  target: TaskDetailTarget;
  subjects: { id: string; name: string }[];
  sessions: TodoSession[];
  /** Soma's guess at the length, for a task with none set. */
  guess: (title: string, subjectId?: string) => number;
  onClose: (saved: boolean) => void;
  /** 'panel': in the dashboard's side panel, like Edit block (a due card opens it). Default: a dialog. */
  variant?: 'dialog' | 'panel';
};

/** A length you type, not pick: it reads what you wrote when you leave the field. */
function LengthInput({ value, onChange, label }: { value: number; onChange: (minutes: number) => void; label: string }) {
  const [text, setText] = useState(hm(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(hm(value)); setBad(false); }, [value]);
  const commit = () => {
    const minutes = parseLength(text);
    if (minutes === null) { setBad(true); return; }
    setBad(false); setText(hm(minutes)); onChange(minutes);
  };
  return <input type="text" inputMode="text" className={styles.length} aria-label={label} aria-invalid={bad || undefined} title="Type a length, like 45 min or 1h 30m"
    placeholder="45 min" value={text} onChange={e => setText(e.target.value)} onFocus={e => e.target.select()} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />;
}
const hm = (m: number) => m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
const pad = (n: number) => String(n).padStart(2, '0');
const dateOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const longDate = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export default function TaskDetail({ userId, target, subjects, sessions, guess, onClose, variant = 'dialog' }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const todo = target.todo;
  const seed = target.seed;
  // Imported work keeps its name, course and posted due date; yours can change.
  const imported = !!(todo?.assignmentId ?? seed?.assignmentId) || !!todo?.kind;
  const posted = todo?.dueDate ?? seed?.dueDate;
  const postedAt = posted ? dueMoment(posted) : null;
  const deadline = todo?.myDue ? dueMoment(todo.myDue) : postedAt;

  const [title, setTitle] = useState(todo?.text ?? seed?.title ?? '');
  const [subjectId, setSubjectId] = useState(todo?.subjectId ?? seed?.subjectId ?? '');
  const [dueDay, setDueDay] = useState(deadline ? dateOf(deadline) : '');
  const [dueTime, setDueTime] = useState(deadline ? timeOf(deadline) : '23:59');
  const [minutes, setMinutes] = useState(() => todo?.estimatedMinutes ?? guess(todo?.text ?? seed?.title ?? '', todo?.subjectId ?? seed?.subjectId));
  const [count, setCount] = useState<number | ''>(todo?.sittingCount ?? '');
  const [from, setFrom] = useState(todo?.workFrom ?? '');
  const [until, setUntil] = useState(todo?.workUntil ?? '');
  const [steps, setSteps] = useState<TaskStep[]>(() => (todo?.steps ?? []).map(s => ({
    ...s, done: s.done || sessions.some(x => x.todoId === todo?.id && x.stepId === s.id && !!x.doneAt) || undefined,
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (variant === 'dialog' && !dialog.current?.open) dialog.current?.showModal?.(); }, [variant]);
  const close = (saved: boolean) => { dialog.current?.close?.(); onClose(saved); };
  /**
   * Delete task (2026-11-21): the one place work is deleted for good. Taking
   * a block off the calendar keeps the task on the Tasks list; this takes the
   * task and all its blocks. Recorded study time stays in Insights.
   */
  async function deleteTask() {
    if (!todo || !window.confirm(`Delete "${todo.text}" for good? It comes off your plan and your Tasks list. Recorded study time stays in Insights.`)) return;
    setBusy(true); setError('');
    try {
      for (const sn of sessions.filter(x => x.todoId === todo.id)) await storage.deleteTodoSession(sn.id);
      await storage.deleteTodo(todo.id);
      await storage.fetchAllTodos();
      window.dispatchEvent(new Event('soma_todos_changed'));
      close(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the task.'); }
    finally { setBusy(false); }
  }
  const deleteButton = todo ? <button type="button" className={styles.danger} onClick={() => void deleteTask()} disabled={busy}>Delete task</button> : null;

  const today = dateOf(new Date());
  const stepTotal = steps.reduce((n, s) => n + s.minutes, 0);
  const dueAt = dueDay ? new Date(`${dueDay}T${dueTime || '23:59'}:00`) : null;
  const moved = !!(imported && postedAt && dueAt && Math.abs(+dueAt - +postedAt) >= 60_000);
  // When each step is on the plan: its sitting's day and time.
  const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const whenOf = (stepId: string): string => {
    const sitting = sessions.find(x => x.todoId === todo?.id && x.stepId === stepId && x.startTime && x.endTime);
    if (!sitting) return '';
    const a = new Date(sitting.startTime!), z = new Date(sitting.endTime!);
    const day = dateOf(a) === today ? 'Today' : longDate(a);
    return `${sitting.doneAt ? 'Done · ' : ''}${day}, ${clock(a)}–${clock(z)}`;
  };

  function problem(): string {
    if (!title.trim()) return 'Give it a name.';
    if (!dueDay) return 'Pick when it’s due.';
    if (from && until && until < from) return '“Until” comes before “from”.';
    if (until && dueDay && until > dueDay) return '“Until” is after it’s due.';
    if (from && dueDay && from > dueDay) return '“From” is after it’s due.';
    if (steps.some(s => !s.title.trim())) return 'Name each step, or remove the empty one.';
    return '';
  }

  async function save() {
    const why = problem();
    if (why) { setError(why); return; }
    setBusy(true); setError('');
    try {
      const due = `${dueDay}T${dueTime || '23:59'}`;
      const assignmentId = todo?.assignmentId ?? seed?.assignmentId;
      const base: Todo = todo ?? {
        id: crypto.randomUUID(), text: title.trim(), status: 'nothing', date: today,
        ...(assignmentId ? { assignmentId, kind: asTodoKind(kindOf(title)) ?? 'homework' } : { kind: asTodoKind(kindOf(title)) }),
      };
      const cleanSteps = steps.map(s => ({ id: s.id, title: s.title.trim(), minutes: s.minutes, ...(s.done ? { done: true } : {}) }));
      const next: Todo = {
        ...base,
        text: imported ? base.text : title.trim(),
        subjectId: subjectId || undefined,
        // Imported work keeps its posted date; a different one is yours.
        dueDate: imported && posted ? posted : due,
        myDue: imported && moved ? due : null,
        estimatedMinutes: cleanSteps.length ? stepTotal : minutes,
        sittingCount: cleanSteps.length ? null : count || null,
        workFrom: from || null,
        workUntil: until || null,
        steps: cleanSteps.length ? cleanSteps : null,
        autoSchedule: true,
      };
      await storage.saveTodo(next);
      await rescheduleTasks(userId);
      window.dispatchEvent(new Event('soma_todos_changed'));
      close(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Please retry.'); }
    finally { setBusy(false); }
  }

  const setStep = (id: string, patch: Partial<TaskStep>) => setSteps(list => list.map(s => s.id === id ? { ...s, ...patch } : s));
  const addStep = () => setSteps(list => [...list, { id: crypto.randomUUID().slice(0, 8), title: '', minutes: list.length ? list[list.length - 1].minutes : 30 }]);

  const body = <>
        {imported
          ? <p className={styles.name}>{title}<span>{subjects.find(s => s.id === subjectId)?.name ?? 'Personal'}</span></p>
          : <>
            <label className={styles.field}><span>Name</span>
              <input type="text" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} required />
            </label>
            <label className={styles.field}><span>Course</span>
              <select value={subjectId} onChange={e => setSubjectId(e.target.value)}>
                <option value="">Personal (not for a course)</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </>}

        <fieldset className={styles.field}>
          <legend>{imported ? 'Your deadline' : 'Due'}</legend>
          <div className={styles.row}>
            <input type="date" aria-label={imported ? 'Your deadline, day' : 'Due day'} value={dueDay} onChange={e => setDueDay(e.target.value)} required />
            <input type="time" aria-label={imported ? 'Your deadline, time' : 'Due time'} value={dueTime} onChange={e => setDueTime(e.target.value)} />
            {moved && postedAt && <button type="button" className={styles.link} onClick={() => { setDueDay(dateOf(postedAt)); setDueTime(timeOf(postedAt)); }}>Use the posted date</button>}
          </div>
          {imported && postedAt && <p className={styles.hint}>{moved ? `Posted as due ${longDate(postedAt)}. Soma works to yours.` : `As posted: ${longDate(postedAt)}. Change it if it’s due sooner for you.`}</p>}
        </fieldset>

        <fieldset className={styles.field}>
          <legend>Work on it</legend>
          <div className={styles.row}>
            <label className={styles.inline}>From <input type="date" aria-label="Earliest day to work on it" value={from} min={today} max={dueDay || undefined} onChange={e => setFrom(e.target.value)} /></label>
            <label className={styles.inline}>until <input type="date" aria-label="Latest day to work on it" value={until} min={from || today} max={dueDay || undefined} onChange={e => setUntil(e.target.value)} /></label>
            {(from || until) && <button type="button" className={styles.link} onClick={() => { setFrom(''); setUntil(''); }}>Clear</button>}
          </div>
          <p className={styles.hint}>{from || until ? 'Sittings stay between these days.' : 'Empty: it starts a few days before and aims to finish a day early (still by the due date if that doesn’t fit), by your Scheduling settings. No AI.'}</p>
        </fieldset>

        <fieldset className={styles.field}>
          <legend>Steps</legend>
          {steps.length > 0 && <ol className={styles.steps}>
            {steps.map((s, i) => <li key={s.id}>
              <input type="checkbox" aria-label={`Step ${i + 1} done`} checked={!!s.done} onChange={e => setStep(s.id, { done: e.target.checked || undefined })} />
              <input type="text" aria-label={`Step ${i + 1}`} placeholder={`Step ${i + 1}, e.g. Problems 1–3`} value={s.title} maxLength={120} onChange={e => setStep(s.id, { title: e.target.value })} />
              <LengthInput label={`Step ${i + 1} length`} value={s.minutes} onChange={m => setStep(s.id, { minutes: m })} />
              <button type="button" className={styles.x} aria-label={`Remove step ${i + 1}`} onClick={() => setSteps(list => list.filter(x => x.id !== s.id))}><X size={14} /></button>
              <span className={styles.when}>{whenOf(s.id) || (s.done ? 'Done' : 'Not on your plan yet. It gets a time when you save.')}</span>
            </li>)}
          </ol>}
          <button type="button" className={styles.addStep} onClick={addStep}><Plus size={14} /> Add a step</button>
          <p className={styles.hint}>{steps.length ? `Each step gets its own sitting, in this order. ${hm(stepTotal)} in all.` : 'Optional. Steps replace Soma’s generic sittings with ones named for what you’ll do.'}</p>
        </fieldset>

        {!steps.length && <div className={styles.pair}>
          <label className={styles.field}><span>How long, in all</span>
            <LengthInput label="How long, in all" value={minutes} onChange={setMinutes} />
          </label>
          <label className={styles.field}><span>Sittings</span>
            <input type="number" aria-label="Sittings" min={1} max={20} step={1} inputMode="numeric" placeholder="Automatic" value={count}
              onChange={e => { const n = Math.round(Number(e.target.value)); setCount(e.target.value && n >= 1 ? Math.min(20, n) : ''); }} />
          </label>
          <p className={`${styles.hint} ${styles.wide}`}>{count ? `${count} ${count === 1 ? 'sitting' : 'sittings'} of ${hm(Math.max(5, Math.round(minutes / count / 5) * 5))}.` : 'Sittings empty: split by your usual sitting length in Scheduling settings. No AI.'} Type a length like 45 min, 1h 30m or 1.5h.</p>
        </div>}

  </>;

  const heading = todo ? 'Task details' : seed?.title ? 'Make it a task' : 'Add a task';
  if (variant === 'panel') return (
    <section className={`${panelStyles.editor} ${styles.panel}`} aria-label={heading}>
      <div className={panelStyles.sectionHeading}><h2>{heading}</h2><button type="button" onClick={() => close(false)} disabled={busy} aria-label="Close task details">Close</button></div>
      <p className={panelStyles.description}>How Soma schedules this: your deadline, the days you’ll work on it, and its sittings or steps.</p>
      <form onSubmit={e => { e.preventDefault(); void save(); }}>
        {body}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={panelStyles.editorButtons}>
          {deleteButton}
          <button type="button" onClick={() => close(false)} disabled={busy}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : todo ? 'Save' : 'Schedule it'}</button>
        </div>
      </form>
    </section>
  );

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); if (!busy) close(false); }}>
      <form onSubmit={e => { e.preventDefault(); void save(); }}>
        <div className={styles.head}>
          <h3 id={titleId}>{heading}</h3>
          <button type="button" className={styles.x} aria-label="Close" onClick={() => close(false)} disabled={busy}><X size={16} /></button>
        </div>

        {body}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          {deleteButton}
          <button type="button" onClick={() => close(false)} disabled={busy}>Cancel</button>
          <button type="submit" className={styles.confirm} disabled={busy}>{busy ? 'Saving…' : todo ? 'Save' : 'Schedule it'}</button>
        </div>
      </form>
    </dialog>
  );
}
