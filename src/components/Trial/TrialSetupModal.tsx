import { useState } from 'react';
import { startCheckout } from '../../lib/subscription';
import { MONTHLY_PRICE, SEMESTER_PER_MONTH, SEMESTER_SAVINGS, TRIAL_DAYS, type Plan } from '../../lib/pricing';
import styles from './TrialSetupModal.module.css';

interface Props {
  onComplete: () => void;
  onSkip?: () => void;
}

export default function TrialSetupModal({ onSkip }: Props) {
  const [plan, setPlan]     = useState<Plan>('monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await startCheckout(plan); // redirects to Stripe — never returns on success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.sheet} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <svg className={styles.icon} width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 1L8.1 5.9L13 7L8.1 8.1L7 13L5.9 8.1L1 7L5.9 5.9Z"/>
          </svg>
          <h2 className={styles.title}>Start your free trial</h2>
        </div>
        <p className={styles.sub}>
          Full access to all AI features for {TRIAL_DAYS} days. Pick a plan — you won't be charged until the trial ends.
        </p>

        <form onSubmit={handleSubmit}>
          <div className={styles.plans}>
            <button
              type="button"
              className={`${styles.planCard}${plan === 'monthly' ? ` ${styles.planCardActive}` : ''}`}
              onClick={() => setPlan('monthly')}
            >
              <span className={styles.planName}>Monthly</span>
              <span className={styles.planPrice}>{MONTHLY_PRICE}</span>
              <span className={styles.planPriceSub}>per month</span>
            </button>
            <button
              type="button"
              className={`${styles.planCard}${plan === 'semester' ? ` ${styles.planCardActive}` : ''}`}
              onClick={() => setPlan('semester')}
            >
              <span className={styles.planBadge}>SAVE {SEMESTER_SAVINGS}</span>
              <span className={styles.planName}>4 months</span>
              <span className={styles.planPrice}>{SEMESTER_PER_MONTH}</span>
              <span className={styles.planPriceSub}>per month · billed every 4 months</span>
            </button>
          </div>

          <p className={styles.trialNotice}>
            <strong>{TRIAL_DAYS}-day free trial.</strong> You'll enter payment details on Stripe's secure checkout page. No charge until the trial ends — cancel anytime before then.
          </p>

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? 'Redirecting to checkout…' : 'Start free trial'}
          </button>

          <div className={styles.secure}>
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <rect x="3" y="6.5" width="8" height="6" rx="1"/>
              <path d="M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0v2"/>
            </svg>
            Secured by Stripe · No charge until trial ends
          </div>
        </form>

        {onSkip && (
          <button className={styles.skipLink} onClick={onSkip}>
            Skip for now — use free features only
          </button>
        )}
      </div>
    </div>
  );
}
