import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { useSubscription } from '../../lib/subscription';
import InviteLink from './InviteLink';
import styles from './InviteNudge.module.css';

/**
 * The daily invite popup (owner, 2026-11-17): everyone who isn't paying (no
 * plan, on a trial, or ended) sees it once a day, the first time they open
 * Soma that day. Subscribers, and accounts given access by hand, never do; a
 * paying student's free week reads as a subscription too (_trial.ts). Not on
 * the day an account is made: sign-up already showed the link.
 */

const DELAY_MS = 1500;
const key = (userId: string) => `soma_invite_nudge_${userId}`;
const today = () => new Date().toDateString();
const NON_PAYING = ['free', 'trialing', 'trial_expired', 'trial_extended', 'trial_extension_expired'];

export function shownToday(userId: string): boolean {
  try { return localStorage.getItem(key(userId)) === today(); } catch { return true; }
}

export default function InviteNudge({ user }: { user: User }) {
  const subscription = useSubscription();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const eligible = NON_PAYING.includes(subscription.status)
    && Date.now() - Date.parse(user.created_at ?? '') > 86_400_000;

  useEffect(() => {
    if (!eligible || shownToday(user.id)) return;
    // Not over the invite page itself, or a full-screen page outside the app.
    if (new URLSearchParams(location.search).get('section') === 'invite') return;
    const id = window.setTimeout(() => {
      // Counted as shown when it opens, so a refresh doesn't bring it back.
      try { localStorage.setItem(key(user.id), today()); } catch { return; }
      setOpen(true);
    }, DELAY_MS);
    return () => window.clearTimeout(id);
  }, [eligible, user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className={styles.box} role="dialog" aria-modal="true" aria-labelledby="invite-nudge-title">
        <h2 id="invite-nudge-title" className={styles.title}>Get a free week of Soma</h2>
        <p className={styles.lead}>
          Send your link to friends. When <strong>3 of them sign up</strong> within 2 months, your next week is free.
        </p>
        <InviteLink />
        <div className={styles.actions}>
          <button className={styles.later} onClick={() => setOpen(false)}>Maybe later</button>
        </div>
      </div>
    </div>
  );
}
