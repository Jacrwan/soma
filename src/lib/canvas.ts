import { supabase } from './supabase';
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

async function supabaseToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function canvasFetch(token: string, baseUrl: string, path: string): Promise<any[]> {
  let res: Response;
  if (import.meta.env.DEV) {
    res = await fetch(`${DEV_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } else {
    const sbToken = await supabaseToken();
    res = await fetch('/api/canvas', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sbToken}`,
      },
      body: JSON.stringify({ canvasUrl: baseUrl, token, endpoint: path }),
    });
  }
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
  access_restricted_by_date?: boolean;
};

function looksLikeOldSectionCourse(name: string): boolean {
  return /\[[^\]]*\bPer\s*:/i.test(name)
    || /\(.+\bPeriods?\b.+\)/i.test(name);
}

function toCourse(c: RawCanvasCourse): CanvasCourse {
  return {
    id: c.id as number,
    name: c.name as string,
    courseCode: c.course_code ?? '',
  };
}

export async function getCourses(token: string, baseUrl: string): Promise<CanvasCourse[]> {
  const result = await canvasFetch(
    token, baseUrl,
    '/api/v1/courses?enrollment_state=active&per_page=100',
  );

  if (!Array.isArray(result)) {
    console.error('[canvas] getCourses: unexpected non-array response', result);
    return [];
  }
  const raw = result as RawCanvasCourse[];
  console.log('[canvas] getCourses: raw response —', raw.length, 'courses');
  console.log('[canvas] getCourses: raw list —', raw.map(c => ({ id: c.id, name: c.name, access_restricted_by_date: c.access_restricted_by_date })));

  const restricted = raw.filter(c => c.access_restricted_by_date);
  if (restricted.length > 0) {
    console.log('[canvas] getCourses: dropping (access_restricted_by_date) —', restricted.map(c => ({ id: c.id, name: c.name })));
  }
  const sectionStyle = raw.filter(c => !c.access_restricted_by_date && looksLikeOldSectionCourse(c.name ?? ''));
  if (sectionStyle.length > 0) {
    console.log('[canvas] getCourses: dropping (old section name pattern) —', sectionStyle.map(c => ({ id: c.id, name: c.name })));
  }

  // Trust enrollment_state=active from Canvas as the source of truth.
  // Only exclude courses the student genuinely cannot access, and clean up
  // legacy K-12 section-style course names.
  const courses = raw
    .filter(c => !c.access_restricted_by_date)
    .filter(c => !looksLikeOldSectionCourse(c.name ?? ''))
    .map(toCourse);
  console.log('[canvas] getCourses: returning', courses.length, 'courses —', courses.map(c => c.name));
  return courses;
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
  const path = `/api/v1/courses/${courseId}/assignments/${assignmentId}?include[]=attachments`;
  let res: Response;
  if (import.meta.env.DEV) {
    res = await fetch(`${DEV_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } else {
    const sbToken = await supabaseToken();
    res = await fetch('/api/canvas', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sbToken}`,
      },
      body: JSON.stringify({ canvasUrl: baseUrl, token, endpoint: path }),
    });
  }
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

// ── Canvas iCal feed ─────────────────────────────────────────────────────────

export async function getIcalAssignments(icalUrl: string): Promise<CanvasAssignment[]> {
  const sbToken = await supabaseToken();
  const res = await fetch('/api/canvas-ical', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sbToken}`,
    },
    body: JSON.stringify({ icalUrl }),
  });

  const raw = await res.text();
  let data: { assignments?: CanvasAssignment[]; error?: string } = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { error: raw || `HTTP ${res.status}` };
  }

  if (!res.ok) {
    const message = data.error || `Calendar feed request failed (${res.status})`;
    throw new Error(message);
  }

  return data.assignments ?? [];
}
