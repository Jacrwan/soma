import { useEffect, useState } from 'react';
import { inviteLink, loadReferralStatus, type ReferralStatus } from '../../lib/referrals';
import styles from './InviteLink.module.css';

/**
 * The invite link with a Copy button and the progress dots, for the end of
 * sign-up and the daily invite popup (Settings → Invite friends has the full
 * card). Renders nothing until the link loads, and nothing if it can't (the
 * migration hasn't run): an invite is never worth an error on these screens.
 */
export default function InviteLink({ onLoaded }: { onLoaded?: (status: ReferralStatus) => void }) {
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    loadReferralStatus().then(s => { if (live) { setStatus(s); onLoaded?.(s); } }).catch(() => {});
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!status) return null;
  const link = inviteLink(status.code);

  async function copy() {
    try { await navigator.clipboard.writeText(link); } catch { return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        <input className={styles.link} readOnly value={link} aria-label="Your invite link" onFocus={e => e.currentTarget.select()} />
        <button type="button" className={styles.copy} onClick={() => void copy()}>{copied ? 'Copied ✓' : 'Copy link'}</button>
      </div>
      <div className={styles.progress} aria-label={`${status.counted} of ${status.needed} friends toward your next free week`}>
        {Array.from({ length: status.needed }, (_, i) => (
          <span key={i} className={`${styles.dot}${i < status.counted ? ` ${styles.on}` : ''}`} />
        ))}
        <span className={styles.count}>
          {status.waitUntil ? 'Free week earned' : `${status.counted} of ${status.needed} friends`}
        </span>
      </div>
    </div>
  );
}
