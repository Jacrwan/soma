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
  const { elapsed, isRunning, isPaused, startTime, start, pause, resume, stop } = useTimer();
  const liveBlockRef = useRef<TimeBlock | null>(null);
  const startTimeRef = useRef<string | null>(null);
  const elapsedRef = useRef(0);

  // Keep refs in sync so handleStop can read latest values
  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);

  // Live block growth every 60s while timer is on the running step
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
    const now = new Date().toISOString();
    startTimeRef.current = now;
    start();
    setStep('running');

    // Find a matching block to track for live growth
    const nowDate = new Date(now);
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

    // 1 & 2. Create and save session
    const session: TimerSession = {
      id: crypto.randomUUID(),
      subjectId: subject.id,
      task,
      startTime: sessionStartTime,
      endTime,
      durationSeconds,
    };
    storage.setTimerSessions([...storage.getTimerSessions(), session]);

    // 3. Update subject totalTimeToday
    const updatedSubjects = storage.getSubjects().map(s =>
      s.id === subject.id ? { ...s, totalTimeToday: s.totalTimeToday + durationSeconds } : s
    );
    storage.setSubjects(updatedSubjects);

    // 4. Block logic
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

    // 5. Notify parent with today's blocks
    onSessionSaved(updatedSubjects, updatedBlocks.filter(b => isToday(b.startTime)));
    onClose();
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.card} onClick={e => e.stopPropagation()}>
        {step === 'input' ? (
          <>
            <div className={styles.subjectLine}>
              <SubjectDot color={subject.color} size={12} />
              <span className={styles.subjectName}>{subject.name}</span>
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
          </>
        ) : (
          <>
            <div className={styles.subjectLine}>
              <span
                className={styles.pulseDot}
                style={{ background: subject.color }}
              />
              <SubjectDot color={subject.color} size={12} />
              <span className={styles.subjectName}>{subject.name}</span>
            </div>
            <div className={styles.elapsed}>{fmtElapsed(elapsed)}</div>
            {task && <div className={styles.taskLabel}>{task}</div>}
            <div className={styles.controls}>
              {isPaused || !isRunning ? (
                <button className={`${styles.controlBtn} ${styles.controlBtnAccent}`} onClick={resume}>Resume</button>
              ) : (
                <button className={styles.controlBtn} onClick={pause}>Pause</button>
              )}
              <button className={`${styles.controlBtn} ${styles.controlBtnDanger}`} onClick={handleStop}>Stop</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
