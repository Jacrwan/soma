// Practice questions written by Soma's AI. Inside Soma (somastudy.app/game)
// the game shares the student's sign-in, so it can read their course notes
// from Supabase and ask Soma's /api/chat for a round of questions. The
// 'practice' purpose runs on Soma's small model, with no memory and nothing
// learned, and is billed to the student's normal AI budget.

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';
const NOTES_CHARS = 14000; // course material sent with each request
const STOP = new Set('the and for with from that this into your are was were will exam midterm final test quiz unit part chapter week'.split(' '));

/** The signed-in Soma session, or null. */
function session() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!/^sb-.+-auth-token$/.test(key)) continue;
      const data = JSON.parse(localStorage.getItem(key));
      const s = data?.currentSession || data;
      if (s?.access_token) return { token: s.access_token, expiresAt: (s.expires_at || 0) * 1000 };
    }
  } catch { /* no session */ }
  return null;
}

/** Whether practice can run here: { ok } or { ok: false, reason }. */
export function practiceStatus() {
  const s = session();
  if (!s) return { ok: false, reason: 'Practice questions come from Soma. Open the game from Soma while signed in.' };
  if (s.expiresAt && s.expiresAt < Date.now() + 30_000) return { ok: false, reason: 'Your Soma sign-in has expired. Open Soma once to refresh it, then come back.' };
  return { ok: true };
}

const words = (text) => (String(text).toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w));

async function rest(path, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`notes ${res.status}`);
  return res.json();
}

/**
 * The student's own notes for this course: documents Soma has read, tied to
 * the course's subject when possible, cut to the passages that best match
 * the exam. Returns { text, files } (empty when there are none).
 */
async function courseNotes(item, token) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { text: '', files: [] };
  const [docs, subjects] = await Promise.all([
    rest('documents?select=file_name,subject_id,extracted_text&extraction_status=eq.done&extracted_text=not.is.null&order=created_at.desc&limit=40', token),
    rest('subjects?select=id,name,canvas_course_id', token).catch(() => []),
  ]);
  const canvasId = String(item.courseId || '').split(':').pop();
  const courseWords = new Set(words(item.courseName));
  const mine = new Set(subjects.filter((s) => String(s.canvas_course_id ?? '') === canvasId || words(s.name).some((w) => courseWords.has(w))).map((s) => s.id));
  const query = new Set([...words(item.name), ...courseWords]);
  const pieces = [];
  for (const doc of docs) {
    const own = mine.has(doc.subject_id);
    if (mine.size && !own) continue;
    const text = String(doc.extracted_text || '');
    for (let at = 0; at < text.length; at += 1400) {
      const chunk = text.slice(at, at + 1600);
      let score = own ? 2 : 0;
      for (const w of words(chunk)) if (query.has(w)) score += 1;
      pieces.push({ file: doc.file_name, chunk, score, at });
    }
  }
  pieces.sort((a, b) => b.score - a.score);
  const picked = [];
  let used = 0;
  for (const p of pieces) {
    if (used + p.chunk.length > NOTES_CHARS) break;
    picked.push(p);
    used += p.chunk.length;
  }
  picked.sort((a, b) => (a.file === b.file ? a.at - b.at : a.file < b.file ? -1 : 1));
  return { text: picked.map((p) => `[${p.file}]\n${p.chunk}`).join('\n\n'), files: [...new Set(picked.map((p) => p.file))] };
}

const SYSTEM = `You write practice questions for a student studying for a test.
Return only JSON, no other text, in this shape:
{"questions":[{"q":"question","choices":["A","B","C","D"],"answer":0,"why":"one or two sentences on why the answer is right"}]}
Rules:
- Exactly the number of questions asked for, each with 4 choices and exactly one right answer ("answer" is its index, 0 to 3).
- Test understanding: applying ideas, worked steps, cause and effect. No trivia about file names, dates of lectures or page numbers.
- When course notes are given, base the questions on them. Without notes, cover what such a course usually tests at that point.
- Mix easy, medium and hard. Plain wording. No "all of the above" or "none of the above".
- Wrong choices should be believable mistakes a student would make.`;

const ERRORS = {
  auth_required: 'Your Soma sign-in has expired. Open Soma once to refresh it.',
  subscription_required: 'Practice questions use Soma AI, which needs a Soma plan or trial.',
  ai_budget_used: 'This month’s Soma AI budget is used up. It resets soon, or you can top up in Soma.',
  rate_limit: 'Soma AI is busy. Try again in a minute.',
  overloaded: 'Soma AI is busy. Try again in a minute.',
};

/** Asks Soma's AI for a round of questions on an item (or on a course when item is free study). */
export async function makePractice(item, count = 5) {
  const s = session();
  if (!s) throw new Error(practiceStatus().reason);
  let notes = { text: '', files: [] };
  try { notes = await courseNotes(item, s.token); } catch { /* questions without notes still work */ }
  const ask = `${notes.text ? `Course notes:\n${notes.text}\n\n` : ''}Write ${count} practice questions for "${item.name}" in ${item.courseName || 'this course'}.`;
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${s.token}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: ask }], systemPrompt: SYSTEM, purpose: 'practice' }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(ERRORS[data?.error] || (res.status === 401 ? ERRORS.auth_required : 'Soma AI could not write questions right now. Try again.'));
  const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let questions = [];
  try { questions = JSON.parse(json).questions || []; } catch { /* bad JSON */ }
  questions = questions.filter((q) => q && typeof q.q === 'string' && Array.isArray(q.choices) && q.choices.length === 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4).slice(0, count);
  if (!questions.length) throw new Error('Soma AI sent back something unreadable. Try again.');
  return { questions, files: notes.files };
}
