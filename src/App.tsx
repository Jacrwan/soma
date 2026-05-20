import { useState } from 'react';
import DayView from './components/DayView/DayView';
import CanvasTab from './components/Canvas/CanvasTab';
import AITab from './components/AI/AITab';
import styles from './App.module.css';

type Tab = 'today' | 'canvas' | 'ai';

export default function App() {
  const [tab, setTab] = useState<Tab>('today');

  return (
    <div className={styles.app}>
      <nav className={styles.nav}>
        <button className={tab === 'today'  ? styles.active : ''} onClick={() => setTab('today')}>Today</button>
        <button className={tab === 'canvas' ? styles.active : ''} onClick={() => setTab('canvas')}>Canvas</button>
        <button className={tab === 'ai'     ? styles.active : ''} onClick={() => setTab('ai')}>AI</button>
      </nav>
      <main className={styles.main}>
        {tab === 'today'  && <DayView />}
        {tab === 'canvas' && <CanvasTab />}
        {tab === 'ai'     && <AITab onSwitchToToday={() => setTab('today')} />}
      </main>
    </div>
  );
}
