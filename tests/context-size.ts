import { expect, type Page } from '@playwright/test';
import { triaged } from './triage';

// A realistic student week for measuring what Soma is sent: four courses,
// four classes a day, three study blocks a day with logged sessions, thirty
// open tasks, and two reading lists. Shared by the size test and its tuning.
const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayAt = (n: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const iso = (n: number, t: string) => { const d = dayAt(n); const [h, m] = t.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };

export async function realisticWeek(page: Page) {
  const u = account.id;
  const subjects = [['phys', 'Physics 5A'], ['math', 'MATH 53-LEC-002'], ['cs', 'CS 61A'], ['lit', 'Comparative Literature R1A']].map(([id, name]) => ({ id, user_id: u, name, color: '#42a5f5', archived: false }));
  const todos: Record<string, unknown>[] = [], sessions: Record<string, unknown>[] = [], timer: Record<string, unknown>[] = [], items: Record<string, unknown>[] = [];
  const work = [['phys', 'Physics reading: 7.1–7.5 Angular momentum'], ['math', 'Math 53 Homework - Chapters 14.3–14.5'], ['cs', 'CS 61A Midterm 2 Practice — Instance 1']];
  for (let n = -7; n < 7; n++) work.forEach(([s, title], i) => {
    const id = `t${n}-${i}`, start = ['13:00', '15:30', '19:00'][i], end = ['14:30', '17:30', '20:30'][i];
    todos.push({ id, user_id: u, text: `${title} (${n + 8})`, subject_id: s, status: n < -1 ? 'done' : 'nothing', date: key(dayAt(n)) });
    sessions.push({ id: `s${id}`, user_id: u, todo_id: id, date: key(dayAt(n)), start_time: iso(n, start), end_time: iso(n, end) });
    if (n < 0) timer.push({ id: `h${id}`, user_id: u, subject_id: s, task_text: `${title} (${n + 8})`, duration_seconds: 4800, date: key(dayAt(n)), start_time: iso(n, start), end_time: iso(n, end) });
  });
  for (let i = 0; i < 30; i++) todos.push({ id: `open${i}`, user_id: u, text: `CS 61A Homework ${i + 4}: Recursion and trees`, subject_id: 'cs', status: 'nothing', date: '', due_date: key(dayAt(i)) });
  for (const [s, prefix] of [['phys', '7.'], ['math', '14.']]) for (let i = 1; i <= 30; i++) items.push({ id: `${s}${i}`, user_id: u, subject_id: s, label: `${prefix}${i}`, title: `Section ${prefix}${i} on a topic`, position: i, due_date: key(dayAt(i - 10)), ...(i < 8 ? { done_at: iso(-10, '12:00') } : {}) });
  const events = [];
  for (let n = -7; n < 14; n++) for (const [id, summary, from, to] of [['lec', 'Physics 5A Lecture', '09:30', '10:59'], ['cs', 'CS 61A Lecture', '12:00', '12:59'], ['math', 'MATH 53 Discussion', '14:00', '14:59'], ['gym', 'gym', '18:00', '19:00']])
    events.push({ id: `${id}${n}`, summary, start: { dateTime: iso(n, from) }, end: { dateTime: iso(n, to) }, source: { connectionId: 'c', calendarId: 'k' } });
  const db: Record<string, Record<string, unknown>[]> = { subjects, todos, todo_sessions: sessions, timer_sessions: timer, course_items: items };
  const bodies: Record<string, unknown>[] = [];
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    const rows = req.method() === 'GET' ? db[table] ?? [] : [];
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/memory', r => r.fulfill({ json: { revision: 0, enabled: true, entries: [] } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events, incomplete: false } }));
  await page.route('**/api/chat', route => { if (triaged(route)) return; bodies.push(route.request().postDataJSON()); return route.fulfill({ json: { content: [{ text: '{"reply":"ok"}' }] } }); });
  await page.goto('/dashboard');
  await page.getByLabel('What do you need to work on?').fill('what do i have tomorrow?');
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect(page.getByRole('log')).toContainText('ok');
  const live = String(bodies[0].context);
  return { live, context: JSON.parse(live.slice(live.indexOf('{'), live.lastIndexOf('}') + 1)) as Record<string, unknown> };
}
