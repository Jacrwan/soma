import styles from './Skeleton.module.css';

interface SkeletonBlockProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
}

export function SkeletonBlock({ width = '100%', height = 14, borderRadius = 6 }: SkeletonBlockProps) {
  return (
    <div
      className={styles.block}
      style={{
        width:        typeof width        === 'number' ? `${width}px`        : width,
        height:       typeof height       === 'number' ? `${height}px`       : height,
        borderRadius: typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius,
      }}
    />
  );
}

/**
 * A loading placeholder for a whole page.
 *
 * The bars themselves are decoration: a screen reader should hear that the
 * page is loading, not a list of empty boxes. So the shapes are hidden from
 * assistive technology and one polite status carries the message, which is
 * also what a test can wait on.
 *
 * `label` says what is loading, since these mount on different pages.
 */
export function SkeletonPage({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <p role="status" aria-live="polite" className={styles.srOnly}>{label}</p>
      <div aria-hidden="true" data-testid="skeleton">{children}</div>
    </>
  );
}

/** A row of bars, the shape most lists reduce to while they load. */
export function SkeletonRow({ widths, gap = 12, height = 13 }: { widths: (string | number)[]; gap?: number; height?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap }}>
      {widths.map((w, i) => <SkeletonBlock key={i} width={w} height={height} />)}
    </div>
  );
}
