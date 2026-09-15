import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useSubscription, startCheckout } from '../../lib/subscription';
import TrialSetupModal from '../Trial/TrialSetupModal';
import styles from './PricingPage.module.css';

const MONTHLY_PRICE    = '$5.99';
const ANNUAL_PRICE     = '$47.88';
const ANNUAL_PER_MONTH = '$3.99';
const ANNUAL_SAVINGS   = '33%';

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

const PREMIUM_FEATURES = [
  'Everything in Free',
  'AI chat assistant',
  'AI schedule generation',
  'AI todo generation',
  'Future AI planning features',
];

type Plan = 'monthly' | 'yearly';

export default function PricingPage() {
  const navigate   = useNavigate();
  const subscription = useSubscription();
  const [plan, setPlan]         = useState<Plan>('monthly');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [backTo, setBackTo]     = useState('/');

  useEffect(() => {
    document.title = 'Soma — Pricing';
    supabase.auth.getSession().then(({ data }) => {
      const loggedIn = !!data.session;
      setIsLoggedIn(loggedIn);
      if (loggedIn) setBackTo('/day-view');
    });
    return () => { document.title = 'Soma'; };
  }, []);

  // Redirect users who already have access
  useEffect(() => {
    const s = subscription.status;
    if (s === 'loading') return;
    if (s === 'trialing' || s === 'trial_extended' || s === 'active') {
      navigate('/settings', { replace: true });
    }
  }, [subscription.status, navigate]);

  const isTrialExpired = subscription.status === 'trial_expired' || subscription.status === 'trial_extension_expired';

  async function handleCta() {
    if (isLoggedIn === null || subscription.status === 'loading') return;

    if (!isLoggedIn) {
      navigate('/signup');
      return;
    }

    if (isTrialExpired) {
      // Trial ended — go straight to Stripe extension checkout
      setLoading(true);
      setError(null);
      try {
        await startCheckout();
      } catch (e: any) {
        setError(e?.message === 'Already extended' ? "You've already used your extension."
               : e?.message === 'Already subscribed' ? "You're already subscribed."
               : 'Something went wrong. Please try again.');
        setLoading(false);
      }
    } else {
      // Free user — show confirmation modal first
      setError(null);
      setShowModal(true);
    }
  }

  const ctaLabel = isTrialExpired
    ? 'Get 7 more days free'
    : loading ? 'Starting…' : 'Start free 3-week trial';

  const ctaMeta = isTrialExpired
    ? `${MONTHLY_PRICE}/month after 7-day extension · Cancel anytime`
    : plan === 'monthly'
      ? `${MONTHLY_PRICE}/month after trial · Cancel anytime`
      : `${ANNUAL_PRICE}/year after trial · Cancel anytime`;

  return (
    <div className={styles.wrap}>
      <div className={styles.topbar}>
        <Link to={backTo} className={styles.wordmark}>
          <img src="/favicon.svg" width="24" height="24" alt="" style={{ borderRadius: 5, verticalAlign: 'middle', marginRight: 8 }} />
          Soma
        </Link>
        <Link to={backTo} className={styles.back}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 2L4 7l5 5" />
          </svg>
          Back
        </Link>
      </div>

      <div className={styles.page}>
        <p className={styles.eyebrow}>Soma Premium</p>
        {isTrialExpired ? (
          <>
            <h1 className={styles.headline}>Your free trial has ended</h1>
            <p className={styles.sub}>Add a payment method to get 7 more days free, then {MONTHLY_PRICE}/mo.</p>
          </>
        ) : (
          <>
            <h1 className={styles.headline}>Start 3 weeks free</h1>
            <p className={styles.sub}>No charge today. Cancel anytime before your trial ends.</p>
          </>
        )}

        {/* Plan toggle — shown for free users choosing post-trial billing */}
        {!isTrialExpired && (
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
        )}

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

        {/* Premium tier */}
        <div className={`${styles.card} ${styles.cardPro}`}>
          <div className={styles.cardHeader}>
            <span className={`${styles.planName} ${styles.planNamePro}`}>Premium</span>
            {isTrialExpired ? (
              <>
                <span className={styles.price}>{MONTHLY_PRICE}</span>
                <span className={styles.priceSub}>/mo</span>
              </>
            ) : plan === 'monthly' ? (
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
            <span className={styles.trial}>
              {isTrialExpired ? '7-day extension' : '3-week free trial'}
            </span>
          </div>
          <div className={styles.featureList}>
            {PREMIUM_FEATURES.map(f => (
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
            disabled={loading || isLoggedIn === null || subscription.status === 'loading'}
          >
            {loading ? 'Loading…' : ctaLabel}
          </button>
          <p className={styles.ctaMeta}>{ctaMeta}</p>
          {!isLoggedIn && isLoggedIn !== null && (
            <p className={styles.loginNote}>
              Already have an account? <Link to="/login">Sign in</Link>
            </p>
          )}
        </div>
      </div>

      {showModal && (
        <TrialSetupModal
          onComplete={() => navigate('/day-view')}
          onSkip={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
