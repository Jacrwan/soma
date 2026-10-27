import { useEffect, useRef, useState } from 'react';
import { buildGrades, showPercent, showScore, type GradeCourse } from '../../lib/grades';
import { CANVAS_CHANGED } from '../../lib/canvasExtension';
import styles from './GradesTab.module.css';

/**
 * Grades, from what the Soma for Canvas extension synced. The page is the
 * courses, each with its grade big; opening one shows the score on every
 * graded assignment, Canvas and Gradescope together.
 */

/** "CS-170-1: Intro to Computer Science I - Fall 2026" → code and title. */
function splitName(name: string): { code: string; title: string } {
  const [head, ...rest] = name.split(':');
  return rest.length && head.trim().length <= 16 ? { code: head.trim(), title: rest.join(':').trim() } : { code: '', title: name };
}

/** The big number: Canvas's course grade, else the points earned over the points possible. */
function headline(c: GradeCourse): { letter: string | null; percent: number | null; estimated: boolean } {
  if (c.letter || c.percent !== null) return { letter: c.letter, percent: c.percent, estimated: false };
  return { letter: null, percent: c.points?.percent ?? null, estimated: c.points !== null };
}

function BigGrade({ course, size }: { course: GradeCourse; size: 'card' | 'detail' }) {
  const h = headline(course);
  const label = h.letter || h.percent !== null
    ? `${h.estimated ? 'Average' : 'Course grade'} ${[h.letter, h.percent !== null ? showPercent(h.percent) : ''].filter(Boolean).join(', ')}`
    : 'No grade yet';
  return (
    <p className={`${styles.big} ${size === 'detail' ? styles.bigDetail : ''}`} aria-label={label}>
      {h.letter && <span className={styles.letter} aria-hidden="true">{h.letter}</span>}
      {h.percent !== null
        ? <span className={h.letter ? styles.percent : styles.percentOnly} aria-hidden="true">{showPercent(h.percent)}</span>
        : !h.letter && <span className={styles.percent} aria-hidden="true">–</span>}
      {h.estimated && <span className={styles.estimate} aria-hidden="true">average</span>}
    </p>
  );
}

export default function GradesTab() {
  const [courses, setCourses] = useState<GradeCourse[]>(() => buildGrades());
  const [open, setOpen] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const refresh = () => setCourses(buildGrades());
    window.addEventListener(CANVAS_CHANGED, refresh);
    return () => window.removeEventListener(CANVAS_CHANGED, refresh);
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
            {code && <span className={styles.code}>{code}</span>}
            <h1 ref={heading} tabIndex={-1} className={styles.detailTitle}>{title}</h1>
          </div>
          <BigGrade course={course} size="detail" />
        </header>
        {course.points && (
          <p className={styles.summary}>
            {course.items.length} graded · {showScore(course.points.earned)} of {showScore(course.points.possible)} points
          </p>
        )}
        {course.items.length ? (
          <ul className={styles.items}>
            {course.items.map((i, n) => (
              <li key={`${i.source}-${n}`} className={styles.item}>
                <div className={styles.itemMain}>
                  <span className={styles.itemName}>
                    {i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer">{i.name}</a> : i.name}
                  </span>
                  <span className={styles.itemMeta}>
                    {i.source === 'gradescope' ? 'Gradescope' : 'Canvas'}
                    {i.dueAt && ` · ${new Date(i.dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    {i.late && ' · Late'}
                  </span>
                  {i.percent !== null && (
                    <span className={styles.bar} role="presentation"><span style={{ width: `${Math.max(0, Math.min(100, i.percent))}%` }} /></span>
                  )}
                </div>
                <div className={styles.itemScore}>
                  <span className={styles.points}>{showScore(i.score)}{i.max ? <span className={styles.outOf}> / {showScore(i.max)}</span> : null}</span>
                  {i.percent !== null && <span className={styles.itemPercent}>{showPercent(i.percent)}</span>}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className={styles.none}>No scores posted yet.</p>}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Grades</h1>
      <ul className={styles.grid}>
        {courses.map(c => {
          const { code, title } = splitName(c.name);
          return (
            <li key={c.key}>
              <button type="button" className={styles.card} onClick={() => setOpen(c.key)} aria-label={`${c.name}, ${c.items.length} graded. Open`}>
                <span className={styles.cardName}>
                  {code && <span className={styles.code}>{code}</span>}
                  <span className={styles.cardTitle}>{title}</span>
                </span>
                <BigGrade course={c} size="card" />
                <span className={styles.cardFoot}>
                  {c.items.length ? `${c.items.length} graded` : 'No scores yet'}
                  <span aria-hidden="true" className={styles.chevron}>→</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
