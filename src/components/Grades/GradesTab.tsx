import styles from './GradesTab.module.css';

export default function GradesTab() {
  return (
    <div className={styles.empty}>
      <span>Grades are not available with the calendar feed integration.</span>
    </div>
  );
}
