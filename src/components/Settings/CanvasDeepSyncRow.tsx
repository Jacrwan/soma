import { useEffect, useState } from 'react';
import {
  CANVAS_CHANGED, EXTENSION_STORE_URL, connectPendingSites, deepSyncStatus, disconnectCanvasSite, extensionPresent,
  pendingCanvasSites, requestSync,
} from '../../lib/canvasExtension';
import { formatDateTime } from '../../lib/timeFormat';
import styles from './SettingsTab.module.css';

/**
 * The Soma for Canvas extension: whether it's here, when each Canvas site
 * last synced, and connecting or disconnecting each site for this account.
 * It is how Canvas reaches Soma: courses, assignments, due dates, points,
 * submissions, grades and announcements. Sites the extension has that this
 * account hasn't said yes to are offered here with Connect, never saved
 * on their own (canvasExtension.ts).
 */
export default function CanvasDeepSyncRow() {
  const [sites, setSites] = useState(deepSyncStatus);
  const [pending, setPending] = useState(pendingCanvasSites);
  const [present, setPresent] = useState(extensionPresent);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    const refresh = () => { setSites(deepSyncStatus()); setPending(pendingCanvasSites()); setPresent(extensionPresent()); };
    window.addEventListener(CANVAS_CHANGED, refresh);
    return () => window.removeEventListener(CANVAS_CHANGED, refresh);
  }, []);

  async function disconnect(host: string) {
    if (!window.confirm(`Disconnect ${host} from this Soma account? Its synced assignments and grades leave this account. Your courses and tasks stay, and you can connect it again.`)) return;
    setBusy(host); setError('');
    try { await disconnectCanvasSite(host); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not disconnect that site.'); }
    finally { setBusy(null); }
  }

  async function connect() {
    setBusy('connect'); setError('');
    try { await connectPendingSites(); }
    catch { setError('Could not connect. Please retry.'); }
    finally { setBusy(null); }
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
    <div className={`${styles.integrationRow} ${styles.gcalSection}`}>
      <div className={styles.gcalSectionHeader}>
        <div className={styles.integrationInfo}>
          <span className={styles.integrationLabel}>Canvas extension</span>
          <span className={styles.integrationDescription}>
            {latest
              ? `Last synced ${formatDateTime(new Date(latest.syncedAt))}. Keeps itself up to date while Chrome is open.`
              : present
                ? 'Installed. Open Canvas in this browser and it syncs on its own.'
                : 'Brings in your courses, assignments, due dates, submissions, grades and announcements. Reads Canvas in your browser, with your own sign-in.'}
          </span>
          {error && <span role="alert" className={styles.integrationDescription}>{error}</span>}
          {note && <span role="status" className={styles.integrationDescription}>{note}</span>}
        </div>
        <div className={styles.integrationActions}>
          {latest && present ? (
            <button className={styles.connectBtn} onClick={() => void syncNow()} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          ) : present ? (
            <span className={styles.connectedBadge}>Installed</span>
          ) : !latest && (
            <a className={styles.connectBtn} href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer">Add to Chrome</a>
          )}
        </div>
      </div>

      {(sites.length > 0 || pending.length > 0) && (
        <div className={styles.gcalConnectionList}>
          {sites.map(s => (
            <div key={s.host} className={styles.gcalConnectionItem}>
              <div className={styles.gcalConnectionHeader}>
                <span className={`${styles.gcalConnectionToggle} ${styles.siteRow}`}>
                  {s.host}
                  <span className={styles.gcalConnectionCount}>{s.courses} courses, {s.assignments} assignments</span>
                </span>
                <button className={styles.disconnectBtn} onClick={() => void disconnect(s.host)} disabled={busy !== null}>
                  {busy === s.host ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>
            </div>
          ))}
          {pending.length > 0 && (
            <div className={styles.gcalConnectionItem}>
              <div className={styles.gcalConnectionHeader}>
                <span className={`${styles.gcalConnectionToggle} ${styles.siteRow}`}>
                  {pending.map(p => p.host).join(', ')}
                  <span className={styles.gcalConnectionCount}>In this browser, not on this account</span>
                </span>
                <button className={styles.connectBtn} onClick={() => void connect()} disabled={busy !== null}>
                  {busy === 'connect' ? 'Connecting…' : 'Connect'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
