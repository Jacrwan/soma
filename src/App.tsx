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
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  });

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
      today: 'Soma — Day View',
      canvas: 'Soma — Canvas',
      ai: 'Soma — AI',
      calendar: 'Soma — Calendar',
    };
    document.title = titles[tab];
  }, [tab]);

  function handleSelectDate(date: Date) {
    setSelectedDate(date);
  }

  function handleSwitchToToday() {
    setTab('today');
  }

  return (
    <div className={styles.app}>
      <nav className={styles.nav}>
        <button className={tab === 'today' ? styles.active : ''} onClick={() => setTab('today')}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <rect x="1" y="2" width="12" height="11" rx="1.5"/>
            <path d="M1 5.5h12"/>
            <path d="M4.5 1v2M9.5 1v2"/>
            <path d="M4.5 8.5h2"/>
          </svg>
          Day View
        </button>
        <button className={tab === 'canvas' ? styles.active : ''} onClick={() => setTab('canvas')}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <rect x="2" y="1" width="10" height="12" rx="1.5"/>
            <path d="M4.5 5h5M4.5 7.5h5M4.5 10h3"/>
          </svg>
          Canvas
        </button>
<button className={tab === 'calendar' ? styles.active : ''} onClick={() => setTab('calendar')}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <rect x="1" y="2" width="12" height="11" rx="1.5"/>
            <path d="M1 5.5h12M5 5.5v7.5M9 5.5v7.5"/>
            <path d="M4.5 1v2M9.5 1v2"/>
          </svg>
          Calendar
        </button>
        <button className={tab === 'ai' ? styles.active : ''} onClick={() => setTab('ai')}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 1L8.1 5.9L13 7L8.1 8.1L7 13L5.9 8.1L1 7L5.9 5.9Z"/>
          </svg>
          AI
        </button>
      </nav>
      <main className={styles.main}>
        {tab === 'today'    && <DayView selectedDate={selectedDate} onSelectDate={handleSelectDate} />}
        {tab === 'canvas'   && <CanvasTab />}
        {tab === 'calendar' && (
          <CalendarTab
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
            onSwitchToToday={handleSwitchToToday}
          />
        )}
        {tab === 'ai' && <AITab onSwitchToToday={handleSwitchToToday} />}
      </main>
    </div>
  );
}
