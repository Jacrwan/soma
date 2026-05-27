import { useState, useEffect, useRef } from 'react';
import { Subject, TimerSession, TimeBlock } from '../../types';
import { storage } from '../../lib/storage';
import { updateAIMemory } from '../../lib/insights';
import { useTimer } from '../../hooks/useTimer';
import styles from './TimerOverlay.module.css';

function toLocalISO(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
}

function fmtElapsed(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parsePreElapsed(s: string): number {
  const parts = s.trim().split(':').map(p => parseInt(p, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function isToday(iso: string) {
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear()
    && d.getMonth() === n.getMonth()
    && d.getDate() === n.getDate();
}

export interface ResumeData {
  elapsedSeconds: number;
  sessionStartTimeISO: string;
  isPaused: boolean;
}

interface Props {
  subject: Subject;
  onClose: () => void;
  onSessionSaved: (updatedSubjects: Subject[], updatedBlocks: TimeBlock[]) => void;
  onRunningChange?: (isRunning: boolean) => void;
  initialTask?: string;
  resumeData?: ResumeData;
}

export default function TimerOverlay({ subject, onClose, onSessionSaved, onRunningChange, initialTask, resumeData }: Props) {
  const [task, setTask] = useState(initialTask ?? '');
  const [step, setStep] = useState<'input' | 'running'>('input');
  const [isStopping, setIsStopping] = useState(false);
  const [preElapsedInput, setPreElapsedInput] = useState('00:00');
  const { elapsed, isRunning, isPaused, start, pause, resume, stop } = useTimer();
  const startTimeRef = useRef<string | null>(null);
  const elapsedRef = useRef(0);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resumeDataRef = useRef(resumeData);

  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);

  // Auto-resume from Supabase active_timer on mount
  useEffect(() => {
    const rd = resumeDataRef.current;
    if (!rd) return;
    startTimeRef.current = rd.sessionStartTimeISO;
    start(rd.elapsedSeconds);
    if (rd.isPaused) pause();
    setStep('running');
    onRunningChange?.(!rd.isPaused);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock scroll only during input modal
  useEffect(() => {
    if (step === 'input') document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [step]);


  // Cleanup timeout on unmount
  useEffect(() => {
    return () => { clearTimeout(stopTimeoutRef.current); };
  }, []);

  function handleStart() {
    const preSeconds = parsePreElapsed(preElapsedInput);
    const now = new Date();
    const adjustedStart = new Date(now.getTime() - preSeconds * 1000);
    const sessionStartISO = toLocalISO(adjustedStart);
    startTimeRef.current = sessionStartISO;
    start(preSeconds);
    setStep('running');
    onRunningChange?.(true);
    void storage.upsertActiveTimer({
      subject_id: subject.id,
      subject_name: subject.name,
      task_text: task || null,
      session_start_time: sessionStartISO,
      start_time: toLocalISO(now),
      accumulated_seconds: preSeconds,
      is_paused: false,
    }).catch(() => {});
  }

  function handlePause() {
    pause();
    const acc = elapsedRef.current;
    void storage.upsertActiveTimer({
      subject_id: subject.id,
      subject_name: subject.name,
      task_text: task || null,
      session_start_time: startTimeRef.current ?? toLocalISO(new Date()),
      start_time: toLocalISO(new Date()),
      accumulated_seconds: acc,
      is_paused: true,
    }).catch(() => {});
  }

  function handleResume() {
    resume();
    const acc = elapsedRef.current;
    void storage.upsertActiveTimer({
      subject_id: subject.id,
      subject_name: subject.name,
      task_text: task || null,
      session_start_time: startTimeRef.current ?? toLocalISO(new Date()),
      start_time: toLocalISO(new Date()),
      accumulated_seconds: acc,
      is_paused: false,
    }).catch(() => {});
  }

  function handleStop() {
    setIsStopping(true);
    stop();
    const endTime = toLocalISO(new Date());
    const sessionStartTime = startTimeRef.current;
    if (!sessionStartTime) {
      stopTimeoutRef.current = setTimeout(() => { onRunningChange?.(false); onClose(); }, 300);
      return;
    }

    const durationSeconds = elapsedRef.current;

    const session: TimerSession = {
      id: crypto.randomUUID(),
      subjectId: subject.id,
      task,
      startTime: sessionStartTime,
      endTime,
      durationSeconds,
    };
    storage.setTimerSessions([...storage.getTimerSessions(), session]);
    void storage.saveTimerSession(session, subject.name).catch(() => {});
    void storage.deleteActiveTimer().catch(() => {});

    const matchedTodo = storage.getTodos().find(t => t.text === task && t.subjectId === subject.id);
    updateAIMemory({
      subjectId: subject.id,
      startHour: new Date(sessionStartTime).getHours(),
      durationMinutes: Math.round(durationSeconds / 60),
      estimatedMinutes: matchedTodo?.estimatedMinutes,
    });

    const updatedSubjects = storage.getSubjects().map(s =>
      s.id === subject.id ? { ...s, totalTimeToday: s.totalTimeToday + durationSeconds } : s
    );
    storage.setSubjects(updatedSubjects);

    const allBlocks = storage.getTimeBlocks();
    const newBlock: TimeBlock = {
      id: crypto.randomUUID(),
      subjectId: subject.id,
      task,
      startTime: sessionStartTime,
      endTime,
      source: 'manual',
      timerSessionId: session.id,
    };
    const updatedBlocks = [...allBlocks, newBlock];
    storage.setTimeBlocks(updatedBlocks);
    onSessionSaved(updatedSubjects, updatedBlocks.filter(b => isToday(b.startTime)));

    stopTimeoutRef.current = setTimeout(() => {
      onRunningChange?.(false);
      onClose();
    }, 300);
  }

  if (step === 'input') {
    return (
      <div className={styles.backdrop} onClick={onClose}>
        <div className={styles.modal} onClick={e => e.stopPropagation()}>
          <div className={styles.subjectLine}>
            <span className={styles.dot} style={{ background: subject.color }} />
            <span className={styles.subjectName}>{subject.name}</span>
          </div>
          <div className={styles.preElapsedRow}>
            <span className={styles.preElapsedLabel}>Time already spent</span>
            <input
              className={styles.preElapsedInput}
              value={preElapsedInput}
              placeholder="00:00"
              onChange={e => setPreElapsedInput(e.target.value)}
            />
          </div>
          <input
            className={styles.taskInput}
            placeholder="What are you working on? (optional)"
            value={task}
            autoFocus
            onChange={e => setTask(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleStart(); if (e.key === 'Escape') onClose(); }}
          />
          <button className={styles.startBtn} onClick={handleStart}>Start</button>
          <button className={styles.cancelLink} onClick={onClose}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.focusBanner}${isStopping ? ` ${styles.focusBannerOut}` : ''}`}>
      <div className={styles.bannerLeft}>
        <span className={styles.bannerDot} style={{ background: subject.color }} />
        <span className={styles.bannerSubject}>{subject.name}</span>
        {task && (
          <>
            <span className={styles.bannerSep}>/</span>
            <span className={styles.bannerTask}>{task}</span>
          </>
        )}
      </div>
      <div className={styles.bannerCenter}>
        <span className={styles.bannerTimer}>{fmtElapsed(elapsed)}</span>
      </div>
      <div className={styles.bannerRight}>
        <button
          className={styles.bannerBtn}
          title={isPaused || !isRunning ? 'Resume' : 'Pause'}
          onClick={() => isPaused || !isRunning ? handleResume() : handlePause()}
        >
          {isPaused || !isRunning ? '▶' : '⏸'}
        </button>
        <button
          className={styles.bannerStopBtn}
          title="Stop"
          onClick={handleStop}
        >
          ■
        </button>
      </div>
    </div>
  );
}
