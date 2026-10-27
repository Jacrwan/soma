// What's due soon and not handed in, from the stored snapshots. Used by the
// background worker (reminders and the toolbar badge) and by the popup (its
// Due soon list), so both always agree.
//
// One piece of work can show up twice: a Canvas entry that links to
// Gradescope or WebAssign, and the platform's own. They're one item, and
// whichever says it's handed in wins, so a Canvas entry that never learns
// about a Gradescope submission doesn't nag.

(() => {
  if (self.somaDue) return;

  const HOUR = 3600 * 1000;
  // Canvas work handed in some way Canvas never sees as submitted.
  const OFFLINE = new Set(['none', 'on_paper', 'not_graded', 'wiki_page']);

  const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  /** "Homework 4" and "Homework 4: Kinematics" are the same work. */
  const sameWork = (a, b) => {
    const x = words(a), y = words(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    return short.length >= 5 && (long.startsWith(`${short} `) || long.endsWith(` ${short}`));
  };
  /** "CS-170-1: Intro to…" → "CS-170-1"; "PHYS 151, Fall 2026" → "PHYS 151". */
  const shortCourse = name => String(name || '').split(/[:,]| - /)[0].trim().slice(0, 30);

  /** Every open piece of work with a due date, from all sites. */
  function openWork(snapshots) {
    const out = [];
    for (const s of Object.values(snapshots || {})) {
      const courses = new Map((s.courses || []).map(c => [c.id, c]));
      for (const a of s.assignments || []) {
        if (!a.dueAt) continue;
        const course = courses.get(a.courseId) || {};
        let done, note = '';
        if (s.kind === 'gradescope') done = a.status !== 'not_submitted';
        else if (s.kind === 'webassign') { done = a.status === 'complete'; note = a.parts ? `${a.answered} of ${a.parts} parts answered` : ''; }
        else {
          const types = a.submissionTypes || [];
          if (types.length && types.every(t => OFFLINE.has(t))) continue;
          done = a.excused || !!a.submittedAt || ['submitted', 'graded', 'pending_review'].includes(a.workflowState);
        }
        out.push({
          key: `${s.host}:${a.id}`, site: s.kind || 'canvas', name: a.name,
          course: shortCourse(course.shortName && s.kind !== 'gradescope' ? course.shortName : course.name),
          dueAt: a.dueAt, url: a.htmlUrl, done, note,
        });
      }
    }
    return out;
  }

  /**
   * Work due within `hours` that isn't done, soonest first. A twin (same
   * name, due within a day of each other) that's done clears both; otherwise
   * the platform's entry is kept, since that's where it's handed in.
   */
  function dueSoon(snapshots, now = Date.now(), hours = 48) {
    const all = openWork(snapshots);
    const soon = all.filter(w => { const t = Date.parse(w.dueAt); return t > now && t <= now + hours * HOUR; });
    const twins = w => all.filter(o => o !== w && sameWork(o.name, w.name) && Math.abs(Date.parse(o.dueAt) - Date.parse(w.dueAt)) <= 24 * HOUR);
    const kept = [];
    for (const w of soon) {
      if (w.done) continue;
      const others = twins(w);
      if (others.some(o => o.done)) continue;
      // Keep one of a set of twins: the platform's, else the first.
      if (w.site === 'canvas' && others.some(o => o.site !== 'canvas' && !o.done && soon.includes(o))) continue;
      if (kept.some(k => sameWork(k.name, w.name) && Math.abs(Date.parse(k.dueAt) - Date.parse(w.dueAt)) <= 24 * HOUR)) continue;
      kept.push(w);
    }
    return kept.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }

  /** "today 11:59 PM", "tomorrow 1:00 PM", "Wed 5:30 PM". */
  function when(iso, now = new Date()) {
    const d = new Date(iso);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((day - today) / 86400000);
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`;
  }

  self.somaDue = { dueSoon, when, HOUR };
})();
