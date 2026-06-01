import { useState, useEffect, useRef, Component, type ReactNode, type ErrorInfo } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import AuthScreen from './components/Auth/AuthScreen';
import DayView from './components/DayView/DayView';
import CanvasTab from './components/Canvas/CanvasTab';
import AITab from './components/AI/AITab';
import CreateTab from './components/Create/CreateTab';
import CalendarTab from './components/Calendar/CalendarTab';
import InsightsTab from './components/Insights/InsightsTab';
import SettingsTab from './components/Settings/SettingsTab';
import { storage } from './lib/storage';
import { TimerProvider } from './contexts/TimerContext';
import TimerOverlay from './components/Timer/TimerOverlay';
import LandingPage from './components/Landing/LandingPage';
import LegalPage from './components/Legal/LegalPage';
import PricingPage from './components/Pricing/PricingPage';
import { SkeletonBlock } from './components/UI/Skeleton';
import OnboardingFlow from './components/Onboarding/OnboardingFlow';
import styles from './App.module.css';

// ── Error boundary ────────────────────────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100dvh',
          gap: 12,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          textAlign: 'center',
          padding: '0 24px',
          background: '#0f0f0f',
          color: '#c9c9c5',
        }}>
          <p style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Something went wrong.</p>
          <p style={{ fontSize: 14, margin: 0, opacity: 0.6 }}>Please refresh the page to continue.</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8,
              padding: '8px 20px',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 8,
              background: 'transparent',
              color: '#c9c9c5',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Refresh
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Auth loading skeleton ─────────────────────────────────────────────────
function AppSkeleton() {
  return (
    <div className={styles.app}>
      <nav className={styles.sidebar}>
        <div className={styles.brand}>Soma</div>
        <div className={styles.navItems}>
          {[100, 80, 90, 50, 85].map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 40, padding: '0 20px' }}>
              <SkeletonBlock width={15} height={15} borderRadius={4} />
              <SkeletonBlock width={w} height={13} />
            </div>
          ))}
        </div>
      </nav>
      <div className={styles.contentCol}>
        <main className={styles.main} style={{ padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <SkeletonBlock width={200} height={22} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[320, 280, 300, 250, 290].map((w, i) => (
              <SkeletonBlock key={i} width={w} height={14} />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

// ── App shell layout (sidebar + footer + outlet) ─────────────────────────
function AppShell({ user, onLogout }: {
  user: User | null;
  onLogout: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();

  // Redirect unauthenticated users
  if (!user) return <Navigate to="/login" replace />;

  const p = location.pathname;

  // Google OAuth implicit-flow redirect (must be after early-return guard)
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
      window.history.replaceState(null, '', p);
      window.dispatchEvent(new CustomEvent('soma_google_auth', { detail: { token } }));
      navigate('/calendar');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Document title
  useEffect(() => {
    const titles: Record<string, string> = {
      '/day-view':  'Soma — Day View',
      '/canvas':    'Soma — Canvas',
      '/ai':        'Soma — AI',
      '/create':    'Soma — Create',
      '/calendar':  'Soma — Calendar',
      '/insights':  'Soma — Insights',
      '/settings':  'Soma — Settings',
    };
    document.title = titles[p] ?? 'Soma';
  }, [p]);

  function nav(path: string) {
    return `${styles.navItem}${p === path ? ` ${styles.navItemActive}` : ''}`;
  }

  return (
    <TimerProvider>
    <div className={styles.app}>
      <TimerOverlay />
      <nav className={styles.sidebar}>
        <div className={styles.brand}>Soma</div>

        <div className={styles.navItems}>
          <button className={nav('/day-view')} onClick={() => navigate('/day-view')}>
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <rect x="1" y="2" width="12" height="11" rx="1.5"/>
              <path d="M1 5.5h12"/>
              <path d="M4.5 1v2M9.5 1v2"/>
              <path d="M4.5 8.5h2"/>
            </svg>
            Day View
          </button>

          <button className={nav('/canvas')} onClick={() => navigate('/canvas')}>
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <rect x="2" y="1" width="10" height="12" rx="1.5"/>
              <path d="M4.5 5h5M4.5 7.5h5M4.5 10h3"/>
            </svg>
            Canvas
          </button>

          <button className={nav('/calendar')} onClick={() => navigate('/calendar')}>
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <rect x="1" y="2" width="12" height="11" rx="1.5"/>
              <path d="M1 5.5h12M5 5.5v7.5M9 5.5v7.5"/>
              <path d="M4.5 1v2M9.5 1v2"/>
            </svg>
            Calendar
          </button>

          <button className={nav('/ai')} onClick={() => navigate('/ai')}>
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 1L8.1 5.9L13 7L8.1 8.1L7 13L5.9 8.1L1 7L5.9 5.9Z"/>
            </svg>
            AI
          </button>

          <button className={nav('/create')} onClick={() => navigate('/create')}>
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 1v12M1 7h12"/>
            </svg>
            Create
          </button>

          <button className={nav('/insights')} onClick={() => navigate('/insights')}>
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 10.5l3-3.5 2.5 2 3-4 1.5 2"/>
              <path d="M1 13h12"/>
            </svg>
            Insights
          </button>
        </div>

        <div className={styles.sidebarBottom}>
          <button className={nav('/settings')} onClick={() => navigate('/settings')}>
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="7" r="1.8"/>
              <path d="M7 1.5v1M7 11.5v1M1.5 7h1M11.5 7h1M3.2 3.2l.7.7M10.1 10.1l.7.7M10.1 3.2l-.7.7M3.2 10.1l.7.7"/>
            </svg>
            Settings
          </button>
          <button className={styles.navItem} onClick={onLogout} title="Log out">
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 2H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3"/>
              <path d="M9.5 10l3-3-3-3"/>
              <path d="M12.5 7H5"/>
            </svg>
            Log out
          </button>
        </div>
      </nav>

      <div className={styles.contentCol}>
        <main className={styles.main}>
          <Outlet />
        </main>

        <footer className={styles.footer}>
          <div className={styles.footerLinks}>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/billing">Billing</Link>
            <Link to="/refund">Refunds</Link>
            <Link to="/data-deletion">Data Deletion</Link>
            <Link to="/ai-disclaimer">AI Disclaimer</Link>
            <Link to="/contact">Contact</Link>
          </div>
          <span className={styles.footerNotice}>
            © 2026 Soma. Not affiliated with Canvas, Instructure, Google, or any school.
          </span>
        </footer>
      </div>

    </div>
    </TimerProvider>
  );
}

// ── Theme helpers ─────────────────────────────────────────────────────────
export function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.dataset.theme = theme;
}

// ── Root component ────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser]         = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const onboardingChecked = useRef(false);
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const navigate = useNavigate();

  useEffect(() => {
    applyTheme(storage.getSomaSettings().theme ?? 'dark');
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user ?? null;
      setUser(u);
      if (u) {
        await storage.loadTokens();
        if (!onboardingChecked.current) {
          onboardingChecked.current = true;
          storage.getSettings()
            .then(s => { if (!s.onboardingCompleted) setShowOnboarding(true); })
            .catch(() => {});
        }
      }
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (event === 'SIGNED_IN' && u && !onboardingChecked.current) {
        onboardingChecked.current = true;
        storage.getSettings()
          .then(s => { if (!s.onboardingCompleted) setShowOnboarding(true); })
          .catch(() => {});
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/');
  }

  if (!authReady) return <AppSkeleton />;

  const shell = (
    <AppShell user={user} onLogout={handleLogout} />
  );

  return (
    <ErrorBoundary>
    <>
    <Routes>
      {/* Landing page */}
      <Route path="/" element={<LandingPage />} />

      {/* Auth routes */}
      <Route path="/login"  element={user ? <Navigate to="/day-view" replace /> : <AuthScreen initialMode="login"  />} />
      <Route path="/signup" element={user ? <Navigate to="/day-view" replace /> : <AuthScreen initialMode="signup" />} />

      {/* Pricing */}
      <Route path="/pricing" element={<PricingPage />} />

      {/* Legal routes — publicly accessible, no auth required */}
      <Route path="/privacy"       element={<LegalPage type="privacy"       />} />
      <Route path="/terms"         element={<LegalPage type="terms"         />} />
      <Route path="/billing"       element={<LegalPage type="billing"       />} />
      <Route path="/refund"        element={<LegalPage type="refund"        />} />
      <Route path="/data-deletion" element={<LegalPage type="data-deletion" />} />
      <Route path="/contact"       element={<LegalPage type="contact"       />} />
      <Route path="/ai-disclaimer"  element={<LegalPage type="ai"            />} />

      {/* Protected app routes inside shell */}
      <Route element={shell}>
        <Route path="/day-view"  element={<DayView selectedDate={selectedDate} onSelectDate={setSelectedDate} />} />
        <Route path="/canvas"    element={<CanvasTab />} />
        <Route path="/calendar"  element={
          <CalendarTab
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onSwitchToToday={() => navigate('/day-view')}
          />
        } />
        <Route path="/ai"       element={<AITab onSwitchToToday={() => navigate('/day-view')} />} />
        <Route path="/create"   element={<CreateTab />} />
        <Route path="/insights" element={<InsightsTab />} />
        <Route path="/settings" element={<SettingsTab />} />
        {/* Unknown app routes → day view */}
        <Route path="*" element={<Navigate to="/day-view" replace />} />
      </Route>
    </Routes>
    {showOnboarding && user && (
      <OnboardingFlow
        userName={
          user.user_metadata?.full_name ??
          user.user_metadata?.name ??
          user.email ??
          ''
        }
        onComplete={() => setShowOnboarding(false)}
      />
    )}
    </>
    </ErrorBoundary>
  );
}
