import { formatClock } from '../../lib/timeFormat';
import { versionLabel, type DayVersion, type VersionBlock } from '../../lib/dayVersions';
import styles from './DashboardV2.module.css';

type Props = {
  current: VersionBlock[];
  versions: DayVersion[];
  selectedId: string;
  onSelect: (id: string) => void;
};

type Change = { id: string; title: string; from?: string; to?: string };

const start = (range?: string) => range ? formatClock(range.split('–')[0]) : '';

/** Blocks whose time changed between an earlier version and now; unchanged ones (classes too) are left out. */
export function dayChanges(earlier: VersionBlock[], now: VersionBlock[]): Change[] {
  const before = new Map(earlier.map(b => [b.id, b]));
  const after = new Map(now.map(b => [b.id, b]));
  const out: Change[] = [];
  for (const b of now) {
    const was = before.get(b.id);
    if (!was) out.push({ id: b.id, title: b.title, to: b.time });
    else if (was.time !== b.time) out.push({ id: b.id, title: b.title, from: was.time, to: b.time });
  }
  for (const b of earlier) if (!after.has(b.id)) out.push({ id: b.id, title: b.title, from: b.time });
  return out;
}

/**
 * What changed in today's plan since an earlier version: each moved block,
 * from and to. It used to be two full lists side by side, every class
 * included, with the moved rows only a shade darker.
 */
export default function DayCompare({ current, versions, selectedId, onSelect }: Props) {
  const selected = versions.find(v => v.id === selectedId) ?? versions[0];
  if (!selected) return <div className={styles.compare} aria-label="Compare today’s plan"><p>The first version is saved when today’s plan loads.</p></div>;
  const changes = dayChanges(selected.blocks, current);
  return (
    <div className={styles.compare} aria-label="Compare today’s plan">
      <div className={styles.compareHead}>
        <label htmlFor="day-version">Changes since</label>
        <select id="day-version" value={selected.id} onChange={e => onSelect(e.target.value)}>
          {versions.map(v => <option key={v.id} value={v.id}>{versionLabel(v)}</option>)}
        </select>
      </div>
      {changes.length ? (
        <ul>
          {changes.map(c => (
            <li key={c.id}>
              <span className={styles.moveNoteTitle}>
                {c.title}
                <span className={styles.compareTag}>{!c.from ? 'Added' : !c.to ? (c.from && current.some(b => b.id === c.id) ? 'Off the clock' : 'Removed') : 'Moved'}</span>
              </span>
              <span className={styles.moveNoteTimes}>
                {c.from && c.to ? <>{start(c.from)} <span aria-hidden="true">→</span><span className={styles.srOnly}> to</span>{' '}{start(c.to)}</>
                  : c.to ? start(c.to) : c.from ? `was ${start(c.from)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : <p>Nothing has moved since then.</p>}
    </div>
  );
}
