import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import styles from './AuthScreen.module.css';

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setNotice('Check your email for a confirmation link.');
    }

    setLoading(false);
  }

  function switchMode(next: 'login' | 'signup') {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.wordmark}>Soma</div>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab}${mode === 'login' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => switchMode('login')}
          >
            Log in
          </button>
          <button
            type="button"
            className={`${styles.tab}${mode === 'signup' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => switchMode('signup')}
          >
            Sign up
          </button>
        </div>

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
          <input
            className={styles.input}
            type="password"
            placeholder="Password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </div>

        {error && <p className={styles.error}>{error}</p>}
        {notice && <p className={styles.notice}>{notice}</p>}

        <button className={styles.submitBtn} type="submit" disabled={loading}>
          {loading ? '…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
