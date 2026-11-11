import { formatClockRange } from '../../lib/timeFormat';
import { versionLabel, type DayVersion, type VersionBlock } from '../../lib/dayVersions';
import styles from './DashboardV2.module.css';

type Props = {
  current: VersionBlock[];
  versions: DayVersion[];
  selectedId: string;
  onSelect: (id: string) => void;
};

function rows(blocks: VersionBlock[], other: Map<string, string>) {
  return blocks.map(b => {
    const was = other.get(b.id);
    const changed = was !== undefined && was !== b.time;
    return (
      <li key={b.id} className={changed ? styles.compareMoved : undefined}>
        <span>{b.title}</span>
        <time>{b.time ? formatClockRange(b.time) : 'Any time'}</time>
      </li>
    );
  });
}

/** Split peek: the day as it is now, beside one earlier version. */
export default function DayCompare({ current, versions, selectedId, onSelect }: Props) {
  const selected = versions.find(v => v.id === selectedId) ?? versions[0];
  const older = new Map((selected?.blocks ?? []).map(b => [b.id, b.time]));
  const now = new Map(current.map(b => [b.id, b.time]));
  return (
    <div className={styles.compare} aria-label="Compare today’s plan">
      <div>
        <h3>Now</h3>
        {current.length ? <ul>{rows(current, older)}</ul> : <p>Nothing on the day yet.</p>}
      </div>
      <div>
        <h3>
          <label htmlFor="day-version">Earlier</label>
        </h3>
        {versions.length ? (
          <select id="day-version" value={selected?.id ?? ''} onChange={e => onSelect(e.target.value)}>
            {versions.map(v => <option key={v.id} value={v.id}>{versionLabel(v)}</option>)}
          </select>
        ) : null}
        {selected ? <ul>{rows(selected.blocks, now)}</ul> : <p>The first version is saved when today’s plan loads.</p>}
      </div>
    </div>
  );
}
