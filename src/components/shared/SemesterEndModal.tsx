import styles from './SemesterEndModal.module.css';

interface Props {
  onConfirm: () => void;
  onDismiss: () => void;
}

export default function SemesterEndModal({ onConfirm, onDismiss }: Props) {
  return (
    <div className={styles.overlay} onClick={onDismiss}>
      <div className={styles.box} onClick={e => e.stopPropagation()}>
        <h2 className={styles.title}>Has your semester ended?</h2>
        <p className={styles.body}>
          We can archive your current courses to keep things tidy.
          Your history and insights will be preserved.
        </p>
        <div className={styles.actions}>
          <button className={styles.primary} onClick={onConfirm}>
            Archive my courses
          </button>
          <button className={styles.dismiss} onClick={onDismiss}>
            Not yet
          </button>
        </div>
      </div>
    </div>
  );
}
