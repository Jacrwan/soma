import { useEffect, useState } from 'react';
import { buildGrades, showPercent, showScore, type GradeCourse } from '../../lib/grades';
import { CANVAS_CHANGED } from '../../lib/canvasExtension';
import styles from './GradesTab.module.css';

/**
 * Grades, from what the Soma for Canvas extension synced: each course's grade
 * and the score on each graded assignment, Canvas and Gradescope together.
 */
export default function GradesTab() {
  const [courses, setCourses] = useState<GradeCourse[]>(() => buildGrades());

  useEffect(() => {
    const refresh = () => setCourses(buildGrades());
    window.addEventListener(CANVAS_CHANGED, refresh);
    return () => window.removeEventListener(CANVAS_CHANGED, refresh);
  }, []);

  if (!courses.length) {
    return (
      <div className={styles.empty}>
        <span>No grades yet. Install the Soma for Canvas extension, open Canvas or Gradescope once, and turn on “Include grades and scores” in the extension.</span>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Grades</h1>
      <div className={styles.grid}>
        {courses.map(c => (
          <section key={c.key} className={styles.card} aria-labelledby={`grade-${c.key}`}>
            <header className={styles.cardHead}>
              <h2 id={`grade-${c.key}`} className={styles.course}>{c.name}</h2>
              {(c.letter || c.percent !== null) && (
                <p className={styles.courseGrade} aria-label={`Course grade ${[c.letter, c.percent !== null ? showPercent(c.percent) : ''].filter(Boolean).join(', ')}`}>
                  {c.letter && <span className={styles.letter}>{c.letter}</span>}
                  {c.percent !== null && <span className={styles.percent}>{showPercent(c.percent)}</span>}
                </p>
              )}
            </header>
            {c.items.length ? (
              <ul className={styles.items}>
                {c.items.map((i, n) => (
                  <li key={`${i.source}-${n}`} className={styles.item}>
                    <span className={styles.itemName}>
                      {i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer">{i.name}</a> : i.name}
                      {i.source === 'gradescope' && <span className={styles.tag}>Gradescope</span>}
                      {i.late && <span className={styles.tag}>Late</span>}
                    </span>
                    <span className={styles.itemScore}>
                      {showScore(i.score)}{i.max ? ` / ${showScore(i.max)}` : ''}
                      {i.percent !== null && <span className={styles.itemPercent}> · {showPercent(i.percent)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className={styles.none}>No scores posted yet.</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
