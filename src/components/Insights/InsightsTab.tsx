import { useMemo, useState } from 'react';
import { summarizeInsights } from '../../lib/insights';
import { useInsights } from '../../lib/useInsights';
import { SkeletonBlock } from '../UI/Skeleton';
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

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {direction === 'left' ? <path d="M9 3.5 5 7.5 9 11.5" /> : <path d="M6 3.5 10 7.5 6 11.5" />}
    </svg>
  );
}

function InsightsSkeleton() {
  const BAR_HEIGHTS = [55, 80, 40, 100, 70, 30, 90];
  return (
    <div className={styles.page} role="status" aria-label="Loading insights" aria-busy="true">
      <header className={styles.pageHeader}>
        <div>
          <SkeletonBlock width={110} height={32} />
          <div style={{ marginTop: 10 }}>
            <SkeletonBlock width={260} height={12} />
          </div>
        </div>
        <div className={styles.summaryRail}>
          {[0, 1, 2].map(i => (
            <div key={i} className={styles.summaryItem}>
              <SkeletonBlock width={62} height={10} />
              <SkeletonBlock width={74} height={20} />
            </div>
          ))}
        </div>
      </header>

      {/* Full-width: bar chart */}
      <section className={styles.section}>
        <div style={{ height: 20, width: 120, marginBottom: 18 }}>
          <SkeletonBlock width={120} height={14} />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160 }}>
          {BAR_HEIGHTS.map((h, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}>
              <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                <SkeletonBlock width="100%" height={`${h}%`} borderRadius="6px 6px 0 0" />
              </div>
              <div style={{ marginTop: 8 }}>
                <SkeletonBlock width={22} height={10} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className={styles.columns}>
      <div className={styles.column}>

      {/* Left col: donut + legend */}
      <section className={styles.section}>
        <div style={{ marginBottom: 18 }}>
          <SkeletonBlock width={160} height={14} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <SkeletonBlock width={130} height={130} borderRadius="50%" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[100, 80, 120, 70].map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <SkeletonBlock width={8} height={8} borderRadius="50%" />
                <SkeletonBlock width={w} height={12} />
              </div>
            ))}
          </div>
        </div>
      </section>

      </div>
      <div className={styles.column}>

      {/* Right col: EVA rows */}
      <section className={styles.section}>
        <div style={{ marginBottom: 18 }}>
          <SkeletonBlock width={140} height={14} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {[140, 110, 160].map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: i < 2 ? '1px solid var(--border)' : 'none' }}>
              <SkeletonBlock width={w} height={12} />
              <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
                <SkeletonBlock width={48} height={11} />
              </div>
            </div>
          ))}
        </div>
      </section>

      </div>
      </div>
    </div>
  );
}

export default function InsightsTab({ userId }: { userId: string | null }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [calendarOffset, setCalendarOffset] = useState(0);
  const { data, loading, error, retry } = useInsights(userId);
  const { weekly, breakdown, estimated, streak, streakAtRisk, heatmapMinutesMap, peakHoursData,
    subjectPacingData, timeAccuracyData, subjects } = useMemo(
    () => summarizeInsights(data, weekOffset, calendarOffset),
    [data, weekOffset, calendarOffset],
  );

  const subjectNameMap = useMemo(() => new Map(subjects.map(s => [s.id, s.name])), [subjects]);
  const archivedSubjectNames = useMemo(() => new Set(subjects.filter(s => s.archived).map(s => s.name)), [subjects]);

  const maxWeeklyMinutes = Math.max(...weekly.map(d => d.minutes), 1);
  const totalWeeklyMinutes = useMemo(
    () => weekly.reduce((sum, d) => sum + d.minutes, 0),
    [weekly]
  );
  const bestDay = useMemo(
    () => weekly.reduce((best, d) => d.minutes > best.minutes ? d : best, weekly[0] ?? { day: '', minutes: 0 }),
    [weekly]
  );

  const maxPeakMinutes = Math.max(...PEAK_HOURS.map(h => peakHoursData[h] ?? 0), 1);
  const top3PeakHours = PEAK_HOURS
    .map(h => ({ h, m: peakHoursData[h] ?? 0 }))
    .sort((a, b) => b.m - a.m)
    .slice(0, 3)
    .map(x => x.h);

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
      const isToday = year === now.getFullYear() && month === now.getMonth() && d === now.getDate();
      cells.push({ day: d, minutes: heatmapMinutesMap[d] ?? 0, isToday });
    }
    const firstDow = new Date(year, month, 1).getDay();
    return { cells, firstDayOfWeekMon: (firstDow + 6) % 7, year, month };
  }, [calendarOffset, heatmapMinutesMap]);

  if (loading && (!data || data.sessions.length === 0)) return <InsightsSkeleton />;

  const errorNotice = error ? (
    <div role="alert">
      {error} <button onClick={retry} aria-label="Retry insights">Retry</button>
    </div>
  ) : null;
  if (!data || (error && data.sessions.length === 0)) return <div className={styles.page}>{errorNotice}</div>;

  const hasAnyData = data.sessions.length > 0;

  if (!hasAnyData) {
    return (
      <div className={styles.page} aria-busy={loading}>
        {errorNotice}
        <div className={styles.insightsEmpty}>
          <div className={styles.insightsEmptyIllo}>
            <svg width="36" height="28" viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
              <path d="M1 13V8M6 13V4M11 13V6M16 13V1"/>
              <path d="M1 13h16" strokeOpacity="0.25"/>
            </svg>
          </div>
          <h2 className={styles.insightsEmptyHeading}>No study data yet</h2>
          <p className={styles.insightsEmptyBody}>Start a task from your dashboard to begin tracking your study time.</p>
          <a href="/dashboard" className={styles.insightsEmptyBtn}>Go to Dashboard</a>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page} aria-busy={loading}>
      {errorNotice}
      <header className={styles.pageHeader}>
        <div className={styles.pageTitleBlock}>
          <h1 className={styles.pageTitle}>Insights</h1>
          <p className={styles.pageSubtitle}>Your study rhythm, organized by time, subject, and follow-through.</p>
        </div>
        <div className={styles.summaryRail} aria-label="Insights summary">
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>This week</span>
            <span className={styles.summaryValue}>{formatHours(totalWeeklyMinutes) || '0m'}</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Best day</span>
            <span className={styles.summaryValue}>{bestDay.minutes > 0 ? dayLabel(bestDay.day) : 'None'}</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Top subject</span>
            <span className={styles.summaryValue}>{breakdown[0]?.subjectName ?? 'None'}</span>
          </div>
        </div>
      </header>

      {/* ── Study time — full width ── */}
      <section className={styles.section}>
        <div className={styles.weekNavRow}>
          <button
            className={styles.weekNavBtn}
            onClick={() => setWeekOffset(o => o - 1)}
            aria-label="Previous week"
          ><ChevronIcon direction="left" /></button>
          <div className={styles.weekNavCenter}>
            <h2 className={styles.sectionTitle}>Study time</h2>
            <span className={styles.weekRange}>{fmtDateRange(weekOffset)}</span>
          </div>
          <button
            className={styles.weekNavBtn}
            onClick={() => setWeekOffset(o => o + 1)}
            disabled={weekOffset >= 0}
            aria-label="Next week"
          ><ChevronIcon direction="right" /></button>
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
                <div
                  className={styles.barTrack}
                  title={minutes > 0 ? `${formatHours(minutes)} studied` : 'No study time'}
                >
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
        <h2 className={styles.sectionTitle}>Peak study hours</h2>
        {maxPeakMinutes === 1 && PEAK_HOURS.every(h => !peakHoursData[h]) ? (
          <EmptyState message="No study sessions recorded yet." />
        ) : (
          <div className={styles.peakChart}>
            {PEAK_HOURS.map(h => {
              const minutes = peakHoursData[h] ?? 0;
              const isTop = top3PeakHours.includes(h);
              return (
                <div key={h} className={styles.peakCol}>
                  <div className={styles.peakTrack} title={minutes > 0 ? `${formatHours(minutes)} at ${hourLabel(h)}` : `No study time at ${hourLabel(h)}`}>
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

      <div className={styles.columns}>
      <div className={styles.column}>

      {/* ── Subject breakdown ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Subject breakdown — last 7 days</h2>
        {breakdown.length === 0 ? (
          <EmptyState message="No study sessions recorded yet." />
        ) : (
          <div className={styles.donutWrap}>
            <div className={styles.donutFigure}>
              <svg className={styles.donutSvg} viewBox="0 0 130 130" width="130" height="130" aria-hidden="true">
                <circle className={styles.donutBase} cx="65" cy="65" r={DONUT_R} fill="none" strokeWidth={DONUT_STROKE} />
                {donutSlices.map((slice, i) => (
                  <circle
                    key={i}
                    cx="65" cy="65" r={DONUT_R}
                    fill="none"
                    stroke={slice.color}
                    strokeWidth={DONUT_STROKE}
                    strokeLinecap="butt"
                    strokeDasharray={`${slice.arc} ${DONUT_C}`}
                    transform={`rotate(${slice.startAngle} 65 65)`}
                  />
                ))}
              </svg>
              <div className={styles.donutCenter}>
                <span>{formatHours(totalBreakdownMinutes) || '0m'}</span>
                <small>Total</small>
              </div>
            </div>
            <div className={styles.donutLegend}>
              {donutSlices.map((slice, i) => {
                const isArchived = archivedSubjectNames.has(slice.name);
                return (
                  <div key={i} className={`${styles.donutLegendItem}${isArchived ? ` ${styles.archivedItem}` : ''}`}>
                    <span className={styles.donutLegendDot} style={{ background: slice.color }} />
                    <span className={styles.donutLegendName}>
                      {slice.name}
                      {isArchived && <span className={styles.archivedBadge}>Archived</span>}
                    </span>
                    <span className={styles.donutLegendTime}>{formatHours(slice.minutes)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── Study streak — half col, pairs with Time Accuracy ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Study streak</h2>
        <div className={styles.streakHero}>
          <span className={styles.streakBigNum}>{streak}</span>
          <span className={styles.streakDayLabel}>day streak</span>
          {streakAtRisk && (
            <span className={styles.streakAtRiskNote}>Study today to keep it going</span>
          )}
        </div>

        <div className={styles.heatmapSection}>
          <div className={styles.heatmapNav}>
            <button
              className={styles.heatmapNavBtn}
              onClick={() => setCalendarOffset(o => o - 1)}
              aria-label="Previous month"
            ><ChevronIcon direction="left" /></button>
            <span className={styles.heatmapTitle}>
              {new Date(heatmapData.year, heatmapData.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
            <button
              className={styles.heatmapNavBtn}
              onClick={() => setCalendarOffset(o => o + 1)}
              disabled={calendarOffset >= 0}
              aria-label="Next month"
            ><ChevronIcon direction="right" /></button>
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
              const timeLabel = fmtCellTime(minutes);
              return (
                <div
                  key={day}
                  className={[
                    styles.heatmapCell,
                    styles[`heatLevel${level}` as keyof typeof styles],
                    isToday ? styles.heatmapCellToday : '',
                  ].filter(Boolean).join(' ')}
                  title={minutes > 0 ? `${minutes}m studied` : 'No study time'}
                >
                  <span className={styles.heatmapDayNum}>{day}</span>
                  {timeLabel && (
                    <span className={styles.heatmapTimeLabel}>{timeLabel}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      </div>
      <div className={styles.column}>

      {/* ── Estimated vs actual ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Estimated vs actual</h2>
        {estimated.length === 0 ? (
          <EmptyState message="Complete todos with time estimates to see this data." />
        ) : (
          <div className={styles.evaList}>
            <div className={styles.evaHeader}>
              <span>Task</span>
              <span>Est.</span>
              <span>Actual</span>
              <span>Delta</span>
            </div>
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
        <h2 className={styles.sectionTitle}>Time accuracy</h2>
        {(() => {
          const rows = Object.entries(timeAccuracyData)
            .filter(([, d]) => d.sampleCount >= 3)
            .map(([id, d]) => ({
              name: subjectNameMap.get(id) ?? 'Unknown',
              avgDelta: d.avgDeltaMinutes,
            }));
          return rows.length === 0 ? (
            <EmptyState message="Complete at least 3 timed todos per subject to see accuracy." />
          ) : (
            <div className={styles.evaList}>
              {rows.map(({ name, avgDelta }) => {
                const abs = Math.abs(avgDelta);
                const label = avgDelta > 0 ? `+${abs}m over` : `${abs}m under`;
                return (
                  <div key={name} className={`${styles.evaRow} ${styles.evaRowCompact}`}>
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
        <h2 className={styles.sectionTitle}>Subject pacing</h2>
        {(() => {
          const rows = Object.entries(subjectPacingData)
            .map(([id, avg]) => ({
              name: subjectNameMap.get(id) ?? 'Unknown',
              avg,
            }))
            .filter(r => r.avg > 0)
            .sort((a, b) => b.avg - a.avg);
          return rows.length === 0 ? (
            <EmptyState message="No pacing data yet." />
          ) : (
            <div className={styles.evaList}>
              {rows.map(({ name, avg }) => (
                <div key={name} className={`${styles.evaRow} ${styles.evaRowCompact}`}>
                  <span className={styles.evaText}>{name}</span>
                  <span className={styles.evaEst}>{formatHours(avg) || '0m'} avg / session</span>
                </div>
              ))}
            </div>
          );
        })()}
      </section>

      </div>
      </div>
    </div>
  );
}
