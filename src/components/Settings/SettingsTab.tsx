import styles from './SettingsTab.module.css';

export default function SettingsTab() {
  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Availability</h2>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Study Preferences</h2>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>AI Behavior</h2>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>AI Memory</h2>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Integrations</h2>
      </section>
    </div>
  );
}
