/**
 * Blocks whose time the student chose: a time they told Soma ("from 3 to 4"),
 * or one they set by hand in Edit plan. Soma moves the student's other blocks
 * to make room for new work ("move stuff around unless I've said a specific
 * time"); these it leaves where they are. Remembered per task, date and start,
 * so a block that moves somewhere the student didn't choose is no longer
 * pinned. Browser storage only, like skipped events: a cleared store just
 * means Soma may suggest moving one, which still needs Accept.
 */
const KEY = 'soma_pinned_blocks';

type Stored = { userId: string; keys: string[] };

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** A task's block on a date at a start time ("14:30"). */
export const pinKey = (todoId: string, date: string, start: string) => `${todoId}@${date}T${start}`;

function read(userId: string): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    if (!stored || stored.userId !== userId || !Array.isArray(stored.keys)) return [];
    // Past days drop out.
    return stored.keys.filter(k => typeof k === 'string' && k.slice(k.lastIndexOf('@') + 1, k.lastIndexOf('@') + 11) >= today());
  } catch { return []; }
}

export function pinnedKeys(userId: string): Set<string> {
  return new Set(read(userId));
}

export function pinBlock(userId: string, key: string) {
  const keys = new Set(read(userId));
  keys.add(key);
  try { localStorage.setItem(KEY, JSON.stringify({ userId, keys: [...keys] })); } catch { /* not remembered on this device */ }
}
