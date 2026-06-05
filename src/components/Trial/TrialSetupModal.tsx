import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { createSetupIntent, createSubscription } from '../../lib/subscription';
import styles from './TrialSetupModal.module.css';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);

type Plan = 'monthly' | 'annual';

const MONTHLY_PRICE = 5.99;
const ANNUAL_PRICE  = 47.88;
const ANNUAL_MONTHLY_EQUIV = (ANNUAL_PRICE / 12).toFixed(2);

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

// ── Inner form (needs Stripe context) ────────────────────────────────────────

interface FormProps {
  plan: Plan;
  onPlanChange: (p: Plan) => void;
  trialEndsAt: string;
  onSuccess: () => void;
}

function CardForm({ plan, onPlanChange, trialEndsAt, onSuccess }: FormProps) {
  const stripe   = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError('');

    // Confirm the SetupIntent — collects card, no charge
    const { error: stripeErr, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });

    if (stripeErr) {
      setError(stripeErr.message ?? 'Card setup failed. Please try again.');
      setLoading(false);
      return;
    }

    const paymentMethodId = typeof setupIntent?.payment_method === 'string'
      ? setupIntent.payment_method
      : (setupIntent?.payment_method as { id: string } | null)?.id ?? '';

    if (!paymentMethodId) {
      setError('Could not retrieve payment method. Please try again.');
      setLoading(false);
      return;
    }

    try {
      await createSubscription(paymentMethodId, plan);
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start trial. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Plan selection */}
      <div className={styles.plans}>
        <button
          type="button"
          className={`${styles.planCard}${plan === 'monthly' ? ` ${styles.planCardActive}` : ''}`}
          onClick={() => onPlanChange('monthly')}
        >
          <span className={styles.planName}>Monthly</span>
          <span className={styles.planPrice}>${MONTHLY_PRICE}</span>
          <span className={styles.planPriceSub}>per month</span>
        </button>
        <button
          type="button"
          className={`${styles.planCard}${plan === 'annual' ? ` ${styles.planCardActive}` : ''}`}
          onClick={() => onPlanChange('annual')}
        >
          <span className={styles.planBadge}>SAVE 33%</span>
          <span className={styles.planName}>Annual</span>
          <span className={styles.planPrice}>${ANNUAL_MONTHLY_EQUIV}</span>
          <span className={styles.planPriceSub}>per month · billed yearly</span>
        </button>
      </div>

      {/* Trial notice */}
      <p className={styles.trialNotice}>
        <strong>21-day free trial.</strong> Your card will not be charged until{' '}
        <strong>{fmtDate(trialEndsAt)}</strong>. Cancel anytime before then and pay nothing.
      </p>

      {/* Card input */}
      <div className={styles.cardSection}>
        <span className={styles.cardLabel}>Payment info</span>
        <div className={styles.cardElementWrap}>
          <PaymentElement
            options={{
              layout: 'tabs',
              fields: { billingDetails: { name: 'auto' } },
            }}
          />
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <button type="submit" className={styles.submitBtn} disabled={loading || !stripe}>
        {loading ? 'Setting up trial…' : 'Start free trial'}
      </button>

      <div className={styles.secure}>
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <rect x="3" y="6.5" width="8" height="6" rx="1"/>
          <path d="M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0v2"/>
        </svg>
        Secured by Stripe · No charge until trial ends
      </div>
    </form>
  );
}

// ── Outer modal (manages setup intent + Stripe Elements provider) ─────────────

interface Props {
  onComplete: () => void;
  onSkip?: () => void;
}

export default function TrialSetupModal({ onComplete, onSkip }: Props) {
  const [plan, setPlan]               = useState<Plan>('monthly');
  const [clientSecret, setClientSecret] = useState('');
  const [trialEndsAt, setTrialEndsAt]   = useState('');
  const [loadingIntent, setLoadingIntent] = useState(true);
  const [intentError, setIntentError]   = useState('');
  const [succeeded, setSucceeded]       = useState(false);

  useEffect(() => {
    createSetupIntent()
      .then(({ clientSecret: cs, trialEndsAt: te }) => {
        setClientSecret(cs);
        setTrialEndsAt(te);
      })
      .catch((err: unknown) => {
        setIntentError(err instanceof Error ? err.message : 'Unable to initialise payment. Please try again.');
      })
      .finally(() => setLoadingIntent(false));
  }, []);

  const stripeOptions = clientSecret
    ? {
        clientSecret,
        appearance: {
          theme: 'night' as const,
          variables: {
            colorPrimary: '#5b6af0',
            colorBackground: 'transparent',
            colorText: '#e8e8e4',
            colorTextSecondary: '#8a8a9e',
            colorInputBackground: 'rgba(255,255,255,0.04)',
            borderRadius: '8px',
            fontFamily: 'DM Sans, system-ui, sans-serif',
          },
        },
      }
    : undefined;

  return (
    <div className={styles.overlay}>
      <div className={styles.sheet} role="dialog" aria-modal="true">

        {!succeeded && (
          <>
            <div className={styles.header}>
              <svg className={styles.icon} width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 1L8.1 5.9L13 7L8.1 8.1L7 13L5.9 8.1L1 7L5.9 5.9Z"/>
              </svg>
              <h2 className={styles.title}>Start your free trial</h2>
            </div>
            <p className={styles.sub}>
              Full access to all AI features for 21 days. Pick a plan — you won't be charged until the trial ends.
            </p>
          </>
        )}

        {loadingIntent && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0 16px' }}>
            Preparing checkout…
          </p>
        )}

        {intentError && (
          <p className={styles.error}>{intentError}</p>
        )}

        {!loadingIntent && !intentError && clientSecret && stripeOptions && !succeeded && (
          <Elements stripe={stripePromise} options={stripeOptions}>
            <CardForm
              plan={plan}
              onPlanChange={setPlan}
              trialEndsAt={trialEndsAt}
              onSuccess={() => setSucceeded(true)}
            />
          </Elements>
        )}

        {succeeded && (
          <div className={styles.success}>
            <div className={styles.successIcon}>
              <svg width="22" height="22" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 7l3.5 3.5 6.5-7"/>
              </svg>
            </div>
            <h2 className={styles.successTitle}>Trial started!</h2>
            <p className={styles.successSub}>
              You have 21 days of full access. Your{' '}
              {plan === 'annual' ? `$${ANNUAL_PRICE}/year` : `$${MONTHLY_PRICE}/month`}{' '}
              plan begins on <strong>{fmtDate(trialEndsAt)}</strong>.
            </p>
            <button className={styles.successBtn} onClick={onComplete}>
              Go to Soma →
            </button>
          </div>
        )}

        {!succeeded && onSkip && (
          <button className={styles.skipLink} onClick={onSkip}>
            Skip for now — use free features only
          </button>
        )}
      </div>
    </div>
  );
}
