// Crash safety for the beta: anything that goes wrong is reported (a few per visit)
// to Soma's /api/game-error, and if the game can't start at all the player sees a
// plain message with a reload button instead of a blank page.

const BUILD = '2026.11.17';
let sent = 0;
let booted = false;
const dev = Boolean(import.meta.env?.DEV);

/** Sends one error report. Quietly does nothing in dev, offline or after five. */
export function reportError(message, stack = '', extra = {}) {
  if (dev || sent >= 5) return;
  sent += 1;
  try {
    fetch('/api/game-error', {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: String(message || 'unknown').slice(0, 500), stack: String(stack || '').slice(0, 4000), url: location.pathname, ua: navigator.userAgent.slice(0, 300), build: BUILD, ...extra }),
    }).catch(() => {});
  } catch { /* nothing to do */ }
}

/** A full-screen message for when the game can't run. */
export function showCrash(title, text, { reload = true, dismiss = false } = {}) {
  if (document.getElementById('crash')) return;
  const box = document.createElement('div');
  box.id = 'crash';
  box.setAttribute('role', 'alertdialog');
  box.style.cssText = 'position:fixed;inset:0;z-index:200;display:grid;place-items:center;background:rgba(14,12,26,0.92);color:#fff6e6;font:600 16px/1.5 system-ui,sans-serif;padding:24px';
  const card = document.createElement('div');
  card.style.cssText = 'max-width:440px;text-align:center;display:grid;gap:14px';
  const h = document.createElement('h2');
  h.textContent = title;
  h.style.cssText = 'margin:0;font-size:24px';
  const p = document.createElement('p');
  p.textContent = text;
  p.style.cssText = 'margin:0;opacity:.85';
  card.append(h, p);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;justify-content:center';
  const button = (label, onclick, primary) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `padding:11px 20px;border-radius:12px;border:0;font:inherit;font-weight:800;cursor:pointer;${primary ? 'background:#3ec45a;color:#fff' : 'background:rgba(255,255,255,0.12);color:#fff'}`;
    b.onclick = onclick;
    row.append(b);
  };
  if (reload) button('Reload', () => location.reload(), true);
  if (dismiss) button('Continue anyway', () => box.remove(), !reload);
  card.append(row);
  box.append(card);
  document.body.append(box);
}

export const markBooted = () => { booted = true; };

/** True when this browser can draw WebGL at all. */
export function webglOk() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

window.addEventListener('error', (e) => {
  reportError(e.message, e.error?.stack, { phase: booted ? 'play' : 'start' });
  if (!booted) showCrash('Epoch couldn’t start', 'Something went wrong while loading. Reloading usually fixes it. If it keeps happening, tell us with the feedback button in Soma.');
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  if (r?.name === 'AbortError') return;
  reportError(r?.message || r, r?.stack, { phase: booted ? 'play' : 'start', kind: 'promise' });
});
