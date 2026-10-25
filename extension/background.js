importScripts('common.js');

// The extension's background worker. Two jobs:
//
// 1. Background sync. Every two hours while Chrome is open, and whenever the
//    student opens Soma (bridge.js asks), it re-reads each site they have
//    synced before, with their own sign-in, so Soma stays current without
//    them visiting Canvas or Gradescope. The readers need a DOM, which a
//    worker lacks, so they run in a hidden offscreen page (offscreen.js).
//    Students can turn this off in the popup; a site they're signed out of
//    records "Sign in…" and keeps its last sync.
//
// 2. Turning the extension on for a school whose Canvas has its own domain
// (canvas.emory.edu and the like). The popup asks Chrome for that one site,
// but Chrome's permission prompt closes the popup, so anything the popup
// meant to do after "Allow" never ran. This does it instead, whenever access
// to a site is granted, and again on every start so a grant that was never
// followed through (or an extension reload) still ends up running there.

const FILES = ['common.js', 'canvas.js'];
const idFor = origin => `canvas-${new URL(origin.replace('/*', '/')).host}`;

async function enable(origins) {
  const sites = origins.filter(o => /^https:\/\/[^/*]+\/\*$/.test(o) && !o.endsWith('.instructure.com/*') && o !== 'https://www.gradescope.com/*' && o !== 'https://www.webassign.net/*');
  if (!sites.length) return;
  const registered = new Set((await chrome.scripting.getRegisteredContentScripts()).map(s => s.id));
  const fresh = sites.filter(o => !registered.has(idFor(o)));
  if (fresh.length) {
    await chrome.scripting.registerContentScripts(fresh.map(o => ({
      id: idFor(o), matches: [o], js: FILES, runAt: 'document_idle', persistAcrossSessions: true,
    })));
  }
  // Tabs already open on the site start now, without a reload. canvas.js
  // checks the page really is Canvas and runs once per tab.
  for (const tab of await chrome.tabs.query({ url: sites })) {
    if (tab.id) chrome.scripting.executeScript({ target: { tabId: tab.id }, files: FILES }).catch(() => {});
  }
}

async function disable(origins) {
  const ids = origins.map(idFor);
  const registered = new Set((await chrome.scripting.getRegisteredContentScripts()).map(s => s.id));
  const gone = ids.filter(id => registered.has(id));
  if (gone.length) await chrome.scripting.unregisterContentScripts({ ids: gone });
}

chrome.permissions.onAdded.addListener(p => { void enable(p.origins || []); });
chrome.permissions.onRemoved.addListener(p => { void disable(p.origins || []); });

async function catchUp() {
  const { origins = [] } = await chrome.permissions.getAll();
  await enable(origins);
}

// ── Background sync ─────────────────────────────────────────────────────────

const ALARM = 'soma-sync';
const EVERY_MINUTES = 120;
const GRADESCOPE_HOST = 'www.gradescope.com';
const WEBASSIGN_HOST = 'www.webassign.net';

/** Sites the student has synced before and still allows: never a guess at which school. */
async function sites() {
  const [{ status = {} }, { origins = [] }] = await Promise.all([chrome.storage.local.get('status'), chrome.permissions.getAll()]);
  return Object.keys(status).flatMap(host => {
    const origin = `https://${host}`;
    if (host === GRADESCOPE_HOST) return [{ host, kind: 'gradescope', origin }];
    if (host === WEBASSIGN_HOST) return [{ host, kind: 'webassign', origin }];
    if (host.endsWith('.instructure.com') || origins.includes(`${origin}/*`)) return [{ host, kind: 'canvas', origin }];
    return [];
  });
}

let offscreenReady = null;
function ensureOffscreen() {
  offscreenReady = offscreenReady || (async () => {
    if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Read the Canvas and Gradescope pages the student is signed in to, so their coursework stays current in Soma.',
    }).catch(err => { if (!/single offscreen/i.test(String(err))) throw err; });
  })().finally(() => { offscreenReady = null; });
  return offscreenReady;
}

async function readInOffscreen(kind, origin, grades) {
  await ensureOffscreen();
  const reply = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'read', kind, origin, grades });
  if (!reply || reply.error) { const err = new Error((reply && reply.error) || 'no answer'); err.status = reply && reply.status; throw err; }
  return reply.snapshot;
}

/** Re-read every known site that wasn't tried in the last `minGapMs`. One at a time, to be gentle. */
async function syncAll(minGapMs) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (settings.background === false && minGapMs > 0) return [];
  const results = [];
  for (const s of await sites()) {
    const signedOutMessage = `Sign in to ${{ gradescope: 'Gradescope', webassign: 'WebAssign' }[s.kind] || 'Canvas'}, then sync again.`;
    results.push({ host: s.host, ...(await self.somaSync.runSync(s.host, st => readInOffscreen(s.kind, s.origin, st.grades), { minGapMs, signedOutMessage })) });
  }
  return results;
}

chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void syncAll(60 * 60 * 1000); });

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || msg.target === 'offscreen') return false;
  // Opening Soma refreshes anything older than 20 minutes; Sync everything
  // (popup, or Soma's Settings) refreshes it all now.
  if (msg.type === 'sync_all') { syncAll(msg.force ? 0 : 20 * 60 * 1000).then(reply, () => reply([])); return true; }
  return false;
});

function schedule() {
  chrome.alarms.create(ALARM, { periodInMinutes: EVERY_MINUTES, delayInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => { void catchUp(); schedule(); });
chrome.runtime.onStartup.addListener(() => { void catchUp(); schedule(); });
