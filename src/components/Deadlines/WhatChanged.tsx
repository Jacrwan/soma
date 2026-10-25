import { useEffect, useState } from 'react';
import { recentChanges, type SnapshotChange } from '../../lib/canvasDeepSync';
import { CANVAS_CHANGED } from '../../lib/canvasExtension';
import { formatDateTime, useTimeFormat } from '../../lib/timeFormat';
import styles from './DeadlinesTab.module.css';

/**
 * What changed on Canvas, Gradescope and WebAssign in the last week: new
 * work, a moved due date, a grade posted, an announcement. The extension
 * works these out by comparing each sync with the last; nothing shows until
 * a site has synced twice.
 */

const LABELS: Record<SnapshotChange['type'], string> = {
  new: 'New', due_moved: 'Due date moved', graded: 'Graded', announcement: 'Announcement',
};
const SITES: Record<SnapshotChange['site'], string> = { canvas: 'Canvas', gradescope: 'Gradescope', webassign: 'WebAssign' };
const SHOWN = 4;

/** "Thu, Oct 29, 2:00 PM": a moved due date often keeps its time, so the day has to show. */
const at = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${formatDateTime(d)}`;
};

function detail(c: SnapshotChange): string {
  if (c.type === 'due_moved') return `now ${at(c.to)}${c.from ? `, was ${at(c.from)}` : ''}`;
  if (c.type === 'new') return c.to ? `due ${at(c.to)}` : 'no due date';
  if (c.type === 'graded') return c.score != null && c.maxScore ? `${c.score} / ${c.maxScore}` : 'grade posted';
  return '';
}

export default function WhatChanged() {
  useTimeFormat();
  const [changes, setChanges] = useState(() => recentChanges());
  const [all, setAll] = useState(false);

  useEffect(() => {
    const refresh = () => setChanges(recentChanges());
    window.addEventListener(CANVAS_CHANGED, refresh);
    return () => window.removeEventListener(CANVAS_CHANGED, refresh);
  }, []);

  if (!changes.length) return null;
  const shown = all ? changes : changes.slice(0, SHOWN);
  return (
    <section className={`${styles.dateGroup} ${styles.changes}`} aria-labelledby="what-changed">
      <div className={styles.dateGroupHeader}>
        <h2 id="what-changed" className={styles.dateGroupLabel}>What changed</h2>
        <span className={styles.dateGroupCount}>last 7 days</span>
      </div>
      <ul className={`${styles.assignmentList} ${styles.changeList}`}>
        {shown.map(c => {
          const body = (
            <>
              <span className={`${styles.changeType} ${c.type === 'due_moved' ? styles.changeTypeMoved : ''}`}>{LABELS[c.type]}</span>
              <span className={styles.assignmentInfo}>
                <span className={styles.assignmentName}>{c.name}</span>
                <span className={styles.assignmentCourse}>{[c.course, SITES[c.site]].filter(Boolean).join(' · ')}</span>
              </span>
              <span className={styles.dueTime}>{detail(c)}</span>
            </>
          );
          const key = `${c.site}-${c.type}-${c.assignmentId ?? c.name}-${c.at}`;
          return (
            <li key={key}>
              {c.url
                ? <a className={`${styles.assignmentCard} ${styles.changeRow}`} href={c.url} target="_blank" rel="noopener noreferrer">{body}</a>
                : <div className={`${styles.assignmentCard} ${styles.changeRow}`} style={{ cursor: 'default' }}>{body}</div>}
            </li>
          );
        })}
      </ul>
      {changes.length > SHOWN && (
        <button type="button" className={styles.changeMore} onClick={() => setAll(v => !v)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${changes.length}`}
        </button>
      )}
    </section>
  );
}
