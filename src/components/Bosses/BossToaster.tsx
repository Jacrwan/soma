import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { storage } from '../../lib/storage';
import {
  BOSS_TOAST_EVENT, BossToastDetail, THEME_COLOR,
  FOCUS_LOGGED_EVENT, reconcileStudySessions,
} from '../../lib/bosses';
import styles from './Bosses.module.css';

interface Toast extends BossToastDetail { id: number; }

// App-wide listener that (1) credits study time to bosses whenever a session is
// logged anywhere in Soma, and (2) surfaces a toast for the damage dealt.
// Mounted once in the app shell, so it works on every tab.
export default function BossToaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const navigate = useNavigate();

  useEffect(() => {
    // Credit any backlog quietly on first mount.
    reconcileStudySessions(storage.getCachedAssignments(), new Date(), true);

    function onToast(e: Event) {
      const d = (e as CustomEvent<BossToastDetail>).detail;
      if (!d) return;
      const id = idRef.current++;
      setToasts(t => [...t.slice(-2), { ...d, id }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
    }
    // A study session was just logged: credit it (toasts on).
    function onFocus() { reconcileStudySessions(storage.getCachedAssignments()); }

    window.addEventListener(BOSS_TOAST_EVENT, onToast);
    window.addEventListener(FOCUS_LOGGED_EVENT, onFocus);
    return () => {
      window.removeEventListener(BOSS_TOAST_EVENT, onToast);
      window.removeEventListener(FOCUS_LOGGED_EVENT, onFocus);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className={styles.toaster}>
      {toasts.map(t => (
        <button key={t.id} className={`${styles.toast}${t.milestone ? ` ${styles.toastMilestone}` : ''}`} onClick={() => navigate('/bosses')}>
          <span className={styles.toastDot} style={{ background: t.milestone ? '#facc15' : THEME_COLOR[t.theme]?.base }} />
          <span className={styles.toastText}>
            {t.milestone
              ? <>★ {t.message}</>
              : t.slain
                ? <><b>{t.name}</b> defeated!</>
                : <>Hit <b>{t.name}</b> for {t.damage}</>}
          </span>
          <span className={styles.toastArrow}>›</span>
        </button>
      ))}
    </div>
  );
}
