import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildCatchUp, buildYesterday, catchUpDayName, type CatchUpAssignment, type CatchUpItem, type YesterdayRow } from '../../lib/catchUp';
import { storage } from '../../lib/storage';
import { subjectForCourse } from '../../lib/canvasDeepSync';
import { formatClockRange } from '../../lib/timeFormat';
import { localDate, readPlan, toneOf, type Snapshot } from './liveData';
import type { PlanBlock } from './PlanEditor';
import dash from './DashboardV2.module.css';
import styles from './CatchUp.module.css';

/**
 * Catch-Up and the yesterday card (lib/catchUp.ts), in the morning brief's
 * place. Soma makes the plan; the student accepts it in one tap, and it is
 * saved the way Accept all saves Soma's suggestions. What the student skipped
 * is remembered in this browser only.
 */

type Failed = { title: string; reason: string }[];
type Props = { userId: string; origin: Date; onApply: (blocks: PlanBlock[]) => Promise<Failed> };

const read = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* remembered for this visit only */ } };
const daysApart = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86_400_000);
const durOf = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`;

/** Canvas work not handed in, under the student's own course. */
function assignments(): CatchUpAssignment[] {
  const subjects = storage.getSubjects(), marked = storage.getAssignmentStatus();
  return storage.getCachedAssignments().flatMap(a => {
    if (!a.dueAt || a.submittedAt || (marked[a.id] ?? a.status) === 'done') return [];
    const subject = subjectForCourse(subjects, a.courseId, a.courseName);
    if (!subject || subject.archived) return [];
    return [{ id: a.id, title: a.name, subjectId: subject.id, subject: subject.name, color: toneOf(subject.color), dueAt: a.dueAt, groupName: a.groupName, groupWeight: a.groupWeight, lateDueAt: a.lateDueAt }];
  });
}

export default function CatchUp({ userId, origin, onApply }: Props) {
  const today = localDate(origin);
  const keys = { seen: `soma_catchup_seen:${userId}`, hidden: `soma_catchup_hidden:${userId}`, skips: `soma_catchup_skips:${userId}`, handled: `soma_yesterday_handled:${userId}` };
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  // Days since the dashboard was last opened in this browser, read once.
  const [away] = useState(() => { const last = read<string>(keys.seen, ''); return last ? daysApart(last, today) : 0; });
  useEffect(() => { write(keys.seen, today); }, [keys.seen, today]);
  const forced = useMemo(() => new URLSearchParams(window.location.search).has('catchup'), []);
  const [hidden, setHidden] = useState(() => read<string>(keys.hidden, '') === today);
  const [skips, setSkips] = useState(() => read<{ skipped: string[]; restored: string[] }>(keys.skips, { skipped: [], restored: [] }));
  const [handled, setHandled] = useState(() => new Set(read<string[]>(keys.handled, [])));
  const [open, setOpen] = useState(false);
  const [todayCap, setTodayCap] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [changing, setChanging] = useState<string | null>(null);

  const load = useCallback(() => readPlan(userId, origin, -7, 14).then(setSnapshot).catch(() => setSnapshot(null)), [userId, origin]);
  useEffect(() => { void load(); }, [load]);

  const settings = storage.getSomaSettings();
  const plan = useMemo(() => snapshot && buildCatchUp({
    snapshot, assignments: assignments(), settings, origin,
    skipped: new Set(skips.skipped), restored: new Set(skips.restored), todayCap: todayCap ?? undefined,
  }), [snapshot, skips, todayCap]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => snapshot ? buildYesterday(snapshot, origin, settings, handled) : [], [snapshot, handled]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSkips = (next: typeof skips) => { setSkips(next); write(keys.skips, next); };
  const hideToday = () => { setHidden(true); write(keys.hidden, today); };

  if (done) return <p className={styles.done} role="status">{done}</p>;
  if (!plan || hidden) return null;

  const showCatchUp = (plan.planned.length + plan.skipped.length > 0) && (forced || (plan.behind >= 3 && (away >= 2 || plan.behind >= 6)));
  if (showCatchUp) {
    const todayCount = plan.planned.filter(p => p.day === 0).length;
    const by = plan.lastDay === 0 ? 'today' : `by ${catchUpDayName(plan.lastDay, origin)}`;
    const skip = (item: CatchUpItem) => saveSkips(item.notWorthIt
      ? { ...skips, restored: skips.restored.filter(k => k !== item.key) }
      : { ...skips, skipped: [...skips.skipped, item.key] });
    const bringBack = (item: CatchUpItem) => saveSkips(item.notWorthIt
      ? { ...skips, restored: [...skips.restored, item.key] }
      : { ...skips, skipped: skips.skipped.filter(k => k !== item.key) });
    async function add() {
      setSaving(true); setError('');
      const blocks: PlanBlock[] = plan!.planned.map(p => ({
        id: `catchup:${crypto.randomUUID()}`, title: p.title, subject: p.subject, time: p.time!, minutes: p.minutes, color: p.color, state: 'Proposal', day: p.day!, note: 'Catch-up',
        ...(p.replaces !== undefined ? { replaces: p.replaces, changeKind: 'move' as const, ...(p.base ? { base: p.base } : {}) } : {}),
      }));
      try {
        const failed = await onApply(blocks);
        hideToday();
        const left = plan!.skipped.length;
        setDone(failed.length
          ? `Added ${blocks.length - failed.length} of ${blocks.length} to your plan. ${failed.length === 1 ? 'One is' : `${failed.length} are`} still waiting below for you to accept.`
          : `You’re on track to be caught up ${by}.${left ? ` ${left} ${left === 1 ? 'thing' : 'things'} left out on purpose.` : ''}`);
      } catch (e) { setError(e instanceof Error ? e.message : 'Could not add the plan. Please retry.'); }
      finally { setSaving(false); }
    }
    const days = [...new Set(plan.planned.map(p => p.day!))];
    return (
      <section className={styles.card} aria-labelledby="catchup-title">
        <h2 id="catchup-title">{away >= 2 ? 'Welcome back.' : 'A few things slipped.'}</h2>
        <p className={styles.lead}>{away >= 2 ? 'You missed a few days, so' : 'Nothing to worry about:'} Soma made a plan to get you caught up {by}.</p>
        {!open && <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => setOpen(true)}>See the plan</button>
          <button type="button" onClick={hideToday}>Later</button>
        </div>}
        {open && <>
          {days.map(day => {
            const items = plan.planned.filter(p => p.day === day);
            return <div key={day} className={styles.day}>
              <div className={styles.dayHead}><h3>{catchUpDayName(day, origin)}</h3><span>{durOf(items.reduce((n, p) => n + p.minutes, 0))}</span></div>
              <ul className={styles.list}>{items.map(p => <li key={p.key} className={dash[p.color]}>
                <span className={styles.when}>{day === 0 ? formatClockRange(p.time!) : durOf(p.minutes)}</span>
                <span className={styles.what}><strong>{p.title}</strong> <em>{p.subject}</em><small>{p.why}</small></span>
                <button type="button" className={styles.quiet} aria-label={`Skip ${p.title}`} onClick={() => skip(p)}>Skip</button>
              </li>)}</ul>
            </div>;
          })}
          {todayCap === null && todayCount > 1 && <button type="button" className={styles.quiet} onClick={() => setTodayCap(todayCount - 1)}>Today looks like too much? Move one thing to tomorrow</button>}
          {todayCap !== null && <p className={styles.note}>Moved one thing off today. <button type="button" className={styles.quiet} onClick={() => setTodayCap(null)}>Undo</button></p>}
          {plan.unplaced.length > 0 && <div className={styles.day}>
            <div className={styles.dayHead}><h3>No room before it’s due</h3></div>
            <ul className={styles.list}>{plan.unplaced.map(p => <li key={p.key} className={dash[p.color]}>
              <span className={styles.what}><strong>{p.title}</strong> <em>{p.subject}</em><small>{p.why} Make room on your calendar, or ask Soma.</small></span>
            </li>)}</ul>
          </div>}
          {plan.skipped.length > 0 && <div className={styles.day}>
            <div className={styles.dayHead}><h3>Not worth catching up on</h3></div>
            <p className={styles.note}>These won’t move your grade much now. Soma keeps them, just doesn’t plan them.</p>
            <ul className={`${styles.list} ${styles.skipped}`}>{plan.skipped.map(p => <li key={p.key} className={dash[p.color]}>
              <span className={styles.what}><strong>{p.title}</strong> <em>{p.subject}</em><small>{p.notWorthIt ? p.why : 'You chose to skip this.'}</small></span>
              <button type="button" className={styles.quiet} aria-label={`Do ${p.title} anyway`} onClick={() => bringBack(p)}>Do it anyway</button>
            </li>)}</ul>
          </div>}
          {error && <p role="alert" className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={saving || !plan.planned.length} onClick={() => void add()}>{saving ? 'Adding…' : 'Add to my plan'}</button>
            <button type="button" disabled={saving} onClick={hideToday}>Not now</button>
          </div>
          <p className={styles.note}>You can move anything later, like any other block.</p>
        </>}
      </section>
    );
  }

  if (!rows.length) return null;
  return <Yesterday rows={rows} choices={choices} setChoices={setChoices} changing={changing} setChanging={setChanging} saving={saving} error={error} onConfirm={async () => {
    setSaving(true); setError('');
    const blocks = rows.flatMap((r): PlanBlock[] => {
      const how = choices[r.key] ?? guess(r);
      const base = { title: r.title, subject: r.subject, color: r.color, state: 'Proposal' as const };
      if (how === 'today' && r.today) return [{ ...base, id: `yesterday:${crypto.randomUUID()}`, time: r.today, minutes: r.rest, day: 0, note: 'The rest of yesterday’s work' }];
      if (how === 'tomorrow' && r.tomorrow) return [{ ...base, id: `yesterday:${crypto.randomUUID()}`, time: r.tomorrow, minutes: r.rest, day: 1, note: 'The rest of yesterday’s work' }];
      if (how === 'done') return [{ ...base, id: `yesterday:${crypto.randomUUID()}`, time: r.base.time, minutes: 0, day: -1, replaces: r.blockId, changeKind: 'complete', base: r.base }];
      return [];
    });
    try {
      const failed = blocks.length ? await onApply(blocks) : [];
      const next = new Set([...handled, ...rows.map(r => r.key)]);
      setHandled(next); write(keys.handled, [...next].slice(-100));
      setDone(failed.length ? `Couldn’t save ${failed.map(f => `"${f.title}"`).join(', ')}. ${failed.length === 1 ? 'It’s' : 'They’re'} waiting below for you to accept.` : 'Yesterday’s work is sorted.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Please retry.'); }
    finally { setSaving(false); }
  }} />;
}

type Choice = 'today' | 'tomorrow' | 'done' | 'leave';
const guess = (r: YesterdayRow): Choice => r.today ? 'today' : r.tomorrow ? 'tomorrow' : 'leave';

function Yesterday({ rows, choices, setChoices, changing, setChanging, saving, error, onConfirm }: {
  rows: YesterdayRow[]; choices: Record<string, Choice>; setChoices: (c: Record<string, Choice>) => void;
  changing: string | null; setChanging: (k: string | null) => void; saving: boolean; error: string; onConfirm: () => Promise<void>;
}) {
  const say = (r: YesterdayRow, how: Choice) => how === 'today' ? `You put in ${r.did} min. The last ${r.rest} min go on today at ${formatClockRange(r.today!)}.`
    : how === 'tomorrow' ? `You put in ${r.did} min. The last ${r.rest} min go on tomorrow at ${formatClockRange(r.tomorrow!)}.`
    : how === 'done' ? 'Checked off, with your time on it.'
    : r.today || r.tomorrow ? 'Left as it is.' : `You put in ${r.did} min. No open time today or tomorrow for the rest.`;
  const label: Record<Choice, string> = { done: 'I finished it', today: 'Do the rest today', tomorrow: 'Do the rest tomorrow', leave: 'Leave it' };
  return (
    <section className={styles.card} aria-labelledby="yesterday-title">
      <div className={styles.dayHead}>
        <h2 id="yesterday-title">From yesterday</h2>
      </div>
      <p className={styles.lead}>You worked on these but didn’t check them off. Here’s Soma’s suggestion.</p>
      <ul className={styles.list}>{rows.map(r => {
        const how = choices[r.key] ?? guess(r);
        const alts = (['done', 'today', 'tomorrow', 'leave'] as Choice[]).filter(k => k !== how && (k !== 'today' || r.today) && (k !== 'tomorrow' || r.tomorrow));
        return <li key={r.key} className={dash[r.color]}>
          <span className={styles.what}><strong>{r.title}</strong> <em>{r.subject}</em><small>{say(r, how)}</small>
            {changing === r.key && <span className={styles.alts} role="group" aria-label={`Change what happens with ${r.title}`}>
              {alts.map(k => <button key={k} type="button" onClick={() => { setChoices({ ...choices, [r.key]: k }); setChanging(null); }}>{label[k]}</button>)}
            </span>}
          </span>
          {changing !== r.key && <button type="button" className={styles.quiet} aria-label={`Change what happens with ${r.title}`} onClick={() => setChanging(r.key)}>Not right?</button>}
        </li>;
      })}</ul>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={saving} onClick={() => void onConfirm()}>{saving ? 'Saving…' : 'Looks right'}</button>
      </div>
    </section>
  );
}
