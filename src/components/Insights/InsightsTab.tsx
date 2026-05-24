import { useMemo } from 'react';
import { getWeeklyStudyTime, getSubjectBreakdown, getEstimatedVsActual, getStudyStreak, getAIMemory } from '../../lib/insights';
import { storage } from '../../lib/storage';
import styles from './InsightsTab.module.css';

const PEAK_HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6am–11pm

function hourLabel(h: number): string {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

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

function formatDelta(estimated: number, actual: number): { label: string; over: boolean } {
  const diff = actual - estimated;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const time = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  return diff > 0
    ? { label: `+${time} over`, over: true }
    : { label: `${time} under`, over: false };
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

export default function InsightsTab() {
  const weekly = useMemo(() => getWeeklyStudyTime(), []);
  const breakdown = useMemo(() => getSubjectBreakdown(), []);
  const estimated = useMemo(() => getEstimatedVsActual(), []);
  const streak = useMemo(() => getStudyStreak(), []);
  const aiMemory = useMemo(() => getAIMemory(), []);
  const subjects = useMemo(() => storage.getSubjects(), []);
  const subjectNameMap = useMemo(() => new Map(subjects.map(s => [s.id, s.name])), [subjects]);

  const maxWeeklyMinutes = Math.max(...weekly.map(d => d.minutes), 1);
  const maxBreakdownMinutes = Math.max(...breakdown.map(s => s.minutes), 1);

  const maxPeakMinutes = aiMemory
    ? Math.max(...PEAK_HOURS.map(h => aiMemory.peakHours[h] ?? 0), 1)
    : 1;
  const top3PeakHours = aiMemory
    ? PEAK_HOURS
        .map(h => ({ h, m: aiMemory.peakHours[h] ?? 0 }))
        .sort((a, b) => b.m - a.m)
        .slice(0, 3)
        .map(x => x.h)
    : [];

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
        <h2 className={styles.sectionTitle}>Estimated vs actual</h2>
        {estimated.length === 0 ? (
          <p className={styles.empty}>Complete some todos with time estimates to see this data.</p>
        ) : (
          <div className={styles.evaList}>
            {estimated.map(({ text, estimated: est, actual }) => {
              const delta = formatDelta(est, actual);
              return (
                <div key={text} className={styles.evaRow}>
                  <span className={styles.evaText}>{truncate(text, 40)}</span>
                  <span className={styles.evaEst}>{formatHours(est)}</span>
                  <span className={styles.evaActual}>{formatHours(actual)}</span>
                  <span className={delta.over ? styles.evaOver : styles.evaUnder}>
                    {delta.label}
                  </span>
                </div>
              );
            })}
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

      {/* ── AI Memory sections ── */}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Time accuracy</h2>
        {!aiMemory ? (
          <p className={styles.empty}>Complete more tasks to unlock AI insights.</p>
        ) : (() => {
          const rows = Object.entries(aiMemory.subjectTimeDeltas)
            .filter(([, d]) => d.sampleCount >= 3)
            .map(([id, d]) => ({
              name: subjectNameMap.get(id) ?? 'Unknown',
              avgDelta: Math.round((d.totalActual - d.totalEstimated) / d.sampleCount),
            }));
          return rows.length === 0 ? (
            <p className={styles.empty}>Need more data — complete at least 3 timed todos per subject.</p>
          ) : (
            <div className={styles.evaList}>
              {rows.map(({ name, avgDelta }) => {
                const abs = Math.abs(avgDelta);
                const label = avgDelta > 0 ? `+${abs}m over` : `${abs}m under`;
                return (
                  <div key={name} className={styles.evaRow}>
                    <span className={styles.evaText}>{name}</span>
                    <span className={avgDelta > 0 ? styles.evaOver : styles.evaUnder}>{label}</span>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Peak study hours</h2>
        {!aiMemory ? (
          <p className={styles.empty}>Complete more tasks to unlock AI insights.</p>
        ) : (
          <div className={styles.peakChart}>
            {PEAK_HOURS.map(h => {
              const minutes = aiMemory.peakHours[h] ?? 0;
              const isTop = top3PeakHours.includes(h);
              return (
                <div key={h} className={styles.peakCol}>
                  <div className={styles.peakTrack}>
                    <div
                      className={`${styles.peakBar}${isTop ? ` ${styles.peakBarTop}` : ''}`}
                      style={{ height: `${(minutes / maxPeakMinutes) * 100}%` }}
                    />
                  </div>
                  <span className={`${styles.peakLabel}${isTop ? ` ${styles.peakLabelTop}` : ''}`}>
                    {hourLabel(h)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Subject pacing</h2>
        {!aiMemory ? (
          <p className={styles.empty}>Complete more tasks to unlock AI insights.</p>
        ) : (() => {
          const rows = Object.entries(aiMemory.subjectAverageDuration)
            .map(([id, avg]) => ({
              name: subjectNameMap.get(id) ?? 'Unknown',
              avg: Math.round(avg),
            }))
            .filter(r => r.avg > 0)
            .sort((a, b) => b.avg - a.avg);
          return rows.length === 0 ? (
            <p className={styles.empty}>No pacing data yet.</p>
          ) : (
            <div className={styles.evaList}>
              {rows.map(({ name, avg }) => (
                <div key={name} className={styles.evaRow}>
                  <span className={styles.evaText}>{name}</span>
                  <span className={styles.evaEst}>{formatHours(avg)} avg / session</span>
                </div>
              ))}
            </div>
          );
        })()}
      </section>
    </div>
  );
}
