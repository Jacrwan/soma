/**
 * A local mirror of the running focus timer.
 *
 * The authoritative record lives in Supabase's `active_timer`, which is what
 * makes a session recoverable on another device. But recovering from it on a
 * page load costs an auth call plus a query, and any failure along the way —
 * a slow session restore, an offline moment, a timestamp column returning a
 * value without a zone — leaves the user staring at a timer that reset itself.
 *
 * So the same state is mirrored here, keyed to absolute epoch milliseconds so
 * it cannot be misread across time zones. On load we restore from this
 * immediately and reconcile with Supabase when it answers.
 */

const KEY = 'soma_active_timer';

export interface TimerMirror {
  /** Whose timer this is, so a second account on the device never inherits it. */
  userId: string | null;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  task: string;
  sessionStartTimeISO: string;
  /** Seconds banked before the current run segment. */
  accumulatedSeconds: number;
  isPaused: boolean;
  /** Date.now() when this snapshot was written. */
  markedAtMs: number;
}

export function readMirror(): TimerMirror | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as TimerMirror;
    if (!m || typeof m.subjectId !== 'string' || typeof m.markedAtMs !== 'number') return null;
    return m;
  } catch {
    return null; // blocked or corrupted storage is simply "no mirror"
  }
}

export function writeMirror(m: TimerMirror): void {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* non-fatal */ }
}

export function clearMirror(): void {
  try { localStorage.removeItem(KEY); } catch { /* non-fatal */ }
}

/**
 * Seconds elapsed for a mirrored session right now. A paused session holds at
 * whatever it had banked; a running one keeps counting across the reload.
 */
export function elapsedFromMirror(m: TimerMirror, now = Date.now()): number {
  if (m.isPaused) return Math.max(0, m.accumulatedSeconds);
  const sinceMark = Math.floor((now - m.markedAtMs) / 1000);
  // A clock that moved backwards must never produce a negative timer.
  return Math.max(0, m.accumulatedSeconds + Math.max(0, sinceMark));
}
