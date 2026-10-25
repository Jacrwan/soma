// Turning the extension on for a school whose Canvas has its own domain
// (canvas.emory.edu and the like). The popup asks Chrome for that one site,
// but Chrome's permission prompt closes the popup, so anything the popup
// meant to do after "Allow" never ran. This does it instead, whenever access
// to a site is granted, and again on every start so a grant that was never
// followed through (or an extension reload) still ends up running there.

const FILES = ['common.js', 'canvas.js'];
const idFor = origin => `canvas-${new URL(origin.replace('/*', '/')).host}`;

async function enable(origins) {
  const sites = origins.filter(o => /^https:\/\/[^/*]+\/\*$/.test(o) && !o.endsWith('.instructure.com/*') && o !== 'https://www.gradescope.com/*');
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
chrome.runtime.onInstalled.addListener(() => { void catchUp(); });
chrome.runtime.onStartup.addListener(() => { void catchUp(); });
