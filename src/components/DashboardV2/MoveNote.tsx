import { formatClock } from '../../lib/timeFormat';
import styles from './DashboardV2.module.css';

/** `fromLabel`/`toLabel`: a day and time ("Tue 4:00 PM"), for task sittings that move between days. */
export type MovedBlock = { id: string; todoId?: string; title: string; from: string; to: string; fromLabel?: string; toLabel?: string };

type Props = {
  reason: 'reclaim' | 'overrun' | 'tasks';
  moves: MovedBlock[];
  busy: boolean;
  onUndo?: () => void;
  onDismiss: () => void;
  /** Tasks that don't fit before they're due (reason 'tasks'). */
  atRisk?: number;
  onTasks?: () => void;
};

const start = (range: string) => formatClock(range.split('–')[0]);

/**
 * What the within-day reclaim just moved, on today's plan: each block by
 * name, from and to, with Undo. It stays until dismissed. (It used to be one
 * line above the page, "Moved 2 blocks that hadn't been started.", gone after
 * eight seconds, with no way back.)
 */
export default function MoveNote({ reason, moves, busy, onUndo, onDismiss, atRisk = 0, onTasks }: Props) {
  if (!moves.length && !atRisk) return null;
  const heading = reason === 'tasks'
    ? moves.length ? `Moved ${moves.length === 1 ? 'a sitting' : `${moves.length} sittings`} that had to move` : `${atRisk === 1 ? 'A task doesn’t' : `${atRisk} tasks don’t`} fit before ${atRisk === 1 ? 'it’s' : 'they’re'} due`
    : reason === 'overrun'
    ? 'You finished late, so the rest of today moved'
    : `Moved ${moves.length === 1 ? 'a block' : `${moves.length} blocks`} you hadn’t started`;
  return (
    <div className={styles.moveNote} role="status" aria-live="polite">
      <p className={styles.moveNoteHeading}>{heading}</p>
      <ul>
        {moves.map(m => (
          <li key={m.id}>
            <span className={styles.moveNoteTitle}>{m.title}</span>
            <span className={styles.moveNoteTimes}>
              {m.fromLabel ?? start(m.from)} <span aria-hidden="true">→</span><span className={styles.srOnly}> to</span>{' '}
              {m.toLabel ?? (m.to ? start(m.to) : 'off the clock, waits for catch-up')}
            </span>
          </li>
        ))}
      </ul>
      {reason === 'tasks' && moves.length > 0 && atRisk > 0 && <p className={styles.moveNoteHeading}>{atRisk === 1 ? 'A task doesn’t' : `${atRisk} tasks don’t`} fit before {atRisk === 1 ? 'it’s' : 'they’re'} due.</p>}
      <div className={styles.moveNoteActions}>
        {onUndo && <button type="button" onClick={onUndo} disabled={busy}>Undo</button>}
        {onTasks && <button type="button" onClick={onTasks}>See tasks</button>}
        <button type="button" onClick={onDismiss} aria-label="Dismiss the moved-blocks note">Dismiss</button>
      </div>
    </div>
  );
}
