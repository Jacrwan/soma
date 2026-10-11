import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import AuthScreen from '../Auth/AuthScreen';
import styles from './ConnectApproval.module.css';

/**
 * Where a student lands when Claude asks to connect to their Soma account
 * (the connector in api/_mcp.ts). Supabase sends them here with an
 * `authorization_id`; nothing is granted until they press Allow.
 *
 * The app that asked is named by where it will send the student back to, not
 * by what it calls itself: anyone can call an app "Claude".
 */

const RETURN_KEY = 'soma_connect_return';
/** Signing in with Google leaves this page for /dashboard; App brings the student back. */
export function connectReturnPath(): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? 'null') as { path?: unknown; at?: unknown } | null;
    sessionStorage.removeItem(RETURN_KEY);
    if (!saved || typeof saved.path !== 'string' || typeof saved.at !== 'number') return null;
    return saved.path.startsWith('/oauth/consent?') && Date.now() - saved.at < 15 * 60_000 ? saved.path : null;
  } catch { return null; }
}

type Details = { client: string; host: string; claude: boolean };
type OAuthApi = {
  getAuthorizationDetails(id: string): Promise<{ data: unknown; error: unknown }>;
  approveAuthorization(id: string, options: { skipBrowserRedirect: boolean }): Promise<{ data: { redirect_url?: string } | null; error: unknown }>;
  denyAuthorization(id: string, options: { skipBrowserRedirect: boolean }): Promise<{ data: { redirect_url?: string } | null; error: unknown }>;
};
const oauth = () => (supabase.auth as unknown as { oauth?: OAuthApi }).oauth;

const CLAUDE_HOSTS = ['claude.ai', 'claude.com'];
/** Only a web address is followed; a localhost one is a developer's own tool. */
function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    const local = ['localhost', '127.0.0.1'].includes(u.hostname);
    return u.protocol === 'https:' || (u.protocol === 'http:' && local) ? u.host : null;
  } catch { return null; }
}
function leave(url: string | undefined) {
  if (!url || !hostOf(url)) throw new Error('bad_redirect');
  window.location.assign(url);
}

export default function ConnectApproval({ user }: { user: User | null }) {
  const [params] = useSearchParams();
  const raw = params.get('authorization_id') ?? '';
  const id = /^[\w-]{1,200}$/.test(raw) ? raw : '';
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState<'allow' | 'cancel' | null>(null);

  useEffect(() => { document.title = 'Connect to Soma'; }, []);

  useEffect(() => {
    if (!id || user) return;
    try { sessionStorage.setItem(RETURN_KEY, JSON.stringify({ path: `/oauth/consent?authorization_id=${id}`, at: Date.now() })); } catch { /* signing in with a password stays on this page anyway */ }
  }, [id, user]);

  useEffect(() => {
    if (!id || !user) return;
    let current = true;
    void (async () => {
      try {
        const api = oauth();
        if (!api) throw new Error('unavailable');
        const { data, error: failed } = await api.getAuthorizationDetails(id);
        if (!current) return;
        if (failed || !data) throw new Error('expired');
        const d = data as { authorization_id?: string; redirect_url?: string; redirect_uri?: string };
        // Already allowed earlier: nothing to ask, go straight back.
        if (!d.authorization_id) return leave(d.redirect_url);
        const host = hostOf(d.redirect_uri ?? '');
        if (!host) throw new Error('bad_redirect');
        const claude = CLAUDE_HOSTS.includes(host);
        setDetails({ client: claude ? 'Claude' : host, host, claude });
      } catch {
        if (current) setError('This request has expired or can’t be read. Go back to Claude and connect Soma again.');
      }
    })();
    return () => { current = false; };
  }, [id, user]);

  async function decide(allow: boolean) {
    setWorking(allow ? 'allow' : 'cancel');
    setError('');
    try {
      const api = oauth();
      if (!api) throw new Error('unavailable');
      const { data, error: failed } = await (allow ? api.approveAuthorization(id, { skipBrowserRedirect: true }) : api.denyAuthorization(id, { skipBrowserRedirect: true }));
      if (failed) throw new Error('failed');
      leave(data?.redirect_url);
    } catch {
      setWorking(null);
      setError('That didn’t go through. Try again, or go back to Claude and connect Soma again.');
    }
  }

  if (id && !user) {
    return (
      <>
        <p className={styles.signInFirst} role="status">Sign in to Soma to finish connecting Claude.</p>
        <AuthScreen initialMode="login" />
      </>
    );
  }

  return (
    <div className={styles.wrap}>
      <main className={styles.card}>
        <a href="/" className={styles.wordmark}>soma</a>
        {!id ? (
          <p className={styles.message}>This link is incomplete. Go back to Claude and connect Soma again.</p>
        ) : error && !details ? (
          <p className={styles.message} role="alert">{error}</p>
        ) : !details ? (
          <p className={styles.message} role="status">Loading…</p>
        ) : (
          <>
            <h1 className={styles.heading}>Let {details.client} use your Soma?</h1>
            <p className={styles.account}>Signed in as {user?.email}</p>
            {!details.claude && (
              <p className={styles.caution} role="alert">
                This is not Claude. Allowing it gives <strong>{details.host}</strong> access to your Soma account. Cancel unless you set this up yourself.
              </p>
            )}
            <div className={styles.can}>
              <p className={styles.canLabel}>{details.claude ? 'Claude' : 'It'} will be able to</p>
              <ul className={styles.list}>
                <li>See your courses, tasks, plan, reading lists, study time and uploaded documents</li>
                <li>Add tasks and reading-list sections</li>
              </ul>
              {details.claude && <p className={styles.cannot}>Through this connection it can’t delete anything or check work off. You can disconnect it at any time in Claude’s connector settings.</p>}
            </div>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <div className={styles.actions}>
              <button className={styles.allow} onClick={() => void decide(true)} disabled={!!working}>{working === 'allow' ? 'Connecting…' : 'Allow'}</button>
              <button className={styles.cancel} onClick={() => void decide(false)} disabled={!!working}>{working === 'cancel' ? 'Cancelling…' : 'Cancel'}</button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
