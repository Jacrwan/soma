/**
 * Demo mode: a fully offline copy of the app filled with a made-up student's
 * semester, for screen recordings and social previews. Open /demo to enter it
 * (it sticks for the tab via sessionStorage) and /demo/exit to leave. Nothing
 * reads or writes the real backend: Supabase and the /api routes are mocked,
 * and localStorage is swapped for an in-memory copy so the demo never touches
 * a real account's cached data. Reloading the page resets the demo.
 */
const FLAG = 'soma_demo';

function detect(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname;
  try {
    if (path === '/demo/exit') {
      sessionStorage.removeItem(FLAG);
      window.history.replaceState(null, '', '/');
      return false;
    }
    if (path === '/demo' || path.startsWith('/demo/')) {
      sessionStorage.setItem(FLAG, '1');
      window.history.replaceState(null, '', '/dashboard');
      return true;
    }
    return import.meta.env.VITE_DEMO === '1' || sessionStorage.getItem(FLAG) === '1';
  } catch {
    return import.meta.env.VITE_DEMO === '1';
  }
}

export const DEMO = detect();

export function exitDemo() {
  try { sessionStorage.removeItem(FLAG); } catch { /* non-fatal */ }
  window.location.assign('/');
}

// Keep the demo's cached Canvas feed, plans and settings out of the real
// localStorage. Only per-device display preferences are carried in.
if (DEMO) {
  const memory = new Map<string, string>();
  try {
    for (const key of ['soma_nav_collapsed']) {
      const v = window.localStorage.getItem(key);
      if (v !== null) memory.set(key, v);
    }
  } catch { /* storage blocked */ }
  const shim: Storage = {
    get length() { return memory.size; },
    clear: () => memory.clear(),
    getItem: k => memory.get(k) ?? null,
    key: i => [...memory.keys()][i] ?? null,
    removeItem: k => { memory.delete(k); },
    setItem: (k, v) => { memory.set(k, String(v)); },
  };
  try {
    Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
  } catch (err) {
    console.warn('[demo] could not isolate localStorage', err);
  }
}
