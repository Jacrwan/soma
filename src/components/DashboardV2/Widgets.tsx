import type { CSSProperties } from 'react';
import { CalendarPlus, Play } from 'lucide-react';
import { clockLabel } from './progress';
import { formatClock, formatClockRange, type TimeFormat } from '../../lib/timeFormat';
import type { PlanBlock } from './PlanEditor';
import styles from './DashboardV2.module.css';

/**
 * The dashboard's smaller widgets (WidgetGrid.tsx): Up next, Due soon, Study
 * this week and This week. Each only shows what the dashboard already has;
 * none of them reads or saves anything itself.
 */

export type DueItem = { id: number; day: number; subject: string; color: string; title: string; dueAt: string };

const minutesOf = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const span = (time: string): [number, number] | null => {
  const [a, b] = time.split('–');
  if (!a || !b) return null;
  const start = minutesOf(a); let end = minutesOf(b);
  if (end <= start) end += 24 * 60;
  return [start, end];
};
const hm = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`;
const dateAt = (origin: Date, day: number) => { const d = new Date(origin); d.setDate(d.getDate() + day); return d; };

/** The block on now, else the next one today. Focus is offered on study blocks. */
export function UpNext({ blocks, now, timeFormat, canFocus, onFocus }: {
  blocks: PlanBlock[]; now: Date; timeFormat: TimeFormat; canFocus: boolean; onFocus: (id: string | number) => void;
}) {
  const at = now.getHours() * 60 + now.getMinutes();
  const today = blocks
    .filter(b => b.day === 0 && b.time && b.state !== 'Completed' && b.state !== 'Proposal')
    .map(b => ({ b, s: span(b.time) }))
    .filter((x): x is { b: PlanBlock; s: [number, number] } => !!x.s && x.s[1] > at)
    .sort((x, y) => x.s[0] - y.s[0]);
  const next = today[0];
  const later = today.slice(1, 3);
  return (
    <section className={styles.widgetCard} aria-labelledby="w-next">
      <div className={styles.sectionHeading}><h2 id="w-next">Up next</h2></div>
      {!next ? <p className={styles.description}>Nothing else planned today.</p> : <>
        <div className={`${styles.nextBlock} ${styles[next.b.color] ?? ''}`}>
          <span className={styles.nextWhen}>{next.s[0] <= at ? 'Now' : next.s[0] - at < 60 ? `In ${next.s[0] - at} min` : formatClock(clockLabel(next.s[0] % 1440), timeFormat)}</span>
          <strong>{next.b.title}</strong>
          <small>{next.b.subject} · {formatClockRange(next.b.time, timeFormat)}</small>
        </div>
        {!next.b.external && canFocus && <button type="button" className={styles.widgetAction} aria-label={`Start focus: ${next.b.title}`} onClick={() => onFocus(next.b.id)}><Play size={13}/> Focus</button>}
        {later.length > 0 && <ul className={styles.widgetList}>{later.map(({ b }) => <li key={b.id}><span>{formatClockRange(b.time, timeFormat).split('–')[0]}</span>{b.title}</li>)}</ul>}
      </>}
    </section>
  );
}

/** Canvas work due in the days on screen, soonest first. */
export function DueSoon({ items, origin, timeFormat, onPlan }: {
  items: DueItem[]; origin: Date; timeFormat: TimeFormat; onPlan?: (item: DueItem) => void;
}) {
  const soon = items.filter(x => x.day >= 0).sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 8);
  const when = (x: DueItem) => {
    const d = new Date(x.dueAt);
    const clock = formatClock(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, timeFormat);
    return x.day === 0 ? `Today, ${clock}` : x.day === 1 ? `Tomorrow, ${clock}` : `${dateAt(origin, x.day).toLocaleDateString(undefined, { weekday: 'short' })}, ${clock}`;
  };
  return (
    <section className={styles.widgetCard} aria-labelledby="w-due">
      <div className={styles.sectionHeading}><h2 id="w-due">Due soon</h2></div>
      {!soon.length ? <p className={styles.description}>Nothing from Canvas due in these days.</p> : <ul className={styles.dueList}>
        {soon.map(x => <li key={x.id} className={styles[x.color as PlanBlock['color']] ?? ''}>
          <span><strong>{x.title}</strong><small>{x.subject} · {when(x)}</small></span>
          {onPlan && <button type="button" aria-label={`Plan it: ${x.title}`} title="Plan it" onClick={() => onPlan(x)}><CalendarPlus size={13}/></button>}
        </li>)}
      </ul>}
    </section>
  );
}

/** Focus minutes for the last seven days, today last. */
export function StudyWeek({ days, origin }: { days: number[]; origin: Date }) {
  const minutes = days.map(s => Math.round(s / 60));
  const most = Math.max(60, ...minutes);
  const total = minutes.reduce((n, m) => n + m, 0);
  return (
    <section className={styles.widgetCard} aria-labelledby="w-stats">
      <div className={styles.sectionHeading}><h2 id="w-stats">Study this week</h2><span>{hm(total)}</span></div>
      <div className={styles.studyBars} role="img" aria-label={`Focus time, last seven days: ${minutes.map((m, i) => `${dateAt(origin, i - 6).toLocaleDateString(undefined, { weekday: 'short' })} ${hm(m)}`).join(', ')}.`}>
        {minutes.map((m, i) => <div key={i} className={i === 6 ? styles.studyToday : undefined}>
          <span style={{ height: `${Math.round((m / most) * 100)}%` } as CSSProperties} title={hm(m)}/>
          <small>{dateAt(origin, i - 6).toLocaleDateString(undefined, { weekday: 'narrow' })}</small>
        </div>)}
      </div>
      <p className={styles.widgetFoot}>Today: {hm(minutes[6] ?? 0)}</p>
    </section>
  );
}

/** A small week calendar of the seven days on screen; picking a day opens it in Today's plan. */
export function WeekGlance({ blocks, due, origin, rangeStart, day, now, onPick }: {
  blocks: PlanBlock[]; due: DueItem[]; origin: Date; rangeStart: number; day: number; now: Date; onPick: (day: number) => void;
}) {
  const days = Array.from({ length: 7 }, (_, k) => rangeStart + k);
  const timed = blocks.filter(b => days.includes(b.day) && b.time && b.changeKind !== 'remove').map(b => ({ b, s: span(b.time)! })).filter(x => x.s);
  // Hours shown: 8 AM to 10 PM, widened to fit anything earlier or later.
  const from = Math.min(8 * 60, ...timed.map(x => Math.floor(x.s[0] / 60) * 60));
  const to = Math.max(22 * 60, ...timed.map(x => Math.min(24 * 60, Math.ceil(x.s[1] / 60) * 60)));
  const pct = (m: number) => `${((Math.min(Math.max(m, from), to) - from) / (to - from)) * 100}%`;
  const nowAt = now.getHours() * 60 + now.getMinutes();
  return (
    <section className={`${styles.widgetCard} ${styles.glance}`} aria-labelledby="w-week">
      <div className={styles.sectionHeading}><h2 id="w-week">This week</h2><a href="/calendar">Open calendar</a></div>
      <div className={styles.glanceGrid}>
        {days.map(i => {
          const d = dateAt(origin, i);
          const mine = timed.filter(x => x.b.day === i);
          const dueCount = due.filter(x => x.day === i).length;
          return <div key={i} className={styles.glanceDay}>
            <button type="button" aria-pressed={day === i} onClick={() => onPick(i)}
              aria-label={`${d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}: ${mine.length} ${mine.length === 1 ? 'block' : 'blocks'}${dueCount ? `, ${dueCount} due` : ''}`}>
              <span>{i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })}</span><strong>{d.getDate()}</strong>
            </button>
            <div className={styles.glanceTrack} aria-hidden="true">
              {mine.map(({ b, s }) => <i key={b.id} className={`${styles[b.color] ?? ''}${b.external ? ` ${styles.glanceEvent}` : ''}${b.state === 'Proposal' ? ` ${styles.glanceProposal}` : ''}`}
                style={{ top: pct(s[0]), height: `calc(${pct(s[1])} - ${pct(s[0])})` } as CSSProperties} title={`${b.title} · ${b.time}`}/>)}
              {i === 0 && nowAt >= from && nowAt <= to && <b className={styles.glanceNow} style={{ top: pct(nowAt) }}/>}
              {dueCount > 0 && <em className={styles.glanceDue}>{dueCount} due</em>}
            </div>
          </div>;
        })}
      </div>
    </section>
  );
}
