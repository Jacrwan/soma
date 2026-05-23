import { useState, useEffect } from 'react';
import DayView from './components/DayView/DayView';
import CanvasTab from './components/Canvas/CanvasTab';
import AITab from './components/AI/AITab';
import CalendarTab from './components/Calendar/CalendarTab';
import { storage } from './lib/storage';
import styles from './App.module.css';

type Tab = 'today' | 'canvas' | 'ai' | 'calendar';
type LegalPanel = 'privacy' | 'terms' | 'data' | 'contact' | 'ai' | null;

export default function App() {
  const [tab, setTab] = useState<Tab>('today');
  const [legalPanel, setLegalPanel] = useState<LegalPanel>(null);
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

  function clearLocalData() {
    if (!window.confirm('Clear all locally stored Soma data on this browser? This cannot be undone.')) return;
    localStorage.clear();
    window.location.reload();
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
      <footer className={styles.footer}>
        <div className={styles.footerLinks}>
          <button onClick={() => setLegalPanel('privacy')}>Privacy</button>
          <button onClick={() => setLegalPanel('terms')}>Terms</button>
          <button onClick={() => setLegalPanel('data')}>Data Deletion</button>
          <button onClick={() => setLegalPanel('contact')}>Contact</button>
          <button onClick={() => setLegalPanel('ai')}>AI Disclaimer</button>
        </div>
        <span className={styles.footerNotice}>
          © 2026 Soma. Not affiliated with Canvas, Instructure, Google, or any school.
        </span>
      </footer>

      {legalPanel && (
        <div className={styles.legalOverlay} onClick={() => setLegalPanel(null)}>
          <div className={styles.legalModal} onClick={e => e.stopPropagation()}>
            <div className={styles.legalHeader}>
              <span className={styles.legalTitle}>
                {legalPanel === 'privacy' && 'Privacy Policy'}
                {legalPanel === 'terms' && 'Terms of Service'}
                {legalPanel === 'data' && 'Data Deletion'}
                {legalPanel === 'contact' && 'Contact'}
                {legalPanel === 'ai' && 'AI Disclaimer'}
              </span>
              <button className={styles.legalClose} onClick={() => setLegalPanel(null)}>×</button>
            </div>

            {legalPanel === 'privacy' && (
              <div className={styles.legalBody}>
                <p>Soma stores your subjects, tasks, Canvas data, Google Calendar data, AI chat history, and preferences in this browser using local storage unless the app is later configured with a hosted backend.</p>
                <p>Canvas and Google tokens are used to load the data you request. Do not share your tokens. Remove access from Canvas, Google, or this browser if you no longer want Soma to use them.</p>
                <p>Soma may send assignment, schedule, and chat context to the configured AI provider when you use AI features. Verify important assignments, due dates, grades, and schedules in Canvas or Google Calendar.</p>
                <p>Soma is not intended for children under 13.</p>
              </div>
            )}

            {legalPanel === 'terms' && (
              <div className={styles.legalBody}>
                <p>Use Soma only with accounts and tokens you are authorized to access. You are responsible for keeping Canvas, Google, and API credentials private.</p>
                <p>Soma is provided as a productivity tool without guarantees that data, AI output, due dates, grades, or schedules are complete, accurate, or available at all times.</p>
                <p>By using Soma, you agree to verify school-critical information in the official systems of record, including Canvas, Google Calendar, and your school’s communications.</p>
              </div>
            )}

            {legalPanel === 'data' && (
              <div className={styles.legalBody}>
                <p>Most Soma data is stored locally in this browser. Clearing local data removes saved Canvas tokens, cached assignments, calendar data, AI chats, subjects, tasks, and preferences from this browser.</p>
                <p>This does not delete data from Canvas, Google, your school, or any third-party service.</p>
                <button className={styles.dangerButton} onClick={clearLocalData}>Clear local Soma data</button>
              </div>
            )}

            {legalPanel === 'contact' && (
              <div className={styles.legalBody}>
                <p>For privacy, security, or support requests, contact the project owner through the Soma GitHub repository.</p>
                <a className={styles.legalLink} href="https://github.com/Jacrwan/soma" target="_blank" rel="noopener noreferrer">
                  github.com/Jacrwan/soma
                </a>
              </div>
            )}

            {legalPanel === 'ai' && (
              <div className={styles.legalBody}>
                <p>AI-generated briefs, plans, summaries, and suggestions may be inaccurate, incomplete, or outdated. Do not rely on AI output as the only source for academic deadlines, grades, or official requirements.</p>
                <p>When using AI features, Soma may include your tasks, schedules, Canvas assignments, announcements, modules, and chat messages as context for the AI response.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
