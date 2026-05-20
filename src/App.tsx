import { useState, useEffect } from 'react';
import DayView from './components/DayView/DayView';
import CanvasTab from './components/Canvas/CanvasTab';
import AITab from './components/AI/AITab';
import CalendarTab from './components/Calendar/CalendarTab';
import { storage } from './lib/storage';
import styles from './App.module.css';

type Tab = 'today' | 'canvas' | 'ai' | 'calendar';

export default function App() {
  const [tab, setTab] = useState<Tab>('today');

  // Handle Google OAuth implicit-flow redirect (popup or direct)
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || !hash.includes('access_token')) return;
    const params = new URLSearchParams(hash.slice(1));
    const token = params.get('access_token');
    if (!token) return;
    storage.setGoogleToken(token);
    storage.setGoogleCacheTimestamp(0);
    if (window.opener) {
      window.opener.postMessage({ type: 'soma_google_auth', token }, window.location.origin);
      window.close();
    } else {
      window.history.replaceState(null, '', window.location.pathname);
      window.dispatchEvent(new CustomEvent('soma_google_auth', { detail: { token } }));
      setTab('calendar');
    }
  }, []);

  useEffect(() => {
    const titles: Record<Tab, string> = {
      today: 'Soma — Today',
      canvas: 'Soma — Canvas',
      ai: 'Soma — AI',
      calendar: 'Soma — Calendar',
    };
    document.title = titles[tab];
  }, [tab]);

  return (
    <div className={styles.app}>
      <nav className={styles.nav}>
        <button className={tab === 'today'    ? styles.active : ''} onClick={() => setTab('today')}>Today</button>
        <button className={tab === 'canvas'   ? styles.active : ''} onClick={() => setTab('canvas')}>Canvas</button>
        <button className={tab === 'calendar' ? styles.active : ''} onClick={() => setTab('calendar')}>Calendar</button>
        <button className={tab === 'ai'       ? styles.active : ''} onClick={() => setTab('ai')}>AI</button>
      </nav>
      <main className={styles.main}>
        {tab === 'today'    && <DayView />}
        {tab === 'canvas'   && <CanvasTab />}
        {tab === 'calendar' && <CalendarTab />}
        {tab === 'ai'       && <AITab onSwitchToToday={() => setTab('today')} />}
      </main>
    </div>
  );
}
