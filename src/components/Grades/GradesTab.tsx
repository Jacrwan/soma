import { useState, useEffect } from 'react';
import { storage } from '../../lib/storage';
import { getGrades } from '../../lib/canvas';
import { CanvasGrade } from '../../types';
import styles from './GradesTab.module.css';

const COURSE_COLORS = [
  '#ef5350', '#42a5f5', '#66bb6a', '#ab47bc',
  '#ffa726', '#26c6da', '#ec407a', '#8d6e63',
];

function scoreColor(score: number | null): string {
  if (score === null) return 'var(--text-muted)';
  if (score >= 90) return '#66bb6a';
  if (score >= 80) return '#42a5f5';
  if (score >= 70) return '#ffa726';
  return '#ef5350';
}

function letterColor(grade: string | null): string {
  if (!grade) return 'var(--text-muted)';
  if (grade.startsWith('A')) return '#66bb6a';
  if (grade.startsWith('B')) return '#42a5f5';
  if (grade.startsWith('C')) return '#ffa726';
  return '#ef5350';
}

export default function GradesTab() {
  const [token] = useState(() => storage.getCanvasToken());
  const [baseUrl] = useState(() => storage.getCanvasBaseUrl());
  const [grades, setGrades] = useState<CanvasGrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isConnected = !!token && !!baseUrl;

  useEffect(() => {
    if (!isConnected) return;
    loadGrades();
  }, []);

  async function loadGrades(force = false) {
    if (force) setLoading(true); else setLoading(true);
    setError('');
    try {
      const data = await getGrades(token, baseUrl);
      setGrades(data);
    } catch {
      setError('Failed to load grades. Check your Canvas connection.');
    } finally {
      setLoading(false);
    }
  }

  if (!isConnected) {
    return (
      <div className={styles.empty}>
        <span>Connect Canvas first in the Canvas tab.</span>
      </div>
    );
  }

  const gpa = (() => {
    const scored = grades.filter(g => g.currentScore !== null);
    if (!scored.length) return null;
    return (scored.reduce((sum, g) => sum + g.currentScore!, 0) / scored.length).toFixed(1);
  })();

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <span className={styles.pageTitle}>Grades</span>
        <button
          className={styles.refreshBtn}
          onClick={() => loadGrades(true)}
          disabled={loading}
          title="Refresh"
        >↻</button>
      </div>

      {loading && <div className={styles.loading}>Loading…</div>}

      {!loading && error && (
        <div className={styles.errorState}>
          <span>{error}</span>
          <button className={styles.retryBtn} onClick={() => loadGrades()}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <div className={styles.content}>
          {gpa !== null && (
            <div className={styles.summary}>
              <span className={styles.summaryLabel}>Current Average</span>
              <span className={styles.summaryScore} style={{ color: scoreColor(Number(gpa)) }}>
                {gpa}%
              </span>
            </div>
          )}

          <div className={styles.courseList}>
            {grades.length === 0 ? (
              <div className={styles.emptyState}>No grade data available.</div>
            ) : grades.map((g, i) => (
              <div key={g.courseId} className={styles.courseRow}>
                <span
                  className={styles.courseDot}
                  style={{ background: COURSE_COLORS[i % COURSE_COLORS.length] }}
                />
                <div className={styles.courseInfo}>
                  <span className={styles.courseName}>{g.courseName}</span>
                  <span className={styles.courseCode}>{g.courseCode}</span>
                </div>
                <div className={styles.gradeRight}>
                  {g.currentScore !== null ? (
                    <>
                      <span
                        className={styles.letterGrade}
                        style={{ color: letterColor(g.currentGrade) }}
                      >
                        {g.currentGrade ?? '—'}
                      </span>
                      <span
                        className={styles.scorePercent}
                        style={{ color: scoreColor(g.currentScore) }}
                      >
                        {g.currentScore.toFixed(1)}%
                      </span>
                    </>
                  ) : (
                    <span className={styles.noGrade}>No grade</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
