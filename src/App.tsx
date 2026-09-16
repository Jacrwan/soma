import { useState, useEffect, useRef, Component, type ReactNode, type ErrorInfo } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import AuthScreen from './components/Auth/AuthScreen';
import DayView from './components/DayView/DayView';
import CanvasTab from './components/Canvas/CanvasTab';
import DocumentsTab from './components/Documents/DocumentsTab';
import AITab from './components/AI/AITab';
import CalendarTab from './components/Calendar/CalendarTab';
import InsightsTab from './components/Insights/InsightsTab';
import SettingsTab from './components/Settings/SettingsTab';
import { storage } from './lib/storage';
import { useSubscription, refreshSubscription, hasAIAccess } from './lib/subscription';
import { TimerProvider } from './contexts/TimerContext';
import TimerOverlay from './components/Timer/TimerOverlay';
import LandingPage from './components/Landing/LandingPage';
import LegalPage from './components/Legal/LegalPage';
import PricingPage from './components/Pricing/PricingPage';
import { SkeletonBlock } from './components/UI/Skeleton';
import OnboardingFlow from './components/Onboarding/OnboardingFlow';
import TrialSetupModal from './components/Trial/TrialSetupModal';
import PaywallScreen from './components/Paywall/PaywallScreen';
import SemesterEndModal from './components/shared/SemesterEndModal';
import styles from './App.module.css';

function getSemesterKey(): string | null {
  const now = new Date();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const y = now.getFullYear();
  if ((m === 5 && d >= 15) || (m === 6 && d <= 15)) return `${y}-spring`;
  if ((m === 12 && d >= 10) || (m === 1 && d <= 5)) return `${m === 1 ? y - 1 : y}-fall`;
  return null;
}

function archiveCanvasCourses() {
  const updated = storage.getSubjects().map(s =>
    s.source === 'canvas' ? { ...s, archived: true } : s,
  );
  storage.setSubjects(updated);
}

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
        <div className={styles.brand}><img src="/favicon.png" width="22" height="22" alt="" style={{ borderRadius: 5, flexShrink: 0 }} />Soma <span className={styles.betaBadge}>beta</span></div>
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
function AppShell({ user, sessionResolved, onLogout }: {
  user: User | null;
  sessionResolved: boolean;
  onLogout: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const subscription = useSubscription();
  const aiLocked = subscription.status !== 'loading' && !hasAIAccess(subscription.status);

  // Paywall: block the app for past_due / unpaid / canceled
  const paywallStatus = (
    subscription.status === 'past_due' ||
    subscription.status === 'unpaid' ||
    subscription.status === 'canceled'
  ) ? subscription.status as 'past_due' | 'unpaid' | 'canceled' : null;

  // Days left in an active trial (for the countdown banner).
  const trialEndIso = subscription.status === 'trialing' ? subscription.trialEndsAt
    : subscription.status === 'trial_extended' ? subscription.extensionEndsAt
    : null;
  const trialDaysLeft = trialEndIso
    ? Math.max(0, Math.ceil((new Date(trialEndIso).getTime() - Date.now()) / 86_400_000))
    : null;
  const [trialBannerDismissed, setTrialBannerDismissed] = useState(
    () => localStorage.getItem('soma_trial_banner_dismissed') === new Date().toDateString(),
  );
  function dismissTrialBanner() {
    localStorage.setItem('soma_trial_banner_dismissed', new Date().toDateString());
    setTrialBannerDismissed(true);
  }

  const [showSemesterModal, setShowSemesterModal] = useState(false);
  useEffect(() => {
    const key = getSemesterKey();
    if (!key) return;
    if (localStorage.getItem('soma_semester_archive_prompted') === key) return;
    const hasActiveCanvas = storage.getSubjects().some(s => s.source === 'canvas' && !s.archived);
    if (hasActiveCanvas) setShowSemesterModal(true);
  }, []);

  const p = location.pathname;

  // Hooks must run before every conditional return.
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
      '/day-view':  'Day View | Soma',
      '/canvas':    'Canvas | Soma',
      '/documents': 'Documents | Soma',
      '/ai':        'AI | Soma',
      '/calendar':  'Calendar | Soma',
      '/insights':  'Insights | Soma',
      '/settings':  'Settings | Soma',
    };
    document.title = titles[p] ?? 'Soma';
  }, [p]);

  // Only redirect to login when we definitively know there is no session.
  if (!user && sessionResolved) return <Navigate to="/login" replace />;

  // Full-screen paywall for expired/failed subscriptions
  if (paywallStatus && subscription.status !== 'loading') {
    return (
      <PaywallScreen
        status={paywallStatus}
        onResubscribe={() => navigate('/pricing')}
      />
    );
  }

  function nav(path: string) {
    return `${styles.navItem}${p === path ? ` ${styles.navItemActive}` : ''}`;
  }

  return (
    <TimerProvider>
    <div className={styles.app}>
      <TimerOverlay />
      {showSemesterModal && (
        <SemesterEndModal
          onConfirm={() => {
            archiveCanvasCourses();
            const key = getSemesterKey();
            if (key) localStorage.setItem('soma_semester_archive_prompted', key);
            setShowSemesterModal(false);
          }}
          onDismiss={() => {
            const key = getSemesterKey();
            if (key) localStorage.setItem('soma_semester_archive_prompted', key);
            setShowSemesterModal(false);
          }}
        />
      )}
      <nav className={styles.sidebar}>
        <div className={styles.brand}><img src="/favicon.png" width="22" height="22" alt="" style={{ borderRadius: 5, flexShrink: 0 }} />Soma <span className={styles.betaBadge}>beta</span></div>

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

          <button className={nav('/documents')} onClick={() => navigate('/documents')}>
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 1.5h5L11 4v8.5a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5Z"/>
              <path d="M8.5 1.5V4H11"/>
              <path d="M4.5 6.5h4M4.5 8.5h4M4.5 10.5h2.5"/>
            </svg>
            Documents
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
            {aiLocked && (
              <svg className={styles.navLock} width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-label="Premium">
                <rect x="3" y="6.5" width="8" height="6" rx="1"/>
                <path d="M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0v2"/>
              </svg>
            )}
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
        {subscription.error && (
          <div role="alert" className={styles.trialBanner}>
            <span>{subscription.error}</span>
            <button onClick={() => void refreshSubscription()}>Retry</button>
          </div>
        )}
        {trialDaysLeft !== null && !trialBannerDismissed && (
          <div className={styles.trialBanner}>
            <span className={styles.trialBannerText}>
              {trialDaysLeft === 0
                ? 'Your trial ends today — your card will be charged at end of day.'
                : `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left in your free trial.`}
            </span>
            <button className={styles.trialBannerClose} onClick={dismissTrialBanner} aria-label="Dismiss">×</button>
          </div>
        )}
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
  const [user, setUser]             = useState<User | null>(null);
  const [authReady, setAuthReady]   = useState(false);
  // true only when Supabase actually responded — false if the fallback timeout fired
  const [sessionResolved, setSessionResolved] = useState(false);
  const [showOnboarding, setShowOnboarding]   = useState(false);
  const [showTrialModal, setShowTrialModal]   = useState(false);
  const subscription = useSubscription();
  const userId = user?.id;
  const location = useLocation();
  const dismissedTrialUsers = useRef(new Set<string>());
  function dismissTrial() {
    if (userId) {
      dismissedTrialUsers.current.add(userId);
      try { sessionStorage.setItem(`soma_trial_dismissed:${userId}`, 'true'); } catch { /* memory fallback */ }
    }
    setShowTrialModal(false);
  }
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

  // Show trial modal for logged-in users with no subscription once status resolves
  useEffect(() => {
    if (!userId || showOnboarding || subscription.error || subscription.status !== 'free') {
      setShowTrialModal(false);
      return;
    }
    let dismissed = dismissedTrialUsers.current.has(userId);
    try { dismissed ||= sessionStorage.getItem(`soma_trial_dismissed:${userId}`) === 'true'; } catch { /* memory fallback */ }
    if (dismissed) { setShowTrialModal(false); return; }
    if (subscription.status === 'free') {
      const publicPaths = ['/', '/login', '/signup', '/pricing'];
      const isPublic = publicPaths.includes(window.location.pathname) ||
        window.location.pathname.startsWith('/privacy') ||
        window.location.pathname.startsWith('/terms') ||
        window.location.pathname.startsWith('/billing') ||
        window.location.pathname.startsWith('/refund') ||
        window.location.pathname.startsWith('/data-deletion') ||
        window.location.pathname.startsWith('/contact') ||
        window.location.pathname.startsWith('/ai-disclaimer');
      setShowTrialModal(!isPublic);
    }
  }, [userId, subscription.status, subscription.error, showOnboarding, location.pathname]);

  async function checkOnboarding(u: User) {
    try {
      const s = await storage.getSettings();
      if (s.onboardingCompleted) return;
      // Only show onboarding for accounts created in the last 5 minutes (new signups).
      // Existing users who signed up before onboarding was added skip it silently.
      const createdAt = new Date(u.created_at).getTime();
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      if (createdAt < fiveMinAgo) {
        // Existing account — mark onboarding as done silently
        storage.saveSettings({ ...s, onboardingCompleted: true }).catch(() => {});
        return;
      }
      setShowOnboarding(true);
    } catch { /* fail silently */ }
  }

  useEffect(() => {
    console.log('[App] starting auth setup');

    // Fallback: if INITIAL_SESSION never fires (very unusual), unblock the
    // skeleton after 5 s but leave sessionResolved=false so AppShell does NOT
    // redirect to login — the app sits in a neutral state until Supabase responds.
    const forceReady = setTimeout(() => {
      console.warn('[App] auth timeout — unblocking skeleton without redirecting');
      setAuthReady(true);
      // sessionResolved intentionally stays false
    }, 5000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[App] onAuthStateChange:', event, 'user:', !!session?.user);
      const u = session?.user ?? null;
      setUser(u);

      if (event === 'INITIAL_SESSION') {
        if (u) {
          console.log('[App] INITIAL_SESSION — logged in, loading tokens');
          storage.loadTokens().catch(() => {});
          if (!onboardingChecked.current) {
            onboardingChecked.current = true;
            checkOnboarding(u);
          }
        } else {
          console.log('[App] INITIAL_SESSION — no session');
        }
        clearTimeout(forceReady);
        setSessionResolved(true);
        setAuthReady(true);
      }

      if (event === 'SIGNED_IN' && u) {
        if (!onboardingChecked.current) {
          onboardingChecked.current = true;
          checkOnboarding(u);
        }
        const path = window.location.pathname;
        if (path === '/' || path === '/login' || path === '/signup') {
          navigate('/day-view', { replace: true });
        }
      }
    });

    return () => {
      clearTimeout(forceReady);
      subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/');
  }

  if (!authReady) {
    const publicRoutes = ['/', '/login', '/signup', '/pricing'];
    const isPublic = publicRoutes.includes(window.location.pathname) ||
      window.location.pathname.startsWith('/privacy') ||
      window.location.pathname.startsWith('/terms') ||
      window.location.pathname.startsWith('/billing') ||
      window.location.pathname.startsWith('/refund') ||
      window.location.pathname.startsWith('/data-deletion') ||
      window.location.pathname.startsWith('/contact') ||
      window.location.pathname.startsWith('/ai-disclaimer');
    if (isPublic) return null;
    return <AppSkeleton />;
  }

  const shell = (
    <AppShell user={user} sessionResolved={sessionResolved} onLogout={handleLogout} />
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
        <Route path="/documents" element={<DocumentsTab />} />
        <Route path="/calendar"  element={
          <CalendarTab
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onSwitchToToday={() => navigate('/day-view')}
          />
        } />
        <Route path="/ai"       element={<AITab onSwitchToToday={() => navigate('/day-view')} />} />
        <Route path="/insights" element={<InsightsTab userId={user?.id ?? null} />} />
        <Route path="/settings" element={<SettingsTab />} />
        {/* Unknown app routes → day view */}
        <Route path="*" element={<Navigate to="/day-view" replace />} />
      </Route>
    </Routes>
    {showOnboarding && user && !['/','/login','/signup','/pricing'].includes(window.location.pathname) && (
      <OnboardingFlow
        userName={
          user.user_metadata?.full_name ??
          user.user_metadata?.name ??
          user.email ??
          ''
        }
        onComplete={() => {
          setShowOnboarding(false);
          // The subscription effect decides whether a trial prompt is appropriate.
        }}
      />
    )}
    {showTrialModal && user && !showOnboarding &&
      !['/','/login','/signup','/pricing'].includes(window.location.pathname) &&
      subscription.status === 'free' && !subscription.error && (
      <TrialSetupModal
        onComplete={() => { dismissTrial(); void refreshSubscription(); }}
        onSkip={dismissTrial}
      />
    )}
    </>
    </ErrorBoundary>
  );
}
