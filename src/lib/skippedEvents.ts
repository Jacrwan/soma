/**
 * Calendar events the student said they're skipping ("I'm not going to OH or
 * RUF"). Soma used to have to repeat the skip in every reply, and two replies
 * later it forgot and planned around the class again. Remembered here per
 * event and date, shared by the dashboard and the AI page, until that date
 * has passed. Browser storage only: it's a convenience for this device, and a
 * blocked or cleared store just means Soma asks again.
 */
const KEY = 'soma_skipped_events';
export const SKIPS_CHANGED = 'soma_skips_changed';

type Stored = { userId: string; keys: string[] };

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** An event on a date. Plan ids end in the day's offset from today, which
 *  shifts at midnight, so that part is left out. */
export const eventKey = (id: string | number, date: string) => `${String(id).replace(/:-?\d+$/, '')}@${date}`;

function read(userId: string): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    if (!stored || stored.userId !== userId || !Array.isArray(stored.keys)) return [];
    return stored.keys.filter(k => typeof k === 'string' && k.slice(k.lastIndexOf('@') + 1) >= today());
  } catch { return []; }
}

export function skippedKeys(userId: string): Set<string> {
  return new Set(read(userId));
}

export function updateSkipped(userId: string, add: string[], remove: string[] = []) {
  if (!add.length && !remove.length) return;
  const keys = new Set(read(userId));
  add.forEach(k => keys.add(k));
  remove.forEach(k => keys.delete(k));
  try { localStorage.setItem(KEY, JSON.stringify({ userId, keys: [...keys] })); } catch { /* remembered for this reply only */ }
  window.dispatchEvent(new Event(SKIPS_CHANGED));
}
