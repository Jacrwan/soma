import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { startCheckout } from '../../lib/subscription';
import styles from './PricingPage.module.css';

const MONTHLY_PRICE     = '$5.99';
const ANNUAL_PRICE      = '$47.88';
const ANNUAL_PER_MONTH  = '$3.99';
const ANNUAL_SAVINGS    = '33%';

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 7.5l3.5 3.5 6.5-7" />
    </svg>
  );
}

const FREE_FEATURES = [
  'Day View & schedule blocks',
  'Canvas assignment sync',
  'Calendar integration',
  'Insights & study tracking',
  'Manual todos & study timer',
];

const PRO_FEATURES = [
  'Everything in Free',
  'AI chat assistant',
  'AI schedule generation',
  'AI todo generation',
  'Future AI planning features',
];

type Plan = 'monthly' | 'yearly';

export default function PricingPage() {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<Plan>('monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [backTo, setBackTo] = useState('/');

  useEffect(() => {
    document.title = 'Soma — Pricing';
    supabase.auth.getSession().then(({ data }) => {
      const loggedIn = !!data.session;
      setIsLoggedIn(loggedIn);
      if (loggedIn) setBackTo('/day-view');
    });
    return () => { document.title = 'Soma'; };
  }, []);

  async function handleCta() {
    if (isLoggedIn === null) return;
    if (!isLoggedIn) {
      navigate('/signup');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await startCheckout(plan);
    } catch (e: any) {
      if (e?.message === 'Already subscribed') {
        navigate('/settings');
        return;
      }
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.topbar}>
        <Link to={backTo} className={styles.wordmark}>Soma</Link>
        <Link to={backTo} className={styles.back}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 2L4 7l5 5" />
          </svg>
          Back
        </Link>
      </div>

      <div className={styles.page}>
        <p className={styles.eyebrow}>Soma Pro</p>
        <h1 className={styles.headline}>Start 1 month free</h1>
        <p className={styles.sub}>No charge today. Cancel anytime before your trial ends.</p>

        {/* Plan toggle */}
        <div className={styles.toggle}>
          <button
            className={`${styles.toggleBtn}${plan === 'monthly' ? ` ${styles.toggleBtnActive}` : ''}`}
            onClick={() => setPlan('monthly')}
          >
            Monthly
          </button>
          <button
            className={`${styles.toggleBtn}${plan === 'yearly' ? ` ${styles.toggleBtnActive}` : ''}`}
            onClick={() => setPlan('yearly')}
          >
            Annual
            <span className={styles.saveBadge}>Save {ANNUAL_SAVINGS}</span>
          </button>
        </div>

        {/* Free tier */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.planName}>Free</span>
            <span className={styles.price}>$0</span>
          </div>
          <div className={styles.featureList}>
            {FREE_FEATURES.map(f => (
              <div key={f} className={styles.featureItem}>
                <CheckIcon />
                {f}
              </div>
            ))}
          </div>
        </div>

        {/* Pro tier */}
        <div className={`${styles.card} ${styles.cardPro}`}>
          <div className={styles.cardHeader}>
            <span className={`${styles.planName} ${styles.planNamePro}`}>Pro</span>
            {plan === 'monthly' ? (
              <>
                <span className={styles.price}>{MONTHLY_PRICE}</span>
                <span className={styles.priceSub}>/mo</span>
              </>
            ) : (
              <>
                <span className={styles.price}>{ANNUAL_PRICE}</span>
                <span className={styles.priceSub}>/yr</span>
                <span className={styles.priceEquiv}>{ANNUAL_PER_MONTH}/mo</span>
              </>
            )}
            <span className={styles.trial}>30-day free trial</span>
          </div>
          <div className={styles.featureList}>
            {PRO_FEATURES.map(f => (
              <div key={f} className={`${styles.featureItem} ${styles.featureItemPro}`}>
                <CheckIcon />
                {f}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.ctaWrap}>
          {error && <p className={styles.ctaError}>{error}</p>}
          <button
            className={styles.ctaBtn}
            onClick={handleCta}
            disabled={loading || isLoggedIn === null}
          >
            {loading ? 'Loading…' : 'Start free trial'}
          </button>
          <p className={styles.ctaMeta}>
            {plan === 'monthly'
              ? `${MONTHLY_PRICE}/month after trial · Cancel anytime`
              : `${ANNUAL_PRICE}/year after trial · Cancel anytime`}
          </p>
          {!isLoggedIn && isLoggedIn !== null && (
            <p className={styles.loginNote}>
              Already have an account? <Link to="/login">Sign in</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
