import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import { lazy, Suspense } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { features } from './lib/features';

// The mock route never imports App or its live data/timer providers.
const App = lazy(() => import('./App.tsx'));
const DashboardV2 = lazy(() => import('./components/DashboardV2/DashboardV2'));
const mockPreview = features.dashboard_v2 && window.location.pathname === '/dashboard-v2';

// Page views only ever report the path: the Google sign-in redirect puts an
// access token in the hash, and query strings can carry other state.
function pathOnly<T extends { url: string }>(event: T): T {
  const url = new URL(event.url);
  return { ...event, url: url.origin + url.pathname };
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Suspense fallback={<p role="status">Loading Soma…</p>}>
      {mockPreview ? <DashboardV2 /> : <App />}
    </Suspense>
    <Analytics beforeSend={pathOnly} />
  </BrowserRouter>
);
