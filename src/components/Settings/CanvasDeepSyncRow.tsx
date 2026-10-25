import { useEffect, useState } from 'react';
import { CANVAS_CHANGED, deepSyncStatus, extensionPresent, forgetDeepSync } from '../../lib/canvasExtension';
import { formatDateTime } from '../../lib/timeFormat';
import styles from './SettingsTab.module.css';

/**
 * The Soma for Canvas extension: whether it's here, when each Canvas site
 * last synced, and removing what it synced. The calendar feed row above it
 * still works on its own; the extension adds descriptions, points,
 * submissions, grades and announcements.
 */
export default function CanvasDeepSyncRow() {
  const [sites, setSites] = useState(deepSyncStatus);
  const [present, setPresent] = useState(extensionPresent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const refresh = () => { setSites(deepSyncStatus()); setPresent(extensionPresent()); };
    window.addEventListener(CANVAS_CHANGED, refresh);
    return () => window.removeEventListener(CANVAS_CHANGED, refresh);
  }, []);

  async function forget() {
    if (!window.confirm('Remove everything the Canvas extension synced, from this browser and your Soma account? Your courses and tasks stay.')) return;
    setBusy(true); setError('');
    try { await forgetDeepSync(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not remove synced Canvas data.'); }
    finally { setBusy(false); }
  }

  const latest = sites[0];
  return (
    <div className={styles.integrationRow}>
      <div className={styles.integrationInfo}>
        <span className={styles.integrationLabel}>Canvas extension</span>
        <span className={styles.integrationDescription}>
          {latest
            ? `${latest.courses} courses, ${latest.assignments} assignments from ${latest.host} · synced ${formatDateTime(new Date(latest.syncedAt))}`
            : present
              ? 'Installed. Open Canvas in this browser and it syncs on its own.'
              : 'Adds assignment details, points, submissions, grades and announcements. Reads Canvas in your browser, with your own sign-in.'}
        </span>
        {error && <span role="alert" className={styles.integrationDescription}>{error}</span>}
      </div>
      <div className={styles.integrationActions}>
        {latest ? (
          <>
            <span className={styles.connectedBadge}>Syncing</span>
            <button className={styles.disconnectBtn} onClick={() => void forget()} disabled={busy}>
              {busy ? 'Removing…' : 'Remove synced data'}
            </button>
          </>
        ) : present ? (
          <span className={styles.connectedBadge}>Installed</span>
        ) : null}
      </div>
    </div>
  );
}
