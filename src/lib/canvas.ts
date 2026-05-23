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

export async function getCourses(token: string, baseUrl: string): Promise<CanvasCourse[]> {
  const raw = await canvasFetch(
    token, baseUrl,
    '/api/v1/courses?enrollment_state=active&per_page=50',
  );
  console.log('[canvas] raw courses response', raw);
  return raw.map(c => ({
    id: c.id,
    name: c.name,
    courseCode: c.course_code ?? '',
  }));
}

export async function getAssignments(
  token: string,
  baseUrl: string,
  course: CanvasCourse,
): Promise<CanvasAssignment[]> {
  const raw = await canvasFetch(
    token, baseUrl,
    `/api/v1/courses/${course.id}/assignments?per_page=50&order_by=due_at&include[]=submission`,
  );

  const now = new Date();
  const past7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const future30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return raw
    .filter(a => {
      if (!a.due_at) return false;
      const due = new Date(a.due_at);
      return due >= past7 && due <= future30;
    })
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
