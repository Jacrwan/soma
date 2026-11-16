import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { formatHourLabel } from '../../lib/timeFormat';
import { addDump, loadDump, removeDump } from '../../lib/brainDump';
import styles from './BrainDump.module.css';

/**
 * Brain dump: a list for getting everything out of your head, with no AI.
 * Enter adds a line (pasting several lines adds each). + opens "Add to your
 * plan": the course, and when, filled in with Soma's guess (LiveDashboard's
 * `onPlan`, no AI) so Add is one tap. "When" is a day's calendar, and the
 * line's block on it is the picker (2026-11-16, the owner: "stop it with
 * these preset hours and dates, let the user choose"): drag it anywhere,
 * over anything already planned and past study hours, drag its bottom edge
 * for the length, tap to start it somewhere else, or type the times. What's
 * on the day and the open study time are drawn behind it as a guide; nothing
 * there blocks it. A course has to be picked when none is named in the
 * words. The list is saved to the student's account (lib/brainDump.ts) and
 * read again when the tab comes back into view, so every device shows the
 * same one; this browser keeps a copy to show at once. Until the table exists
 * it lives in the browser only. The first time a browser reaches the table,
 * the lines it kept on its own are added to the account's list.
 */

type Item = { id: string; text: string };
/** A start on a coming day, in minutes from that day's midnight. */
export type DumpSlot = { day: number; start: number };
/** One day of the calendar: what's on it, and its open study time (minutes from midnight). */
export type DumpDay = { day: number; name: string; busy: { title: string; start: number; end: number; external: boolean; suggested: boolean }[]; free: [number, number][] };
/** What + needs for one line: the courses and Soma's guesses, the coming days' calendar, and saving the choice (it says where it went). */
export type DumpPlanner = {
  courses: { id: string; name: string }[];
  guess: string | null;
  estimate: (courseId: string | null) => { minutes: number; basis: string };
  days: () => DumpDay[];
  /** Minutes past midnight now, for today. */
  now: number;
  /** The usual study hours [open, close], or null when they're off. A guide only. */
  window: [number, number] | null;
  clock: (minutes: number) => string;
  add: (choice: { courseId: string | null; minutes: number; slot: DumpSlot | null }) => Promise<string>;
};
/** `onMakeTask`: open it as a task with a due date and details instead; true once it's saved. */
type Props = { userId: string; onPlan: (text: string) => Promise<DumpPlanner>; onMakeTask?: (text: string, courseId: string | null) => Promise<boolean> };
type Adding = { item: Item; planner: DumpPlanner; days: DumpDay[]; course: string; minutes: number; picked: boolean; untimed: boolean; asTask: boolean; day: number; start: number };

const SNAP = 5, HOUR_PX = 44, SHORTEST = 15, DAY = 1440, LONGEST = 12 * 60;
const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Where it starts: the first open study time that fits, from now; else the next hour today (or tomorrow morning, late at night). */
function firstFit(days: DumpDay[], minutes: number, now: number): { day: number; start: number } {
  for (const d of days) for (const [a, z] of d.free) {
    const from = d.day === 0 ? Math.max(a, Math.ceil(now / SNAP) * SNAP) : a;
    if (z - from >= minutes) return { day: d.day, start: from };
  }
  const next = Math.ceil((now + 1) / 60) * 60;
  return next + minutes <= DAY ? { day: 0, start: next } : { day: Math.min(1, days.length - 1), start: 9 * 60 };
}
const asInput = (m: number) => `${String(Math.floor((m % DAY) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromInput = (v: string) => { const [h, m] = v.split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };

const PERSONAL = 'personal';
const hm = (m: number) => m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`;

const MAX_ITEMS = 100, MAX_LENGTH = 200;
const read = (key: string): Item[] => { try { const v = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(v) ? v.filter(i => typeof i?.id === 'string' && typeof i?.text === 'string') : []; } catch { return []; } };
const write = (key: string, items: Item[]) => { try { localStorage.setItem(key, JSON.stringify(items)); } catch { /* kept for this visit only */ } };
const flagged = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const flag = (key: string) => { try { localStorage.setItem(key, '1'); } catch { /* uploads again next time; saving the same line twice is harmless */ } };

export default function BrainDump({ userId, onPlan, onMakeTask }: Props) {
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
  /** A drag on the calendar: moving the block (offset from its start) or stretching its end. */
  const drag = useRef<{ mode: 'move' | 'resize'; offset: number } | null>(null);
  // The calendar's hours stay put while dragging: widening them under the
  // pointer, and scrolling to the block, made it shake (2026-11-17).
  const frozen = useRef<{ to: number } | null>(null);
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
      const course = planner.guess ?? '', minutes = planner.estimate(planner.guess).minutes, days = planner.days();
      setAdding({ item, planner, days, course, minutes, picked: false, untimed: false, asTask: false, ...firstFit(days, minutes, planner.now) });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not find open times. Please retry.'); }
    finally { setBusy(null); }
  }
  // A new course re-suggests the length, unless the student set one; the start stays where it is.
  const pickCourse = (course: string) => setAdding(a => a && (a.picked ? { ...a, course } : { ...a, course, minutes: clamp(a.planner.estimate(course === PERSONAL ? null : course || null).minutes, SHORTEST, LONGEST) }));

  async function confirm() {
    if (adding?.asTask) { await makeTask(); return; }
    if (!adding || !adding.course) return;
    const { item, planner, course, minutes, day, start, untimed } = adding;
    setBusy(item.id); setError('');
    try {
      const where = await planner.add({ courseId: course === PERSONAL ? null : course, minutes, slot: untimed ? null : { day, start } });
      close();
      const at = current.current.findIndex(i => i.id === item.id);
      keep(current.current.filter(i => i.id !== item.id));
      setStatus(`Added “${item.text}” ${where}.`);
      await persist(() => removeDump(userId, item.id), () => putBack(item, at), `“${item.text}” is on your plan, but couldn’t be taken off this list. Remove it with ×.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add it. Please retry.'); }
    finally { setBusy(null); }
  }

  /** "It has a due date": the line becomes a task Soma schedules, with details; it leaves this list once saved. */
  async function makeTask() {
    if (!adding || !onMakeTask) return;
    const { item, course } = adding;
    close();
    const saved = await onMakeTask(item.text, course && course !== PERSONAL ? course : null);
    if (!saved) return;
    const at = current.current.findIndex(i => i.id === item.id);
    keep(current.current.filter(i => i.id !== item.id));
    setStatus(`“${item.text}” is a task now. Soma placed its sittings.`);
    await persist(() => removeDump(userId, item.id), () => putBack(item, at), `“${item.text}” is a task now, but couldn’t be taken off this list. Remove it with ×.`);
  }

  const suggestion = adding && adding.planner.estimate(adding.course && adding.course !== PERSONAL ? adding.course : null);
  const shown = adding ? adding.days[adding.day] : undefined;
  const end = adding ? adding.start + adding.minutes : 0;
  // The whole day, midnight to midnight (and on, for a block that runs past
  // it), scrolled to the block: hours that never shift under the pointer.
  const from = 0;
  const to = Math.max(frozen.current?.to ?? 0, shown && adding ? Math.min(DAY + LONGEST, Math.ceil(Math.max(DAY, end, ...shown.busy.map(b => b.end)) / 60) * 60) : 0);
  const px = (m: number) => ((m - from) / 60) * HOUR_PX;
  const minuteAt = (y: number) => { const rect = track.current?.getBoundingClientRect(); return rect ? from + ((y - rect.top) / HOUR_PX) * 60 : 0; };
  // It may start any time of the day and run past midnight, as a block can.
  // Unchanged when the snapped time is the same, so a drag only redraws on a new 5-minute step.
  const moveTo = (a: Adding, start: number): Adding => { const next = clamp(snap(start), 0, DAY - SNAP); return next === a.start ? a : { ...a, start: next }; };
  const resizeTo = (a: Adding, endAt: number): Adding => { const next = clamp(snap(endAt) - a.start, SHORTEST, LONGEST); return next === a.minutes ? a : { ...a, picked: true, minutes: next }; };
  function pointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!adding) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    frozen.current = { to };
    const m = minuteAt(e.clientY), edge = (10 / HOUR_PX) * 60;
    if (m >= adding.start && m <= end) {
      // The grab point stays put under the pointer, for the edge as for the block.
      drag.current = m >= end - edge ? { mode: 'resize', offset: end - m } : { mode: 'move', offset: m - adding.start };
      return;
    }
    // A tap on the calendar starts the block there.
    drag.current = { mode: 'move', offset: adding.minutes / 2 };
    setAdding(a => a && moveTo(a, m - a.minutes / 2));
  }
  function pointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current; if (!d) return;
    const m = minuteAt(e.clientY);
    setAdding(a => a && (d.mode === 'move' ? moveTo(a, m - d.offset) : resizeTo(a, m + d.offset)));
  }
  const stepDay = (by: number) => setAdding(a => a && { ...a, day: clamp(a.day + by, 0, a.days.length - 1) });
  const typeStart = (v: string) => { const m = fromInput(v); if (m !== null) setAdding(a => a && moveTo(a, m)); };
  const typeEnd = (v: string) => { const m = fromInput(v); if (m !== null) setAdding(a => a && resizeTo(a, m <= a.start ? m + DAY : m)); };
  // To the block when it opens, changes day or gets a typed time; never mid-drag.
  useEffect(() => { if (!drag.current) marker.current?.scrollIntoView?.({ block: 'center', behavior: 'instant' }); }, [adding?.day, adding?.start]);
  // Guides, never limits: what it overlaps, and whether it's outside the usual hours.
  const overlaps = shown && adding ? shown.busy.filter(b => b.start < end && b.end > adding.start).map(b => b.title) : [];
  const outside = adding?.planner.window && (adding.start < adding.planner.window[0] || end > adding.planner.window[1]);
  const passed = adding && adding.day === 0 && adding.start < adding.planner.now;

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
            <select value={adding.course} onChange={e => pickCourse(e.target.value)} required={!adding.asTask}>
              <option value="" disabled>Choose a course</option>
              {adding.planner.courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={PERSONAL}>Personal (not for a course)</option>
            </select>
          </label>
          {!adding.planner.guess && !adding.course && <p className={styles.hint}>Soma couldn’t tell which course this is for.</p>}

          {!adding.asTask && <fieldset className={styles.field} disabled={adding.untimed}><legend>When</legend>
            <div className={styles.picked}>
              <button type="button" aria-label="Previous day" title="Previous day" disabled={adding.day <= 0} onClick={() => stepDay(-1)}><ChevronLeft size={15} /></button>
              <p aria-live="polite">{adding.untimed ? 'No set time' : `${shown?.name}, ${adding.planner.clock(adding.start)}–${adding.planner.clock(end % DAY)}`}</p>
              <button type="button" aria-label="Next day" title="Next day" disabled={adding.day >= adding.days.length - 1} onClick={() => stepDay(1)}><ChevronRight size={15} /></button>
            </div>
            {!adding.untimed && shown && <>
              <div className={styles.calendar}>
                <div ref={track} data-day-track="" className={styles.track} style={{ height: px(to) }} title="Drag the block to move it, its bottom edge to change the length"
                  onPointerDown={pointerDown} onPointerMove={pointerMove}
                  onPointerUp={() => { drag.current = null; frozen.current = null; setAdding(a => a && { ...a }); }} onPointerCancel={() => { drag.current = null; frozen.current = null; setAdding(a => a && { ...a }); }}>
                  {Array.from({ length: (to - from) / 60 + 1 }, (_, i) => <div key={i} className={styles.hour} style={{ top: px(from + i * 60) }}><span>{formatHourLabel((from / 60 + i) % 24)}</span></div>)}
                  {shown.free.map(([a, z]) => <div key={a} className={styles.open} style={{ top: px(a), height: px(z) - px(a) }} />)}
                  {shown.busy.map((b, i) => <div key={i} className={`${styles.busy}${b.suggested ? ` ${styles.busySuggested}` : ''}${b.external ? ` ${styles.busyEvent}` : ''}`} style={{ top: px(b.start), height: Math.max(14, px(b.end) - px(b.start)) }}><span>{b.title}</span></div>)}
                  <div ref={marker} className={styles.marker} style={{ top: px(adding.start), height: px(end) - px(adding.start) }}>
                    <strong>{adding.item.text}</strong><span>{adding.planner.clock(adding.start)}–{adding.planner.clock(end % DAY)}</span>
                    <i className={styles.handle} aria-hidden="true" />
                  </div>
                </div>
              </div>
              <div className={styles.times}>
                <label><span>Start</span><input type="time" step={300} value={asInput(adding.start)} onChange={e => typeStart(e.target.value)} /></label>
                <label><span>End</span><input type="time" step={300} value={asInput(end)} onChange={e => typeEnd(e.target.value)} /></label>
              </div>
              <p className={`${styles.hint} ${styles.calendarHint}`}>
                {[overlaps.length ? `Overlaps ${overlaps.join(', ')}` : '', outside ? 'Outside your usual study hours' : '', passed ? 'That time has passed' : ''].filter(Boolean).join(' · ')
                  || `Drag it anywhere; drag its bottom edge for the length. Soma suggests ${hm(suggestion!.minutes)}, ${suggestion!.basis}.`}
              </p>
            </>}
          </fieldset>}

          <div className={styles.options}>
            <label><input type="checkbox" checked={adding.untimed} disabled={adding.asTask} onChange={e => setAdding(a => a && { ...a, untimed: e.target.checked })} /> No set time</label>
            {onMakeTask && <label><input type="checkbox" checked={adding.asTask} onChange={e => setAdding(a => a && { ...a, asTask: e.target.checked })} /> Make it a task <span className={styles.optionNote}>with a due date; Soma schedules it</span></label>}
          </div>

          {error && <p role="alert" className={styles.error}>{error}</p>}
          <div className={styles.dialogActions}>
            <button type="button" onClick={close} disabled={busy !== null}>Cancel</button>
            <button type="submit" className={styles.confirm} disabled={busy !== null || (!adding.course && !adding.asTask)}>{busy ? 'Adding…' : adding.asTask ? 'Continue' : 'Add'}</button>
          </div>
        </form>
      </dialog>}
    </section>
  );
}
