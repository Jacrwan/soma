import { useState } from 'react';
import { openBillingPortal } from '../../lib/subscription';
import styles from './PaywallScreen.module.css';

interface Props {
  status: 'past_due' | 'canceled' | 'unpaid';
  onResubscribe?: () => void;
}

export default function PaywallScreen({ status, onResubscribe }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const isPastDue  = status === 'past_due' || status === 'unpaid';
  const isCanceled = status === 'canceled';

  async function handleUpdatePayment() {
    setLoading(true);
    setError('');
    try {
      await openBillingPortal();
    } catch {
      setError('Could not open billing portal. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={`${styles.iconWrap}${isCanceled ? ` ${styles.iconWrapCanceled}` : ''}`}>
          {isPastDue ? (
            <svg width="24" height="24" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="7" r="5.5"/>
              <path d="M7 4.5v3M7 9.5h.01"/>
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="6.5" width="8" height="6" rx="1"/>
              <path d="M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0v2"/>
            </svg>
          )}
        </div>

        <h1 className={styles.title}>
          {isPastDue ? 'Payment failed' : 'Subscription ended'}
        </h1>

        <p className={styles.sub}>
          {isPastDue
            ? 'Your card was declined when your trial ended. Update your payment method to restore access to Soma.'
            : 'Your Soma subscription has been canceled. Resubscribe to get access back.'}
        </p>

        {isPastDue && (
          <button className={styles.primaryBtn} onClick={handleUpdatePayment} disabled={loading}>
            {loading ? 'Opening portal…' : 'Update payment method'}
          </button>
        )}

        {isCanceled && onResubscribe && (
          <button className={styles.primaryBtn} onClick={onResubscribe}>
            Resubscribe
          </button>
        )}

        {isCanceled && (
          <button className={styles.secondaryBtn} onClick={handleUpdatePayment} disabled={loading}>
            {loading ? 'Opening…' : 'Manage billing'}
          </button>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
