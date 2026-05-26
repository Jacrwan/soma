import { useMemo, useState } from 'react';
import { getWeeklyStudyTime, getSubjectBreakdown, getEstimatedVsActual, getStudyStreak, getAIMemory } from '../../lib/insights';
import { storage } from '../../lib/storage';
import styles from './InsightsTab.module.css';

const PEAK_HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6am–11pm
const DONUT_R = 55;
const DONUT_C = 2 * Math.PI * DONUT_R; // ≈ 345.58
const DONUT_STROKE = 14;

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

function heatLevel(minutes: number): number {
  if (minutes <= 0) return 0;
  if (minutes <= 30) return 1;
  if (minutes <= 60) return 2;
  if (minutes <= 120) return 3;
  if (minutes <= 180) return 4;
  return 5;
}

function fmtCellTime(minutes: number): string {
  if (minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h` : `${m}m`;
}

function fmtDateRange(weekOffset: number): string {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + weekOffset * 7);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const sm = months[start.getMonth()];
  const em = months[end.getMonth()];
  if (sm === em) return `${sm} ${start.getDate()}–${end.getDate()}`;
  return `${sm} ${start.getDate()} – ${em} ${end.getDate()}`;
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
  const [weekOffset, setWeekOffset] = useState(0);
  const [calendarOffset, setCalendarOffset] = useState(0);

  const weekly = useMemo(() => getWeeklyStudyTime(weekOffset), [weekOffset]);
  const breakdown = useMemo(() => getSubjectBreakdown(), []);
  const estimated = useMemo(() => getEstimatedVsActual(), []);
  const streak = useMemo(() => getStudyStreak(), []);
  const aiMemory = useMemo(() => getAIMemory(), []);
  const subjects = useMemo(() => storage.getSubjects(), []);
  const subjectNameMap = useMemo(() => new Map(subjects.map(s => [s.id, s.name])), [subjects]);

  const maxWeeklyMinutes = Math.max(...weekly.map(d => d.minutes), 1);

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

  const totalBreakdownMinutes = useMemo(
    () => breakdown.reduce((s, d) => s + d.minutes, 0),
    [breakdown]
  );

  const donutSlices = useMemo(() => {
    if (totalBreakdownMinutes === 0) return [];
    let cumAngle = 0;
    return breakdown.slice(0, 5).map((d) => {
      const fraction = d.minutes / totalBreakdownMinutes;
      const arc = fraction * DONUT_C;
      const startAngle = cumAngle - 90;
      cumAngle += fraction * 360;
      return {
        arc,
        startAngle,
        color: d.color,
        name: d.subjectName,
        minutes: d.minutes,
      };
    });
  }, [breakdown, totalBreakdownMinutes]);

  const heatmapData = useMemo(() => {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() + calendarOffset, 1);
    const year = target.getFullYear();
    const month = target.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { day: number; minutes: number; isToday: boolean }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const raw = localStorage.getItem(`soma_elapsed_${dateStr}`);
      let minutes = 0;
      if (raw) {
        try {
          const data: Record<string, number> = JSON.parse(raw);
          minutes = Math.round(Object.values(data).reduce((sum, m) => sum + m, 0));
        } catch {}
      }
      const isToday = year === now.getFullYear() && month === now.getMonth() && d === now.getDate();
      cells.push({ day: d, minutes, isToday });
    }
    const firstDow = new Date(year, month, 1).getDay();
    return { cells, firstDayOfWeekMon: (firstDow + 6) % 7, year, month };
  }, [calendarOffset]);

  return (
    <div className={styles.page}>

      {/* ── Study time — full width ── */}
      <section className={`${styles.section} ${styles.spanFull}`}>
        <div className={styles.weekNavRow}>
          <button
            className={styles.weekNavBtn}
            onClick={() => setWeekOffset(o => o - 1)}
            aria-label="Previous week"
          >‹</button>
          <div className={styles.weekNavCenter}>
            <h2 className={`${styles.sectionTitle} ${styles.sectionTitleStudy}`}>Study time</h2>
            <span className={styles.weekRange}>{fmtDateRange(weekOffset)}</span>
          </div>
          <button
            className={styles.weekNavBtn}
            onClick={() => setWeekOffset(o => o + 1)}
            disabled={weekOffset >= 0}
            aria-label="Next week"
          >›</button>
        </div>
        <div className={styles.chart}>
          {weekly.map(({ day, minutes }) => {
            const isPeak = minutes === maxWeeklyMinutes && minutes > 0;
            const showLabel = minutes > 0 && minutes >= maxWeeklyMinutes * 0.45;
            return (
              <div key={day} className={styles.barCol}>
                <span className={styles.barValue}>
                  {showLabel ? formatHours(minutes) : ''}
                </span>
                <div className={`${styles.barTrack}${minutes === 0 ? ` ${styles.barTrackEmpty}` : ''}`}>
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

      {/* ── Subject breakdown — left col ── */}
      <section
        className={styles.section}
        style={{ '--section-accent': donutSlices[0]?.color } as React.CSSProperties}
      >
        <h2 className={`${styles.sectionTitle} ${styles.sectionTitleDynamic}`}>Subject breakdown — last 7 days</h2>
        {breakdown.length === 0 ? (
          <EmptyState message="No study sessions recorded yet." />
        ) : (
          <div className={styles.donutWrap}>
            <svg viewBox="0 0 130 130" width="130" height="130" aria-hidden="true">
              {donutSlices.map((slice, i) => (
                <circle
                  key={i}
                  cx="65" cy="65" r={DONUT_R}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={DONUT_STROKE}
                  strokeDasharray={`${slice.arc} ${DONUT_C}`}
                  transform={`rotate(${slice.startAngle} 65 65)`}
                />
              ))}
            </svg>
            <div className={styles.donutLegend}>
              {donutSlices.map((slice, i) => (
                <div key={i} className={styles.donutLegendItem}>
                  <span className={styles.donutLegendDot} style={{ background: slice.color }} />
                  <span className={styles.donutLegendName}>{slice.name}</span>
                  <span className={styles.donutLegendTime}>{formatHours(slice.minutes)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Estimated vs actual — right col ── */}
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} ${styles.sectionTitleEva}`}>Estimated vs actual</h2>
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

      {/* ── Study streak — half col, pairs with Time Accuracy ── */}
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} ${styles.sectionTitleStreak}`}>Study streak</h2>
        <div className={styles.streakHero}>
          <svg width="32" height="44" viewBox="0 0 32 44" fill="none" className={styles.flameSvg} aria-hidden="true">
            <defs>
              <linearGradient id="flameGrad" x1="16" y1="43" x2="16" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#FF4500" />
                <stop offset="100%" stopColor="#FFB700" />
              </linearGradient>
            </defs>
            <path
              d="M16 43C5 43 1 33 4 24C6 17 9 13 13 8C15 4 15 1 18 0C22 3 26 10 27 17C29 24 28 33 25 39C22 43 27 43 16 43Z"
              fill="url(#flameGrad)"
            />
            <path
              d="M16 34C13 34 11 29 12 24C13 20 15 17 16 13C18 17 20 20 21 24C22 29 20 34 16 34Z"
              fill="#FFFDE7"
              opacity="0.55"
            />
          </svg>
          <div className={styles.streakMeta}>
            <span className={styles.streakBigNum}>{streak}</span>
            <span className={styles.streakDayLabel}>day streak</span>
          </div>
        </div>

        <div className={styles.heatmapSection}>
          <div className={styles.heatmapNav}>
            <button
              className={styles.heatmapNavBtn}
              onClick={() => setCalendarOffset(o => o - 1)}
              aria-label="Previous month"
            >‹</button>
            <span className={styles.heatmapTitle}>
              {new Date(heatmapData.year, heatmapData.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
            <button
              className={styles.heatmapNavBtn}
              onClick={() => setCalendarOffset(o => o + 1)}
              disabled={calendarOffset >= 0}
              aria-label="Next month"
            >›</button>
          </div>
          <div className={styles.heatmapDow}>
            {['M','T','W','T','F','S','S'].map((d, i) => (
              <span key={i} className={styles.heatmapDowCell}>{d}</span>
            ))}
          </div>
          <div className={styles.heatmapGrid}>
            {Array.from({ length: heatmapData.firstDayOfWeekMon }).map((_, i) => (
              <div key={`empty-${i}`} className={styles.heatmapCellEmpty} />
            ))}
            {heatmapData.cells.map(({ day, minutes, isToday }) => {
              const level = heatLevel(minutes);
              const isDark = level >= 3;
              const timeLabel = fmtCellTime(minutes);
              return (
                <div
                  key={day}
                  className={[
                    styles.heatmapCell,
                    styles[`heatLevel${level}` as keyof typeof styles],
                    isToday ? styles.heatmapCellToday : '',
                  ].filter(Boolean).join(' ')}
                  title={minutes > 0 ? `${minutes}m studied` : undefined}
                >
                  <span className={[styles.heatmapDayNum, isDark ? styles.heatmapDayNumDark : ''].filter(Boolean).join(' ')}>
                    {day}
                  </span>
                  {timeLabel && (
                    <span className={[styles.heatmapTimeLabel, isDark ? styles.heatmapTimeLabelDark : ''].filter(Boolean).join(' ')}>
                      {timeLabel}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
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

      <section className={`${styles.section} ${styles.spanFull}`}>
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
