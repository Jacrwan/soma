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

  void breakdown; void estimated; void streak;

  const maxMinutes = Math.max(...weekly.map(d => d.minutes), 1);

  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Study time — last 7 days</h2>
        <div className={styles.chart}>
          {weekly.map(({ day, minutes }) => {
            const heightPct = (minutes / maxMinutes) * 100;
            return (
              <div key={day} className={styles.barCol}>
                <span className={styles.barValue}>{formatHours(minutes)}</span>
                <div className={styles.barTrack}>
                  <div
                    className={styles.bar}
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
                <span className={styles.barLabel}>{dayLabel(day)}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
