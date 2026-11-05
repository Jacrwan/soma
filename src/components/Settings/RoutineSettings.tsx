import { useEffect, useState } from 'react';
import { readRoutineItems, daysLabel, lengthLabel, DAY_OPENS, DAY_CLOSES, type RoutineItem } from '../../lib/routine';
import { currentRoutine, saveRoutine, ROUTINE_CHANGED } from '../../lib/routineStore';
import { formatClock } from '../../lib/timeFormat';
import base from './SettingsTab.module.css';
import styles from './RoutineSettings.module.css';

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The weekly routine (lib/routine.ts): gym, meals, evening projects. Soma
 * can suggest one from a chat; this is where the student sees it, adds to it
 * and takes things off. Every change saves at once.
 */
export default function RoutineSettings() {
  const [items, setItems] = useState<RoutineItem[]>(() => currentRoutine()?.items ?? []);
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [fixed, setFixed] = useState(false);
  const [start, setStart] = useState('21:00');
  const [after, setAfter] = useState(DAY_OPENS);
  const [before, setBefore] = useState(DAY_CLOSES);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const refresh = () => setItems(currentRoutine()?.items ?? []);
    window.addEventListener(ROUTINE_CHANGED, refresh);
    return () => window.removeEventListener(ROUTINE_CHANGED, refresh);
  }, []);

  async function store(next: RoutineItem[]) {
    setSaving(true); setError('');
    try { await saveRoutine(next); setItems(next); return true; }
    catch { setError("Couldn't save your routine. Check your connection and try again."); return false; }
    finally { setSaving(false); }
  }

  async function add() {
    const [item] = readRoutineItems([{ title, minutes, days, ...(fixed ? { start } : { after, before }) }]);
    if (!item) { setError(!title.trim() ? 'Give it a name.' : !days.length ? 'Pick at least one day.' : fixed ? 'Check the length.' : 'The window has to be at least as long as it.'); return; }
    // Its id comes from where it lands in the list, so the list is read again whole.
    if (await store(readRoutineItems([...items, item]))) setTitle('');
  }

  return (
    <div className={styles.routine}>
      <h3 className={base.memoryHeading}>Weekly routine</h3>
      <p className={base.subsectionHint}>
        The rest of your week: gym, meals, time for your own projects. It shows on your plan every day, and Soma plans study around it. Things with a window get a time each day around your classes.
      </p>
      {items.length > 0 ? (
        <ul className={styles.list} aria-label="Your weekly routine">
          {items.map(i => (
            <li key={i.id} className={styles.item}>
              <span><strong>{i.title}</strong> · {lengthLabel(i.minutes)} · {daysLabel(i.days)} · {i.start ? `at ${formatClock(i.start)}` : `between ${formatClock(i.after ?? DAY_OPENS)} and ${formatClock(i.before ?? DAY_CLOSES)}`}</span>
              <button type="button" className={styles.remove} disabled={saving} aria-label={`Remove ${i.title}`} onClick={() => void store(items.filter(x => x.id !== i.id))}>Remove</button>
            </li>
          ))}
        </ul>
      ) : <p className={base.subsectionHint}>Nothing yet. Tell Soma how your days go, or add things here.</p>}
      <form className={styles.form} onSubmit={e => { e.preventDefault(); void add(); }} aria-label="Add to your routine">
        <div className={styles.row}>
          <label className={styles.field}>Name<input className={base.timeInput} value={title} maxLength={60} placeholder="Gym" onChange={e => setTitle(e.target.value)} /></label>
          <label className={styles.field}>Minutes<input className={base.timeInput} type="number" min={5} max={720} step={5} value={minutes} onChange={e => setMinutes(Number(e.target.value))} /></label>
        </div>
        <div className={styles.days} role="group" aria-label="Days">
          {LETTERS.map((l, d) => (
            <button key={d} type="button" aria-label={NAMES[d]} aria-pressed={days.includes(d)} className={`${styles.day}${days.includes(d) ? ` ${styles.dayOn}` : ''}`}
              onClick={() => setDays(ds => ds.includes(d) ? ds.filter(x => x !== d) : [...ds, d])}>{l}</button>
          ))}
        </div>
        <div className={styles.row}>
          <label className={styles.check}><input type="checkbox" checked={fixed} onChange={e => setFixed(e.target.checked)} /> At a set time</label>
          {fixed
            ? <label className={styles.field}>Starts<input className={base.timeInput} type="time" value={start} onChange={e => e.target.value && setStart(e.target.value)} /></label>
            : <>
              <label className={styles.field}>Between<input className={base.timeInput} type="time" value={after} onChange={e => e.target.value && setAfter(e.target.value)} /></label>
              <label className={styles.field}>and<input className={base.timeInput} type="time" value={before} onChange={e => e.target.value && setBefore(e.target.value)} /></label>
            </>}
        </div>
        <div className={styles.row}>
          <button type="submit" className={base.saveBtn} disabled={saving}>Add to routine</button>
          {items.length > 0 && <button type="button" className={styles.remove} disabled={saving} onClick={() => { if (window.confirm('Clear your whole weekly routine?')) void store([]); }}>Clear routine</button>}
        </div>
        {error && <p role="alert" className={base.subsectionHint}>{error}</p>}
      </form>
    </div>
  );
}
