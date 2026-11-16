// What the game reads from (and writes back to) Soma, beyond Canvas:
//  - whether the student has Soma's plan (trial or paid), which unlocks the
//    Watchtower, the real plan as daily quests, the Oracle and AI practice;
//  - the tasks Soma's AI planner scheduled (table `todos`);
//  - syllabus readings Soma pulled from course documents (`course_items`),
//    which Canvas usually never shows.
// Inside Soma (somastudy.app/game) the game shares the student's sign-in.
// Anywhere else (or signed out) everything here reports "not connected".

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';
const PLUS = new Set(['trialing', 'trial_extended', 'active']);
export const UPGRADE_URL = '/pricing';

let mock = null; // test data: { plus, todos, readings, subjects }
export function useMock(data) { mock = data; }

export function session() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!/^sb-.+-auth-token$/.test(key)) continue;
      const data = JSON.parse(localStorage.getItem(key));
      const s = data?.currentSession || data;
      if (s?.access_token) return { token: s.access_token, userId: s.user?.id, expiresAt: (s.expires_at || 0) * 1000 };
    }
  } catch { /* no session */ }
  return null;
}

const live = () => {
  const s = session();
  return s && SUPABASE_URL && SUPABASE_KEY && (!s.expiresAt || s.expiresAt > Date.now() + 30_000) ? s : null;
};

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const s = live();
  if (!s) throw new Error('not connected');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${s.token}`, 'content-type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`soma ${res.status}`);
  return res.status === 204 ? null : res.json();
}

const day = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** 'plus' (trial or paid), 'free', or 'offline' when the game isn't inside Soma. */
export async function planStatus() {
  if (mock) return mock.plus ? 'plus' : 'free';
  const s = live();
  if (!s) return 'offline';
  try {
    const res = await fetch('/api/stripe', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${s.token}` }, body: JSON.stringify({ action: 'get-subscription' }) });
    const data = await res.json();
    return PLUS.has(data?.status) ? 'plus' : 'free';
  } catch {
    return 'offline';
  }
}

/**
 * The plan for the next week and the syllabus readings still to do.
 * Returns { todos: [{ id, text, date, minutes, done, course }], readings: [{ id, label, title, due, course, courseId }] }.
 */
export async function loadPlan(now = Date.now()) {
  if (mock) return { todos: mock.todos || [], readings: mock.readings || [] };
  const from = day(now - 86400000), to = day(now + 7 * 86400000);
  const [todos, items, subjects] = await Promise.all([
    rest(`todos?select=id,text,status,date,estimated_minutes,subject_id&date=gte.${from}&date=lte.${to}&order=date`),
    rest('course_items?select=id,subject_id,label,title,due_date,done_at,exam_id&done_at=is.null&exam_id=is.null&due_date=not.is.null&order=due_date&limit=200'),
    rest('subjects?select=id,name,canvas_course_id'),
  ]);
  const names = new Map(subjects.map((s) => [s.id, { name: s.name, canvas: s.canvas_course_id }]));
  return {
    todos: todos.map((t) => ({ id: t.id, text: t.text, date: t.date, minutes: t.estimated_minutes || null, done: t.status === 'done', course: names.get(t.subject_id)?.name || '' })),
    readings: items.map((i) => ({ id: i.id, label: i.label, title: i.title || '', due: i.due_date, course: names.get(i.subject_id)?.name || 'Course', courseId: i.subject_id, canvasCourse: names.get(i.subject_id)?.canvas ?? null })),
  };
}

/** Checks a planned task off (or back on) in Soma. */
export async function setTodoDone(id, done) {
  if (mock) { const t = mock.todos.find((x) => x.id === id); if (t) t.done = done; return; }
  await rest(`todos?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: done ? 'done' : 'nothing' }, prefer: 'return=minimal' });
}

/** Marks a syllabus reading as read in Soma. */
export async function markRead(id) {
  if (mock) { mock.readings = mock.readings.filter((r) => r.id !== id); return; }
  await rest(`course_items?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { done_at: new Date().toISOString() }, prefer: 'return=minimal' });
  window.dispatchEvent(new Event('soma_course_items_changed'));
}

const ORACLE = `You plan a student's next 7 days of study. You are given today's date, what is due (from Canvas and their syllabus), and what is already planned.
Return only JSON, no other text: {"tasks":[{"text":"short task","date":"YYYY-MM-DD","minutes":30,"course":"course name"}],"note":"one or two sentences on the plan"}
Rules:
- 4 to 12 tasks over the next 7 days, at most 3 per day, 15 to 90 minutes each.
- Put work before its due date, with exams studied in several short sessions on different days, not one long cram.
- Don't repeat tasks that are already planned. Use the exact course names given.
- Task text is short and concrete, like "Read 4.1-4.3 (Momentum)" or "Practice problems for Midterm 2".`;

/** Asks Soma's planner for a week of study tasks. Returns { tasks, note }. */
export async function askOracle({ due, planned, ask }) {
  if (mock) return mock.oracle || { tasks: [], note: '' };
  const s = live();
  if (!s) throw new Error('Open the game from Soma, signed in, to use the Oracle.');
  const today = day(Date.now());
  const content = `Today is ${today}.\n\nDue soon:\n${due.map((d) => `- ${d}`).join('\n') || '- nothing'}\n\nAlready planned:\n${planned.map((p) => `- ${p}`).join('\n') || '- nothing'}\n\n${ask ? `The student asks: ${ask}\n\n` : ''}Plan the next 7 days.`;
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${s.token}` },
    body: JSON.stringify({ messages: [{ role: 'user', content }], systemPrompt: ORACLE, purpose: 'oracle' }),
  });
  const data = await res.json().catch(() => null);
  if (res.status === 402) throw new Error('The Oracle uses Soma AI, which needs Soma’s plan (or this month’s AI budget is used up).');
  if (!res.ok) throw new Error('The Oracle is quiet right now. Try again in a minute.');
  const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    const out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const tasks = (out.tasks || []).filter((t) => t && typeof t.text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date)).slice(0, 12);
    return { tasks, note: String(out.note || '') };
  } catch {
    throw new Error('The Oracle mumbled something unreadable. Try again.');
  }
}

/** Adds approved tasks to the student's Soma plan. */
export async function addTasks(tasks, courses) {
  if (mock) { mock.todos.push(...tasks.map((t, i) => ({ id: `new${Date.now()}${i}`, text: t.text, date: t.date, minutes: t.minutes, done: false, course: t.course }))); return; }
  const s = live();
  const subjects = await rest('subjects?select=id,name');
  const byName = new Map(subjects.map((x) => [x.name.toLowerCase(), x.id]));
  const rows = tasks.map((t) => ({
    id: crypto.randomUUID(), user_id: s.userId, text: t.text, status: 'nothing', date: t.date,
    estimated_minutes: Number.isFinite(t.minutes) ? Math.round(t.minutes) : null,
    subject_id: byName.get(String(t.course || '').toLowerCase()) ?? null, kind: 'other',
  }));
  await rest('todos', { method: 'POST', body: rows, prefer: 'return=minimal' });
  void courses;
}
