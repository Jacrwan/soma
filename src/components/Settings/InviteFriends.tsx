import { useEffect, useState } from 'react';
import { ReferralsNotSetUpError, inviteLink, loadReferralStatus, type ReferralReward, type ReferralStatus } from '../../lib/referrals';
import styles from './InviteFriends.module.css';

/**
 * Settings → Invite friends (api/_referrals.ts): the student's link, how many
 * friends count toward the next free week, and the weeks earned.
 */

const dateOf = (iso: string | null) => iso
  ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '';

function rewardLine(r: ReferralReward): string {
  if (r.status === 'pending') return 'Saved: your next plan starts with a free week';
  if (r.status === 'not_needed') return 'Not needed: your account is already free';
  if (r.how === 'next_charge_later') return `Next charge moved to ${dateOf(r.endsAt)}`;
  if (r.how === 'checkout_trial') return 'Added to your trial when you subscribed';
  return r.endsAt ? `Trial runs until ${dateOf(r.endsAt)}` : 'Given';
}

export default function InviteFriends() {
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    loadReferralStatus()
      .then(s => { if (live) setStatus(s); })
      .catch(e => { if (live) setError(e instanceof ReferralsNotSetUpError ? 'Invites aren’t set up yet. Check back soon.' : e instanceof Error ? e.message : 'Couldn’t load your invite link.'); });
    return () => { live = false; };
  }, []);

  async function copy() {
    if (!status) return;
    const link = inviteLink(status.code);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Older browsers: select the field so the student can copy it.
      (document.getElementById('invite-link') as HTMLInputElement | null)?.select();
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.lead}>
        Share your link. When <strong>3 friends sign up</strong> with it within 2 months, you get <strong>a free week</strong> of Soma.
        You can earn one free week every 2 months.
      </p>

      {error && <p role="alert" className={styles.note}>{error}</p>}
      {!status && !error && <p className={styles.note}>Loading your link…</p>}

      {status && (
        <>
          <div className={styles.linkRow}>
            <input id="invite-link" className={styles.link} readOnly value={inviteLink(status.code)} aria-label="Your invite link" onFocus={e => e.currentTarget.select()} />
            <button className={styles.copy} onClick={() => void copy()}>{copied ? 'Copied ✓' : 'Copy link'}</button>
          </div>

          <div className={styles.progress} aria-label={`${status.counted} of ${status.needed} friends toward your next free week`}>
            <div className={styles.dots}>
              {Array.from({ length: status.needed }, (_, i) => (
                <span key={i} className={`${styles.dot}${i < status.counted ? ` ${styles.dotOn}` : ''}`} />
              ))}
            </div>
            <p className={styles.progressText}>
              {status.waitUntil
                ? `Free week earned. Your next one can start on ${dateOf(status.waitUntil)}; friends who join from then on count toward it.`
                : status.counted === 0
                  ? 'No friends yet in the last 2 months.'
                  : `${status.counted} of ${status.needed} friends in the last 2 months.`}
            </p>
          </div>

          {status.totalFriends > 0 && (
            <p className={styles.note}>{status.totalFriends} {status.totalFriends === 1 ? 'friend has' : 'friends have'} joined with your link so far.</p>
          )}

          {status.rewards.length > 0 && (
            <div className={styles.rewards}>
              <h3 className={styles.rewardsTitle}>Free weeks</h3>
              <ul className={styles.rewardList}>
                {status.rewards.map(r => (
                  <li key={r.grantedAt} className={styles.reward}>
                    <span className={styles.rewardDate}>{dateOf(r.grantedAt)}</span>
                    <span>{rewardLine(r)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
