import { useState } from 'react';
import { buyTopup, type AiBudget } from '../../lib/aiBudget';
import { TOPUP_PRICE } from '../../lib/pricing';
import styles from './AiBudgetMeter.module.css';

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * This month's Soma, as a percentage: quiet until it matters. Near the end it
 * offers a top-up; used up, it says asking Soma is paused and when it resets.
 * Nothing shows for the owner's unlimited account or when it can't be told.
 */
export default function AiBudgetMeter({ budget, returnPath, offerAlways = false }: { budget: AiBudget | null; returnPath: '/dashboard' | '/ai' | '/settings'; offerAlways?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toppedUp = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('topup') === 'done';
  if (!budget || !('percent' in budget)) return null;
  const out = budget.used >= budget.available;
  const label = budget.trial ? 'Soma in your trial' : 'Soma this month';
  const when = budget.trial ? `ends ${day(budget.resetsAt)}` : `resets ${day(budget.resetsAt)}`;
  const offer = !budget.trial && (offerAlways || budget.percent >= 80);
  async function topUp() {
    setBusy(true); setError('');
    try { await buyTopup(returnPath); } catch (e) { setError(e instanceof Error ? e.message : 'Could not start the top-up.'); setBusy(false); }
  }
  return (
    <div className={`${styles.meter}${out ? ` ${styles.out}` : ''}`} aria-label="Soma usage">
      <div className={styles.bar} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={budget.percent}>
        <span style={{ width: `${budget.percent}%` }} />
      </div>
      <p className={styles.line}>
        {out
          ? budget.trial
            ? <>You’ve used your trial’s Soma. <a href="/pricing">Subscribe</a> to keep asking.</>
            : <>You’ve used this month’s Soma, so asking is paused until it {when}. Everything else still works.</>
          : <>{label}: {budget.percent}% used · {when}</>}
        {toppedUp && !out && <> · Top-up added, thanks.</>}
      </p>
      {offer && <button type="button" className={styles.topup} disabled={busy} onClick={() => void topUp()}>{busy ? 'Opening checkout…' : `Add more Soma · ${TOPUP_PRICE}`}</button>}
      {error && <p role="alert" className={styles.line}>{error}</p>}
    </div>
  );
}
