import { useState, useEffect, useRef } from 'react';
import { Subject, TimerSession, TimeBlock } from '../../types';
import { storage } from '../../lib/storage';
import { useTimer } from '../../hooks/useTimer';
import SubjectDot from '../shared/SubjectDot';
import styles from './TimerOverlay.module.css';

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

interface Props {
  subject: Subject;
  onClose: () => void;
  onSessionSaved: (updatedSubjects: Subject[], updatedBlocks: TimeBlock[]) => void;
  onLiveBlockUpdate?: (block: TimeBlock) => void;
  initialTask?: string;
}

export default function TimerOverlay({ subject, onClose, onSessionSaved, onLiveBlockUpdate, initialTask }: Props) {
  const [task, setTask] = useState(initialTask ?? '');
  const [step, setStep] = useState<'input' | 'running'>('input');
  const [preElapsedInput, setPreElapsedInput] = useState('00:00');
  const [expanded, setExpanded] = useState(false);
  const { elapsed, isRunning, isPaused, start, pause, resume, stop } = useTimer();
  const liveBlockRef = useRef<TimeBlock | null>(null);
  const startTimeRef = useRef<string | null>(null);
  const elapsedRef = useRef(0);

  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);

  // Lock scroll only during input modal, not during floating pill
  useEffect(() => {
    if (step === 'input') document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [step]);

  // Live block growth every 60s
  useEffect(() => {
    if (step !== 'running') return;
    const id = setInterval(() => {
      if (!liveBlockRef.current) return;
      const updated: TimeBlock = { ...liveBlockRef.current, endTime: new Date().toISOString() };
      liveBlockRef.current = updated;
      onLiveBlockUpdate?.(updated);
    }, 60_000);
    return () => clearInterval(id);
  }, [step]);

  function handleStart() {
    const preSeconds = parsePreElapsed(preElapsedInput);
    const now = new Date();
    const adjustedStart = new Date(now.getTime() - preSeconds * 1000);
    startTimeRef.current = adjustedStart.toISOString();
    start(preSeconds);
    setStep('running');

    const nowDate = new Date();
    const matching = storage.getTimeBlocks().find(b =>
      b.subjectId === subject.id &&
      isToday(b.startTime) &&
      new Date(b.startTime) <= nowDate &&
      new Date(b.endTime) >= nowDate
    );
    liveBlockRef.current = matching ?? null;
  }

  function handleStop() {
    stop();
    const endTime = new Date().toISOString();
    const sessionStartTime = startTimeRef.current;
    if (!sessionStartTime) { onClose(); return; }

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

    const updatedSubjects = storage.getSubjects().map(s =>
      s.id === subject.id ? { ...s, totalTimeToday: s.totalTimeToday + durationSeconds } : s
    );
    storage.setSubjects(updatedSubjects);

    const allBlocks = storage.getTimeBlocks();
    const sessionStart = new Date(sessionStartTime);
    const matchingBlock = allBlocks.find(b =>
      b.subjectId === subject.id &&
      isToday(b.startTime) &&
      new Date(b.startTime) <= sessionStart &&
      new Date(b.endTime) >= sessionStart
    );

    let updatedBlocks: TimeBlock[];
    if (matchingBlock) {
      updatedBlocks = allBlocks.map(b =>
        b.id === matchingBlock.id ? { ...b, endTime, timerSessionId: session.id } : b
      );
    } else {
      const newBlock: TimeBlock = {
        id: crypto.randomUUID(),
        subjectId: subject.id,
        task,
        startTime: sessionStartTime,
        endTime,
        source: 'manual',
        timerSessionId: session.id,
      };
      updatedBlocks = [...allBlocks, newBlock];
    }
    storage.setTimeBlocks(updatedBlocks);

    onSessionSaved(updatedSubjects, updatedBlocks.filter(b => isToday(b.startTime)));
    onClose();
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
    <div
      className={`${styles.pill}${expanded ? ` ${styles.pillExpanded}` : ''}`}
      onClick={() => setExpanded(e => !e)}
    >
      <div className={styles.pillMain}>
        <span className={styles.pulseDot} style={{ background: subject.color }} />
        <span className={styles.pillSubject}>{subject.name}</span>
        <span className={styles.pillElapsed}>{fmtElapsed(elapsed)}</span>
        <button
          className={styles.pillBtn}
          title={isPaused || !isRunning ? 'Resume' : 'Pause'}
          onClick={e => { e.stopPropagation(); isPaused || !isRunning ? resume() : pause(); }}
        >
          {isPaused || !isRunning ? '▶' : '⏸'}
        </button>
        <button
          className={styles.pillBtn}
          title="Stop"
          onClick={e => { e.stopPropagation(); handleStop(); }}
        >
          ■
        </button>
      </div>
      {expanded && task && <div className={styles.pillTask}>{task}</div>}
    </div>
  );
}
