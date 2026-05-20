import { CanvasCourse, CanvasAssignment } from '../types';

const DEV_BASE = '/canvas-api';

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
    }));
}
