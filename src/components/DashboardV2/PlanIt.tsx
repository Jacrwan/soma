import { useState } from 'react';
import { formatClock, formatClockRange, useTimeFormat } from '../../lib/timeFormat';
import { dayKey, defaultFinishBy, defaultSittings, dueAsDate, type PlanChoice, type PlanTarget } from '../../lib/planIt';
import styles from './DashboardV2.module.css';

/**
 * Plan it (see src/lib/planIt.ts): how long, in how many sittings, done by
 * when. The sittings land on the plan as suggestions to accept; time already
 * spent can be logged here too.
 */

const todayKey = () => dayKey(new Date());
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const hours = (m: number) => m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
const CHOICES = [30, 60, 120, 180];

export type Placed = { title: string; date: string; time: string };

export default function PlanIt({ target, estimate, onPlace, onLog, onClose }: {
  target: PlanTarget;
  estimate: { minutes: number; basis: string };
  onPlace: (choice: PlanChoice) => Promise<{ placed: Placed[]; missing: number }>;
  onLog: (date: string, minutes: number, start?: string) => Promise<void>;
  onClose: () => void;
}) {
  const timeFormat = useTimeFormat();
  const [minutes, setMinutes] = useState(estimate.minutes);
  const [sittings, setSittings] = useState(() => defaultSittings(estimate.minutes));
  const [touchedSittings, setTouchedSittings] = useState(false);
  const due = dueAsDate(target.due);
  const dueDay = dayKey(due);
  const lastDay = dueDay < todayKey() ? todayKey() : dueDay;
  const dueClock = target.due.length > 10 ? `, ${formatClock(`${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`, timeFormat)}` : '';
  const [finishBy, setFinishBy] = useState(() => defaultFinishBy(target.due));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ placed: Placed[]; missing: number } | null>(null);
  const [error, setError] = useState('');
  const [logDate, setLogDate] = useState(todayKey);
  const [logMinutes, setLogMinutes] = useState('');
  const [logStart, setLogStart] = useState('');
  const [logged, setLogged] = useState('');

  const setTotal = (m: number) => { setMinutes(m); if (!touchedSittings) setSittings(defaultSittings(m)); setResult(null); };
  const each = Math.max(5, Math.round(minutes / sittings / 5) * 5);
  const span = finishBy === todayKey() ? 'today' : `by ${dayLabel(finishBy)}`;

  return (
    <section className={styles.editor} aria-label="Plan it">
      <div className={styles.sectionHeading}><h2>Plan it</h2><button onClick={onClose} aria-label="Close Plan it">Close</button></div>
      <p className={styles.planItWhat}><span>{target.subject}</span><strong>{target.title}</strong><small>Due {dayLabel(dueDay)}{dueClock}</small></p>
      <form className={styles.planItForm} onSubmit={async e => {
        e.preventDefault(); if (busy) return;
        setBusy(true); setError(''); setResult(null);
        try { setResult(await onPlace({ minutes, sittings, finishBy })); }
        catch (err) { setError(err instanceof Error ? err.message : 'Could not find times. Try again.'); }
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
        <label>Sittings
          <select aria-label="Sittings" value={sittings} onChange={e => { setSittings(Number(e.target.value)); setTouchedSittings(true); setResult(null); }}>
            {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n === 1 ? '1 sitting' : `${n} sittings`}</option>)}
          </select>
        </label>
        <label>Finish by
          <input type="date" aria-label="Finish by" value={finishBy} min={todayKey()} max={lastDay} onChange={e => { setFinishBy(e.target.value || defaultFinishBy(target.due)); setResult(null); }} />
        </label>
        <p className={styles.editorNote}>{sittings === 1 ? `One ${hours(each)} sitting` : `${sittings} sittings of about ${hours(each)}`}, in your open study time {span}.</p>
        {error && <p role="alert" className={styles.editorNote}>{error}</p>}
        <div className={styles.editorButtons}><button type="submit" className={styles.planItGo} disabled={busy || minutes < 5}>{busy ? 'Finding times…' : result ? 'Find times again' : 'Find times'}</button></div>
      </form>
      {result && <div className={styles.planItResult} role="status">
        {result.placed.length > 0 && <>
          <p>{result.placed.length === 1 ? 'Suggested on your plan' : `${result.placed.length} sittings suggested on your plan`}. Accept them there.</p>
          <ul>{result.placed.map(p => <li key={p.title}><span>{dayLabel(p.date)}</span><span>{formatClockRange(p.time, timeFormat)}</span><strong>{p.title}</strong></li>)}</ul>
        </>}
        {result.missing > 0 && <p className={styles.editorNote}>{result.missing === sittings ? 'No open study time fits' : `${result.missing} more ${result.missing === 1 ? 'sitting doesn’t' : 'sittings don’t'} fit`} {span}. Try fewer, shorter sittings, a later finish, or longer study hours in Settings.</p>}
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
