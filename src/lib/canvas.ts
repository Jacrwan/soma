import { CanvasCourse, CanvasAssignment, CanvasAnnouncement, CanvasModule, CanvasGrade } from '../types';

const DEV_BASE = '/canvas-api';

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function canvasFetch(token: string, baseUrl: string, path: string): Promise<any[]> {
  const base = import.meta.env.DEV ? DEV_BASE : baseUrl;
  const url = base ? `${base}${path}` : path;
  console.log('[canvas] fetching', url);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('[canvas] response', res.status, url);
  if (!res.ok) throw new Error(`Canvas error: ${res.status}`);

  const data = await res.json();
  const linkHeader = res.headers.get('Link');
  const nextMatch = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
  if (nextMatch) {
    const nextUrl = new URL(nextMatch[1]);
    const nextData = await canvasFetch(token, baseUrl, nextUrl.pathname + nextUrl.search);
    return [...data, ...nextData];
  }
  return data;
}

type RawCanvasCourse = Record<string, unknown> & {
  id?: number;
  name?: string;
  course_code?: string;
  enrollment_term_id?: number;
  start_at?: string | null;
  end_at?: string | null;
  access_restricted_by_date?: boolean;
  term?: {
    id?: number;
    name?: string;
    start_at?: string | null;
    end_at?: string | null;
  };
};

function toMillis(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function isWithinWindow(start: unknown, end: unknown, now = Date.now()): boolean {
  const startMs = toMillis(start);
  const endMs = toMillis(end);
  return (startMs === null || startMs <= now) && (endMs === null || endMs >= now);
}

function hasDateWindow(course: RawCanvasCourse): boolean {
  return !!(course.start_at || course.end_at || course.term?.start_at || course.term?.end_at);
}

function isCurrentByDate(course: RawCanvasCourse): boolean {
  if (course.access_restricted_by_date) return false;
  const courseDatesCurrent = course.start_at || course.end_at
    ? isWithinWindow(course.start_at, course.end_at)
    : true;
  const termDatesCurrent = course.term?.start_at || course.term?.end_at
    ? isWithinWindow(course.term?.start_at, course.term?.end_at)
    : true;
  return courseDatesCurrent && termDatesCurrent;
}

function currentSemesterTermNamePattern(): RegExp {
  const month = new Date().getMonth();
  if (month >= 0 && month <= 6) return /\b(s2|semester\s*2|spring)\b/i;
  return /\b(s1|semester\s*1|fall|autumn)\b/i;
}

function looksLikeOldSectionCourse(name: string): boolean {
  return /\[[^\]]*\bPer\s*:/i.test(name)
    || /\(.+\bPeriods?\b.+\)/i.test(name);
}

function chooseCurrentCourses(raw: RawCanvasCourse[]): RawCanvasCourse[] {
  const unrestricted = raw.filter(c => !c.access_restricted_by_date);
  const withoutOldSectionNames = unrestricted.filter(c => !looksLikeOldSectionCourse(c.name ?? ''));
  const candidateCourses = withoutOldSectionNames.length > 0 ? withoutOldSectionNames : unrestricted;
  const dated = candidateCourses.filter(hasDateWindow);
  const currentByDate = dated.filter(isCurrentByDate);
  if (currentByDate.length > 0) return currentByDate;

  const termNamePattern = currentSemesterTermNamePattern();
  const currentByTermName = candidateCourses.filter(c => termNamePattern.test(c.term?.name ?? ''));
  if (currentByTermName.length > 0) return currentByTermName;

  const byTerm = new Map<number, RawCanvasCourse[]>();
  for (const course of candidateCourses) {
    const termId = course.enrollment_term_id ?? course.term?.id;
    if (!termId) continue;
    byTerm.set(termId, [...(byTerm.get(termId) ?? []), course]);
  }
  const largestTermGroup = [...byTerm.values()].sort((a, b) => b.length - a.length)[0];
  if (largestTermGroup?.length) return largestTermGroup;

  return candidateCourses;
}

function toCourse(c: RawCanvasCourse): CanvasCourse {
  return {
    id: c.id as number,
    name: c.name as string,
    courseCode: c.course_code ?? '',
  };
}

export async function getCourses(token: string, baseUrl: string): Promise<CanvasCourse[]> {
  const raw = await canvasFetch(
    token, baseUrl,
    '/api/v1/courses?enrollment_state=active&per_page=100&include[]=term',
  ) as Promise<RawCanvasCourse[]>;

  return chooseCurrentCourses(await raw).map(toCourse);
}

export async function getAssignments(
  token: string,
  baseUrl: string,
  course: CanvasCourse,
): Promise<CanvasAssignment[]> {
  // Fetch upcoming + past assignments in parallel (Canvas filters by bucket server-side)
  const [upcoming, past] = await Promise.all([
    canvasFetch(token, baseUrl,
      `/api/v1/courses/${course.id}/assignments?per_page=100&order_by=due_at&include[]=submission`,
    ),
    canvasFetch(token, baseUrl,
      `/api/v1/courses/${course.id}/assignments?bucket=past&per_page=100&order_by=due_at&include[]=submission`,
    ).catch(() => []),
  ]);

  // Only keep past assignments from the current school year (Aug 1 of current or previous year)
  const now = new Date();
  const schoolYearStart = new Date(
    now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1,
    7, 1 // August 1
  );

  // Merge, deduplicate by id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignmentMap = new Map<number, any>();
  for (const a of upcoming) {
    if (a.due_at) assignmentMap.set(a.id, a);
  }
  for (const a of past) {
    if (a.due_at && new Date(a.due_at) >= schoolYearStart) assignmentMap.set(a.id, a);
  }

  return Array.from(assignmentMap.values()).map(a => ({
    id: a.id,
    name: a.name,
    courseId: course.id,
    courseName: course.name,
    dueAt: a.due_at,
    htmlUrl: a.html_url,
    status: 'not_started' as const,
    description: a.description ? stripHtml(a.description) : undefined,
    submittedAt: a.submission?.submitted_at ?? null,
    score: a.submission?.score ?? null,
    pointsPossible: a.points_possible ?? null,
  }));
}

export async function getActiveAssignments(
  token: string,
  baseUrl: string,
  course: CanvasCourse,
): Promise<CanvasAssignment[]> {
  const raw = await canvasFetch(
    token,
    baseUrl,
    `/api/v1/courses/${course.id}/assignments?bucket=upcoming&per_page=50&order_by=due_at&include[]=submission`,
  );

  return raw
    .filter(a => a.due_at)
    .map(a => ({
      id: a.id,
      name: a.name,
      courseId: course.id,
      courseName: course.name,
      dueAt: a.due_at,
      htmlUrl: a.html_url,
      status: 'not_started' as const,
      description: a.description ? stripHtml(a.description) : undefined,
      submittedAt: a.submission?.submitted_at ?? null,
      score: a.submission?.score ?? null,
      pointsPossible: a.points_possible ?? null,
    }));
}

export async function getAnnouncements(
  token: string,
  baseUrl: string,
  courseId: number,
): Promise<CanvasAnnouncement[]> {
  const raw = await canvasFetch(
    token, baseUrl,
    `/api/v1/announcements?context_codes[]=course_${courseId}&per_page=10`,
  );
  return raw.map(a => ({
    id: a.id,
    title: a.title ?? '',
    message: a.message ? stripHtml(a.message) : '',
    postedAt: a.posted_at ?? '',
    htmlUrl: a.html_url ?? '',
    courseId,
  }));
}

export async function getGrades(
  token: string,
  baseUrl: string,
): Promise<CanvasGrade[]> {
  const raw = await canvasFetch(
    token, baseUrl,
    '/api/v1/courses?enrollment_state=active&include[]=total_scores&include[]=current_grading_period_scores&per_page=50',
  );
  return raw.map(c => {
    const enrollment = c.enrollments?.[0] ?? {};
    // Use current grading period score if available (matches what Canvas shows for semester courses)
    const hasPeriod = enrollment.current_period_computed_current_score != null;
    return {
      courseId: c.id,
      courseName: c.name ?? '',
      courseCode: c.course_code ?? '',
      currentScore: hasPeriod
        ? enrollment.current_period_computed_current_score
        : (enrollment.computed_current_score ?? null),
      currentGrade: hasPeriod
        ? enrollment.current_period_computed_current_grade
        : (enrollment.computed_current_grade ?? null),
      finalScore: hasPeriod
        ? enrollment.current_period_computed_final_score
        : (enrollment.computed_final_score ?? null),
      finalGrade: hasPeriod
        ? enrollment.current_period_computed_final_grade
        : (enrollment.computed_final_grade ?? null),
    } as CanvasGrade;
  });
}

export interface AssignmentAttachment {
  id: number;
  filename: string;
  contentType: string;
  url: string;
  size: number;
}

export interface AssignmentDetails {
  id: number;
  name: string;
  description: string | null;
  dueAt: string | null;
  htmlUrl: string;
  attachments: AssignmentAttachment[];
}

export async function getAssignmentDetails(
  token: string,
  baseUrl: string,
  courseId: number,
  assignmentId: number,
): Promise<AssignmentDetails> {
  const base = import.meta.env.DEV ? DEV_BASE : baseUrl;
  const url = `${base}/api/v1/courses/${courseId}/assignments/${assignmentId}?include[]=attachments`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Canvas error: ${res.status}`);
  const d = await res.json();
  return {
    id: d.id,
    name: d.name ?? '',
    description: d.description ?? null,
    dueAt: d.due_at ?? null,
    htmlUrl: d.html_url ?? '',
    attachments: (d.attachments ?? []).map((a: Record<string, unknown>) => ({
      id: a.id,
      filename: a.filename ?? a.display_name ?? 'file',
      contentType: a['content-type'] ?? a.content_type ?? '',
      url: a.url ?? '',
      size: a.size ?? 0,
    })),
  };
}

export async function getModules(
  token: string,
  baseUrl: string,
  courseId: number,
): Promise<CanvasModule[]> {
  const raw = await canvasFetch(
    token, baseUrl,
    `/api/v1/courses/${courseId}/modules?per_page=50`,
  );
  return raw.map(m => ({
    id: m.id,
    name: m.name ?? '',
    position: m.position ?? 0,
    courseId,
  }));
}
