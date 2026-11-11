import { useRef, useState } from 'react';
import styles from './PriorityBar.module.css';

/**
 * Five-step priority as one slider: a track that fills up to a knob at the
 * level, like an effort slider (owner, 2026-11-10: five separate pills read
 * as five things, and didn't line up). Default comes from the AI; the
 * student clicks or drags anywhere on the track, or uses the arrow keys,
 * Home and End. It's the sort weight for placing study blocks, nothing more.
 */
export default function PriorityBar({
  value,
  onChange,
  disabled,
  size = 'md',
  labelledBy,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  labelledBy?: string;
}) {
  const saved = Math.min(5, Math.max(1, Math.round(value) || 3));
  const [preview, setPreview] = useState<number | null>(null);
  const n = preview ?? saved;
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const fill = ((n - 1) / 4) * 100;
  const stepAt = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || !box.width) return n;
    return Math.min(5, Math.max(1, Math.round(((clientX - box.left) / box.width) * 4) + 1));
  };
  const set = (next: number) => { if (!disabled && next !== saved) onChange(next); };
  const cancel = () => { dragging.current = null; setPreview(null); };
  return (
    <div
      className={`${styles.bar} ${size === 'sm' ? styles.sm : ''} ${disabled ? styles.off : ''}`}
      role="slider"
      aria-valuemin={1}
      aria-valuemax={5}
      aria-valuenow={n}
      aria-valuetext={`${n} of 5, ${n <= 2 ? 'low' : n >= 4 ? 'high' : 'medium'} priority`}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : 'Priority'}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={e => {
        if (disabled) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); set(Math.min(5, n + 1)); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); set(Math.max(1, n - 1)); }
        if (e.key === 'Home') { e.preventDefault(); set(1); }
        if (e.key === 'End') { e.preventDefault(); set(5); }
      }}
      onPointerDown={e => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragging.current = stepAt(e.clientX);
        setPreview(dragging.current);
      }}
      onPointerMove={e => {
        if (dragging.current === null) return;
        dragging.current = stepAt(e.clientX);
        setPreview(dragging.current);
      }}
      onPointerUp={() => {
        const next = dragging.current;
        cancel();
        if (next !== null) set(next);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    >
      <div ref={track} className={styles.track}>
        <span className={styles.fill} style={{ width: `${fill}%` }} />
        <span className={styles.knob} style={{ left: `${fill}%` }} />
      </div>
    </div>
  );
}
