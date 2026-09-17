import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { friendlyError } from '../../lib/errors';
import styles from './AuthScreen.module.css';

export default function AuthScreen({ initialMode = 'login' }: { initialMode?: 'login' | 'signup' }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleGoogleAuth() {
    setGoogleLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) {
      setError(friendlyError('auth'));
      setGoogleLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    if (mode === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/settings`,
      });
      if (error) setError(friendlyError('auth'));
      else setNotice('Check your email for a password reset link.');
    } else if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(friendlyError('auth'));
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(friendlyError('auth'));
      else setNotice('Check your email for a confirmation link.');
    }

    setLoading(false);
  }

  function switchMode(next: 'login' | 'signup' | 'reset') {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  const isReset = mode === 'reset';

  return (
    <div className={styles.wrap}>
      <div className={styles.stage}>
        <a href="/" className={styles.brandPanel}>
          <div className={styles.brandMockWindow}>
            <div className={styles.brandMockDots}>
              <span /><span /><span />
            </div>
            <div className={styles.brandMockRow}>
              <div className={styles.brandMockBlock} style={{ background: 'oklch(85% 0.06 265)' }} />
            </div>
            <div className={styles.brandMockRow}>
              <div className={styles.brandMockBlock} style={{ background: 'oklch(88% 0.07 90)', width: '70%' }} />
            </div>
            <div className={styles.brandMockRow}>
              <div className={styles.brandMockBlock} style={{ background: 'oklch(87% 0.06 155)', width: '55%' }} />
            </div>
          </div>
          <div className={styles.brandCopy}>
            <div className={styles.brandWordmark}>
              soma
            </div>
            <p className={styles.brandTagline}>
              Connect Canvas, get a plan for the day, and know what's next — free to use, no credit card required.
            </p>
          </div>
        </a>

        <div className={styles.card}>
          <a href="/" className={styles.wordmark}>
            soma
          </a>

          <div className={styles.heading}>
            {mode === 'login' && 'Welcome back'}
            {mode === 'signup' && 'Create your account'}
            {isReset && 'Reset your password'}
          </div>

          {isReset ? (
            <p className={styles.resetHint}>
              Enter the email on your account and we'll send you a link to set a new password.
            </p>
          ) : (
            <>
              <button
                className={styles.googleBtn}
                type="button"
                onClick={handleGoogleAuth}
                disabled={googleLoading || loading}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
                  <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
                </svg>
                {googleLoading ? 'Redirecting…' : `Continue with Google`}
              </button>

              <div className={styles.divider}>
                <span className={styles.dividerLine} />
                <span className={styles.dividerText}>or</span>
                <span className={styles.dividerLine} />
              </div>
            </>
          )}

          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.fields}>
              <input
                className={styles.input}
                type="email"
                placeholder="Email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              {!isReset && (
                <input
                  className={styles.input}
                  type="password"
                  placeholder="Password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              )}
            </div>

            {mode === 'login' && (
              <button
                type="button"
                className={styles.forgotLink}
                onClick={() => switchMode('reset')}
              >
                Forgot password?
              </button>
            )}

            {error && <p className={styles.error}>{error}</p>}
            {notice && <p className={styles.notice}>{notice}</p>}

            <button className={styles.submitBtn} type="submit" disabled={loading || googleLoading}>
              {loading ? '…' : mode === 'login' ? 'Log in' : isReset ? 'Send reset link' : 'Create account'}
            </button>

            {mode === 'signup' && (
              <p className={styles.consent}>
                By creating an account you agree to our{' '}
                <Link to="/terms" className={styles.consentLink}>Terms of Service</Link>
                {' '}and{' '}
                <Link to="/privacy" className={styles.consentLink}>Privacy Policy</Link>.
              </p>
            )}
          </form>

          <p className={styles.toggle}>
            {isReset ? (
              <button type="button" className={styles.toggleLink} onClick={() => switchMode('login')}>
                Back to log in
              </button>
            ) : (
              <>
                {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
                <button
                  type="button"
                  className={styles.toggleLink}
                  onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
                >
                  {mode === 'login' ? 'Sign up' : 'Log in'}
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
