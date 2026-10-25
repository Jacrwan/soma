// Shared by the site readers (canvas.js, gradescope.js) and the background
// worker: how often a site may sync, how a finished read is stored, and the
// popup's Sync now and probe messages in a site's tab.
//
// A reader's read(settings) returns a snapshot with `courses` and
// `assignments`; it's kept in chrome.storage.local under the site's host, and
// bridge.js hands it to Soma.
//
// A site syncs when the student visits it (at most every 30 minutes), when
// they open Soma, on Sync now, and every two hours in the background while
// Chrome is open (background.js), unless they turn background sync off.

(() => {
  if (self.somaSync) return;

  const VISIT_GAP_MS = 30 * 60 * 1000;

  /** Plain text from HTML that came from a web page. DOMParser runs no scripts. */
  const text = html => {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const pause = ms => new Promise(r => setTimeout(r, ms));

  // One sync per site at a time, whoever asked for it.
  const running = new Map();

  /**
   * Read one site and store the result, unless it was tried less than
   * `minGapMs` ago. A failed read records why and keeps the last good snapshot.
   */
  function runSync(host, read, { minGapMs = 0, signedOutMessage = 'Sign in, then sync again.' } = {}) {
    if (running.has(host)) return running.get(host);
    const job = (async () => {
      const store = await chrome.storage.local.get(['status', 'settings']);
      const status = store.status || {};
      const last = status[host] && status[host].attemptedAt ? Date.parse(status[host].attemptedAt) : 0;
      if (Date.now() - last < minGapMs) return { skipped: true };
      const settings = { grades: true, ...(store.settings || {}) };
      const attemptedAt = new Date().toISOString();
      await chrome.storage.local.set({ status: { ...status, [host]: { ...(status[host] || {}), attemptedAt } } });
      try {
        const snapshot = await read(settings);
        const fresh = await chrome.storage.local.get(['snapshots', 'status']);
        await chrome.storage.local.set({
          snapshots: { ...(fresh.snapshots || {}), [host]: snapshot },
          status: { ...(fresh.status || {}), [host]: {
            attemptedAt, syncedAt: snapshot.syncedAt, deliveredAt: null, error: null,
            courses: snapshot.courses.length, assignments: snapshot.assignments.length,
          } },
        });
        return { ok: true, courses: snapshot.courses.length, assignments: snapshot.assignments.length };
      } catch (err) {
        const fresh = await chrome.storage.local.get('status');
        const message = err && err.status === 401 ? signedOutMessage : 'The site didn’t answer. Try again in a minute.';
        await chrome.storage.local.set({ status: { ...(fresh.status || {}), [host]: { ...((fresh.status || {})[host] || {}), error: message } } });
        return { ok: false, error: message };
      }
    })()
      // The extension was reloaded mid-sync: this copy can't reach storage any more.
      .catch(() => ({ ok: false, error: 'The extension was reloaded. Reload this page to sync.' }))
      .finally(() => running.delete(host));
    running.set(host, job);
    return job;
  }

  /** In a site's own tab: sync on visit, answer the popup. */
  function start({ host, isHere, read, signedOutMessage }) {
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg && msg.type === 'sync_now') { runSync(host, read, { signedOutMessage }).then(reply); return true; }
      if (msg && msg.type === 'probe') { reply({ supported: isHere(), host }); return false; }
      return false;
    });
    if (isHere()) void runSync(host, read, { minGapMs: VISIT_GAP_MS, signedOutMessage });
    // runSync never rejects, so a tab cut off by a reload stays quiet.
  }

  self.somaSync = { start, runSync, text, pause };
})();
