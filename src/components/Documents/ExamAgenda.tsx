import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTimerContext } from '../../contexts/TimerContext';
import { storage } from '../../lib/storage';
import { supabase } from '../../lib/supabase';
import { useProposals } from '../../lib/proposalStore';
import { applyProposal } from '../../lib/assistant';
import { formatClock, formatClockRange } from '../../lib/timeFormat';
import { blockTitle, dayKey, addDays, shortDay, weekNote, type ExamPlan } from '../../lib/examPlan';
import { daysBetween, milestoneDates, sittingLabel, stageOf } from '../../lib/examSittings';
import { clockOf, spanMinutes } from '../../lib/clockRange';
import { toneOf } from '../DashboardV2/liveData';
import type { CourseItem } from '../../lib/courseItems';
import type { Subject } from '../../types';
import { Capacity, duration, useExamAvailability } from './ExamAvailability';
import styles from './ExamPlans.module.css';

export default function ExamAgenda({ exam, userId, items, subject, onChange }: {
  exam: ExamPlan; userId: string; items: CourseItem[]; subject?: Subject; onChange: () => Promise<void>;
}) {
  const timer = useTimerContext();
  const today = dayKey(new Date());
  const prefs = storage.getSomaSettings().examPrep?.[exam.id];
  const milestones = milestoneDates(prefs?.start ?? today, exam.examDate);
  const { snapshot, free, error } = useExamAvailability(userId, exam.examDate);
  const proposals = useProposals(userId).filter(p => p.examPlanId === exam.id);
  const [choosing, setChoosing] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [message, setMessage] = useState('');
  const open = items.filter(i => !i.doneAt);
  const todoIds = new Set(open.map(i => i.todoId).filter(Boolean));
  const blocks = snapshot?.blocks.filter(b => b.todoId && todoIds.has(b.todoId)) ?? [];
  const future = blocks.filter(b => !b.ended);
  const daily = prefs?.daily ?? 180;
  const dayLoad = (day: number) => [...future, ...proposals].filter(b => b.day === day).reduce((n, b) => n + b.minutes, 0);
  const logged = (item: CourseItem) => {
    const title = snapshot?.todos.find(t => t.id === item.todoId)?.text;
    if (!title || items.filter(i => i.todoId === item.todoId).length > 1) return 0;
    return Math.round((snapshot?.history ?? []).filter(s => s.subject_id === exam.subjectId && s.task_text === title)
      .reduce((sum, s) => sum + (s.duration_seconds || 0), 0) / 60);
  };
  const remaining = (item: CourseItem) => Math.max(0, (item.minutes ?? 45) - logged(item));
  const available = snapshot && free.reduce((n, d, i) => n + Math.min(daily, dayLoad(i) + d.slots.reduce((sum, [a, z]) => sum + z - a, 0)), 0);
  const missed = open.filter(i => i.todoId && !future.some(b => b.todoId === i.todoId)
    && snapshot?.sessions.some(s => s.todoId === i.todoId && s.endTime && Date.parse(s.endTime) <= Date.now())
    && !proposals.some(p => p.coverIds?.includes(i.id)));
  const todayBlocks = future.filter(b => b.day === 0).sort((a, b) => a.time.localeCompare(b.time));
  function agendaTitle(title: string, linked: CourseItem[]) {
    if (linked.length !== 1) return title;
    const item = linked[0];
    const compact = sittingLabel(item.label);
    return title.startsWith(exam.title + ': ' + item.label) || title === item.label ? compact : title;
  }
  function choices(item: CourseItem) {
    const minutes = Math.max(5, remaining(item));
    return free.flatMap(({ slots, date }, day) => {
      if (date === milestones['Final review'] && stageOf(item.label + ' ' + (item.title ?? '')) !== 'Final review' && date > today) return [];
      if (dayLoad(day) + minutes > Math.max(daily, minutes)) return [];
      return slots.flatMap(([a, z]) => {
        const times = [];
        for (let start = a; start + minutes <= z; start += 30) times.push({ date, day, start, time: `${clockOf(start)}–${clockOf(start + minutes)}` });
        return times;
      });
    }).sort((a, b) => dayLoad(a.day) - dayLoad(b.day) || a.day - b.day || a.start - b.start);
  }
  async function move(item: CourseItem, slot: ReturnType<typeof choices>[number]) {
    if (!subject || !slot || accepting) return;
    const old = snapshot?.sessions.filter(s => s.todoId === item.todoId && s.endTime && Date.parse(s.endTime) <= Date.now())
      .sort((a, b) => b.endTime!.localeCompare(a.endTime!))[0];
    const single = old && items.filter(i => i.todoId === item.todoId).length === 1 && !logged(item);
    setAccepting(true);
    try {
      await applyProposal(userId, new Date(), {
        id: 'proposal:' + crypto.randomUUID(), title: single ? snapshot!.todos.find(t => t.id === item.todoId)!.text : blockTitle(exam.title, [item]),
        subject: subject.name, color: toneOf(subject.color), day: slot.day, time: slot.time,
        minutes: spanMinutes(...slot.time.split('–') as [string, string]), state: 'Proposal', examPlanId: exam.id, coverIds: [item.id],
        requestedDate: slot.date, pinned: true, note: weekNote(exam),
        ...(single && old.startTime ? {
          replaces: old.id, changeKind: 'move' as const, base: {
            day: daysBetween(today, old.date), time: [old.startTime, old.endTime!].map(t => {
              const d = new Date(t);
              return clockOf(d.getHours() * 60 + d.getMinutes());
            }).join('–'),
          }
        } : {}),
      });
      setChoosing('');
      setMessage(`Moved to ${shortDay(slot.date)} at ${formatClock(clockOf(slot.start))}.`);
      await onChange();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Couldn’t move this sitting.'); }
    finally { setAccepting(false); }
  }
  async function drop(item: CourseItem) {
    const { error } = await supabase.from('course_items').delete().eq('user_id', userId).eq('exam_id', exam.id).eq('id', item.id);
    if (error) {
      setMessage('Couldn’t drop this sitting. Please retry.');
      return;
    }
    await onChange();
    setMessage('Sitting removed from this exam.');
  }
  return <section className={styles.agenda} aria-label="Exam agenda">
    <h3>Today · {shortDay(today)}</h3>
    {todayBlocks.map(b => <div className={styles.agendaRow} key={b.id}>
      <div>
        <strong>{agendaTitle(b.title, items.filter(i => i.todoId === b.todoId))}</strong>
        <small>{formatClockRange(b.time)} · {duration(b.minutes)}</small>
      </div>
      <button
        className={styles.secondary}
        disabled={!subject || !!timer.activeSession}
        onClick={() => subject && timer.startSession(subject, b.title, 0)}>
        {timer.activeSession?.task === b.title ? 'Focus running' : 'Start Focus'}
      </button>
    </div>)}
    {proposals.filter(p => p.day === 0).map(p => <div className={styles.agendaRow} key={p.id}>
      <span>
        {agendaTitle(p.title, items.filter(i => p.coverIds?.includes(i.id)))}
        <small>{formatClockRange(p.time)} · Suggested</small>
      </span>
      <button
        className={styles.secondary}
        disabled={accepting || !subject || !!timer.activeSession}
        onClick={async () => {
          if (!subject) return;
          setAccepting(true);
          try {
            await applyProposal(userId, new Date(), p);
            timer.startSession(subject, p.title, 0);
            await onChange();
          }
          catch (err) { setMessage(err instanceof Error ? err.message : 'Couldn’t start this sitting.'); }
          finally { setAccepting(false); }
        }}>Accept &amp; start Focus
      </button>
    </div>)}
    {!todayBlocks.length && !proposals.some(p => p.day === 0) && <p className={styles.note}>{snapshot ? 'No sitting scheduled for today.' : 'Loading today’s sittings…'}</p>}
    {missed.map(i => {
      const options = choices(i), first = options[0];
      return <div className={styles.capacity} key={i.id}>
        <strong>Missed · {sittingLabel(i.label)}</strong>
        <div className={styles.actions}>
          {first && !error && <button className={styles.secondary} disabled={accepting} onClick={() => void move(i, first)}>Move to {shortDay(first.date)} {formatClock(clockOf(first.start))}?</button>}
          {first && !error && <button className={styles.linkish} onClick={() => setChoosing(i.id)}>Pick another time</button>}
          <button className={styles.linkish} onClick={() => void drop(i)}>Drop sitting</button>
          {choosing === i.id && <select
            aria-label={`Choose time for ${i.label}`}
            defaultValue=""
            disabled={accepting}
            onChange={e => void move(i, options[+e.target.value])}>
            <option disabled value="">Choose an open time</option>
            {options.map((s, j) => <option key={j} value={j}>{shortDay(s.date)} · {formatClockRange(s.time)}</option>)}
          </select>}
        </div>
      </div>;
    })}
    {message && <p role="status">
      {message}{' '}
      <Link to="/dashboard">Open dashboard</Link>
    </p>}
    <Capacity needed={open.reduce((n, i) => n + remaining(i), 0)} available={available} error={error}>
      {snapshot && <small>{duration(items.reduce((n, i) => n + logged(i), 0))} logged in Focus · {items.length - open.length} of {items.length} sittings covered</small>}
    </Capacity>
    <h3>This week</h3>
    <div className={styles.week}>
      {Array.from({ length: Math.min(7, daysBetween(today, exam.examDate) + 1) }, (_, i) => {
        const date = addDays(today, i), n = [...future, ...proposals].filter(b => b.day === i).length;
        return <span key={date}>
          {shortDay(date)}
          <small>
            {date === exam.examDate ? 'Exam' : date === milestones['Final review'] ? 'Timed practice' : date === milestones.Learn ? 'Finish learning' : date === milestones.Practice ? 'Finish practice' : n ? `${n} sitting${n === 1 ? '' : 's'}` : 'Open'}
          </small>
        </span>;
      })}
    </div>
  </section>;
}
