// No runtime imports, so tests can load it without the Supabase client.

/**
 * Habits the student wants to keep: the gym, eating well. Asked for on
 * 2026-11-05 in place of a weekly routine ("a habit thing ... as like a
 * widget thing for the gym and eat healthy type of stuff").
 *
 * Each habit has a weekly target, not a daily streak: "Gym, 6 a week" leaves
 * Sunday off, and a missed day costs nothing but a dot. Weeks run Monday to
 * Sunday, like the rest of Soma. Kept in settings (`settings.habits`); only
 * the last ten weeks of check-offs are kept, which is all anything shows.
 *
 * Habits aren't study and have no times: Soma knows them and this week's
 * count, and never turns them into blocks.
 */

export type Habit = { id: string; title: string; perWeek: number };
export type Habits = { items: Habit[]; done: Record<string, string[]> };

export const MAX_HABITS = 8;
const KEEP_DAYS = 70;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'habit';

/** A new habit's id: from its title, unique among the others. */
export function habitId(title: string, taken: Habit[]): string {
  let id = slug(title), n = 2;
  while (taken.some(h => h.id === id)) id = `${slug(title)}-${n++}`;
  return id;
}

/** Habits from settings, checked: anything malformed is left out, and old check-offs dropped. */
export function readHabits(raw: unknown, today = new Date()): Habits {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const items: Habit[] = [];
  for (const entry of Array.isArray(r.items) ? r.items : []) {
    if (items.length >= MAX_HABITS || !entry || typeof entry !== 'object') continue;
    const h = entry as Record<string, unknown>;
    const title = typeof h.title === 'string' ? h.title.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    const perWeek = Math.round(Number(h.perWeek));
    const id = typeof h.id === 'string' && /^[a-z0-9-]{1,40}$/.test(h.id) && !items.some(x => x.id === h.id) ? h.id : '';
    if (!title || !id || !(perWeek >= 1 && perWeek <= 7)) continue;
    items.push({ id, title, perWeek });
  }
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  const from = dayKey(cutoff), until = dayKey(today);
  const doneRaw = r.done && typeof r.done === 'object' ? r.done as Record<string, unknown> : {};
  const done: Record<string, string[]> = {};
  for (const h of items) {
    const dates = Array.isArray(doneRaw[h.id]) ? (doneRaw[h.id] as unknown[]) : [];
    done[h.id] = [...new Set(dates.filter((d): d is string => typeof d === 'string' && DATE.test(d) && d >= from && d <= until))].sort();
  }
  return { items, done };
}

/** Checks a habit off for a day, or takes the check back. Future days can't be checked. */
export function toggleDay(habits: Habits, id: string, day: string, today = new Date()): Habits {
  if (!habits.items.some(h => h.id === id) || day > dayKey(today)) return habits;
  const dates = habits.done[id] ?? [];
  const next = dates.includes(day) ? dates.filter(d => d !== day) : [...dates, day].sort();
  return { ...habits, done: { ...habits.done, [id]: next } };
}

/** This week's days, Monday to Sunday. */
export function weekDays(today = new Date()): string[] {
  const monday = new Date(today); monday.setHours(12, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return dayKey(d); });
}

/** How many times a habit was done this week. */
export const doneThisWeek = (habits: Habits, id: string, today = new Date()) => {
  const week = weekDays(today);
  return (habits.done[id] ?? []).filter(d => week.includes(d)).length;
};

/** One line per habit, for Soma: "Gym · 6 a week · 3 so far this week · done today". */
export function habitLines(habits: Habits, today = new Date()): string[] {
  const key = dayKey(today);
  return habits.items.map(h => `${h.title} · ${h.perWeek === 7 ? 'every day' : `${h.perWeek} a week`} · ${doneThisWeek(habits, h.id, today)} so far this week · ${(habits.done[h.id] ?? []).includes(key) ? 'done today' : 'not yet today'}`);
}
