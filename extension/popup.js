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

async function renderDue() {
  const { snapshots = {} } = await chrome.storage.local.get('snapshots');
  const soon = self.somaDue.dueSoon(snapshots, Date.now(), 48);
  if (!soon.length) return;
  $('due').replaceChildren(...soon.map(w => {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.setAttribute('role', 'link');
    const name = document.createElement('div');
    name.className = 'site';
    name.textContent = w.name;
    const detail = document.createElement('div');
    detail.className = 'small muted';
    const at = document.createElement('span');
    at.className = 'due-when';
    at.textContent = self.somaDue.when(w.dueAt);
    detail.append(at, ` · ${[w.course, w.note].filter(Boolean).join(' · ')}`);
    li.append(name, detail);
    const open = () => { if (/^https:\/\//.test(w.url || '')) chrome.tabs.create({ url: w.url }); };
    li.onclick = open;
    li.onkeydown = e => { if (e.key === 'Enter') open(); };
    return li;
  }));
}

const CHANGE_WORDS = { new: 'New', due_moved: 'Due date moved', graded: 'Graded', announcement: 'Announcement' };

async function renderChanged() {
  const { snapshots = {} } = await chrome.storage.local.get('snapshots');
  const week = Date.now() - 7 * 86400000;
  const all = Object.values(snapshots).flatMap(s => s.changes || [])
    .filter(c => Date.parse(c.at) > week)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);
  if (!all.length) return;
  $('changedCard').hidden = false;
  $('changed').replaceChildren(...all.map(c => {
    const li = document.createElement('li');
    const name = document.createElement('div');
    name.className = 'site';
    name.textContent = `${CHANGE_WORDS[c.type] || 'Changed'}: ${c.name}`;
    const detail = document.createElement('div');
    detail.className = 'small muted';
    const what = c.type === 'due_moved' ? `now ${self.somaDue.when(c.to)}`
      : c.type === 'new' && c.to ? `due ${self.somaDue.when(c.to)}`
      : c.type === 'graded' && c.score != null && c.maxScore ? `${c.score} / ${c.maxScore}` : '';
    detail.textContent = [c.course, what].filter(Boolean).join(' · ');
    li.append(name, detail);
    if (/^https:\/\//.test(c.url || '')) {
      li.tabIndex = 0;
      li.setAttribute('role', 'link');
      li.style.cursor = 'pointer';
      li.onclick = () => chrome.tabs.create({ url: c.url });
      li.onkeydown = e => { if (e.key === 'Enter') chrome.tabs.create({ url: c.url }); };
    }
    return li;
  }));
}

async function renderSites() {
  const { status = {} } = await chrome.storage.local.get('status');
  const hosts = Object.keys(status).filter(h => status[h].syncedAt || status[h].error);
  const list = $('sites');
  if (!hosts.length) return;
  $('syncAll').hidden = false;
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
  $('background').checked = settings.background !== false;
  for (const id of ['changes', 'reminders', 'badge']) {
    $(id).checked = settings[id] !== false;
    $(id).onchange = async e => {
      const { settings: current = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...current, [id]: e.target.checked } });
    };
  }
  $('background').onchange = async e => {
    const { settings: current = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...current, background: e.target.checked } });
  };
  $('syncAll').onclick = async () => {
    const btn = $('syncAll');
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    await chrome.runtime.sendMessage({ type: 'sync_all', force: true }).catch(() => []);
    btn.disabled = false;
    btn.textContent = 'Sync everything now';
    await renderSites();
  };
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
  await Promise.all([renderDue(), renderChanged(), renderSites(), renderHere()]);
}

void init();
