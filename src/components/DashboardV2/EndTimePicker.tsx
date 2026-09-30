import { useState } from 'react';
import { clockMinutes, clockOf, spanMinutes } from '../../lib/clockRange';
import { formatClock, useTimeFormat } from '../../lib/timeFormat';

const STEP = 15, LONGEST = 720;
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "45 min", "1 hr", "1 hr 15 min". */
export function lengthLabel(minutes: number) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h} hr${m ? ` ${m} min` : ''}` : `${m} min`;
}

/**
 * The end of a block or session, picked the way Google Calendar does it:
 * ends are listed from the start with how long each makes it, and ends past
 * midnight say "next day". Nobody has to work out that 12:35 AM is after
 * 11:25 PM, and a typo like 3 PM → 2 PM can't happen by accident. "Other
 * time…" types any time.
 */
export default function EndTimePicker({ label, start, end, onChange, disabled }: {
  label: string; start: string; end: string; onChange: (end: string) => void; disabled?: boolean;
}) {
  const format = useTimeFormat();
  const span = clock.test(start) && clock.test(end) ? spanMinutes(start, end) : 0;
  const [other, setOther] = useState(() => !!end && clock.test(start) && (span === 0 || span > LONGEST));
  // Without a start there is nothing to count from yet.
  if (!clock.test(start)) return <input type="time" aria-label={label} value={end} disabled={disabled} onChange={e => onChange(e.target.value)} />;
  const from = clockMinutes(start);
  const lengths = Array.from({ length: LONGEST / STEP }, (_, i) => (i + 1) * STEP);
  if (span > 0 && span <= LONGEST && span % STEP) lengths.push(span);
  lengths.sort((a, b) => a - b);
  return <>
    <select aria-label={label} value={other ? 'other' : clock.test(end) && span > 0 && span <= LONGEST ? end : ''} disabled={disabled}
      onChange={e => { if (e.target.value === 'other') { setOther(true); return; } setOther(false); onChange(e.target.value); }}>
      <option value="" disabled>Choose an end</option>
      {lengths.map(m => {
        const value = clockOf(from + m);
        return <option key={m} value={value}>{formatClock(value, format)} ({lengthLabel(m)}){from + m >= 1440 ? ' · next day' : ''}</option>;
      })}
      <option value="other">Other time…</option>
    </select>
    {other && <input type="time" aria-label={`${label}, other time`} value={end} disabled={disabled} onChange={e => onChange(e.target.value)} />}
  </>;
}

/** Moving the start keeps the length, as in Google Calendar: returns the new end. */
export function endAfterMove(oldStart: string, oldEnd: string, newStart: string): string {
  if (!clock.test(oldStart) || !clock.test(oldEnd) || !clock.test(newStart)) return oldEnd;
  const length = spanMinutes(oldStart, oldEnd);
  return length > 0 && length <= LONGEST ? clockOf(clockMinutes(newStart) + length) : oldEnd;
}
