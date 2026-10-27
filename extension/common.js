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

  // ── What changed ──────────────────────────────────────────────────────────
  // Each sync is compared with the one before it, and what's new is kept on
  // the snapshot (`changes`, the last 14 days, newest first) so it reaches
  // Soma, other devices and the AI the same way the rest does.

  const KEEP_CHANGES_MS = 14 * 86400000;
  const MAX_CHANGES = 50;
  /** "CS-170-1: Intro to…" → "CS-170-1"; "PHYS 151, Fall 2026" → "PHYS 151". */
  const shortCourse = name => String(name || '').split(/[:,]| - /)[0].trim().slice(0, 30);
  const handedIn = (kind, a) => kind === 'gradescope' ? a.status !== 'not_submitted'
    : kind === 'webassign' ? a.status === 'complete'
    : !!(a.excused || a.submittedAt || ['submitted', 'graded', 'pending_review'].includes(a.workflowState));
  const graded = (kind, a) => kind === 'gradescope' ? a.status === 'graded'
    : kind === 'webassign' ? false
    : a.workflowState === 'graded' || a.score != null;

  /**
   * What's different in `next` compared with `prev`: work added, a due date
   * moved, a grade posted, an announcement. Nothing on a site's first sync,
   * which would otherwise report the whole semester as new.
   */
  function diff(prev, next) {
    if (!prev || !Array.isArray(prev.assignments)) return [];
    const kind = next.kind || 'canvas';
    const at = next.syncedAt;
    const courseOf = new Map((next.courses || []).map(c => [c.id, shortCourse(c.name || c.shortName)]));
    const before = new Map(prev.assignments.map(a => [a.id, a]));
    const out = [];
    const base = a => ({ at, site: kind, assignmentId: a.id, name: a.name, course: courseOf.get(a.courseId) || '', url: a.htmlUrl || '' });
    for (const a of next.assignments || []) {
      const old = before.get(a.id);
      // New work, unless it was already handed in or is long past.
      if (!old) {
        if (!handedIn(kind, a) && (!a.dueAt || Date.parse(a.dueAt) > Date.now() - 86400000)) out.push({ ...base(a), type: 'new', to: a.dueAt || null });
        continue;
      }
      if ((old.dueAt || null) !== (a.dueAt || null) && a.dueAt) out.push({ ...base(a), type: 'due_moved', from: old.dueAt || null, to: a.dueAt });
      if (!graded(kind, old) && graded(kind, a)) out.push({ ...base(a), type: 'graded', score: a.score ?? null, maxScore: a.pointsPossible ?? a.maxScore ?? null });
    }
    if (kind === 'canvas') {
      const seen = new Set((prev.announcements || []).map(n => n.id));
      for (const n of next.announcements || []) {
        if (!seen.has(n.id)) out.push({ at, site: kind, type: 'announcement', name: n.title, course: courseOf.get(n.courseId) || '', url: n.htmlUrl || '' });
      }
    }
    return out;
  }

  /** The new snapshot, carrying its own changes plus the recent ones before it. */
  function withChanges(prev, next) {
    const now = Date.now();
    const recent = [...diff(prev, next), ...((prev && prev.changes) || [])]
      .filter(c => Date.parse(c.at) > now - KEEP_CHANGES_MS)
      .slice(0, MAX_CHANGES);
    return { ...next, changes: recent };
  }

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
        const fetched = await read(settings);
        // Read storage again after the read: another site may have synced meanwhile.
        const fresh = await chrome.storage.local.get(['snapshots', 'status']);
        const snapshot = withChanges((fresh.snapshots || {})[host], fetched);
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

  self.somaSync = { start, runSync, text, pause, diff, withChanges };
})();
