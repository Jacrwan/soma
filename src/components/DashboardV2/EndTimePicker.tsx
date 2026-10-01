import { useId } from 'react';
import { clockMinutes, clockOf, spanMinutes } from '../../lib/clockRange';

const LONGEST = 720;
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "45 min", "1 hr", "1 hr 15 min". */
export function lengthLabel(minutes: number) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h} hr${m ? ` ${m} min` : ''}` : `${m} min`;
}

/**
 * The end of a block or session: a time the student types, with how long that
 * makes it and "next day" past midnight shown beside it, so nobody has to work
 * out that 12:35 AM is after 11:25 PM. It used to be a list of ends counted
 * from the start; the exact time was buried under "Other time…" at the bottom.
 */
export default function EndTimePicker({ label, start, end, onChange, disabled }: {
  label: string; start: string; end: string; onChange: (end: string) => void; disabled?: boolean;
}) {
  const hintId = useId();
  const span = clock.test(start) && clock.test(end) ? spanMinutes(start, end) : 0;
  const nextDay = span > 0 && clockMinutes(end) <= clockMinutes(start);
  const hint = !span ? '' : `${lengthLabel(span)}${nextDay ? ' · next day' : ''}`;
  return <>
    <input type="time" aria-label={label} value={end} disabled={disabled} onChange={e => onChange(e.target.value)} {...(hint ? { 'aria-describedby': hintId } : {})}/>
    {hint && <small id={hintId}>{hint}</small>}
  </>;
}

/** Moving the start keeps the length, as in Google Calendar: returns the new end. */
export function endAfterMove(oldStart: string, oldEnd: string, newStart: string): string {
  if (!clock.test(oldStart) || !clock.test(oldEnd) || !clock.test(newStart)) return oldEnd;
  const length = spanMinutes(oldStart, oldEnd);
  return length > 0 && length <= LONGEST ? clockOf(clockMinutes(newStart) + length) : oldEnd;
}
