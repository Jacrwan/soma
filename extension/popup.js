// The popup: what has synced, a Sync now button on Canvas pages, and turning
// the extension on for a school whose Canvas isn't on instructure.com
// (bruinlearn.ucla.edu and the like). That last one asks Chrome for access to
// that one site only, at the moment the student clicks.

const SOMA_URL = 'https://somastudy.app/deadlines';
const $ = id => document.getElementById(id);

const ago = iso => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
};

async function renderSites() {
  const { status = {} } = await chrome.storage.local.get('status');
  const hosts = Object.keys(status).filter(h => status[h].syncedAt || status[h].error);
  const list = $('sites');
  if (!hosts.length) return;
  list.replaceChildren(...hosts.map(h => {
    const s = status[h];
    const li = document.createElement('li');
    const name = document.createElement('div');
    name.className = 'site';
    name.textContent = h;
    const detail = document.createElement('div');
    detail.className = s.error ? 'small error' : 'small muted';
    detail.textContent = s.error
      ? s.error
      : `${s.courses} courses · ${s.assignments} assignments · ${ago(s.syncedAt)}${s.deliveredAt ? ' · in Soma' : ' · open Soma to bring it in'}`;
    li.append(name, detail);
    return li;
  }));
}

function sendToTab(tabId, msg) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, msg, reply => resolve(chrome.runtime.lastError ? null : reply));
  });
}

async function syncNow(tabId) {
  const btn = $('syncNow');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  const result = await sendToTab(tabId, { type: 'sync_now' });
  btn.disabled = false;
  btn.textContent = 'Sync now';
  $('hereText').textContent = !result ? 'Reload this Canvas page, then try again.'
    : result.ok ? `Synced ${result.courses} courses and ${result.assignments} assignments.`
    : result.error;
  await renderSites();
}

async function enableSite(tab, origin) {
  // Chrome's prompt usually closes this popup; background.js then turns the
  // site on and starts the sync. If the popup is still open, say so here.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) return;
  $('enableSite').hidden = true;
  $('hereText').textContent = 'Turned on. Syncing now; open this popup again in a moment to see it.';
  await new Promise(r => setTimeout(r, 1500));
  await renderSites();
}

async function renderHere() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !/^https:/.test(tab.url || '')) return;
  const origin = new URL(tab.url).origin;
  const here = $('here');

  const probe = await sendToTab(tab.id, { type: 'probe' });
  if (probe && probe.supported) {
    here.hidden = false;
    $('hereText').textContent = `You’re on ${probe.host}.`;
    $('syncNow').hidden = false;
    $('syncNow').onclick = () => syncNow(tab.id);
    return;
  }
  if (probe) return;   // the script is here, but this page isn't one it reads

  // Not running here. Is this a Canvas site on its own domain?
  let isCanvas = false;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => !!document.querySelector('#application.ic-app, .ic-app'),
    });
    isCanvas = !!(res && res.result);
  } catch { /* a page the extension can't look at */ }
  if (!isCanvas) return;
  here.hidden = false;
  $('hereText').textContent = new URL(origin).host.endsWith('.instructure.com')
    ? 'Reload this page to sync it.'
    : 'This looks like your school’s Canvas. Let Soma read it on this site?';
  if (!new URL(origin).host.endsWith('.instructure.com')) {
    $('enableSite').hidden = false;
    $('enableSite').onclick = () => enableSite(tab, origin);
  }
}

async function init() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  $('grades').checked = settings.grades !== false;
  $('grades').onchange = async e => {
    const { settings: current = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...current, grades: e.target.checked } });
  };
  $('openSoma').onclick = () => chrome.tabs.create({ url: SOMA_URL });
  $('forget').onclick = async () => {
    await chrome.storage.local.remove(['snapshots', 'status']);
    $('sites').replaceChildren(Object.assign(document.createElement('li'), {
      className: 'muted',
      textContent: 'Removed from this browser. To remove it from your Soma account too, use Settings → Canvas in Soma.',
    }));
  };
  await Promise.all([renderSites(), renderHere()]);
}

void init();
