import { useState, ReactNode } from 'react';
import styles from './SubjectSection.module.css';

const COLLAPSE_KEY = 'soma_subject_section_collapsed';

function getCollapsedMap(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function setCollapsed(sectionKey: string, collapsed: boolean) {
  const map = getCollapsedMap();
  map[sectionKey] = collapsed;
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(map));
}

interface SubjectSectionProps {
  /** Stable key for persisting collapsed state, e.g. `canvas:${subjectId}`. */
  sectionKey: string;
  name: string;
  color: string;
  count: number;
  /** Rendered on the header row, e.g. a "Generate study plan" or "Upload" action. Stops propagation automatically. */
  actions?: ReactNode;
  children: ReactNode;
}

// Shared collapsible "group by subject" shell used by both the Canvas page
// and the Documents page, so the same subject a student sees due dates under
// is instantly recognizable when they land on Documents. Collapsed state
// persists per subject across visits instead of resetting every reload.
export default function SubjectSection({ sectionKey, name, color, count, actions, children }: SubjectSectionProps) {
  const [open, setOpen] = useState(() => !getCollapsedMap()[sectionKey]);

  function toggle() {
    const next = !open;
    setOpen(next);
    setCollapsed(sectionKey, !next);
  }

  return (
    <section className={styles.section}>
      <button type="button" className={styles.header} onClick={toggle} aria-expanded={open}>
        <svg
          className={`${styles.chevron}${open ? ` ${styles.chevronOpen}` : ''}`}
          width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"
        >
          <path d="M2.5 1.5L6.5 5L2.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className={styles.dot} style={{ background: color }} />
        <span className={styles.name}>{name}</span>
        <span className={styles.count}>{count}</span>
        {actions && (
          <span className={styles.actions} onClick={e => e.stopPropagation()}>
            {actions}
          </span>
        )}
      </button>
      {open && <div className={styles.body}>{children}</div>}
    </section>
  );
}
