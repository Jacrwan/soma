import { formatClock } from '../../lib/timeFormat';
import styles from './DashboardV2.module.css';

export type MovedBlock = { id: string; todoId?: string; title: string; from: string; to: string };

type Props = {
  reason: 'reclaim' | 'overrun';
  moves: MovedBlock[];
  busy: boolean;
  onUndo: () => void;
  onDismiss: () => void;
};

const start = (range: string) => formatClock(range.split('–')[0]);

/**
 * What the within-day reclaim just moved, on today's plan: each block by
 * name, from and to, with Undo. It stays until dismissed. (It used to be one
 * line above the page, "Moved 2 blocks that hadn't been started.", gone after
 * eight seconds, with no way back.)
 */
export default function MoveNote({ reason, moves, busy, onUndo, onDismiss }: Props) {
  if (!moves.length) return null;
  const heading = reason === 'overrun'
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
              {start(m.from)} <span aria-hidden="true">→</span><span className={styles.srOnly}> to</span>{' '}
              {m.to ? start(m.to) : 'off the clock, waits for catch-up'}
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.moveNoteActions}>
        <button type="button" onClick={onUndo} disabled={busy}>Undo</button>
        <button type="button" onClick={onDismiss} aria-label="Dismiss the moved-blocks note">Dismiss</button>
      </div>
    </div>
  );
}
