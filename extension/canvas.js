// Soma for Canvas: runs on Canvas pages, in the student's own signed-in
// session. It reads their courses, assignment groups, assignments (with their
// own submission) and recent announcements from Canvas's JSON API on the same
// site, and keeps the result in the extension's storage. bridge.js hands it to
// an open Soma tab, which saves it under the student's Soma account.
//
// Nothing here sends a cookie, token or password anywhere. Requests go only to
// the Canvas site the page is on, and only read (GET).
//
// It syncs when the student is on Canvas: at most every few hours on its own,
// or right away from the popup's "Sync now". No background crawling.

(() => {
  const VERSION = 1;
  const { start, text, pause } = self.somaSync;

  /**
   * The reader for one Canvas site. It runs in a Canvas tab when the student
   * visits, and in the extension's offscreen page (offscreen.js) for the
   * background sync, so it uses only `origin`, never the page around it.
   */
  function canvasReader(origin) {
    const host = new URL(origin).host;

    async function getJson(path) {
      const res = await fetch(path.startsWith('http') ? path : origin + path, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) { const err = new Error(`Canvas answered ${res.status}`); err.status = res.status; throw err; }
      const raw = await res.text();
      // Canvas prefixes JSON with this guard on some setups.
      return { body: JSON.parse(raw.replace(/^while\(1\);/, '')), next: nextLink(res.headers.get('Link')) };
    }

    const nextLink = header => {
      const m = /<([^>]+)>;\s*rel="next"/.exec(header || '');
      if (!m) return null;
      try { const u = new URL(m[1]); return u.origin === origin ? u.href : null; } catch { return null; }
    };

    /** Every page of a list, up to a limit so a huge course can't stall the tab. */
    async function getAll(path, maxPages = 10) {
      const out = [];
      let url = path;
      for (let i = 0; url && i < maxPages; i++) {
        const { body, next } = await getJson(url);
        if (Array.isArray(body)) out.push(...body);
        url = next;
      }
      return out;
    }

    async function readCanvas({ grades }) {
      const courses = (await getAll('/api/v1/courses?enrollment_state=active&include[]=term&include[]=total_scores&per_page=50'))
        .filter(c => c && c.id && c.name && !c.access_restricted_by_date);

      const recent = Date.now() - 14 * 86400000;
      const snapshot = { kind: 'canvas', v: VERSION, host, syncedAt: '', courses: [], groups: [], assignments: [], announcements: [] };
      for (const c of courses) {
        const enrollment = (c.enrollments || []).find(e => e.type === 'student' || e.type === 'StudentEnrollment') || (c.enrollments || [])[0] || {};
        snapshot.courses.push({
          id: c.id,
          name: c.name,
          courseCode: c.course_code || c.name,
          term: c.term && c.term.name ? c.term.name : undefined,
          currentScore: grades ? enrollment.computed_current_score ?? null : null,
          currentGrade: grades ? enrollment.computed_current_grade ?? null : null,
          weighted: c.apply_assignment_group_weights === true,
        });
      }

      for (const c of snapshot.courses) {
        // A course can hide its assignment list; that course is skipped, not the sync.
        try {
          for (const g of await getAll(`/api/v1/courses/${c.id}/assignment_groups?per_page=50`, 3)) {
            snapshot.groups.push({ id: g.id, courseId: c.id, name: g.name || '', weight: typeof g.group_weight === 'number' ? g.group_weight : 0 });
          }
          for (const a of await getAll(`/api/v1/courses/${c.id}/assignments?include[]=submission&order_by=due_at&per_page=100`)) {
            const s = a.submission || {};
            snapshot.assignments.push({
              id: a.id,
              courseId: c.id,
              name: a.name || '',
              dueAt: a.due_at || null,
              htmlUrl: a.html_url || '',
              // Only for work still ahead: a semester of old descriptions would fill Soma's storage.
              description: !a.due_at || Date.parse(a.due_at) >= recent ? text(a.description).slice(0, 2000) : '',
              pointsPossible: typeof a.points_possible === 'number' ? a.points_possible : null,
              groupId: a.assignment_group_id || null,
              submittedAt: s.submitted_at || null,
              workflowState: s.workflow_state || 'unsubmitted',
              // How it's handed in: "on_paper" or "none" never shows as submitted, so reminders skip those.
              submissionTypes: Array.isArray(a.submission_types) ? a.submission_types.slice(0, 6).map(String) : [],
              score: grades && typeof s.score === 'number' ? s.score : null,
              grade: grades && s.grade != null ? String(s.grade) : null,
              missing: s.missing === true,
              late: s.late === true,
              excused: s.excused === true,
            });
          }
        } catch (err) {
          if (err.status !== 401 && err.status !== 403 && err.status !== 404) throw err;
        }
        await pause(150);
      }

      if (snapshot.courses.length) {
        const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const until = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        const contexts = snapshot.courses.slice(0, 20).map(c => `context_codes[]=course_${c.id}`).join('&');
        try {
          for (const n of await getAll(`/api/v1/announcements?${contexts}&start_date=${since}&end_date=${until}&per_page=50`, 2)) {
            const courseId = Number(/course_(\d+)/.exec(n.context_code || '')?.[1]);
            if (!courseId) continue;
            snapshot.announcements.push({ id: n.id, courseId, title: n.title || '', message: text(n.message).slice(0, 1500), postedAt: n.posted_at || n.created_at, htmlUrl: n.html_url || '' });
          }
        } catch { /* announcements are extra; a refusal costs only them */ }
      }

      snapshot.syncedAt = new Date().toISOString();
      return snapshot;
    }

    return readCanvas;
  }

  (self.somaReaders = self.somaReaders || {}).canvas = canvasReader;

  // In a Canvas tab: sync on visit and answer the popup. The offscreen page
  // only needs the reader above.
  if (location.protocol !== 'https:' || window.top !== window || window.__somaCanvas) return;
  window.__somaCanvas = true;

  // Canvas pages carry this shell; a site that merely lives on instructure.com
  // (a status page, a login screen) doesn't.
  const looksLikeCanvas = () => !!document.querySelector('#application.ic-app, .ic-app, #application');

  start({ host: location.host, isHere: looksLikeCanvas, read: canvasReader(location.origin), signedOutMessage: 'Sign in to Canvas, then sync again.' });
})();
