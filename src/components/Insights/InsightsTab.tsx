import { useMemo } from 'react';
import { getWeeklyStudyTime, getSubjectBreakdown, getEstimatedVsActual, getStudyStreak, getAIMemory } from '../../lib/insights';
import { storage } from '../../lib/storage';
import styles from './InsightsTab.module.css';

const PEAK_HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6am–11pm
const RING_R = 22;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R; // ≈ 138.23

function hourLabel(h: number): string {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyIcon}>
        <svg width="18" height="14" viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M1 13V8M6 13V4M11 13V6M16 13V1"/>
          <path d="M1 13h16" strokeOpacity="0.25"/>
        </svg>
      </span>
      <span className={styles.emptyMsg}>{message}</span>
    </div>
  );
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

  const ringOffset = RING_CIRCUMFERENCE * (1 - Math.min(streak, 7) / 7);

  return (
    <div className={styles.page}>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Study time — last 7 days</h2>
        <div className={styles.chart}>
          {weekly.map(({ day, minutes }) => {
            const isPeak = minutes === maxWeeklyMinutes && minutes > 0;
            const showLabel = minutes > 0 && minutes >= maxWeeklyMinutes * 0.45;
            return (
              <div key={day} className={styles.barCol}>
                <span className={styles.barValue}>
                  {showLabel ? formatHours(minutes) : ''}
                </span>
                <div className={styles.barTrack}>
                  <div
                    className={`${styles.bar}${isPeak ? ` ${styles.barPeak}` : ''}`}
                    style={{ height: `${(minutes / maxWeeklyMinutes) * 100}%` }}
                  />
                </div>
                <span className={styles.barLabel}>{dayLabel(day)}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Subject breakdown — last 7 days</h2>
        {breakdown.length === 0 ? (
          <EmptyState message="No study sessions recorded yet." />
        ) : (
          <div className={styles.breakdown}>
            {breakdown.map(({ subjectName, minutes }, index) => (
              <div key={subjectName} className={styles.breakdownRow}>
                <div className={styles.breakdownMeta}>
                  <span className={styles.breakdownName}>{subjectName}</span>
                  <span className={styles.breakdownTime}>{formatHours(minutes)}</span>
                </div>
                <div className={styles.hBarTrack}>
                  <div
                    className={styles.hBar}
                    style={{
                      width: `${(minutes / maxBreakdownMinutes) * 100}%`,
                      opacity: Math.max(0.38, 1 - index * 0.1),
                    }}
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
          <EmptyState message="Complete todos with time estimates to see this data." />
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
        <div className={styles.streakWidget}>
          <div className={styles.streakRingWrap}>
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r={RING_R} strokeWidth="3.5" className={styles.streakRingBg} />
              <circle
                cx="28" cy="28" r={RING_R}
                strokeWidth="3.5"
                className={styles.streakRingFill}
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={ringOffset}
                transform="rotate(-90 28 28)"
              />
            </svg>
            <div className={styles.streakInner}>
              <span className={styles.streakNum}>{streak}</span>
            </div>
          </div>
          <span className={styles.streakLabel}>day streak</span>
        </div>
      </section>

      {/* ── AI Memory sections ── */}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Time accuracy</h2>
        {!aiMemory ? (
          <EmptyState message="Complete more tasks to unlock AI insights." />
        ) : (() => {
          const rows = Object.entries(aiMemory.subjectTimeDeltas)
            .filter(([, d]) => d.sampleCount >= 3)
            .map(([id, d]) => ({
              name: subjectNameMap.get(id) ?? 'Unknown',
              avgDelta: Math.round((d.totalActual - d.totalEstimated) / d.sampleCount),
            }));
          return rows.length === 0 ? (
            <EmptyState message="Complete at least 3 timed todos per subject to see accuracy." />
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
          <EmptyState message="Complete more tasks to unlock AI insights." />
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
          <EmptyState message="Complete more tasks to unlock AI insights." />
        ) : (() => {
          const rows = Object.entries(aiMemory.subjectAverageDuration)
            .map(([id, avg]) => ({
              name: subjectNameMap.get(id) ?? 'Unknown',
              avg: Math.round(avg),
            }))
            .filter(r => r.avg > 0)
            .sort((a, b) => b.avg - a.avg);
          return rows.length === 0 ? (
            <EmptyState message="No pacing data yet." />
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
