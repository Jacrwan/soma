import { useEffect, useRef, useState } from 'react';
import { buildGrades, showPercent, showScore, type GradeCourse, type GradeItem } from '../../lib/grades';
import { CANVAS_CHANGED, deepSyncStatus } from '../../lib/canvasExtension';
import { formatDateTime } from '../../lib/timeFormat';
import styles from './GradesTab.module.css';

/**
 * Grades, from what the Soma for Canvas extension synced. The page is one row
 * per course, in its subject colour, with the grade big; opening a course
 * shows the score on every graded assignment, Canvas and Gradescope together.
 */

/** "CS-170-1: Intro to Computer Science I - Fall 2026" → code and title. */
function splitName(name: string): { code: string; title: string } {
  const [head, ...rest] = name.split(':');
  return rest.length && head.trim().length <= 16 ? { code: head.trim(), title: rest.join(':').trim() } : { code: '', title: name };
}

/** The big number: Canvas's course grade, else the points earned over the points possible. */
function headline(c: GradeCourse): { big: string | null; small: string | null; estimated: boolean } {
  if (c.letter) return { big: c.letter, small: c.percent !== null ? showPercent(c.percent) : null, estimated: false };
  if (c.percent !== null) return { big: showPercent(c.percent), small: null, estimated: false };
  if (c.points) return { big: showPercent(c.points.percent), small: 'average', estimated: true };
  return { big: null, small: null, estimated: false };
}

const fill = (percent: number | null) => `${Math.max(0, Math.min(100, percent ?? 0))}%`;
/** A score worth a second look. Only the number is coloured; nothing shouts. */
const LOW = 70;

function Bar({ percent, color }: { percent: number | null; color: string | null }) {
  return (
    <span className={styles.track} aria-hidden="true">
      <span className={styles.fill} style={{ width: fill(percent), background: color ?? 'var(--accent)' }} />
    </span>
  );
}

function Grade({ course, large }: { course: GradeCourse; large?: boolean }) {
  const h = headline(course);
  const label = h.big
    ? `${h.estimated ? 'Average' : 'Course grade'} ${[h.big, h.small && !h.estimated ? h.small : ''].filter(Boolean).join(', ')}`
    : 'No grade yet';
  return (
    <span className={`${styles.grade} ${large ? styles.gradeLarge : ''}`} role="img" aria-label={label}>
      <span className={styles.gradeBig}>{h.big ?? '–'}</span>
      {h.small && <span className={styles.gradeSmall}>{h.small}</span>}
    </span>
  );
}

function Row({ item, color }: { item: GradeItem; color: string | null }) {
  const low = item.percent !== null && item.percent < LOW;
  return (
    <li className={styles.item}>
      <span className={styles.itemName}>
        {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a> : item.name}
        <span className={styles.itemMeta}>
          {item.source === 'gradescope' ? 'Gradescope' : 'Canvas'}
          {item.dueAt && ` · ${new Date(item.dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
          {item.late && ' · Late'}
        </span>
      </span>
      {item.percent !== null ? <Bar percent={item.percent} color={color} /> : <span />}
      <span className={styles.itemScore}>
        {showScore(item.score)}{item.max ? <span className={styles.outOf}> / {showScore(item.max)}</span> : null}
      </span>
      <span className={`${styles.itemPercent} ${low ? styles.low : ''}`}>{item.percent !== null ? showPercent(item.percent) : ''}</span>
    </li>
  );
}

export default function GradesTab() {
  const [courses, setCourses] = useState<GradeCourse[]>(() => buildGrades());
  const [open, setOpen] = useState<string | null>(null);
  const [synced, setSynced] = useState(() => deepSyncStatus()[0]?.syncedAt ?? null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const refresh = () => { setCourses(buildGrades()); setSynced(deepSyncStatus()[0]?.syncedAt ?? null); };
    // Subjects load after the page does, and a course takes its colour from its subject.
    const events = [CANVAS_CHANGED, 'soma_subjects_changed'];
    for (const e of events) window.addEventListener(e, refresh);
    return () => { for (const e of events) window.removeEventListener(e, refresh); };
  }, []);
  useEffect(() => { if (open) heading.current?.focus(); }, [open]);

  if (!courses.length) {
    return (
      <div className={styles.empty}>
        <span>No grades yet. Install the Soma for Canvas extension, open Canvas or Gradescope once, and turn on “Include grades and scores” in the extension.</span>
      </div>
    );
  }

  const course = courses.find(c => c.key === open);
  if (course) {
    const { code, title } = splitName(course.name);
    return (
      <div className={styles.page}>
        <button type="button" className={styles.back} onClick={() => setOpen(null)}>← All courses</button>
        <header className={styles.detailHead}>
          <div className={styles.detailName}>
            {(code || course.color) && (
              <span className={styles.code}>
                {course.color && <span className={styles.dot} style={{ background: course.color }} aria-hidden="true" />}
                {code}
              </span>
            )}
            <h1 ref={heading} tabIndex={-1} className={styles.detailTitle}>{title}</h1>
            {course.points && (
              <p className={styles.summary}>
                {course.items.length} graded · {showScore(course.points.earned)} of {showScore(course.points.possible)} points
              </p>
            )}
          </div>
          <Grade course={course} large />
        </header>
        {course.items.length ? (
          <>
            <div className={styles.columns} aria-hidden="true">
              <span>Assignment</span><span /><span className={styles.right}>Score</span><span className={styles.right}>%</span>
            </div>
            <ul className={styles.items}>
              {course.items.map((i, n) => <Row key={`${i.source}-${n}`} item={i} color={course.color} />)}
            </ul>
          </>
        ) : <p className={styles.none}>No scores posted yet.</p>}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Grades</h1>
        {synced && <p className={styles.synced}>Updated {formatDateTime(new Date(synced))}</p>}
      </header>
      <ul className={styles.list}>
        {courses.map(c => {
          const { code, title } = splitName(c.name);
          const h = headline(c);
          return (
            <li key={c.key}>
              <button type="button" className={styles.row} onClick={() => setOpen(c.key)} aria-label={`${c.name}, ${c.items.length} graded. Open`}>
                <span className={styles.rowName}>
                  {(code || c.color) && (
                    <span className={styles.code}>
                      {c.color && <span className={styles.dot} style={{ background: c.color }} aria-hidden="true" />}
                      {code}
                    </span>
                  )}
                  <span className={styles.rowTitle}>{title}</span>
                </span>
                <span className={styles.rowBar}>
                  <Bar percent={c.percent ?? c.points?.percent ?? null} color={c.color} />
                  <span className={styles.rowCount}>{c.items.length ? `${c.items.length} graded` : 'No scores yet'}</span>
                </span>
                <Grade course={c} />
                <span aria-hidden="true" className={styles.chevron}>{h.big ? '›' : ''}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
