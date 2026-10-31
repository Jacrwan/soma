import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { addDump, loadDump, removeDump } from '../../lib/brainDump';
import styles from './BrainDump.module.css';

/**
 * Brain dump: a list for getting everything out of your head, with no AI.
 * Enter adds a line (pasting several lines adds each). + opens "Add to your
 * plan": the course, how long, and when, each filled in with Soma's guess
 * (LiveDashboard's `onPlan`, no AI) so Add is one tap, and each can be
 * changed. A course has to be picked when none is named in the words. The list
 * is saved to the student's account (lib/brainDump.ts) and read again when
 * the tab comes back into view, so every device shows the same one; this
 * browser keeps a copy to show at once. Until the table exists it lives in
 * the browser only. The first time a browser reaches the table, the lines it
 * kept on its own are added to the account's list.
 */

type Item = { id: string; text: string };
export type DumpSlot = { day: number; time: string; label: string };
/** What + needs for one line: the courses and Soma's guesses, and saving the choice (it says where it went). */
export type DumpPlanner = {
  courses: { id: string; name: string }[];
  guess: string | null;
  estimate: (courseId: string | null) => { minutes: number; basis: string };
  slots: (minutes: number) => DumpSlot[];
  add: (choice: { courseId: string | null; minutes: number; slot: DumpSlot | null }) => Promise<string>;
};
type Props = { userId: string; onPlan: (text: string) => Promise<DumpPlanner> };
type Adding = { item: Item; planner: DumpPlanner; course: string; minutes: number; picked: boolean; slot: number };

const LENGTHS = [15, 30, 45, 60, 90, 120];
const PERSONAL = 'personal';
const hm = (m: number) => m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`;

const MAX_ITEMS = 100, MAX_LENGTH = 200;
const read = (key: string): Item[] => { try { const v = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(v) ? v.filter(i => typeof i?.id === 'string' && typeof i?.text === 'string') : []; } catch { return []; } };
const write = (key: string, items: Item[]) => { try { localStorage.setItem(key, JSON.stringify(items)); } catch { /* kept for this visit only */ } };
const flagged = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const flag = (key: string) => { try { localStorage.setItem(key, '1'); } catch { /* uploads again next time; saving the same line twice is harmless */ } };

export default function BrainDump({ userId, onPlan }: Props) {
  const key = `soma_brain_dump:${userId}`;
  const [items, setItems] = useState(() => read(key));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState<Adding | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const current = useRef(items);
  // true: the account's list; false: no table yet, browser only; null: not known yet.
  const synced = useRef<boolean | null>(null);
  // Saves in flight: a read that lands meanwhile could drop a line just added.
  const saving = useRef(0);

  const keep = (next: Item[]) => { current.current = next; setItems(next); write(key, next); };

  const refresh = useCallback(async () => {
    if (saving.current) return;
    try {
      const rows = await loadDump(userId);
      if (saving.current) return;
      if (rows === null) { synced.current = false; return; }
      synced.current = true;
      let list = rows;
      const uploaded = `soma_brain_dump_uploaded:${userId}`;
      if (!flagged(uploaded)) {
        const extra = current.current.filter(i => !rows.some(r => r.id === i.id));
        if (extra.length && await addDump(userId, extra)) list = [...rows, ...extra];
        flag(uploaded);
      }
      keep(list.slice(-MAX_ITEMS));
    } catch { /* the list on screen stays; the next look at the tab tries again */ }
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void refresh();
    const back = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
  }, [refresh]);

  /** Saves a change to the account; if it fails, `undo` puts the list back. */
  async function persist(save: () => Promise<boolean>, undo: () => void, failed?: string) {
    if (synced.current === false) return;
    saving.current++;
    try { if (!(await save())) synced.current = false; }
    catch (e) { undo(); setError(failed ?? (e instanceof Error ? e.message : 'Could not save. Please retry.')); }
    finally { saving.current--; }
  }
  const putBack = (item: Item, at: number) => { const list = current.current.filter(i => i.id !== item.id); keep([...list.slice(0, at), item, ...list.slice(at)]); };

  const take = (lines: string[]) => {
    const fresh = lines.map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim().slice(0, MAX_LENGTH)).filter(Boolean).map(text => ({ id: crypto.randomUUID(), text }));
    if (!fresh.length) return;
    setError('');
    keep([...current.current, ...fresh].slice(-MAX_ITEMS));
    void persist(() => addDump(userId, fresh), () => keep(current.current.filter(i => !fresh.some(f => f.id === i.id))),
      `Couldn’t save ${fresh.length === 1 ? `“${fresh[0].text}”` : `those ${fresh.length} lines`}. Please add ${fresh.length === 1 ? 'it' : 'them'} again.`);
  };

  function remove(item: Item) {
    const at = current.current.findIndex(i => i.id === item.id);
    setError('');
    keep(current.current.filter(i => i.id !== item.id));
    void persist(() => removeDump(userId, item.id), () => putBack(item, at));
  }

  useEffect(() => { if (adding && !dialog.current?.open) dialog.current?.showModal?.(); }, [adding]);
  const close = () => { dialog.current?.close?.(); setAdding(null); };

  /** + : finds the open times and opens "Add to your plan" with Soma's guesses filled in. */
  async function open(item: Item) {
    setBusy(item.id); setError(''); setStatus('');
    try {
      const planner = await onPlan(item.text);
      const course = planner.guess ?? '';
      setAdding({ item, planner, course, minutes: planner.estimate(planner.guess).minutes, picked: false, slot: 0 });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not find open times. Please retry.'); }
    finally { setBusy(null); }
  }
  // A new course re-suggests the length, unless the student chose one; a new length finds new times.
  const pickCourse = (course: string) => setAdding(a => a && { ...a, course, ...(a.picked ? {} : { minutes: a.planner.estimate(course === PERSONAL ? null : course || null).minutes, slot: 0 }) });
  const pickLength = (minutes: number) => setAdding(a => a && { ...a, minutes, picked: true, slot: 0 });

  async function confirm() {
    if (!adding || !adding.course) return;
    const { item, planner, course, minutes } = adding, slots = planner.slots(minutes);
    setBusy(item.id); setError('');
    try {
      const where = await planner.add({ courseId: course === PERSONAL ? null : course, minutes, slot: slots[adding.slot] ?? null });
      close();
      const at = current.current.findIndex(i => i.id === item.id);
      keep(current.current.filter(i => i.id !== item.id));
      setStatus(`Added “${item.text}” ${where}.`);
      await persist(() => removeDump(userId, item.id), () => putBack(item, at), `“${item.text}” is on your plan, but couldn’t be taken off this list. Remove it with ×.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add it. Please retry.'); }
    finally { setBusy(null); }
  }

  const suggestion = adding && adding.planner.estimate(adding.course && adding.course !== PERSONAL ? adding.course : null);
  const slots = adding ? adding.planner.slots(adding.minutes) : [];
  const lengths = adding ? [...new Set([...LENGTHS, suggestion!.minutes, adding.minutes])].sort((a, b) => a - b) : [];

  return (
    <section className={styles.dump} aria-labelledby="brain-dump-title">
      <h2 id="brain-dump-title">Brain dump</h2>
      <p className={styles.lead}>Get everything out of your head. Press + to put it on your plan.</p>
      <form onSubmit={e => { e.preventDefault(); take([draft]); setDraft(''); }}>
        <input
          type="text" aria-label="Add to your brain dump" placeholder="Email TA about the lab grade" maxLength={MAX_LENGTH} value={draft}
          onChange={e => setDraft(e.target.value)}
          onPaste={e => { const text = e.clipboardData.getData('text'); if (!/\n/.test(text)) return; e.preventDefault(); take([draft + text.split(/\r?\n/)[0], ...text.split(/\r?\n/).slice(1)]); setDraft(''); }}
        />
      </form>
      {items.length > 0 && <ul>{items.map(item => <li key={item.id}>
        <span>{item.text}</span>
        <button type="button" className={styles.add} disabled={busy !== null} aria-label={`Add “${item.text}” to your plan`} title="Add to your plan" onClick={() => void open(item)}><Plus size={15} /></button>
        <button type="button" className={styles.remove} disabled={busy !== null} aria-label={`Remove “${item.text}”`} title="Remove" onClick={() => remove(item)}><X size={14} /></button>
      </li>)}</ul>}
      {busy && !adding && <p className={styles.note}>Finding open times…</p>}
      {error && !adding && <p role="alert" className={styles.error}>{error}</p>}
      {status && !busy && <p role="status" className={styles.note}>{status}</p>}
      {adding && <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
        <form method="dialog" onSubmit={e => { e.preventDefault(); void confirm(); }}>
          <h3 id={titleId}>Add to your plan</h3>
          <p className={styles.what}>{adding.item.text}</p>

          <label className={styles.field}><span>Course</span>
            <select value={adding.course} onChange={e => pickCourse(e.target.value)} required>
              <option value="" disabled>Choose a course</option>
              {adding.planner.courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={PERSONAL}>Personal (not for a course)</option>
            </select>
          </label>
          {!adding.planner.guess && !adding.course && <p className={styles.hint}>Soma couldn’t tell which course this is for.</p>}

          <fieldset className={styles.field}><legend>How long</legend>
            <div className={styles.chips}>{lengths.map(m => <button key={m} type="button" aria-pressed={adding.minutes === m} onClick={() => pickLength(m)}>{hm(m)}</button>)}</div>
            <p className={styles.hint}>Suggested: {hm(suggestion!.minutes)}, {suggestion!.basis}.</p>
          </fieldset>

          <fieldset className={styles.field}><legend>When</legend>
            {slots.length === 0 && <p className={styles.hint}>No open time this week fits {hm(adding.minutes)}. Pick a shorter length, or add it with no set time.</p>}
            <div className={styles.times}>
              {slots.map((slot, i) => <label key={`${slot.day} ${slot.time}`}><input type="radio" name="when" checked={adding.slot === i} onChange={() => setAdding(a => a && { ...a, slot: i })} />{slot.label}</label>)}
              <label><input type="radio" name="when" checked={adding.slot === -1 || (slots.length === 0)} onChange={() => setAdding(a => a && { ...a, slot: -1 })} />No set time: add it to today’s list</label>
            </div>
          </fieldset>

          {error && <p role="alert" className={styles.error}>{error}</p>}
          <div className={styles.dialogActions}>
            <button type="button" onClick={close} disabled={busy !== null}>Cancel</button>
            <button type="submit" className={styles.confirm} disabled={busy !== null || !adding.course}>{busy ? 'Adding…' : 'Add'}</button>
          </div>
        </form>
      </dialog>}
    </section>
  );
}
