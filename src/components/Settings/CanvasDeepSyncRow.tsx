import { useEffect, useState } from 'react';
import { CANVAS_CHANGED, EXTENSION_STORE_URL, deepSyncStatus, extensionPresent, forgetDeepSync, requestSync } from '../../lib/canvasExtension';
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
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState('');

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

  async function syncNow() {
    setSyncing(true); setError(''); setNote('');
    const results = await requestSync();
    setSyncing(false);
    const failed = results.filter(r => !r.ok);
    if (!results.length) setError('The extension didn’t answer. Make sure it’s turned on in Chrome.');
    else if (failed.length) setError(failed.map(f => `${f.host}: ${f.error ?? 'didn’t sync'}`).join(' '));
    else setNote('Up to date.');
  }

  const latest = sites[0];
  return (
    <div className={styles.integrationRow}>
      <div className={styles.integrationInfo}>
        <span className={styles.integrationLabel}>Canvas extension</span>
        <span className={styles.integrationDescription}>
          {latest
            ? `${sites.map(s => `${s.host}: ${s.courses} courses, ${s.assignments} assignments`).join(' · ')} · last synced ${formatDateTime(new Date(latest.syncedAt))}. Keeps itself up to date while Chrome is open.`
            : present
              ? 'Installed. Open Canvas in this browser and it syncs on its own.'
              : 'Adds assignment details, points, submissions, grades and announcements. Reads Canvas in your browser, with your own sign-in.'}
        </span>
        {error && <span role="alert" className={styles.integrationDescription}>{error}</span>}
        {note && <span role="status" className={styles.integrationDescription}>{note}</span>}
      </div>
      <div className={styles.integrationActions}>
        {latest ? (
          <>
            {present && (
              <button className={styles.connectBtn} onClick={() => void syncNow()} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            )}
            <button className={styles.disconnectBtn} onClick={() => void forget()} disabled={busy}>
              {busy ? 'Removing…' : 'Remove synced data'}
            </button>
          </>
        ) : present ? (
          <span className={styles.connectedBadge}>Installed</span>
        ) : (
          <a className={styles.connectBtn} href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer">Add to Chrome</a>
        )}
      </div>
    </div>
  );
}
