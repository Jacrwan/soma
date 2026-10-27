// Soma for Canvas, on WebAssign: runs on www.webassign.net in the student's
// own signed-in session. Canvas often shows nothing for WebAssign homework
// (PHYS 151's Canvas lists one exam), so this reads WebAssign itself:
//
// - the class home page (/v4cgi/student.pl), whose assignment list is the JSON
//   in #js-student-myAssignmentsWrapper's data-assignments attribute: each
//   current assignment's id, name and due time (epoch seconds);
// - each current assignment's page, for how far along it is: every question
//   part has a points cell (td.points.questionGrade, "–/1" until answered)
//   and a submissions cell (td.submissions, "0/100" until tried).
//
// Past assignments are only ids on that page, and past due, so they're left
// out. Same rules as the other readers: same-site GETs only, nothing but
// these fields leaves the page, scores only when grades are on.

(() => {
  const VERSION = 1;
  const MAX_ASSIGNMENTS = 30;
  const { start, pause } = self.somaSync;

  function webassignReader(origin) {
    const host = new URL(origin).host;

    async function page(path) {
      const res = await fetch(origin + path, { credentials: 'include', headers: { Accept: 'text/html' } });
      if (res.redirected && /login|wa-auth/i.test(new URL(res.url).pathname)) { const err = new Error('signed out'); err.status = 401; throw err; }
      if (!res.ok) { const err = new Error(`WebAssign answered ${res.status}`); err.status = res.status; throw err; }
      const html = await res.text();
      return { html, doc: new DOMParser().parseFromString(html, 'text/html') };
    }

    /** How far along an assignment is, from its question parts. */
    function progress(doc, grades) {
      const parts = [...doc.querySelectorAll('td.points.questionGrade[id^="dashboard_box"]')];
      const tries = [...doc.querySelectorAll('td.submissions')].map(c => Number(/^\s*(\d+)\s*\//.exec(c.textContent)?.[1] ?? 0));
      let answered = 0, earned = 0, possible = 0;
      parts.forEach((p, i) => {
        const m = /([\d.]+|–|-)\s*\/\s*([\d.]+)/.exec(p.textContent);
        if (m) { possible += Number(m[2]); if (/\d/.test(m[1])) earned += Number(m[1]); }
        if ((tries[i] ?? 0) > 0 || (m && /\d/.test(m[1]))) answered++;
      });
      const status = !parts.length ? 'not_started' : answered === parts.length ? 'complete' : answered ? 'in_progress' : 'not_started';
      return { status, parts: parts.length, answered, score: grades && answered ? Math.round(earned * 100) / 100 : null, maxScore: possible || null };
    }

    return async function readWebassign({ grades }) {
      const { html, doc } = await page('/v4cgi/student.pl');
      const wrapper = doc.querySelector('#js-student-myAssignmentsWrapper');
      // Signed out pages and redesigned ones both lack the list: keep the last good sync.
      if (!wrapper) { const err = new Error(doc.querySelector('input[type="password"]') ? 'signed out' : 'unreadable'); err.status = doc.querySelector('input[type="password"]') ? 401 : undefined; throw err; }
      const data = JSON.parse(wrapper.getAttribute('data-assignments') || '{}');
      const courseId = Number(/"contextId"\s*:\s*"WA-[a-z]+-(\d+)"/.exec(html)?.[1]) || 0;
      const courseName = (doc.title || '').replace(/\s*-\s*Home\b.*$/i, '').trim() || 'WebAssign';
      const assignments = [];
      for (const a of (Array.isArray(data.current_assignments) ? data.current_assignments : []).slice(0, MAX_ASSIGNMENTS)) {
        const id = Number(a && a.id);
        if (!id || !a.name) continue;
        const seconds = Number(a.due && a.due.seconds);
        let detail = { status: 'not_started', parts: 0, answered: 0, score: null, maxScore: null };
        try { detail = progress((await page(`/web/Student/Assignment-Responses/last?dep=${id}`)).doc, grades); }
        catch (err) { if (err.status === 401) throw err; }
        assignments.push({
          id, courseId, name: String(a.name).trim(),
          dueAt: seconds ? new Date(seconds * 1000).toISOString() : null,
          htmlUrl: `${origin}/web/Student/Assignment-Responses/last?dep=${id}`,
          ...detail,
        });
        await pause(250);
      }
      return { kind: 'webassign', v: VERSION, host, syncedAt: new Date().toISOString(), courses: [{ id: courseId, name: courseName }], assignments };
    };
  }

  (self.somaReaders = self.somaReaders || {}).webassign = webassignReader;

  if (location.protocol !== 'https:' || window.top !== window || window.__somaWebassign) return;
  window.__somaWebassign = true;

  const isHere = () => !document.querySelector('input[type="password"]') &&
    (!!document.querySelector('#js-student-myAssignmentsWrapper') || /^\/(web\/Student|v4cgi\/student)/.test(location.pathname));

  start({ host: location.host, isHere, read: webassignReader(location.origin), signedOutMessage: 'Sign in to WebAssign, then sync again.' });
})();
