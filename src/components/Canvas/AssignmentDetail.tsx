import styles from './AssignmentDetail.module.css';

interface Props {
  onClose: () => void;
}

export default function AssignmentDetail({ onClose }: Props) {
  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>
    </>
  );
}
