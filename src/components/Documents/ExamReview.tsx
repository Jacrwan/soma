import { useMemo, useState } from 'react';
import { type StudyDraft, dayKey, shortDay, placeBlocks } from '../../lib/examPlan';
import { confidenceLevels, milestoneDates, prepareSittings, sizing, stages, type Confidence } from '../../lib/examSittings';
import { Capacity, duration, useExamAvailability } from './ExamAvailability';
import { storage } from '../../lib/storage';
import type { SomaDocument } from '../../types';
import PriorityBar from './PriorityBar';
import styles from './ExamPlans.module.css';

export default function ExamReview({ userId, date, title, topics, reading, docs, note, initialConfidence, initialDaily, pending, error, onBack, onApprove }: {
  userId: string; date: string; title: string; topics: StudyDraft[]; reading: string[]; docs: SomaDocument[]; note: string;
  initialConfidence: Record<string, Confidence>; initialDaily: number; pending: boolean; error: string; onBack: () => void;
  onApprove: (rows: StudyDraft[], confidence: Record<string, Confidence>, daily: number, horizon: 'today' | 'week' | 'later') => void;
}) {
  const [confidence, setConfidence] = useState(initialConfidence);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<StudyDraft[] | null>(null);
  const [showConfidence, setShowConfidence] = useState(true);
  const [previousInputs, setPreviousInputs] = useState({ confidence, rates });
  const [horizon, setHorizon] = useState<'today' | 'week' | 'later'>('week');
  const [daily, setDaily] = useState(initialDaily);
  const { snapshot, board, free, error: calendarError } = useExamAvailability(userId, date);
  const dates = milestoneDates(dayKey(new Date()), date);
  const sizes = topics.map(d => sizing(d, reading));
  const units = [...new Set(sizes.map(s => s.unit))];
  const total = (rows ?? []).reduce((n, d) => n + d.minutes, 0);
  const available = snapshot && free.reduce((sum, day) => sum + Math.min(daily, day.slots.reduce((n, [a, z]) => n + z - a, 0)), 0);
  const missing = useMemo(() => {
    if (!board || !rows || calendarError) return 0;
    const origin = new Date(), start = dayKey(origin), deadlines = milestoneDates(start, date);
    const preview = { id: 'preview', subjectId: '', title, examDate: date };
    const items = rows.filter(r => r.label.trim()).map((r, i) => ({
      ...r, id: String(i), subjectId: '', examId: preview.id,
      title: r.detail, position: i, due: deadlines[r.phase ?? 'Practice']
    }));
    const settings = { ...storage.getSomaSettings(), examPrep: { preview: { start, daily, confidence: {} } } };
    return placeBlocks(preview, items, board, origin, settings, { name: '', color: '' }, 'exam', new Map(), origin).missing;
  }, [board, rows, calendarError, date, title, daily]);
  const edit = (index: number, patch: Partial<StudyDraft>) => setRows(prev => prev && prev.map((r, i) => i === index ? { ...r, ...patch } : r));
  function review() {
    if (!rows) setRows(topics.flatMap((d, i) => prepareSittings(d, reading, confidence[d.label], rates[sizes[i].unit])));
    else {
      const updated = topics.flatMap((d, i) => {
        const unit = sizes[i].unit;
        if (confidence[d.label] === previousInputs.confidence[d.label] && rates[unit] === previousInputs.rates[unit]) {
          return rows.filter(r => r.topic === d.label);
        }
        return prepareSittings(d, reading, confidence[d.label], rates[unit]);
      });
      setRows([...updated, ...rows.filter(r => !r.topic)]);
    }
    setPreviousInputs({ confidence, rates });
    setShowConfidence(false);
  }
  if (showConfidence || !rows) return <>
    <div className={styles.step}>
      <small>{title} · Topic confidence</small>
      <h2>How well do you know each topic?</h2>
      <p>Choose a lighter review or allow more time for a first pass. Leave a topic unmarked to keep its original estimate.</p>
    </div>
    <div className={styles.topicList}>
      {topics.map(d => <div className={styles.topic} key={d.label}>
        <div>
          <strong>{d.label}</strong>
          <small>{docs.find(doc => doc.id === d.documentId)?.fileName ?? d.detail}</small>
        </div>
        <div className={styles.pills} role="group" aria-label={`Confidence for ${d.label}`}>
          {confidenceLevels.map(c => <button
            type="button"
            key={c}
            aria-pressed={confidence[d.label] === c}
            onClick={() => setConfidence(prev => ({ ...prev, [d.label]: c }))}>{c}</button>)}
        </div>
      </div>)}
    </div>
    <div className={styles.calibration}>
      <h3>Calibrate your pace</h3>
      {units.map(unit => <label key={unit}>{`Minutes per ${unit}`}
        <input
          type="number"
          min={1}
          max={600}
          placeholder="Use estimate"
          value={rates[unit] ?? ''}
          onChange={e => setRates(prev => {
            const next = { ...prev };
            if (+e.target.value > 0) next[unit] = Math.min(600, +e.target.value); else delete next[unit];
            return next;
          })} />
      </label>)}
    </div>
    <div className={styles.builderActions}>
      <button className={styles.quiet} onClick={onBack}>Back to files</button>
      <button className={styles.primary} onClick={review}>Continue to checklist</button>
    </div>
  </>;
  return <>
    <div className={styles.step}>
      <small>Review checklist · {shortDay(date)}</small>
      <h2>{title}</h2>
    </div>
    <Capacity needed={total} available={available} error={calendarError}>
      {missing > 0 && <small>{missing} {missing === 1 ? 'sitting needs' : 'sittings need'} a different time or a shorter duration to fit before the milestones.</small>}
      <div className={styles.capacityActions}>
        <label>Daily study budget
          <input
            aria-label="Daily study budget in minutes"
            type="number"
            min={15}
            max={1440}
            step={15}
            value={daily}
            onChange={e => setDaily(Math.min(1440, Math.max(15, +e.target.value)))} /> min
        </label>
        {available !== undefined && !calendarError && (total > available || missing > 0) && rows.some(d => d.priority <= 2) && <button className={styles.linkish} onClick={() => setRows(rows.filter(d => d.priority > 2))}>Trim low-priority sittings</button>}
      </div>
    </Capacity>
    {note && <details className={styles.note}>
      <summary>How Soma built this checklist</summary>
      {note}
    </details>}
    <div className={styles.week} aria-label="Exam milestones">
      {stages.map(phase => <span key={phase}>
        {shortDay(dates[phase])}
        <small>{phase === 'Learn' ? 'Finish learning' : phase === 'Practice' ? 'Finish practice' : 'Protected practice day'}</small>
      </span>)}
      <span>
        {shortDay(date)}
        <small>Exam</small>
      </span>
    </div>
    {stages.filter(phase => rows.some(r => r.phase === phase)).map(phase => <section className={styles.phase} key={phase}>
      <header>
        <h3>{phase}</h3>
        <span>Finish by {shortDay(dates[phase])} · {duration(rows.filter(r => r.phase === phase).reduce((n, r) => n + r.minutes, 0))}</span>
      </header>
      <div role="table" aria-label={phase}>
        {rows.map((r, i) => r.phase === phase && <div role="row" aria-label={r.label} className={styles.reviewRow} key={i}>
          <div className={styles.reviewText}>
            <input aria-label="What" value={r.label} maxLength={40} onChange={e => edit(i, { label: e.target.value })} />
            <input
              aria-label={`Detail for ${r.label}`}
              value={r.detail ?? ''}
              maxLength={120}
              onChange={e => edit(i, { detail: e.target.value })} />
            <small>{r.documentId && docs.find(d => d.id === r.documentId)?.fileName} {r.estimateBasis}</small>
          </div>
          <label className={styles.reviewMinutes}>
            <input
              aria-label={`Minutes for ${r.label}`}
              type="number"
              min={5}
              max={600}
              value={r.minutes}
              onChange={e => edit(i, { minutes: Math.max(5, Math.min(600, +e.target.value)), estimateBasis: 'Your estimate' })} /> min
          </label>
          <div className={styles.priorityControl}>
            <small>{r.priority >= 4 ? 'High' : r.priority <= 2 ? 'Low' : 'Med'}</small>
            <PriorityBar size="sm" value={r.priority} onChange={priority => edit(i, { priority })} />
          </div>
          <button
            className={styles.removeSitting}
            aria-label={`Remove ${r.label}`}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
        </div>)}
      </div>
    </section>)}
    <button className={styles.addRow} onClick={() => setRows([...rows, { label: '', minutes: 30, phase: 'Practice', priority: 3 }])}>Add an item</button>
    {error && <p role="alert">{error}</p>}
    <div className={styles.builderActions}>
      <button className={styles.quiet} disabled={pending} onClick={() => setShowConfidence(true)}>Back to confidence</button>
      <label className={styles.note}>Suggest sittings
        <select aria-label="Planning horizon" value={horizon} onChange={e => setHorizon(e.target.value as typeof horizon)}>
          <option value="week">This week</option>
          <option value="today">Today</option>
          <option value="later">Later</option>
        </select>
      </label>
      <button
        className={styles.primary}
        disabled={pending || (!snapshot && !calendarError) || !rows.some(r => r.label.trim())}
        onClick={() => onApprove(rows.map(r => ({ ...r, due: dates[r.phase!] })), confidence, daily, horizon)}>
        {pending ? 'Saving…' : 'Approve checklist'}
      </button>
    </div>
    <small className={styles.note}>{rows.length} sittings · {duration(total)}</small>
  </>;
}
