import { useState, useEffect, useRef, useCallback, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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

const POS_KEY = 'soma_timer_pos';
/** Gap kept between the pill and the viewport edges when clamping. */
const EDGE = 8;

interface Pos { x: number; y: number }

function readPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pos;
    return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? p : null;
  } catch {
    return null;
  }
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

  // Where the user has dragged the pill. null means the default corner, which
  // stays in CSS so the untouched case needs no inline styles.
  const pillRef = useRef<HTMLElement>(null);
  const [pos, setPos] = useState<Pos | null>(readPos);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; dx: number; dy: number; moved: boolean } | null>(null);
  // Set when a drag ends, so the pointerup's click does not also navigate.
  const suppressClickRef = useRef(false);

  /** Keep the pill fully on screen — a position saved on a wide monitor must
      not strand it off the edge of a laptop. */
  const clamp = useCallback((x: number, y: number): Pos => {
    // offsetWidth/Height are the untransformed layout box. getBoundingClientRect
    // includes the entrance animation's scale and translate, which would make
    // the pill clamp against a box it does not actually occupy once settled.
    const el = pillRef.current;
    const w = el?.offsetWidth ?? 280;
    const h = el?.offsetHeight ?? 56;
    const maxX = Math.max(EDGE, window.innerWidth - w - EDGE);
    const maxY = Math.max(EDGE, window.innerHeight - h - EDGE);
    return { x: Math.min(Math.max(EDGE, x), maxX), y: Math.min(Math.max(EDGE, y), maxY) };
  }, []);

  const savePos = useCallback((next: Pos | null) => {
    try {
      if (next) localStorage.setItem(POS_KEY, JSON.stringify(next));
      else localStorage.removeItem(POS_KEY);
    } catch { /* non-fatal */ }
  }, []);

  // A stored position from a larger window, or a window that has since been
  // resized, is pulled back into view rather than left unreachable. The pill
  // also changes height after web fonts load, which moves its bottom edge, so
  // its own size is watched too — a single clamp on mount would be stale.
  useEffect(() => {
    if (!ctx.activeSession) return;
    const reclamp = () => setPos(p => (p ? clamp(p.x, p.y) : p));
    reclamp();
    window.addEventListener('resize', reclamp);
    const el = pillRef.current;
    const ro = el && 'ResizeObserver' in window ? new ResizeObserver(reclamp) : null;
    if (el && ro) ro.observe(el);
    return () => {
      window.removeEventListener('resize', reclamp);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.activeSession, clamp]);

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

  function onPointerDown(e: ReactPointerEvent<HTMLElement>) {
    if (e.button !== 0 || !pillRef.current) return;
    const rect = pillRef.current.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLElement>) {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved) {
      // Only past a small threshold, so a tap on the pill still counts as a click.
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
      d.moved = true;
      setDragging(true);
    }
    setPos(clamp(e.clientX - d.dx, e.clientY - d.dy));
  }

  function endDrag(e: ReactPointerEvent<HTMLElement>) {
    const d = dragRef.current;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d?.moved) return;
    setDragging(false);
    suppressClickRef.current = true;
    setPos(p => { if (p) savePos(p); return p; });
  }

  function onPillKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    const step = e.shiftKey ? 1 : 12;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    if (e.key === 'Escape' && pos) {
      e.preventDefault();
      resetPos();
      return;
    }
    const delta = deltas[e.key];
    if (!delta) return;
    e.preventDefault();
    const rect = pillRef.current?.getBoundingClientRect();
    const from = pos ?? { x: rect?.left ?? 0, y: rect?.top ?? 0 };
    const next = clamp(from.x + delta[0], from.y + delta[1]);
    setPos(next);
    savePos(next);
  }

  function resetPos() {
    setPos(null);
    savePos(null);
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
      ref={pillRef}
      className={`${styles.pill}${isStopping ? ` ${styles.pillOut}` : ''}${dragging ? ` ${styles.pillDragging}` : ''}`}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
      aria-label="Focus timer"
    >
      <button
        className={styles.pillBody}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onPillKeyDown}
        onClick={() => {
          // A drag ends with a click on the same element; ignore that one.
          if (suppressClickRef.current) { suppressClickRef.current = false; return; }
          navigate('/dashboard');
        }}
        title="Drag to move · arrow keys to nudge · Esc to reset"
        aria-label={`Focus: ${task || subject.name}. Open the dashboard. Drag to move, arrow keys to nudge, Escape to reset its position.`}
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
