import { useMemo } from 'react';
import { getWeeklyStudyTime, getSubjectBreakdown, getEstimatedVsActual, getStudyStreak } from '../../lib/insights';
import styles from './InsightsTab.module.css';

const DAY_LABELS: Record<string, string> = {
  '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat',
};

function dayLabel(dateStr: string): string {
  return DAY_LABELS[String(new Date(dateStr + 'T00:00:00').getDay())];
}

function formatHours(minutes: number): string {
  if (minutes === 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function InsightsTab() {
  const weekly = useMemo(() => getWeeklyStudyTime(), []);
  const breakdown = useMemo(() => getSubjectBreakdown(), []);
  const estimated = useMemo(() => getEstimatedVsActual(), []);
  const streak = useMemo(() => getStudyStreak(), []);

  void estimated;

  const maxWeeklyMinutes = Math.max(...weekly.map(d => d.minutes), 1);
  const maxBreakdownMinutes = Math.max(...breakdown.map(s => s.minutes), 1);

  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Study time — last 7 days</h2>
        <div className={styles.chart}>
          {weekly.map(({ day, minutes }) => (
            <div key={day} className={styles.barCol}>
              <span className={styles.barValue}>{formatHours(minutes)}</span>
              <div className={styles.barTrack}>
                <div
                  className={styles.bar}
                  style={{ height: `${(minutes / maxWeeklyMinutes) * 100}%` }}
                />
              </div>
              <span className={styles.barLabel}>{dayLabel(day)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Subject breakdown — last 7 days</h2>
        {breakdown.length === 0 ? (
          <p className={styles.empty}>No study sessions recorded yet.</p>
        ) : (
          <div className={styles.breakdown}>
            {breakdown.map(({ subjectName, minutes }) => (
              <div key={subjectName} className={styles.breakdownRow}>
                <div className={styles.breakdownMeta}>
                  <span className={styles.breakdownName}>{subjectName}</span>
                  <span className={styles.breakdownTime}>{formatHours(minutes)}</span>
                </div>
                <div className={styles.hBarTrack}>
                  <div
                    className={styles.hBar}
                    style={{ width: `${(minutes / maxBreakdownMinutes) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Study streak</h2>
        <div className={styles.streakRow}>
          <span className={styles.streakNumber}>{streak}</span>
          <span className={styles.streakLabel}>day streak</span>
        </div>
      </section>
    </div>
  );
}
