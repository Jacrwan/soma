import { formatClock, formatClockRange } from '../../lib/timeFormat';
import { versionLabel, type DayVersion, type VersionBlock } from '../../lib/dayVersions';
import styles from './DashboardV2.module.css';

type Props = {
  current: VersionBlock[];
  versions: DayVersion[];
  selectedId: string;
  onSelect: (id: string) => void;
};

const start = (range?: string) => range ? formatClock(range.split('–')[0]) : '';

/**
 * The right half of today's plan when Compare is on: an earlier version of
 * the day, in time order, beside the plan as it is now (owner's sketch,
 * 2026-11-10: split the plan itself, don't add a section). A block that has
 * moved since says where it is now.
 */
export default function DayCompare({ current, versions, selectedId, onSelect }: Props) {
  const selected = versions.find(v => v.id === selectedId) ?? versions[0];
  const now = new Map(current.map(b => [b.id, b]));
  const earlier = [...(selected?.blocks ?? [])].sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title));
  return (
    <div className={styles.earlier} aria-label="Compare today’s plan">
      <div className={styles.earlierHead}>
        <label htmlFor="day-version">Earlier</label>
        {versions.length > 0 && (
          <select id="day-version" value={selected?.id ?? ''} onChange={e => onSelect(e.target.value)}>
            {versions.map(v => <option key={v.id} value={v.id}>{versionLabel(v)}</option>)}
          </select>
        )}
      </div>
      {!selected ? <p className={styles.earlierEmpty}>The first version is saved when today’s plan loads.</p> : (
        <ol className={styles.earlierList}>
          {earlier.map(b => {
            const nowBlock = now.get(b.id);
            const moved = !nowBlock ? 'Removed since' : nowBlock.time !== b.time ? (nowBlock.time ? `Now ${start(nowBlock.time)}` : 'Now off the clock') : '';
            return (
              <li key={b.id} className={moved ? styles.earlierMoved : undefined}>
                <span className={styles.earlierTime}>{b.time ? formatClockRange(b.time) : 'Any time'}</span>
                <span className={styles.earlierTitle}>{b.title}</span>
                {moved && <span className={styles.compareTag}>{moved}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
