import styles from './TrialConfirmModal.module.css';

interface Props {
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  error?: string;
}

const FEATURES = [
  'AI chat assistant — ask anything about your schedule or coursework',
  'AI schedule generation — auto-plan your study blocks',
  'AI todo generation — extract tasks from assignments',
];

export default function TrialConfirmModal({ onConfirm, onCancel, loading, error }: Props) {
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.sheet} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="trial-modal-title">
        <div className={styles.header}>
          <svg className={styles.icon} width="22" height="22" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 1L8.1 5.9L13 7L8.1 8.1L7 13L5.9 8.1L1 7L5.9 5.9Z"/>
          </svg>
          <h2 id="trial-modal-title" className={styles.title}>Start your free trial</h2>
        </div>

        <ul className={styles.featureList}>
          {FEATURES.map(f => (
            <li key={f} className={styles.featureItem}>
              <svg className={styles.check} width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 6.5l3 3 6-6" />
              </svg>
              {f}
            </li>
          ))}
        </ul>

        <p className={styles.terms}>
          <strong>3 weeks free</strong>, no credit card required. After 21 days, add a payment method to unlock 7 more free days, then $4.99/mo. Cancel anytime.
        </p>

        {error && <p className={styles.error}>{error}</p>}

        <button className={styles.confirmBtn} onClick={onConfirm} disabled={loading} autoFocus>
          {loading ? 'Starting…' : 'Start my free trial'}
        </button>

        <button className={styles.cancelLink} onClick={onCancel} disabled={loading}>
          Maybe later
        </button>
      </div>
    </div>
  );
}
