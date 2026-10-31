import { useCallback, useEffect, useRef, useState } from 'react';
import { buildGrades, headline, type GradeCourse } from '../../lib/grades';
import { cachedGradeBooks, emptyBook, GRADE_BOOKS_CHANGED, loadGradeBooks, saveGradeBook, type GradeBook } from '../../lib/gradeBooks';
import { CANVAS_CHANGED, deepSyncStatus } from '../../lib/canvasExtension';
import { storage } from '../../lib/storage';
import { formatDateTime } from '../../lib/timeFormat';
import CourseGrades, { Bar, Grade } from './CourseGrades';
import styles from './GradesTab.module.css';

/**
 * Grades. The page is one row per course, in its subject colour, with its
 * one grade big: Canvas, Gradescope and scores the student typed in, weighted
 * the way the syllabus says once that is set up. Starred courses are the only
 * ones shown when there are any. Opening a course shows how it's graded and
 * every score (CourseGrades).
 */

/** "CS-170-1: Intro to Computer Science I - Fall 2026" → code and title. */
function splitName(name: string): { code: string; title: string } {
  const [head, ...rest] = name.split(':');
  return rest.length && head.trim().length <= 16 ? { code: head.trim(), title: rest.join(':').trim() } : { code: '', title: name };
}

function Star({ on, name, onToggle }: { on: boolean; name: string; onToggle: () => void }) {
  return (
    <button type="button" className={`${styles.star} ${on ? styles.starOn : ''}`} onClick={onToggle} aria-pressed={on} aria-label={on ? `Unstar ${name}` : `Star ${name}`} title={on ? 'Starred' : 'Star to keep on this page'}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <path d="M10 2.2l2.35 4.9 5.35.72-3.9 3.73.97 5.33L10 14.3l-4.77 2.58.97-5.33-3.9-3.73 5.35-.72z" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function CourseRow({ course, onOpen, onStar }: { course: GradeCourse; onOpen: () => void; onStar: () => void }) {
  const { code, title } = splitName(course.name);
  const h = headline(course);
  const count = course.items.length;
  return (
    <li className={styles.rowWrap}>
      <button type="button" className={styles.row} onClick={onOpen} aria-label={`${course.name}, ${count ? `${count} graded` : 'no scores yet'}. Open`}>
        <span className={styles.dot} style={{ background: course.color ?? 'var(--border)' }} aria-hidden="true" />
        <span className={styles.rowName}>
          {code && <span className={styles.code}>{code}</span>}
          <span className={styles.rowTitle}>{title}</span>
        </span>
        <span className={styles.rowBar}>
          <Bar percent={course.weighted?.percent ?? course.percent ?? course.points?.percent ?? null} color={course.color} />
          <span className={styles.rowCount}>
            {count ? `${count} graded` : 'No scores yet'}
            {h.kind === 'weighted' && (course.weighted?.mode === 'points' ? ' · by points' : ' · weighted')}
          </span>
        </span>
        <Grade course={course} />
        <span aria-hidden="true" className={styles.chevron}>›</span>
      </button>
      <Star on={!!course.book?.starred} name={course.name} onToggle={onStar} />
    </li>
  );
}

export default function GradesTab() {
  const [courses, setCourses] = useState<GradeCourse[]>(() => buildGrades());
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState('');
  const [synced, setSynced] = useState(() => deepSyncStatus()[0]?.syncedAt ?? null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const refresh = () => { setCourses(buildGrades()); setSynced(deepSyncStatus()[0]?.syncedAt ?? null); };
    // Subjects load after the page does, and a course takes its colour from its subject.
    const events = [CANVAS_CHANGED, 'soma_subjects_changed', GRADE_BOOKS_CHANGED];
    for (const e of events) window.addEventListener(e, refresh);
    // On a direct visit the courses may not have loaded yet, and loading them
    // announces nothing, so the page asks for them itself.
    Promise.allSettled([storage.getUserId().then(loadGradeBooks), storage.fetchSubjects()]).then(refresh);
    return () => { for (const e of events) window.removeEventListener(e, refresh); };
  }, []);
  useEffect(() => { if (open) heading.current?.focus(); }, [open]);

  /**
   * Change a course's grade book and save it; the page redraws from the saved
   * copy. Saves run one at a time, each on the book the last one saved, so two
   * quick picks can't overwrite each other.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const change = useCallback((course: GradeCourse, edit: (book: GradeBook) => GradeBook) => {
    const run = queue.current.catch(() => {}).then(async () => {
      const userId = await storage.getUserId();
      const latest = cachedGradeBooks().find(b => course.aliases.includes(b.courseKey)) ?? course.book ?? emptyBook(course.key);
      await saveGradeBook(userId, edit(latest));
    });
    queue.current = run;
    return run;
  }, []);
  const star = (course: GradeCourse) => {
    setError('');
    change(course, b => ({ ...b, starred: !b.starred })).catch(e => setError(e instanceof Error ? e.message : 'Could not save. Please retry.'));
  };

  if (!courses.length) {
    return (
      <div className={styles.empty} data-tour="grades">
        <span>No grades yet. Add your courses, or install the Soma for Canvas extension and turn on “Include grades and scores” to bring in Canvas grades.</span>
      </div>
    );
  }

  const course = courses.find(c => c.key === open);
  if (course) {
    const { code, title } = splitName(course.name);
    return <CourseGrades course={course} code={code} title={title} headingRef={heading} onBack={() => setOpen(null)} onChange={edit => change(course, edit)} />;
  }

  const starred = courses.filter(c => c.book?.starred);
  const shown = starred.length ? starred : courses;
  const others = starred.length ? courses.filter(c => !c.book?.starred) : [];
  const row = (c: GradeCourse) => <CourseRow key={c.key} course={c} onOpen={() => setOpen(c.key)} onStar={() => star(c)} />;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Grades</h1>
        {synced && <p className={styles.synced}>Canvas updated {formatDateTime(new Date(synced))}</p>}
      </header>
      {!starred.length && courses.length > 1 && <p className={styles.hint}>Star the courses you want to see and only those stay here.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <ul className={styles.list} data-tour="grades">{shown.map(row)}</ul>
      {others.length > 0 && (
        <>
          <button type="button" className={styles.more} onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
            {showAll ? 'Hide other courses' : `${others.length} other course${others.length === 1 ? '' : 's'}`}
          </button>
          {showAll && <ul className={`${styles.list} ${styles.otherList}`}>{others.map(row)}</ul>}
        </>
      )}
    </div>
  );
}
