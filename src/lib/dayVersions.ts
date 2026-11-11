/**
 * Versions of one day's plan, kept in this browser so the dashboard can
 * compare the latest day with an earlier pass. No server, no model.
 */

export type VersionBlock = { id: string; title: string; subject: string; time: string; minutes: number };
export type DayVersion = {
  id: string;
  at: string;
  reason: 'original' | 'reclaim' | 'overrun' | 'undo';
  blocks: VersionBlock[];
};

const MAX = 12;
const keyOf = (userId: string, date: string) => `soma_day_versions:${userId}:${date}`;

export function samePlan(a: VersionBlock[], b: VersionBlock[]) {
  const sig = (xs: VersionBlock[]) => [...xs].map(x => `${x.id}|${x.time}`).sort().join('\n');
  return sig(a) === sig(b);
}

export function versionLabel(v: DayVersion) {
  const clock = new Date(v.at);
  const time = Number.isNaN(+clock) ? '' : clock.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const name = v.reason === 'original' ? 'Original' : v.reason === 'overrun' ? 'After you finished a block' : v.reason === 'undo' ? 'After you undid a move' : 'After a missed block';
  return time ? `${name} · ${time}` : name;
}

/** Append a version when the times actually changed. The original is kept. */
export function pushVersion(list: DayVersion[], next: { at: string; reason: DayVersion['reason']; blocks: VersionBlock[] }): DayVersion[] {
  if (list.length && samePlan(list[list.length - 1].blocks, next.blocks)) return list;
  if (list.some(v => v.reason === 'original') && next.reason === 'original') return list;
  const version: DayVersion = { id: `${next.reason}:${next.at}`, at: next.at, reason: next.reason, blocks: next.blocks };
  return [...list, version].slice(-MAX);
}

export function loadDayVersions(userId: string, date: string): DayVersion[] {
  try {
    const raw = JSON.parse(localStorage.getItem(keyOf(userId, date)) ?? 'null') as DayVersion[] | null;
    if (!Array.isArray(raw)) return [];
    return raw.filter(v => v && typeof v.id === 'string' && Array.isArray(v.blocks));
  } catch { return []; }
}

export function saveDayVersions(userId: string, date: string, list: DayVersion[]) {
  try { localStorage.setItem(keyOf(userId, date), JSON.stringify(list.slice(-MAX))); } catch { /* this browser won't remember the compare */ }
}

/**
 * Blocks the student put back with Undo today: the reclaim leaves them alone
 * for the rest of the day, even after a reload, or it would move them again
 * a minute later.
 */
const keptKey = (userId: string, date: string) => `soma_reclaim_kept:${userId}:${date}`;
export function loadKept(userId: string, date: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(keptKey(userId, date)) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }
}
export function saveKept(userId: string, date: string, ids: Set<string>) {
  try { localStorage.setItem(keptKey(userId, date), JSON.stringify([...ids])); } catch { /* kept for this page only */ }
}
