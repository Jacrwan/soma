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
