import { useState, useEffect } from 'react';
import { storage } from '../../lib/storage';
import { getEvents, getWeekRange, isCacheStale } from '../../lib/googleCalendar';
import { GoogleCalendarEvent } from '../../types';
import styles from './CalendarTab.module.css';

function fmtEventTime(iso: string) {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
  return m === 0 ? `${h} ${ampm}` : `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtDayLabel(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtSynced(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  return `${mins} mins ago`;
}

function groupByDay(events: GoogleCalendarEvent[]): Map<string, GoogleCalendarEvent[]> {
  const map = new Map<string, GoogleCalendarEvent[]>();
  for (const e of events) {
    const dt = e.start.dateTime ?? e.start.date;
    if (!dt) continue;
    const key = new Date(dt).toDateString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return map;
}

export default function CalendarTab() {
  const [clientId, setClientId] = useState(() => storage.getGoogleClientId());
  const [token, setToken] = useState(() => storage.getGoogleToken());
  const [setupClientId, setSetupClientId] = useState('');
  const [events, setEvents] = useState<GoogleCalendarEvent[]>(() => storage.getCachedGoogleEvents());
  const [lastSynced, setLastSynced] = useState<number | null>(() => storage.getGoogleCacheTimestamp());
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const isConnected = !!token;

  // Listen for OAuth completion (popup or direct redirect)
  useEffect(() => {
    const messageHandler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'soma_google_auth' && e.data.token) {
        storage.setGoogleToken(e.data.token);
        setToken(e.data.token);
      }
    };
    const customHandler = (e: Event) => {
      const t = (e as CustomEvent).detail?.token;
      if (t) setToken(t);
    };
    window.addEventListener('message', messageHandler);
    window.addEventListener('soma_google_auth', customHandler);
    return () => {
      window.removeEventListener('message', messageHandler);
      window.removeEventListener('soma_google_auth', customHandler);
    };
  }, []);

  // Auto-load events when connected
  useEffect(() => {
    if (!token) return;
    if (!isCacheStale(storage.getGoogleCacheTimestamp())) {
      setEvents(storage.getCachedGoogleEvents());
      return;
    }
    loadEvents(token, false);
  }, [token]);

  async function loadEvents(tk: string, force: boolean) {
    if (force) setSyncing(true); else setLoading(true);
    setError('');
    try {
      const { timeMin, timeMax } = getWeekRange();
      const data = await getEvents(tk, timeMin, timeMax);
      storage.setCachedGoogleEvents(data);
      const now = Date.now();
      storage.setGoogleCacheTimestamp(now);
      setEvents(data);
      setLastSynced(now);
      window.dispatchEvent(new CustomEvent('soma_gcal_updated'));
    } catch (err) {
      if (err instanceof Error && err.message === 'auth') {
        setError('Token expired. Please reconnect.');
        storage.setGoogleToken('');
        setToken('');
      } else {
        setError('Failed to load events. Check your connection.');
      }
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  }

  function openOAuthPopup() {
    const id = setupClientId.trim() || clientId;
    if (!id) return;
    storage.setGoogleClientId(id);
    setClientId(id);
    const params = new URLSearchParams({
      client_id: id,
      redirect_uri: window.location.origin,
      response_type: 'token',
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      include_granted_scopes: 'true',
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    const popup = window.open(url, 'google_oauth', 'width=500,height=600,left=200,top=100');
    if (!popup) window.location.href = url;
  }

  function handleDisconnect() {
    storage.setGoogleToken('');
    storage.setGoogleClientId('');
    storage.setCachedGoogleEvents([]);
    storage.setGoogleCacheTimestamp(0);
    setToken('');
    setClientId('');
    setEvents([]);
    setLastSynced(null);
    setSetupClientId('');
    window.dispatchEvent(new CustomEvent('soma_gcal_updated'));
  }

  // ── Setup card ─────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className={styles.setupOverlay}>
        <div className={styles.setupCard}>
          <span className={styles.setupTitle}>Connect Google Calendar</span>
          <div className={styles.setupField}>
            <label className={styles.setupLabel}>OAuth 2.0 Client ID</label>
            <input
              className={styles.setupInput}
              placeholder="123456789-abc.apps.googleusercontent.com"
              value={setupClientId || clientId}
              onChange={e => setSetupClientId(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') openOAuthPopup(); }}
            />
          </div>
          <button
            className={styles.setupBtn}
            onClick={openOAuthPopup}
            disabled={!setupClientId.trim() && !clientId}
          >
            Connect Google Calendar
          </button>
          <div className={styles.setupHint}>
            <strong>How to get a Client ID:</strong><br />
            1. Go to console.cloud.google.com<br />
            2. APIs &amp; Services → Credentials<br />
            3. Create OAuth 2.0 Client ID (Web application)<br />
            4. Add <code>{window.location.origin}</code> as an authorized redirect URI<br />
            5. Enable the Google Calendar API
          </div>
        </div>
      </div>
    );
  }

  // ── Connected view ─────────────────────────────────────────────────────
  const grouped = groupByDay(events.filter(e => !!e.start.dateTime));
  const allDayEvents = events.filter(e => !e.start.dateTime && !!e.start.date);
  const days = Array.from(grouped.entries()).sort(
    ([a], [b]) => new Date(a).getTime() - new Date(b).getTime(),
  );

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div className={styles.syncRow}>
          <span className={styles.connectedDot} />
          <span className={styles.connectedLabel}>Google Calendar</span>
          {lastSynced && (
            <span className={styles.syncLabel}>· {fmtSynced(lastSynced)}</span>
          )}
          <button
            className={styles.refreshBtn}
            onClick={() => loadEvents(token, true)}
            disabled={syncing || loading}
            title="Refresh"
          >↻</button>
        </div>
        <button className={styles.disconnectLink} onClick={handleDisconnect}>Disconnect</button>
      </div>

      <div className={styles.content}>
        {loading && <div className={styles.loading}>Loading…</div>}
        {!loading && error && (
          <div className={styles.errorState}>
            <span>{error}</span>
            <button className={styles.retryBtn} onClick={() => loadEvents(token, false)}>Retry</button>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className={styles.weekHeader}>This week</div>
            {days.length === 0 && allDayEvents.length === 0 && (
              <div className={styles.empty}>No events this week.</div>
            )}
            {allDayEvents.length > 0 && (
              <div className={styles.dayGroup}>
                <div className={styles.dayLabel}>All-day</div>
                {allDayEvents.map(e => (
                  <div key={e.id} className={styles.eventRow}>
                    <div className={styles.eventTime}>—</div>
                    <div className={styles.eventTitle}>{e.summary ?? '(No title)'}</div>
                  </div>
                ))}
              </div>
            )}
            {days.map(([dayStr, dayEvents]) => (
              <div key={dayStr} className={styles.dayGroup}>
                <div className={styles.dayLabel}>{fmtDayLabel(dayEvents[0].start.dateTime!)}</div>
                {dayEvents.map(e => (
                  <div key={e.id} className={styles.eventRow}>
                    <div className={styles.eventTime}>
                      {fmtEventTime(e.start.dateTime!)}
                      {e.end.dateTime && (
                        <span className={styles.eventTimeEnd}> – {fmtEventTime(e.end.dateTime)}</span>
                      )}
                    </div>
                    <div className={styles.eventTitle}>{e.summary ?? '(No title)'}</div>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
