import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { formatHourLabel } from '../../lib/timeFormat';
import { addDump, loadDump, removeDump } from '../../lib/brainDump';
import styles from './BrainDump.module.css';

/**
 * Brain dump: a list for getting everything out of your head, with no AI.
 * Enter adds a line (pasting several lines adds each). + opens "Add to your
 * plan": the course, how long, and when, each filled in with Soma's guess
 * (LiveDashboard's `onPlan`, no AI) so Add is one tap, and each can be
 * changed. "When" is the day's calendar: what's already on it, the open
 * time, and a marker for this line that can be tapped or dragged into place. A course has to be picked when none is named in the words. The list
 * is saved to the student's account (lib/brainDump.ts) and read again when
 * the tab comes back into view, so every device shows the same one; this
 * browser keeps a copy to show at once. Until the table exists it lives in
 * the browser only. The first time a browser reaches the table, the lines it
 * kept on its own are added to the account's list.
 */

type Item = { id: string; text: string };
/** A start on one of the next seven days, in minutes from that day's midnight. */
export type DumpSlot = { day: number; start: number };
/** One day of the calendar: what's on it, and the open stretches that fit the length asked for (minutes from midnight). */
export type DumpDay = { day: number; name: string; busy: { title: string; start: number; end: number; external: boolean; suggested: boolean }[]; free: [number, number][] };
/** What + needs for one line: the courses and Soma's guesses, the week's calendar, and saving the choice (it says where it went). */
export type DumpPlanner = {
  courses: { id: string; name: string }[];
  guess: string | null;
  estimate: (courseId: string | null) => { minutes: number; basis: string };
  days: (minutes: number) => DumpDay[];
  clock: (minutes: number) => string;
  add: (choice: { courseId: string | null; minutes: number; slot: DumpSlot | null }) => Promise<string>;
};
type Props = { userId: string; onPlan: (text: string) => Promise<DumpPlanner> };
/** `day` null: no set time, because the student chose that (`untimed`) or nothing this week fits. */
type Adding = { item: Item; planner: DumpPlanner; course: string; minutes: number; picked: boolean; untimed: boolean; day: number | null; start: number | null };

const STEP = 15, HOUR_PX = 44;
/** Every start a length can take on a day: each open stretch's own start, then each quarter hour that still fits. */
const startsOf = (d: DumpDay | undefined, minutes: number) => {
  const out: number[] = [];
  for (const [a, z] of d?.free ?? []) for (let s = a; s + minutes <= z; s = Math.floor(s / STEP) * STEP + STEP) out.push(s);
  return out;
};
const nearest = (starts: number[], to: number) => starts.reduce((best, s) => Math.abs(s - to) < Math.abs(best - to) ? s : best, starts[0]);
/** The start on `day` nearest `near` (else its first); with no day, or none there, the week's first open time. */
function pick(days: DumpDay[], minutes: number, day: number | null, near?: number): { day: number | null; start: number | null } {
  const there = day === null ? [] : startsOf(days[day], minutes);
  if (there.length) return { day, start: near === undefined ? there[0] : nearest(there, near) };
  for (const d of days) { const s = startsOf(d, minutes); if (s.length) return { day: d.day, start: s[0] }; }
  return { day: null, start: null };
}

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
  const track = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const placing = useRef(false);
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
      const course = planner.guess ?? '', minutes = planner.estimate(planner.guess).minutes;
      setAdding({ item, planner, course, minutes, picked: false, untimed: false, ...pick(planner.days(minutes), minutes, null) });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not find open times. Please retry.'); }
    finally { setBusy(null); }
  }
  // A new length keeps the day and the time as near as it can; a new course re-suggests the length, unless the student chose one.
  const relength = (a: Adding, minutes: number): Adding =>
    a.untimed ? { ...a, minutes } : { ...a, minutes, ...pick(a.planner.days(minutes), minutes, a.day, a.start ?? undefined) };
  const pickCourse = (course: string) => setAdding(a => a && (a.picked ? { ...a, course } : relength({ ...a, course }, a.planner.estimate(course === PERSONAL ? null : course || null).minutes)));
  const pickLength = (minutes: number) => setAdding(a => a && { ...relength(a, minutes), picked: true });

  async function confirm() {
    if (!adding || !adding.course) return;
    const { item, planner, course, minutes, day, start } = adding;
    setBusy(item.id); setError('');
    try {
      const where = await planner.add({ courseId: course === PERSONAL ? null : course, minutes, slot: day !== null && start !== null ? { day, start } : null });
      close();
      const at = current.current.findIndex(i => i.id === item.id);
      keep(current.current.filter(i => i.id !== item.id));
      setStatus(`Added “${item.text}” ${where}.`);
      await persist(() => removeDump(userId, item.id), () => putBack(item, at), `“${item.text}” is on your plan, but couldn’t be taken off this list. Remove it with ×.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add it. Please retry.'); }
    finally { setBusy(null); }
  }

  const suggestion = adding && adding.planner.estimate(adding.course && adding.course !== PERSONAL ? adding.course : null);
  const days = useMemo(() => adding ? adding.planner.days(adding.minutes) : [], [adding?.planner, adding?.minutes]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = adding?.day != null ? days[adding.day] : undefined;
  const starts = shown ? startsOf(shown, adding!.minutes) : [];
  // The calendar's hours: 8 AM to 10 PM, widened to whatever is on the day.
  const from = shown ? Math.max(0, Math.floor(Math.min(8 * 60, ...shown.free.map(f => f[0]), ...shown.busy.map(b => b.start)) / 60) * 60) : 0;
  const to = shown ? Math.ceil(Math.max(22 * 60, ...shown.free.map(f => f[1]), ...shown.busy.map(b => b.end)) / 60) * 60 : 0;
  const px = (m: number) => ((m - from) / 60) * HOUR_PX;
  const step = (by: number) => setAdding(a => a && a.start !== null ? { ...a, start: starts[starts.indexOf(a.start) + by] ?? a.start } : a);
  function placeAt(e: PointerEvent<HTMLDivElement>) {
    const rect = track.current?.getBoundingClientRect(); if (!rect || !starts.length || !adding) return;
    const want = from + ((e.clientY - rect.top) / HOUR_PX) * 60 - adding.minutes / 2;
    setAdding(a => a && { ...a, start: nearest(starts, want) });
  }
  useEffect(() => { marker.current?.scrollIntoView?.({ block: 'nearest' }); }, [adding?.day, adding?.start]);
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
            <div className={styles.chips}>
              {days.map(d => <button key={d.day} type="button" aria-pressed={adding.day === d.day} disabled={!startsOf(d, adding.minutes).length}
                onClick={() => setAdding(a => a && { ...a, untimed: false, ...pick(days, a.minutes, d.day) })}>{d.name}</button>)}
              <button type="button" aria-pressed={adding.day === null} onClick={() => setAdding(a => a && { ...a, untimed: true, day: null, start: null })}>No set time</button>
            </div>
            {!days.some(d => startsOf(d, adding.minutes).length) && <p className={styles.hint}>No open time this week fits {hm(adding.minutes)}. Pick a shorter length, or add it with no set time.</p>}
            {adding.day === null ? <p className={styles.hint}>It goes on today’s list with no time; you can give it one later.</p> : shown && adding.start !== null && <>
              <div className={styles.picked}>
                <button type="button" aria-label="Earlier" title="Earlier" disabled={starts.indexOf(adding.start) <= 0} onClick={() => step(-1)}><ChevronLeft size={15} /></button>
                <p aria-live="polite">{shown.name}, {adding.planner.clock(adding.start)}–{adding.planner.clock(adding.start + adding.minutes)}</p>
                <button type="button" aria-label="Later" title="Later" disabled={starts.indexOf(adding.start) >= starts.length - 1} onClick={() => step(1)}><ChevronRight size={15} /></button>
              </div>
              <div className={styles.calendar}>
                <div ref={track} data-day-track="" className={styles.track} style={{ height: px(to) }} title="Tap or drag to pick a time"
                  onPointerDown={e => { placing.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); placeAt(e); }}
                  onPointerMove={e => { if (placing.current) placeAt(e); }}
                  onPointerUp={() => { placing.current = false; }} onPointerCancel={() => { placing.current = false; }}>
                  {Array.from({ length: (to - from) / 60 + 1 }, (_, i) => <div key={i} className={styles.hour} style={{ top: px(from + i * 60) }}><span>{formatHourLabel((from / 60 + i) % 24)}</span></div>)}
                  {shown.free.map(([a, z]) => <div key={a} className={styles.open} style={{ top: px(a), height: px(z) - px(a) }} />)}
                  {shown.busy.map((b, i) => <div key={i} className={`${styles.busy}${b.suggested ? ` ${styles.busySuggested}` : ''}${b.external ? ` ${styles.busyEvent}` : ''}`} style={{ top: px(b.start), height: Math.max(14, px(b.end) - px(b.start)) }}><span>{b.title}</span></div>)}
                  <div ref={marker} className={styles.marker} style={{ top: px(adding.start), height: px(adding.start + adding.minutes) - px(adding.start) }}>
                    <strong>{adding.item.text}</strong><span>{adding.planner.clock(adding.start)}–{adding.planner.clock(adding.start + adding.minutes)}</span>
                  </div>
                </div>
              </div>
              <p className={styles.hint}>Open time is shaded. Tap or drag on the calendar to move it.</p>
            </>}
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
