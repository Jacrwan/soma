// Soma for Canvas: runs on Soma's own pages. It hands what canvas.js synced to
// the Soma tab with window.postMessage; the app saves it under the signed-in
// student's account (src/lib/canvasExtension.ts). The extension itself never
// holds a Soma session or calls Soma's servers.

(() => {
  if (window.top !== window) return;
  const VERSION = chrome.runtime.getManifest().version;
  const post = msg => window.postMessage({ source: 'soma-extension', ...msg }, location.origin);

  async function deliver(hosts) {
    const { snapshots = {} } = await chrome.storage.local.get('snapshots');
    for (const host of hosts || Object.keys(snapshots)) {
      if (snapshots[host]) post({ type: 'canvas_snapshot', snapshot: snapshots[host] });
    }
  }

  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== 'soma-app') return;
    // The app may start listening after this script ran, so it says hello.
    if (msg.type === 'hello') { post({ type: 'present', version: VERSION }); return deliver(); }
    if (msg.type === 'snapshot_saved' && typeof msg.host === 'string') {
      const { status = {} } = await chrome.storage.local.get('status');
      if (status[msg.host] && status[msg.host].syncedAt === msg.syncedAt) {
        status[msg.host] = { ...status[msg.host], deliveredAt: new Date().toISOString() };
        await chrome.storage.local.set({ status });
      }
      return;
    }
    // The student removed synced data in Soma: the extension forgets it too.
    if (msg.type === 'forget') await chrome.storage.local.remove(['snapshots', 'status']);
  });

  // A sync that finishes while Soma is open arrives without a reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.snapshots) return;
    const before = changes.snapshots.oldValue || {}, after = changes.snapshots.newValue || {};
    const changed = Object.keys(after).filter(h => !before[h] || before[h].syncedAt !== after[h].syncedAt);
    if (changed.length) void deliver(changed);
  });

  post({ type: 'present', version: VERSION });
})();
