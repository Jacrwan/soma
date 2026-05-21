import { CanvasCourse, CanvasAssignment, CanvasAnnouncement, CanvasModule } from '../types';

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
      submission: a.submission
        ? {
            workflow_state: a.submission.workflow_state ?? null,
            submitted_at: a.submission.submitted_at ?? null,
          }
        : null,
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
