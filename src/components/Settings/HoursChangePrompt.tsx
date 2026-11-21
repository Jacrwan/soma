import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { storage } from '../../lib/storage';
import { pinnedKeys } from '../../lib/pinnedBlocks';
import { outsideHours, placeInside, type Outside } from '../../lib/hoursChange';
import { dateAt, readPlan, savePlanBlock, type Snapshot } from '../DashboardV2/liveData';
import { formatClockRange } from '../../lib/timeFormat';
import styles from './SettingsTab.module.css';

/**
 * Asked after the study hours change (2026-11-21): blocks already planned
 * outside the new hours are listed, and move only when the student says so.
 * Blocks whose time they set themselves start unticked.
 */
export default function HoursChangePrompt({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<{ userId: string; snapshot: Snapshot; outside: Outside[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId) return onDone();
      const now = new Date(), origin = dateAt(now, 0);
      const snapshot = await readPlan(userId, origin, 0, 7).catch(() => null);
      if (!live) return;
      if (!snapshot || snapshot.calendarError) return onDone();
      const outside = outsideHours(snapshot, storage.getSomaSettings().studyWindow, origin, now, pinnedKeys(userId));
      if (!outside.length) return onDone();
      setPicked(new Set(outside.filter(o => !o.pinned).map(o => String(o.block.id))));
      setState({ userId, snapshot, outside });
    })();
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return null;
  const dayName = (day: number) => day === 0 ? 'Today' : day === 1 ? 'Tomorrow' : dateAt(new Date(), day).toLocaleDateString(undefined, { weekday: 'short' });

  async function move() {
    if (!state) return;
    setBusy(true);
    try {
      const now = new Date(), origin = dateAt(now, 0), pins = pinnedKeys(state.userId);
      const moving = state.outside.filter(o => picked.has(String(o.block.id))).map(o => o.block);
      const { moves, left } = placeInside(state.snapshot, moving, storage.getSomaSettings(), origin, now, pins);
      for (const m of moves) await savePlanBlock(state.userId, origin, { ...m.block, day: m.day, time: m.time, minutes: m.block.minutes }, state.snapshot);
      window.dispatchEvent(new Event('soma_todos_changed'));
      setResult(`Moved ${moves.length} ${moves.length === 1 ? 'block' : 'blocks'} inside your study hours.${left.length ? ` No room this week for ${left.map(b => `“${b.title}”`).join(', ')}, so ${left.length === 1 ? 'it stays' : 'they stay'} where ${left.length === 1 ? 'it is' : 'they are'}.` : ''}`);
    } catch (e) { setResult(e instanceof Error ? e.message : 'Could not move them. Nothing else changed.'); }
    finally { setBusy(false); }
  }

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBox} role="dialog" aria-modal="true" aria-labelledby="hours-change-title">
        <h2 id="hours-change-title" className={styles.modalTitle}>
          {state.outside.length === 1 ? '1 block is' : `${state.outside.length} blocks are`} outside your new study hours
        </h2>
        {result ? <>
          <p role="status">{result}</p>
          <div className={styles.saveRow}><button type="button" className={styles.saveBtn} onClick={onDone}>Done</button></div>
        </> : <>
          <p className={styles.subsectionHint}>Move them to open time inside your hours? Blocks you set a time for yourself are left unticked.</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, maxHeight: 260, overflow: 'auto' }}>
            {state.outside.map(o => {
              const id = String(o.block.id);
              return <li key={id}><label style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <input type="checkbox" checked={picked.has(id)} disabled={busy} onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(id); else n.delete(id); return n; })} />
                <span>{o.block.title} <span className={styles.subsectionHint}>· {dayName(o.block.day)} {formatClockRange(o.block.time)}{o.pinned ? ' · you set this time' : ''}</span></span>
              </label></li>;
            })}
          </ul>
          <div className={styles.saveRow} style={{ gap: 8 }}>
            <button type="button" disabled={busy} onClick={onDone}>Leave them</button>
            <button type="button" className={styles.saveBtn} disabled={busy || !picked.size} onClick={() => void move()}>{busy ? 'Moving…' : 'Move them'}</button>
          </div>
        </>}
      </div>
    </div>
  );
}
