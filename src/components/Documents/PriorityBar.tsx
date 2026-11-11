import styles from './PriorityBar.module.css';

/** 1 = low … 5 = high. Color shifts cool → warm as priority rises. */
const TINTS = ['#6b7c8a', '#5a8f7b', '#c4a035', '#d4783c', '#c44b4b'];

export function priorityColor(value: number) {
  const i = Math.min(5, Math.max(1, Math.round(value))) - 1;
  return TINTS[i];
}

/**
 * Five-step priority control. Default comes from the AI; the student can drag
 * or click to override. Not a separate "system" — just the sort weight for
 * placing study blocks.
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
  const n = Math.min(5, Math.max(1, Math.round(value) || 3));
  const color = priorityColor(n);
  return (
    <div
      className={`${styles.bar} ${size === 'sm' ? styles.sm : ''}`}
      role="slider"
      aria-valuemin={1}
      aria-valuemax={5}
      aria-valuenow={n}
      aria-valuetext={`${n} of 5, ${n <= 2 ? 'low' : n >= 4 ? 'high' : 'medium'} priority`}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : 'Priority'}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={e => {
        if (disabled) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(5, n + 1)); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(1, n - 1)); }
        if (e.key === 'Home') { e.preventDefault(); onChange(1); }
        if (e.key === 'End') { e.preventDefault(); onChange(5); }
      }}
    >
      <span className={styles.edge}>Low</span>
      <div className={styles.track} style={{ ['--prio' as string]: color }}>
        {[1, 2, 3, 4, 5].map(step => (
          <button
            key={step}
            type="button"
            className={`${styles.step} ${step <= n ? styles.on : ''}`}
            style={step <= n ? { background: color, borderColor: color } : undefined}
            aria-label={`Priority ${step}`}
            aria-pressed={step === n}
            disabled={disabled}
            onClick={() => onChange(step)}
          />
        ))}
      </div>
      <span className={styles.edge}>High</span>
    </div>
  );
}
