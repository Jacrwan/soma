import { useState } from 'react';
import { formatClock, formatClockRange, useTimeFormat } from '../../lib/timeFormat';
import { dayKey, dueAsDate, type PlanTarget } from '../../lib/planIt';
import styles from './DashboardV2.module.css';

/**
 * Plan it (2026-11-15): the assignment becomes a task Soma schedules
 * (src/lib/taskSchedule.ts). The student says how long; Soma places the
 * sittings before the finish day (Settings → Scheduling) and moves them
 * again when one is missed or the plan changes. Time already spent can be
 * logged here too.
 */

const todayKey = () => dayKey(new Date());
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const hours = (m: number) => m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
const CHOICES = [30, 60, 120, 180];

export type Placed = { title: string; date: string; time: string };
export type ScheduleOutcome = { placed: Placed[]; short: number; finishBy?: Date; firstDay?: number; error?: string };

export default function PlanIt({ target, estimate, onPlace, onLog, onClose }: {
  target: PlanTarget;
  estimate: { minutes: number; basis: string };
  onPlace: (choice: { minutes: number }) => Promise<ScheduleOutcome>;
  onLog: (date: string, minutes: number, start?: string) => Promise<void>;
  onClose: () => void;
}) {
  const timeFormat = useTimeFormat();
  const [minutes, setMinutes] = useState(estimate.minutes);
  const due = dueAsDate(target.due);
  const dueDay = dayKey(due);
  const dueClock = target.due.length > 10 ? `, ${formatClock(`${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`, timeFormat)}` : '';
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScheduleOutcome | null>(null);
  const [error, setError] = useState('');
  const [logDate, setLogDate] = useState(todayKey);
  const [logMinutes, setLogMinutes] = useState('');
  const [logStart, setLogStart] = useState('');
  const [logged, setLogged] = useState('');

  const setTotal = (m: number) => { setMinutes(m); setResult(null); };
  const finish = result?.finishBy ? (dayKey(result.finishBy) === todayKey() ? 'today' : `by ${dayLabel(dayKey(result.finishBy))}`) : '';

  return (
    <section className={styles.editor} aria-label="Plan it">
      <div className={styles.sectionHeading}><h2>Plan it</h2><button onClick={onClose} aria-label="Close Plan it">Close</button></div>
      <p className={styles.planItWhat}><span>{target.subject}</span><strong>{target.title}</strong><small>Due {dayLabel(dueDay)}{dueClock}</small></p>
      <form className={styles.planItForm} onSubmit={async e => {
        e.preventDefault(); if (busy) return;
        setBusy(true); setError(''); setResult(null);
        try { const r = await onPlace({ minutes }); if (r.error) setError(r.error); setResult(r); }
        catch (err) { setError(err instanceof Error ? err.message : 'Could not schedule it. Try again.'); }
        finally { setBusy(false); }
      }}>
        <fieldset>
          <legend>Total time</legend>
          <div className={styles.planItChips} role="group" aria-label="Total time">
            {CHOICES.map(m => <button key={m} type="button" aria-pressed={minutes === m} onClick={() => setTotal(m)}>{hours(m)}</button>)}
            <label className={styles.planItMinutes}><input type="number" min={15} max={720} step={5} aria-label="Total minutes" value={minutes} onChange={e => setTotal(Math.max(5, Math.min(720, Number(e.target.value) || 0)))} /> min</label>
          </div>
          <small>Soma's guess: {hours(estimate.minutes)}, {estimate.basis}.</small>
        </fieldset>
        <p className={styles.editorNote}>Soma splits it into sittings in your open study time and finishes before it's due. If you miss one, it moves. Change how in Settings → Scheduling.</p>
        {error && <p role="alert" className={styles.editorNote}>{error}</p>}
        <div className={styles.editorButtons}><button type="submit" className={styles.planItGo} disabled={busy || minutes < 5}>{busy ? 'Scheduling…' : result ? 'Update' : 'Schedule it'}</button></div>
      </form>
      {result && !result.error && <div className={styles.planItResult} role="status">
        {result.placed.length > 0 && <>
          <p>{result.placed.length === 1 ? 'On your plan' : `${result.placed.length} sittings on your plan`}{finish ? `, done ${finish}` : ''}.</p>
          <ul>{result.placed.map(p => <li key={`${p.date}-${p.time}`}><span>{dayLabel(p.date)}</span><span>{formatClockRange(p.time, timeFormat)}</span><strong>{p.title}</strong></li>)}</ul>
        </>}
        {result.short > 0 && <p className={styles.editorNote}>{hours(result.short)} doesn’t fit {finish || 'before it’s due'}. Try a shorter total, longer study hours, or move it up on Tasks.</p>}
        {!result.placed.length && !result.short && <p className={styles.editorNote}>Nothing left to schedule: the time you’ve logged covers it.</p>}
      </div>}
      <form className={styles.planItLog} onSubmit={async e => {
        e.preventDefault();
        const m = Number(logMinutes);
        if (!m || m < 1) { setLogged('Say how many minutes.'); return; }
        try { await onLog(logDate, m, logStart || undefined); setLogged(`Logged ${hours(m)} on ${dayLabel(logDate)}.`); setLogMinutes(''); setLogStart(''); }
        catch (err) { setLogged(err instanceof Error ? err.message : 'Could not log that time.'); }
      }}>
        <h3>Already worked on it?</h3>
        <div className={styles.planItLogRow}>
          <input type="date" aria-label="Day worked" value={logDate} max={todayKey()} onChange={e => setLogDate(e.target.value || todayKey())} />
          <input type="time" aria-label="Started at (optional)" value={logStart} onChange={e => setLogStart(e.target.value)} />
          <input type="number" min={1} max={720} aria-label="Minutes worked" placeholder="min" value={logMinutes} onChange={e => setLogMinutes(e.target.value)} />
          <button type="submit">Log time</button>
        </div>
        {logged && <p className={styles.editorNote} role="status">{logged}</p>}
      </form>
    </section>
  );
}
