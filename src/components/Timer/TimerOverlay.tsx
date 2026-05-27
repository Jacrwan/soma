import { useState, useEffect } from 'react';
import { useTimerContext } from '../../contexts/TimerContext';
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

export default function TimerOverlay() {
  const ctx = useTimerContext();
  const [taskInput, setTaskInput] = useState('');
  const [preElapsedInput, setPreElapsedInput] = useState('00:00');
  const [isStopping, setIsStopping] = useState(false);

  // Reset inputs when a new pending session opens
  useEffect(() => {
    if (ctx.pendingSession) {
      setTaskInput(ctx.pendingSession.initialTask);
      setPreElapsedInput('00:00');
    }
  }, [ctx.pendingSession]);

  // Scroll lock during input modal
  useEffect(() => {
    if (!ctx.pendingSession) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [ctx.pendingSession]);

  if (!ctx.pendingSession && !ctx.activeSession) return null;

  function handleStart() {
    if (!ctx.pendingSession) return;
    ctx.startSession(ctx.pendingSession.subject, taskInput, parsePreElapsed(preElapsedInput));
  }

  function handleStop() {
    setIsStopping(true);
    setTimeout(() => {
      ctx.stopSession();
      setIsStopping(false);
    }, 300);
  }

  if (ctx.pendingSession) {
    const { subject } = ctx.pendingSession;
    return (
      <div className={styles.backdrop} onClick={ctx.closeInputModal}>
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
            value={taskInput}
            autoFocus
            onChange={e => setTaskInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleStart(); if (e.key === 'Escape') ctx.closeInputModal(); }}
          />
          <button className={styles.startBtn} onClick={handleStart}>Start</button>
          <button className={styles.cancelLink} onClick={ctx.closeInputModal}>Cancel</button>
        </div>
      </div>
    );
  }

  const { subject, task } = ctx.activeSession!;
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
        <span className={styles.bannerTimer}>{fmtElapsed(ctx.elapsed)}</span>
      </div>
      <div className={styles.bannerRight}>
        <button
          className={styles.bannerBtn}
          title={ctx.isPaused || !ctx.isRunning ? 'Resume' : 'Pause'}
          onClick={() => ctx.isPaused || !ctx.isRunning ? ctx.resumeSession() : ctx.pauseSession()}
        >
          {ctx.isPaused || !ctx.isRunning ? '▶' : '⏸'}
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
