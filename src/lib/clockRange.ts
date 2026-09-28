// Kept free of imports so tests can load it without the Supabase client.

/**
 * Clock ranges like "23:30–01:00". A block's time is written in clock times on
 * the day it starts, so an end at or before the start means it runs past
 * midnight into the next day. Everything that measures or compares ranges goes
 * through here; comparing the raw strings made every overnight block look like
 * it ended before it began.
 */

/** Minutes after midnight for "HH:mm". */
export const clockMinutes = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

/** How long start→end runs. "23:30"→"01:00" is 90; the same time twice is 0. */
export function spanMinutes(start: string, end: string): number {
  const d = clockMinutes(end) - clockMinutes(start);
  return d > 0 ? d : d < 0 ? d + 1440 : 0;
}

/** [from, to] in minutes after the start day's midnight; `to` passes 1440 overnight. */
export function rangeOf(time: string): [number, number] {
  const [a = '', b = ''] = time.split('–');
  const from = clockMinutes(a);
  return [from, from + spanMinutes(a, b)];
}

/** The range ends on the day after it starts. */
export const overnight = (time: string) => rangeOf(time)[1] > 1440;

/** Study hours as [open, close]; a latest end at or before the earliest start runs past midnight. */
export function windowOf(w: { start: string; end: string }): [number, number] {
  const open = clockMinutes(w.start);
  return [open, open + (spanMinutes(w.start, w.end) || 1440)];
}

/** "HH:mm" for a minute count, wrapping past midnight. */
export const clockOf = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
