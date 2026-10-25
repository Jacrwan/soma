// Shared by the site readers (canvas.js, gradescope.js): when to sync, how a
// finished read is stored, and the popup's Sync now and probe messages. Each
// reader only says how to tell it's on its site and how to read it.
//
// A reader's read(settings) returns a snapshot with `courses` and
// `assignments`; it's kept in chrome.storage.local under the site's host, and
// bridge.js hands it to Soma.

(() => {
  if (self.somaSync) return;

  const AUTO_EVERY_MS = 3 * 60 * 60 * 1000;

  /** Plain text from HTML that came from a web page. DOMParser runs no scripts. */
  const text = html => {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const pause = ms => new Promise(r => setTimeout(r, ms));

  function start({ host, isHere, read, signedOutMessage }) {
    let running = null;
    const sync = force => {
      if (running) return running;
      running = (async () => {
        const store = await chrome.storage.local.get(['status', 'settings']);
        const status = store.status || {};
        const last = status[host] && status[host].attemptedAt ? Date.parse(status[host].attemptedAt) : 0;
        if (!force && Date.now() - last < AUTO_EVERY_MS) return { skipped: true };
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
      })().finally(() => { running = null; });
      return running;
    };

    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg && msg.type === 'sync_now') { sync(true).then(reply); return true; }
      if (msg && msg.type === 'probe') { reply({ supported: isHere(), host }); return false; }
      return false;
    });

    if (isHere()) void sync(false);
  }

  self.somaSync = { start, text, pause };
})();
