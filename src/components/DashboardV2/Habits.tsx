import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { dayKey, doneThisWeek, habitId, toggleDay, weekDays, MAX_HABITS, type Habits as HabitList } from '../../lib/habits';
import { HABITS_CHANGED, loadHabits, localHabits, saveHabits } from '../../lib/habitsStore';
import dash from './DashboardV2.module.css';
import styles from './Habits.module.css';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * The Habits widget (lib/habits.ts): today's check for each habit, this
 * week's days as dots (tap one to fix a day you forgot), and how many of the
 * week's target are done. Edit adds and removes habits. Live dashboard only.
 */
export default function Habits() {
  const [habits, setHabits] = useState<HabitList>(localHabits);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [perWeek, setPerWeek] = useState(5);
  const [error, setError] = useState('');
  // Saves of this widget's own still on the way: their events would show an older state.
  const pending = useRef(0);

  useEffect(() => {
    let gone = false;
    loadHabits().then(h => { if (!gone) setHabits(h); }).catch(() => { /* this browser's copy stays */ });
    const refresh = () => { if (!pending.current) setHabits(localHabits()); };
    window.addEventListener(HABITS_CHANGED, refresh);
    return () => { gone = true; window.removeEventListener(HABITS_CHANGED, refresh); };
  }, []);

  async function store(next: HabitList) {
    const before = habits;
    setHabits(next); setError('');
    pending.current++;
    try { await saveHabits(next); return true; }
    catch { setHabits(before); setError("Couldn't save. Check your connection and try again."); return false; }
    finally { pending.current--; }
  }

  async function add() {
    const name = title.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) { setError('Give the habit a name.'); return; }
    const habit = { id: habitId(name, habits.items), title: name, perWeek };
    if (await store({ items: [...habits.items, habit], done: { ...habits.done, [habit.id]: [] } })) setTitle('');
  }

  function remove(id: string) {
    void store({ items: habits.items.filter(h => h.id !== id), done: Object.fromEntries(Object.entries(habits.done).filter(([k]) => k !== id)) });
  }

  const now = new Date(), today = dayKey(now), week = weekDays(now);
  const addForm = (
    <form className={styles.add} onSubmit={e => { e.preventDefault(); void add(); }} aria-label="Add a habit">
      <input aria-label="Habit name" placeholder="Gym" maxLength={40} value={title} onChange={e => setTitle(e.target.value)} />
      <select aria-label="Times a week" value={perWeek} onChange={e => setPerWeek(Number(e.target.value))}>
        {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n === 7 ? 'Every day' : `${n}× a week`}</option>)}
      </select>
      <button type="submit">Add</button>
    </form>
  );

  return (
    <section className={`${dash.widgetCard} ${styles.habits}`} aria-labelledby="w-habits">
      <div className={dash.sectionHeading}>
        <h2 id="w-habits">Habits</h2>
        {habits.items.length > 0 && <button type="button" className={styles.edit} aria-pressed={editing} onClick={() => setEditing(v => !v)}>{editing ? 'Done' : 'Edit'}</button>}
      </div>
      {habits.items.length === 0 ? (
        <>
          <p className={styles.hint}>Things you want to keep up, like the gym or eating well. Check them off each day.</p>
          {addForm}
        </>
      ) : (
        <ul className={styles.list}>
          {habits.items.map(h => {
            const doneToday = (habits.done[h.id] ?? []).includes(today);
            const count = doneThisWeek(habits, h.id, now);
            return (
              <li key={h.id} className={styles.habit}>
                <button type="button" className={`${styles.today}${doneToday ? ` ${styles.on}` : ''}`} aria-pressed={doneToday} aria-label={`${h.title}: done today`}
                  onClick={() => void store(toggleDay(habits, h.id, today, now))}>{doneToday && <Check size={13} />}</button>
                <span className={styles.name}>{h.title}</span>
                <span className={styles.dots} role="group" aria-label={`${h.title} this week`}>
                  {week.map((d, i) => {
                    const done = (habits.done[h.id] ?? []).includes(d);
                    return <button key={d} type="button" disabled={d > today} aria-pressed={done} aria-label={`${h.title}, ${WEEKDAYS[i]}${d === today ? ' (today)' : ''}`}
                      className={`${styles.dot}${done ? ` ${styles.on}` : ''}${d === today ? ` ${styles.isToday}` : ''}`}
                      onClick={() => void store(toggleDay(habits, h.id, d, now))} />;
                  })}
                </span>
                <span className={`${styles.count}${count >= h.perWeek ? ` ${styles.met}` : ''}`} aria-label={`${count} of ${h.perWeek} this week`}>{count}/{h.perWeek}</span>
                {editing && <button type="button" className={styles.remove} aria-label={`Remove ${h.title}`} onClick={() => remove(h.id)}><X size={13} /></button>}
              </li>
            );
          })}
        </ul>
      )}
      {editing && habits.items.length < MAX_HABITS && addForm}
      {error && <p role="alert" className={styles.hint}>{error}</p>}
    </section>
  );
}
