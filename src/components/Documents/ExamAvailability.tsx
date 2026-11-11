import { useEffect, useMemo, useState } from 'react';
import { readPlan, type Snapshot } from '../DashboardV2/liveData';
import { daysBetween } from '../../lib/examSittings';
import { dailyStudySlots, dayKey, MAX_DAYS_AHEAD } from '../../lib/examPlan';
import { storage } from '../../lib/storage';
import { useProposals } from '../../lib/proposalStore';
import styles from './ExamPlans.module.css';

export const duration = (m: number) => m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;

export function useExamAvailability(userId: string, date: string) {
  const today = dayKey(new Date());
  const days = Math.min(MAX_DAYS_AHEAD, Math.max(0, daysBetween(today, date)));
  const proposals = useProposals(userId);
  const [data, setData] = useState<{ key: string; snapshot?: Snapshot; error?: string }>();
  const key = userId + date + today;
  useEffect(() => {
    if (!userId || !Number.isFinite(days)) return;
    let live = true;
    let sequence = 0;
    const load = () => {
      const request = ++sequence;
      void readPlan(userId, new Date(), -1, days + 1).then(snapshot => {
        if (live && request === sequence) setData({ key, snapshot });
      }).catch(() => { if (live && request === sequence) setData({ key, error: 'Couldn’t load your calendar capacity.' }); });
    };
    load();
    window.addEventListener('focus', load);
    window.addEventListener('soma_insights_changed', load);
    window.addEventListener('soma_todos_changed', load);
    return () => {
      live = false;
      window.removeEventListener('focus', load);
      window.removeEventListener('soma_insights_changed', load);
      window.removeEventListener('soma_todos_changed', load);
    };
  }, [userId, days, key]);
  const snapshot = data?.key === key ? data.snapshot : undefined;
  const board = useMemo(() => snapshot && ({ ...snapshot, blocks: [...snapshot.blocks, ...proposals.filter(p => p.time && p.replaces === undefined)] }), [snapshot, proposals]);
  const free = useMemo(() => {
    if (!board) return [];
    const origin = new Date(today + 'T00:00:00');
    return dailyStudySlots(board, origin, storage.getSomaSettings(), new Date(), days);
  }, [board, today, days]);
  return { snapshot, board, free, error: data?.key === key ? data.error || snapshot?.calendarError : undefined };
}

export function Capacity({ needed, available, error, children }: { needed: number; available?: number; error?: string; children?: React.ReactNode }) {
  const short = available === undefined ? 0 : Math.max(0, needed - available);
  return <section className={styles.capacity} aria-label="Study capacity">
    <div>
      <strong>{duration(needed)} needed</strong>
      <span> · {error ? 'Capacity unavailable' : available === undefined ? 'Checking your calendar…' : `${duration(available)} available before the exam`}</span>
    </div>
    {!error && available !== undefined && <><progress
      aria-label="Time needed versus available"
      value={Math.min(needed, available)}
      max={Math.max(needed, available, 1)} />
      <small>{short ? `${duration(short)} over capacity` : `${duration(available - needed)} to spare`}</small></>}
    {error && <small>{error}</small>}
    {children}
  </section>;
}
