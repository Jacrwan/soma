import styles from './PriorityBar.module.css';

/**
 * Five-step priority control. Default comes from the AI; the student can
 * click or use the arrow keys to override. Not a separate "system": just the
 * sort weight for placing study blocks.
 *
 * One calm color, filled up to the level (2026-11-10 UI review: the
 * red-to-green steps read as "red = problem" in a restrained palette, and
 * priority already shows as how many steps are filled). Each step has a 24px
 * hit area around a small mark, and the bar is one Tab stop: arrows, Home and
 * End change it, as for any slider.
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
      <div className={styles.track}>
        {[1, 2, 3, 4, 5].map(step => (
          <button
            key={step}
            type="button"
            className={`${styles.step} ${step <= n ? styles.on : ''}`}
            aria-label={`Priority ${step}`}
            tabIndex={-1}
            disabled={disabled}
            onClick={() => onChange(step)}
          />
        ))}
      </div>
    </div>
  );
}
