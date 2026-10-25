import type { CanvasAssignment } from '../types';

/**
 * Deep sync: what the Soma for Canvas extension (extension/) reads from the
 * student's own Canvas session, which the calendar feed doesn't carry —
 * assignment descriptions, points and group weights, whether it was
 * submitted, current grades, and announcements.
 *
 * The extension posts a snapshot to the open Soma tab; this module checks it
 * and keeps it. Everything in a snapshot came from a web page, so it is
 * untrusted: every field is type-checked and cut to length here, and the AI
 * context frames it as data, never instructions.
 *
 * Pure on purpose: storage.ts merges these into the feed's assignments, and
 * canvasExtension.ts (which imports storage) does the bridge and the saving.
 */

export const SNAPSHOT_VERSION = 1;

export interface DeepCourse {
  id: number;
  name: string;
  courseCode: string;
  term?: string;
  /** Current score in percent, when the student lets grades sync. */
  currentScore?: number | null;
  currentGrade?: string | null;
  /** Whether the course weights its assignment groups. */
  weighted: boolean;
}

export interface DeepGroup { id: number; courseId: number; name: string; weight: number }

export interface DeepAssignment {
  id: number;
  courseId: number;
  name: string;
  dueAt: string | null;
  htmlUrl: string;
  /** Plain text, already stripped of HTML by the extension and cut here. */
  description: string;
  pointsPossible: number | null;
  groupId: number | null;
  submittedAt: string | null;
  /** Canvas's submission state: unsubmitted, submitted, graded, pending_review. */
  workflowState: string;
  score: number | null;
  grade: string | null;
  missing: boolean;
  late: boolean;
  excused: boolean;
}

export interface DeepAnnouncement { id: number; courseId: number; title: string; message: string; postedAt: string; htmlUrl: string }

export interface CanvasSnapshot {
  kind: 'canvas';
  v: number;
  host: string;
  syncedAt: string;
  courses: DeepCourse[];
  groups: DeepGroup[];
  assignments: DeepAssignment[];
  announcements: DeepAnnouncement[];
}

// Caps: a snapshot is stored as one row and read into every AI prompt.
const MAX = { courses: 30, groups: 300, assignments: 3000, announcements: 60, description: 2000, message: 1500, name: 300 };
const LOCAL_KEY = 'soma_canvas_deep_sync';

const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null;
const str = (v: unknown, max: number): string => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const iso = (v: unknown): string | null => typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;
/** Links go back to the Canvas site the snapshot came from, never elsewhere. */
const link = (v: unknown, host: string): string => {
  try { const u = new URL(String(v)); return u.protocol === 'https:' && u.host === host ? u.href : ''; } catch { return ''; }
};
const list = (v: unknown, max: number): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)).slice(0, max) : [];

/**
 * Gradescope, read from the student's own course pages (extension/gradescope.js).
 * Many courses take work there while Canvas shows nothing, or shows a linked
 * entry that never learns it was submitted.
 */
export interface GradescopeCourse { id: number; shortName: string; name: string; term?: string }
export interface GradescopeAssignment {
  id: number;
  courseId: number;
  name: string;
  dueAt: string | null;
  lateDueAt: string | null;
  htmlUrl: string;
  /** What the course page says: no submission, submitted, or a score posted. */
  status: 'not_submitted' | 'submitted' | 'graded';
  score: number | null;
  maxScore: number | null;
}
export interface GradescopeSnapshot {
  kind: 'gradescope';
  v: number;
  host: string;
  syncedAt: string;
  courses: GradescopeCourse[];
  assignments: GradescopeAssignment[];
}

export type SourceSnapshot = CanvasSnapshot | GradescopeSnapshot;
export const GRADESCOPE_HOST = 'www.gradescope.com';

/** A snapshot as the extension sent it, checked; null when it isn't one. */
export function normalizeSnapshot(raw: unknown): SourceSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const host = typeof r.host === 'string' && /^[a-z0-9.-]+(:\d+)?$/i.test(r.host) ? r.host.toLowerCase() : '';
  const syncedAt = iso(r.syncedAt);
  if (r.v !== SNAPSHOT_VERSION || !host || !syncedAt) return null;
  // Snapshots from before Gradescope have no kind: they are Canvas.
  if (r.kind === 'gradescope') return host === GRADESCOPE_HOST ? normalizeGradescope(r, syncedAt) : null;
  if (r.kind !== undefined && r.kind !== 'canvas') return null;

  const courses: DeepCourse[] = list(r.courses, MAX.courses).flatMap(c => {
    const id = num(c.id), name = str(c.name, MAX.name);
    if (id === null || !name) return [];
    const score = num(c.currentScore);
    return [{
      id, name, courseCode: str(c.courseCode, MAX.name) || name,
      ...(str(c.term, 100) ? { term: str(c.term, 100) } : {}),
      ...(score !== null ? { currentScore: Math.round(score * 10) / 10 } : {}),
      ...(str(c.currentGrade, 10) ? { currentGrade: str(c.currentGrade, 10) } : {}),
      weighted: c.weighted === true,
    }];
  });
  const courseIds = new Set(courses.map(c => c.id));
  const groups: DeepGroup[] = list(r.groups, MAX.groups).flatMap(g => {
    const id = num(g.id), courseId = num(g.courseId), weight = num(g.weight);
    return id !== null && courseId !== null && courseIds.has(courseId)
      ? [{ id, courseId, name: str(g.name, 120), weight: weight ?? 0 }] : [];
  });
  const assignments: DeepAssignment[] = list(r.assignments, MAX.assignments).flatMap(a => {
    const id = num(a.id), courseId = num(a.courseId), name = str(a.name, MAX.name);
    if (id === null || courseId === null || !courseIds.has(courseId) || !name) return [];
    return [{
      id, courseId, name,
      dueAt: iso(a.dueAt),
      htmlUrl: link(a.htmlUrl, host),
      description: str(a.description, MAX.description),
      pointsPossible: num(a.pointsPossible),
      groupId: num(a.groupId),
      submittedAt: iso(a.submittedAt),
      workflowState: str(a.workflowState, 30) || 'unsubmitted',
      score: num(a.score),
      grade: str(a.grade, 20) || null,
      missing: a.missing === true,
      late: a.late === true,
      excused: a.excused === true,
    }];
  });
  const announcements: DeepAnnouncement[] = list(r.announcements, MAX.announcements).flatMap(n => {
    const id = num(n.id), courseId = num(n.courseId), postedAt = iso(n.postedAt);
    if (id === null || courseId === null || !courseIds.has(courseId) || !postedAt) return [];
    return [{ id, courseId, title: str(n.title, MAX.name), message: str(n.message, MAX.message), postedAt, htmlUrl: link(n.htmlUrl, host) }];
  });
  return { kind: 'canvas', v: SNAPSHOT_VERSION, host, syncedAt, courses, groups, assignments, announcements };
}

function normalizeGradescope(r: Record<string, unknown>, syncedAt: string): GradescopeSnapshot {
  const host = GRADESCOPE_HOST;
  const courses: GradescopeCourse[] = list(r.courses, MAX.courses).flatMap(c => {
    const id = num(c.id), shortName = str(c.shortName, MAX.name), name = str(c.name, MAX.name);
    if (id === null || !(shortName || name)) return [];
    return [{ id, shortName: shortName || name, name: name || shortName, ...(str(c.term, 100) ? { term: str(c.term, 100) } : {}) }];
  });
  const courseIds = new Set(courses.map(c => c.id));
  const STATUSES = ['not_submitted', 'submitted', 'graded'];
  const assignments: GradescopeAssignment[] = list(r.assignments, MAX.assignments).flatMap(a => {
    const id = num(a.id), courseId = num(a.courseId), name = str(a.name, MAX.name);
    if (id === null || courseId === null || !courseIds.has(courseId) || !name) return [];
    return [{
      id, courseId, name,
      dueAt: iso(a.dueAt), lateDueAt: iso(a.lateDueAt),
      htmlUrl: link(a.htmlUrl, host),
      status: (STATUSES.includes(a.status as string) ? a.status : 'not_submitted') as GradescopeAssignment['status'],
      score: num(a.score), maxScore: num(a.maxScore),
    }];
  });
  return { kind: 'gradescope', v: SNAPSHOT_VERSION, host, syncedAt, courses, assignments };
}

// ── This browser's copy, by Canvas site ─────────────────────────────────────

export function getLocalSnapshots(): Record<string, SourceSnapshot> {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.values(raw).map(normalizeSnapshot).filter((s): s is SourceSnapshot => !!s).map(s => [s.host, s]));
  } catch { return {}; }
}

export const canvasSnapshots = (all = getLocalSnapshots()) =>
  Object.values(all).filter((s): s is CanvasSnapshot => s.kind === 'canvas');

export function setLocalSnapshot(snapshot: SourceSnapshot) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...getLocalSnapshots(), [snapshot.host]: snapshot })); } catch { /* full or blocked: the server copy remains */ }
}

export function clearLocalSnapshots() {
  try { localStorage.removeItem(LOCAL_KEY); } catch { /* nothing to clear */ }
}

// ── Merging into the feed's assignments ─────────────────────────────────────

/** Handed in, graded or excused: the work is done whatever the plan says. */
export const isTurnedIn = (a: DeepAssignment) =>
  a.excused || !!a.submittedAt || a.workflowState === 'submitted' || a.workflowState === 'graded' || a.workflowState === 'pending_review';

function enrich(base: CanvasAssignment | undefined, a: DeepAssignment, s: CanvasSnapshot): CanvasAssignment {
  const course = s.courses.find(c => c.id === a.courseId);
  const group = s.groups.find(g => g.id === a.groupId);
  return {
    id: a.id,
    name: base?.name ?? a.name,
    courseId: a.courseId,
    // The feed's course name is the one Subjects were made from; keep it.
    courseName: base?.courseName || course?.name || '',
    dueAt: a.dueAt ?? base?.dueAt ?? '',
    htmlUrl: a.htmlUrl || base?.htmlUrl || '',
    status: isTurnedIn(a) ? 'done' : base?.status ?? 'not_started',
    description: a.description || base?.description,
    submittedAt: a.submittedAt,
    score: a.score,
    pointsPossible: a.pointsPossible,
    ...(group ? { groupName: group.name, ...(course?.weighted ? { groupWeight: group.weight } : {}) } : {}),
    missing: a.missing,
    late: a.late,
    deepSynced: true,
  };
}

/**
 * The feed's assignments with what deep sync knows about each, plus dated
 * assignments the feed left out (Canvas omits some, such as ones without a
 * calendar entry). Due dates from the last two weeks on, so a whole
 * semester's history doesn't land on Deadlines.
 */
export function mergeDeepSync(feed: CanvasAssignment[], snapshots = getLocalSnapshots(), now = new Date()): CanvasAssignment[] {
  const all = Object.values(snapshots);
  if (!all.length) return feed;
  const deep = new Map<number, { a: DeepAssignment; s: CanvasSnapshot }>();
  for (const s of canvasSnapshots(snapshots)) for (const a of s.assignments) deep.set(a.id, { a, s });
  const merged = feed.map(f => { const d = deep.get(f.id); return d ? enrich(f, d.a, d.s) : f; });
  const known = new Set(feed.map(f => f.id));
  const since = now.getTime() - 14 * 86_400_000;
  for (const { a, s } of deep.values()) {
    if (known.has(a.id) || !a.dueAt || Date.parse(a.dueAt) < since) continue;
    merged.push(enrich(undefined, a, s));
  }
  for (const g of all) if (g.kind === 'gradescope') mergeGradescope(merged, g, since);
  return merged;
}

// ── Gradescope ──────────────────────────────────────────────────────────────

// Departments spelled differently on the two sites.
const DEPT_ALIASES: Record<string, string> = { compsci: 'cs', computerscience: 'cs', comsci: 'cs', phys: 'physics', mathematics: 'math', eleng: 'ee', chem: 'chemistry' };

/**
 * The department-and-number pairs a course name could mean: "PHYSICS 7A - LEC
 * 001" gives physics 7a (and lec 001); "Computer Science 61A" gives science
 * 61a and computerscience 61a.
 */
function courseParts(name: string): { dept: string; num: string }[] {
  const out: { dept: string; num: string }[] = [];
  for (const m of name.toLowerCase().matchAll(/(?:([a-z]+)\s+)?([a-z]+)\s*(\d+[a-z]*)\b/g)) {
    for (const raw of [m[2], m[1] ? m[1] + m[2] : '']) {
      if (raw) out.push({ dept: DEPT_ALIASES[raw] ?? raw, num: m[3] });
    }
  }
  return out;
}

/**
 * "PHYSICS 7A - LEC 001 - Fall 2026" and "Physics 7A" are one course, and so
 * are "BIO 101" and "Biology 101": the same number, and one department name
 * is the other or starts it.
 */
export function sameCourse(a: string, b: string): boolean {
  const ys = courseParts(b);
  return courseParts(a).some(x => ys.some(y => {
    if (x.num !== y.num) return false;
    const [short, long] = x.dept.length <= y.dept.length ? [x.dept, y.dept] : [y.dept, x.dept];
    return short === long || (short.length >= 2 && long.startsWith(short));
  }));
}

const workName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** "Homework 4" in Canvas is "Homework 4" or "Homework 4: Kinematics" on Gradescope. */
const sameWork = (a: string, b: string) => {
  const x = workName(a), y = workName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 5 && (long.startsWith(`${short} `) || long.endsWith(` ${short}`));
};

/**
 * Gradescope work into the list. A course that also takes it in Canvas (a
 * linked "external tool" assignment) keeps the Canvas entry, which learns it
 * was handed in; anything else is added as its own deadline, under the
 * Canvas course of the same department and number when there is one.
 */
function mergeGradescope(merged: CanvasAssignment[], g: GradescopeSnapshot, since: number) {
  const canvasCourses = [...new Map(merged.filter(a => a.courseName && a.platform !== 'gradescope').map(a => [a.courseId, { id: a.courseId, name: a.courseName }])).values()];
  for (const a of g.assignments) {
    if (!a.dueAt) continue;
    const handedIn = a.status !== 'not_submitted';
    const due = Date.parse(a.lateDueAt ?? a.dueAt);
    // Old work only matters if it was never handed in and is still open.
    if (Date.parse(a.dueAt) < since && (handedIn || due < since)) continue;
    const course = g.courses.find(c => c.id === a.courseId);
    const home = course && canvasCourses.find(c => sameCourse(c.name, course.shortName) || sameCourse(c.name, course.name));
    const twin = home && merged.find(m => m.courseId === home.id && m.platform !== 'gradescope' && sameWork(m.name, a.name));
    if (twin) {
      twin.platform = 'gradescope';
      twin.htmlUrl = a.htmlUrl || twin.htmlUrl;
      twin.lateDueAt = a.lateDueAt ?? undefined;
      if (handedIn) twin.status = 'done';
      continue;
    }
    merged.push({
      // Negative, so it can never collide with a Canvas assignment id.
      id: -a.id,
      name: a.name,
      courseId: home?.id ?? 0,
      courseName: home?.name ?? course?.shortName ?? 'Gradescope',
      dueAt: a.dueAt,
      htmlUrl: a.htmlUrl,
      status: handedIn ? 'done' : 'not_started',
      pointsPossible: a.maxScore,
      score: a.score,
      platform: 'gradescope',
      ...(a.lateDueAt ? { lateDueAt: a.lateDueAt } : {}),
      deepSynced: true,
    });
  }
}
