import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pause, Play, Square } from 'lucide-react';
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
  const navigate = useNavigate();
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
    void ctx.stopSession().finally(() => setIsStopping(false));
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
  const running = ctx.isRunning && !ctx.isPaused;
  return (
    <aside
      className={`${styles.pill}${isStopping ? ` ${styles.pillOut}` : ''}`}
      aria-label="Focus timer"
    >
      <button
        className={styles.pillBody}
        onClick={() => navigate('/dashboard')}
        aria-label={`Focus: ${task || subject.name}. Open the dashboard.`}
      >
        <span
          className={`${styles.pillDot}${running ? ` ${styles.pillDotLive}` : ''}`}
          style={{ background: subject.color }}
        />
        <span className={styles.pillText}>
          <span className={styles.pillTask}>{task || subject.name}</span>
          <span className={styles.pillSubject}>{task ? subject.name : 'Focus session'}</span>
        </span>
        <span className={styles.pillTime}>{fmtElapsed(ctx.elapsed)}</span>
      </button>

      <div className={styles.pillActions}>
        <button
          className={styles.pillBtn}
          disabled={ctx.saving || ctx.savePending}
          aria-label={running ? 'Pause focus' : 'Resume focus'}
          onClick={() => running ? ctx.pauseSession() : ctx.resumeSession()}
        >
          {running ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          className={`${styles.pillBtn} ${styles.pillStop}`}
          disabled={ctx.saving}
          aria-label="Stop focus and save"
          onClick={handleStop}
        >
          <Square size={12} />
        </button>
      </div>

      {ctx.error && <p className={styles.pillError} role="alert">{ctx.error}</p>}
    </aside>
  );
}
