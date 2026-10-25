// Soma for Canvas, on Gradescope: runs on www.gradescope.com in the student's
// own signed-in session and reads two kinds of page they can already open —
// their course list, and each current course's assignments table (name, due
// date, late due date, and "No Submission" / "Submitted" / a score).
//
// Gradescope has no data feed for students, so this reads the pages
// themselves. The selectors below are Gradescope's own class names; when one
// isn't found it falls back to the table's structure, and when nothing is
// found the sync stores nothing rather than a wrong "nothing due".
//
// Same rules as Canvas: same-site GETs only, nothing but the parsed fields
// leaves the page, and it syncs only when the student is on Gradescope.

(() => {
  if (window.top !== window || window.__somaGradescope) return;
  window.__somaGradescope = true;

  const VERSION = 1;
  const MAX_COURSES = 12;
  const { start, pause } = self.somaSync;
  const host = location.host;
  const origin = location.origin;

  const isHere = () => !document.querySelector('form[action="/login"], .loginForm') &&
    !!document.querySelector('.courseList, .courseBox, #assignments-student-table, a[href^="/courses/"]');

  async function page(path) {
    const res = await fetch(origin + path, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
    if (res.redirected && /\/login\b/.test(res.url)) { const err = new Error('signed out'); err.status = 401; throw err; }
    if (!res.ok) { const err = new Error(`Gradescope answered ${res.status}`); err.status = res.status; throw err; }
    return new DOMParser().parseFromString(await res.text(), 'text/html');
  }

  const clean = s => (s || '').replace(/\s+/g, ' ').trim();

  /** "2026-10-27 23:59:00 -0700" (Gradescope's datetime attribute) as ISO. */
  function gsDate(raw) {
    const v = clean(raw);
    if (!v) return null;
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*(?:([+-]\d{2}):?(\d{2})|Z|UTC)?$/.exec(v);
    const t = m ? Date.parse(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}${m[3] ? `${m[3]}:${m[4]}` : 'Z'}`) : Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  /**
   * The student's courses from the course list, newest term only. The list
   * is grouped under term headings, newest first, and may have a separate
   * "Instructor Courses" section, which is skipped.
   */
  function readCourses(doc) {
    const courses = [];
    let term = '', firstTerm = null, instructor = false;
    // Course boxes when the page has them; plain course links only if not, so
    // a menu of courses elsewhere on the page can't stand in for the list.
    const links = doc.querySelector('a.courseBox') ? 'a.courseBox' : 'a[href^="/courses/"]';
    const nodes = doc.querySelectorAll(`h1, h2, .pageHeading, .courseList--term, ${links}`);
    const seen = new Set();
    for (const el of nodes) {
      if (el.matches('h1, h2, .pageHeading') && !el.matches('.courseList--term')) {
        const t = clean(el.textContent).toLowerCase();
        if (/instructor/.test(t)) instructor = true;
        else if (/student|your courses/.test(t)) instructor = false;
        continue;
      }
      if (el.matches('.courseList--term')) { term = clean(el.textContent); continue; }
      const id = Number(/^\/courses\/(\d+)\/?$/.exec(el.getAttribute('href') || '')?.[1]);
      if (!id || seen.has(id) || instructor) continue;
      if (firstTerm === null) firstTerm = term;
      if (term !== firstTerm) continue;
      seen.add(id);
      const shortName = clean(el.querySelector('.courseBox--shortname, h3, h4')?.textContent) || clean(el.textContent);
      const name = clean(el.querySelector('.courseBox--name')?.textContent) || shortName;
      courses.push({ id, shortName, name, ...(term ? { term } : {}) });
    }
    return courses.slice(0, MAX_COURSES);
  }

  /** One course's assignments table. */
  function readAssignments(doc, courseId, grades) {
    const table = doc.querySelector('#assignments-student-table') ||
      [...doc.querySelectorAll('table')].find(t => /due/i.test(clean(t.querySelector('thead')?.textContent)));
    if (!table) return [];
    const out = [];
    for (const row of table.querySelectorAll('tbody tr')) {
      const head = row.querySelector('th') || row.cells[0];
      if (!head) continue;
      const anchor = head.querySelector('a[href]');
      const button = head.querySelector('[data-assignment-id]');
      const name = clean((anchor || button || head).textContent);
      const href = anchor ? anchor.getAttribute('href') : '';
      const id = Number((button && button.getAttribute('data-assignment-id')) ||
        /\/assignments\/(\d+)/.exec(href || (button && button.getAttribute('data-post-url')) || '')?.[1]);
      if (!id || !name) continue;

      const statusCell = row.querySelector('.submissionStatus') || [...row.cells].find(c => /submission|submitted|\d\s*\/\s*\d/i.test(clean(c.textContent)));
      const statusText = clean(statusCell && statusCell.textContent);
      const score = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(statusText);
      const status = score ? 'graded' : /no submission/i.test(statusText) ? 'not_submitted' : /submitted/i.test(statusText) ? 'submitted' : 'not_submitted';

      // Due and late due carry their own class; failing that, the row's times
      // run release, due, late due.
      const dues = [...row.querySelectorAll('.submissionTimeChart--dueDate')];
      const times = [...row.querySelectorAll('time[datetime]')];
      const at = el => el ? gsDate(el.getAttribute('datetime') || el.textContent) : null;
      const dueAt = dues.length ? at(dues[0]) : at(times.length >= 2 ? times[1] : times[0]);
      const lateDueAt = dues.length ? at(dues[1]) : at(times[2]);

      out.push({
        id, courseId, name, dueAt, lateDueAt,
        htmlUrl: href ? new URL(href, origin).href : `${origin}/courses/${courseId}/assignments/${id}`,
        status,
        score: grades && score ? Number(score[1]) : null,
        maxScore: score ? Number(score[2]) : null,
      });
    }
    return out;
  }

  async function readGradescope({ grades }) {
    const courses = readCourses(await page('/'));
    const assignments = [];
    let read = 0;
    for (const c of courses) {
      try { assignments.push(...readAssignments(await page(`/courses/${c.id}`), c.id, grades)); read++; }
      catch (err) { if (err.status === 401) throw err; }
      await pause(300);
    }
    // Courses but not one table read: the pages changed, so keep the last good sync.
    if (courses.length && !read) throw new Error('unreadable');
    return { kind: 'gradescope', v: VERSION, host, syncedAt: new Date().toISOString(), courses, assignments };
  }

  start({ host, isHere, read: readGradescope, signedOutMessage: 'Sign in to Gradescope, then sync again.' });
})();
