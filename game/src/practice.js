// Practice questions and study sets written by Claude, always on a server.
// Inside Soma (somastudy.app/game) the game shares the student's sign-in, so it
// can read their course notes from Supabase and ask Soma's /api/practice (a
// Vercel function: signed-in students only, billed to their AI budget, no memory,
// nothing learned). In dev, the Epoch/Soma vite server answers /api/practice
// itself (server/practice-api.js), so studying works with no sign-in on localhost.
// Both answer the same URLs with the same shapes; GET /api/practice says which
// one is there ({ signin: true } on Soma's).

import { getSession, readSession } from './auth.js';

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';
const NOTES_CHARS = 14000; // course material sent with each request
const STOP = new Set('the and for with from that this into your are was were will exam midterm final test quiz unit part chapter week'.split(' '));

// Where the AI lives, asked once per page: GET /api/practice answers
// { service:'epoch-practice', ready, model, signin? }. A missing endpoint (an
// older Soma deploy) is remembered for the session, and the game falls back to
// Soma's /api/chat. Only a network failure, or a dev endpoint without a key
// yet, is asked again (after 15 s).
let probe = null; // { at, endpoint, final }
async function endpoint() {
  if (probe && (probe.final || Date.now() - probe.at < 15000)) return probe.endpoint;
  let found = null, final = false;
  try {
    const res = await fetch('/api/practice', { headers: { accept: 'application/json' } });
    final = true;
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) {
      const data = await res.json();
      if (data?.service === 'epoch-practice') { found = data; final = Boolean(data.ready || data.signin); }
    }
  } catch { /* offline, or no server: ask again later */ }
  probe = { at: Date.now(), endpoint: found, final };
  return found;
}

const MB = 1024 * 1024;
const fileLimit = (ep) => (Number(ep?.maxFileBytes) > 0 ? Number(ep.maxFileBytes) : 20 * MB);
const tooLarge = (limit) => `That file is over ${Math.round(limit / MB)} MB. Try a smaller file, or split it.`;

/**
 * Whether AI studying can run here: { ok, via: 'local'|'soma'|'chat', label } or
 * { ok: false, reason } with a sentence a student can act on.
 * local: the dev server (no sign-in). soma: Soma's /api/practice. chat: an older
 * Soma deploy without it, through /api/chat (short sets only, no uploads).
 */
export async function practiceStatus() {
  const ep = await endpoint();
  if (ep && !ep.signin) {
    if (ep.ready) return { ok: true, via: 'local', label: 'Claude, running on this computer' };
    return { ok: false, reason: 'The AI isn’t set up on this computer yet: the dev server found no EPOCH_ANTHROPIC_API_KEY. Add it to .env.development.local and restart the server.' };
  }
  if (ep && !ep.ready) return { ok: false, reason: 'The AI isn’t set up on the server yet.' };
  const s = await getSession();
  if (s) return { ok: true, via: ep ? 'soma' : 'chat', label: 'Soma AI' };
  if (readSession()) return { ok: false, reason: 'Your Soma sign-in has expired. Open Soma once to refresh it, then come back.' };
  return { ok: false, reason: 'AI studying runs through Soma. Open Epoch from Soma (somastudy.app/game) while signed in.' };
}

/** Request headers for an AI call: the Soma token when the route needs it. */
async function aiHeaders(via, json = true) {
  const s = via === 'local' ? null : await getSession();
  return { ...(json ? { 'content-type': 'application/json' } : {}), ...(s ? { Authorization: `Bearer ${s.token}` } : {}) };
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
  subscription_required: 'AI studying uses Soma AI, which needs a Soma plan or trial.',
  ai_budget_used: 'This month’s Soma AI budget is used up. It resets soon, or you can top up in Soma.',
  rate_limit: 'The AI is busy right now. Wait a minute and try again.',
  overloaded: 'The AI is busy right now. Wait a minute and try again.',
  request_timeout: 'The AI took too long to answer. Try again, maybe with fewer items.',
  offline: 'Couldn’t reach the AI. Check your internet connection and try again.',
  bad_key: 'The AI key was rejected. Locally: check EPOCH_ANTHROPIC_API_KEY and restart the dev server.',
  auth_service_unavailable: 'Couldn’t check your Soma sign-in just now. Try again in a moment.',
  service_unavailable: 'The AI couldn’t do that right now. Try again in a moment.',
  upstream_unavailable: 'The AI couldn’t do that right now. Try again in a moment.',
  invalid_ai_response: 'The AI came back empty. Try again.',
  invalid_request: 'That request was too big or incomplete. Try again with less text.',
  server_not_configured: 'The AI isn’t set up on the server yet.',
  context_too_long: 'That’s too much text for one go. Paste fewer notes and try again.',
  response_incomplete: 'The answer got cut off. Try again with fewer items.',
  refused: 'The AI wouldn’t write material on that. Try wording the topic differently.',
  file_too_large: 'That file is too big to upload. Try a smaller file, or split it.',
  image_too_large: 'That photo is over 5 MB. Try a smaller photo or a screenshot.',
  video_file: 'Video files can’t be read yet. Paste a YouTube link instead, or paste the transcript as text.',
  bad_video_link: 'That doesn’t look like a YouTube link. Copy the link from the video’s Share button.',
  video_unavailable: 'Couldn’t open that video. It may be private, age-restricted or removed.',
  no_captions: 'That video has no captions to read. Try another video, or paste its transcript as text.',
  unsupported_file: 'That kind of file can’t be read. Use a PDF, Word (.docx), PowerPoint (.pptx), text file or a photo of your notes.',
  old_format: 'That’s an older file format. Save it as PDF (or .docx / .pptx) and upload that.',
  empty_source: 'There wasn’t enough text in that to study from. Try another file, or paste your notes.',
  unreadable_file: 'Couldn’t read that file. If it’s a PDF, try exporting it again, or paste the text.',
  local_only: 'Uploads aren’t available here yet. Paste your notes as text instead.',
};
const NO_REPLY = 'Couldn’t reach the AI. Check your connection and try again.';
const UNREADABLE = 'The AI sent back something unreadable. Try again.';

/** One call to the AI (/api/practice, or /api/chat on an older Soma). Returns the parsed JSON it wrote. */
async function askAI(system, content) {
  const status = await practiceStatus();
  if (!status.ok) throw new Error(status.reason);
  let res;
  try {
    res = await fetch(status.via === 'chat' ? '/api/chat' : '/api/practice', {
      method: 'POST',
      headers: await aiHeaders(status.via),
      body: JSON.stringify({ messages: [{ role: 'user', content }], systemPrompt: system, purpose: 'practice' }),
    });
  } catch { throw new Error(NO_REPLY); }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    if (status.via !== 'chat' && res.status === 404) probe = null; // the endpoint went away (dev server restarted without it)
    throw new Error(ERRORS[data?.error] || (res.status === 401 ? ERRORS.auth_required : 'The AI couldn’t do that right now. Try again in a moment.'));
  }
  const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { throw new Error(UNREADABLE); }
}

/** Asks the AI for a round of questions on an item (or on a course when item is free study). */
export async function makePractice(item, count = 5, topic = null) {
  const s = await getSession();
  let notes = { text: '', files: [] };
  if (s) try { notes = await courseNotes(topic ? { ...item, name: `${topic} ${topic} ${item.name}` } : item, s.token); } catch { /* questions without notes still work */ }
  const ask = `${notes.text ? `Course notes:\n${notes.text}\n\n` : ''}Write ${count} practice questions ${topic ? `on the topic "${topic}" ` : ''}for "${item.name}" in ${item.courseName || 'this course'}.`;
  const out = await askAI(SYSTEM, ask);
  const questions = (out.questions || []).filter((q) => q && typeof q.q === 'string' && Array.isArray(q.choices) && q.choices.length === 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4).slice(0, count);
  if (!questions.length) throw new Error(UNREADABLE);
  return { questions, files: notes.files };
}

// --- Study Hall: sets built from what the student wants to study ----------------------
// Every set comes from the AI on a server (askAI: /api/practice, from the dev
// server or Soma); the browser never sees a key.
// The student's own notes ride along: whatever they pasted, plus (when signed in
// to Soma) the Soma documents that best match the topic.

const LEVELS = { easy: 'Mostly easy, a few medium.', mixed: 'A mix of easy, medium and hard.', hard: 'Mostly hard: multi-step, application and tricky cases.' };
const SET_PROMPTS = {
  quiz: `Return only JSON: {"title":"short title","questions":[{"q":"question","choices":["A","B","C","D"],"answer":0,"why":"one or two sentences on why"}]}
- Exactly 4 choices each, exactly one right ("answer" is its index 0-3). Wrong choices are believable mistakes. No "all/none of the above".`,
  cards: `Return only JSON: {"title":"short deck title","cards":[{"front":"a term, question or prompt","back":"the answer, short and exact"}]}
- One fact or idea per card. Fronts are specific (not "What is X?" for everything; mix definitions, why/how, formulas, examples). Backs under 30 words.`,
  explain: `Return only JSON: {"title":"short title","prompts":[{"q":"an open question the student answers in their own words","points":["key point a good answer includes","..."]}]}
- Questions test understanding: explain why, compare, walk through a process, apply to a case. 2 to 4 key points each.`,
  problems: `Return only JSON: {"title":"short title","problems":[{"q":"a practice problem with all numbers and givens","steps":["step 1","step 2","..."],"answer":"the final answer"}]}
- Problems like the ones on a real exam for this topic. Steps are short and show the reasoning. If the topic has no calculations, use short scenario problems.`,
};
const SET_SYSTEM = (mode) => `You make study material for a college student. Base it on the student's notes when given; otherwise on what courses like this usually cover. Plain wording. No trivia about file names or page numbers.
${SET_PROMPTS[mode]}`;

/**
 * A study set. what: { topic, course, item, notes } (any of them). mode: quiz |
 * cards | explain | problems. Returns { title, files, ...items } with bad entries dropped.
 */
export async function makeStudySet({ topic = '', course = '', item = null, notes = '' }, mode = 'quiz', count = 8, level = 'mixed') {
  const s = await getSession();
  let found = { text: '', files: [] };
  const lookup = item || { name: topic, courseName: course, courseId: '' };
  if (s) try { found = await courseNotes(topic ? { ...lookup, name: `${topic} ${topic} ${lookup.name || ''}` } : lookup, s.token); } catch { /* without notes is fine */ }
  const own = notes.trim().slice(0, 9000);
  const subject = [topic && `the topic "${topic}"`, item && `"${item.name}"`, (course || item?.courseName) && `in ${course || item.courseName}`].filter(Boolean).join(' ') || 'this course';
  const ask = `${own ? `The student's own notes:\n${own}\n\n` : ''}${found.text ? `More of their course notes:\n${found.text}\n\n` : ''}Make ${count} ${{ quiz: 'quiz questions', cards: 'flashcards', explain: 'explain-it questions', problems: 'practice problems' }[mode]} on ${subject}. ${LEVELS[level] || LEVELS.mixed}`;
  const out = await askAI(SET_SYSTEM(mode), ask);
  const clean = {
    quiz: () => ({ questions: (out.questions || []).filter((q) => q && typeof q.q === 'string' && Array.isArray(q.choices) && q.choices.length === 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4) }),
    cards: () => ({ cards: (out.cards || []).filter((c) => c && typeof c.front === 'string' && typeof c.back === 'string' && c.front.trim() && c.back.trim()) }),
    explain: () => ({ prompts: (out.prompts || []).filter((p) => p && typeof p.q === 'string').map((p) => ({ q: p.q, points: Array.isArray(p.points) ? p.points.filter((x) => typeof x === 'string') : [] })) }),
    problems: () => ({ problems: (out.problems || []).filter((p) => p && typeof p.q === 'string').map((p) => ({ q: p.q, steps: Array.isArray(p.steps) ? p.steps.filter((x) => typeof x === 'string') : [], answer: String(p.answer ?? '') })) }),
  }[mode]();
  const list = Object.values(clean)[0].slice(0, count);
  if (!list.length) throw new Error('The AI came back empty. Try again, or add a few lines of notes.');
  return { title: typeof out.title === 'string' && out.title.trim() ? out.title.trim().slice(0, 80) : (topic || item?.name || course || 'Study set'), files: found.files, [Object.keys(clean)[0]]: list };
}

const GRADE_SYSTEM = `You grade a student's short written answer kindly and honestly.
Return only JSON: {"score":0-100,"got":["what they got right, short"],"missed":["what was missing or wrong, short"],"tip":"one sentence to improve"}
Judge understanding, not wording or spelling. An empty or off-topic answer scores 0.`;
/** Grades an explain-it answer against its key points. */
export async function gradeExplain(prompt, answer) {
  const out = await askAI(GRADE_SYSTEM, `Question: ${prompt.q}\nKey points a good answer covers:\n${prompt.points.map((p) => `- ${p}`).join('\n') || '- (use your judgement)'}\n\nThe student's answer:\n${String(answer).slice(0, 3000)}`);
  const list = (x) => (Array.isArray(x) ? x.filter((v) => typeof v === 'string').slice(0, 5) : []);
  return { score: Math.max(0, Math.min(100, Math.round(Number(out.score) || 0))), got: list(out.got), missed: list(out.missed), tip: typeof out.tip === 'string' ? out.tip : '' };
}

// --- Study kits: the student brings material, Claude makes the rest on request ---------
// A kit holds the material as plain text plus a title, a short overview and its main
// topics. Flashcards, practice questions and the study guide are each made only when
// the student asks for them.

const toBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Couldn’t open that file on this computer. Try again.'));
  r.readAsDataURL(file);
});

/** Turns a file or a YouTube link into text: { title, text, kind, cut }. */
export async function readMaterial({ file = null, url = '' }) {
  const status = await practiceStatus();
  if (!status.ok) throw new Error(status.reason);
  if (status.via === 'chat') throw new Error(ERRORS.local_only);
  const limit = fileLimit(probe?.endpoint);
  if (file && file.size > limit) throw new Error(tooLarge(limit));
  const body = file ? { kind: 'file', name: file.name, data: await toBase64(file) } : { kind: 'video', url };
  let res;
  try {
    res = await fetch('/api/practice/source', { method: 'POST', headers: await aiHeaders(status.via), body: JSON.stringify(body) });
  } catch { throw new Error(NO_REPLY); }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (res.status === 413 || data?.error === 'file_too_large') throw new Error(tooLarge(limit));
  if (!res.ok || data?.error) throw new Error(ERRORS[data?.error] || (res.status === 401 ? ERRORS.auth_required : 'Couldn’t read that. Try again in a moment.'));
  return data;
}

const KIT_TEXT = 50000; // characters of material sent with each request

// One system prompt for every kit request, so the cached material is reused across
// cards, questions and the guide. What to make goes in the request after the material.
const KIT_SYSTEM = `You make study material from a student's own material (notes, slides, a reading or a video transcript).
Output NDJSON: one complete JSON object per line, nothing else. No code fences, no commentary.
Rules:
- Use only what the material covers. Be exact; never invent facts, numbers or formulas.
- Short and scannable: no padding, no "In this section...". Plain words a student would use.
- Math, physics and stats: LaTeX inside \\( \\) for inline and \\[ \\] for display. Chemistry formulas and reactions: \\ce{...}. In JSON every backslash is doubled, e.g. "\\\\frac{a}{b}".
- **bold** for the one key word in a line when it helps. \`code\` for code, and fenced code blocks for multi-line code.
- "src": where in the material it comes from, using its markers ("p. 3" for [Page 3], "slide 4" for Slide 4, "4:12" for [4:12]). Leave it "" when the material has no markers.`;

const ASKS = {
  map: () => `Map this material for a study kit. Output exactly one line:
{"title":"what it's about, under 8 words (not the file name)","overview":"2 sentences on what it covers","topics":[{"name":"1 to 5 words","src":"where it starts"}]}
3 to 8 topics, in the order the material covers them.`,
  cards: ({ count, topics, avoid }) => `Make ${count} flashcards${topics.length ? `, spread evenly over these topics: ${topics.join('; ')}` : ''}.
One line per card: {"front":"a specific prompt","back":"the answer, under 25 words","topic":"one of the topics","src":"..."}
Mix definitions, why/how, formulas, steps and examples. One idea per card.${avoid.length ? `\nDon't repeat these:\n${avoid.map((a) => `- ${a}`).join('\n')}` : ''}`,
  questions: ({ count, topics, avoid }) => `Write ${count} test-style multiple-choice questions${topics.length ? `, spread over these topics: ${topics.join('; ')}` : ''}. Start easy and get harder.
One line per question: {"q":"question","choices":["A","B","C","D"],"answer":0,"why":"why the right answer is right, under 20 words","more":"one or two sentences on the trap in the most tempting wrong choice","topic":"...","level":"easy|medium|hard","src":"..."}
Exactly 4 choices, one right ("answer" is its index 0-3). Wrong choices are mistakes students really make. Test understanding and application; for math, include computation questions. No "all/none of the above".${avoid.length ? `\nDon't repeat these:\n${avoid.map((a) => `- ${a}`).join('\n')}` : ''}`,
  guide: ({ topics }) => `Write a study guide as topic cards, one line each, in this order:
First line: {"kind":"summary","text":"the big picture in 2 or 3 sentences"}
Then one line per topic${topics.length ? ` (${topics.join('; ')})` : ''}:
{"kind":"topic","name":"...","src":"...","points":["key idea, under 18 words","..."],"terms":[{"term":"...","def":"under 15 words"}],"table":{"cols":["",""],"rows":[["",""]]},"check":{"q":"one quick question","choices":["A","B","C","D"],"answer":0,"why":"under 20 words"}}
3 to 5 points per topic. 0 to 4 terms. Add "table" only when a comparison or a list of steps/values reads better as a table; otherwise leave it out.`,
};

// A model writes LaTeX like \frac inside JSON strings; when it forgets to double the
// backslash, JSON.parse fails or reads "\f" as a form feed. Escapes JSON really uses
// are kept; a lone backslash before anything else (or before a LaTeX command that
// starts with b/f/n/r/t/u) is doubled.
const LATEX_BFNRTU = /^(b(eta|ar|inom|oxed|ig|igl|igr|ot|ullet|egin|f|m)|f(rac|orall|lat)|n(abla|eq|e|u|ot|i|ewline|cong|leq|geq|mid|parallel|subseteq)|r(ho|ight|angle|ceil|floor|m|Rightarrow)|t(heta|imes|ext|extbf|extit|au|an|o|op|frac|ilde|riangle|herefore)|u(nderline|parrow|psilon|nion))(?![a-zA-Z])/;
export function repairJsonLine(line) {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c !== '\\') { out += c; continue; }
    const next = line[i + 1] ?? '';
    if (next === '\\') { out += '\\\\'; i += 1; continue; }
    if (next === '"' || next === '/') { out += c + next; i += 1; continue; }
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(line.slice(i + 2, i + 6))) { out += c; continue; }
    if ('bfnrt'.includes(next) && next && !LATEX_BFNRTU.test(line.slice(i + 1))) { out += c; continue; }
    out += '\\\\';
  }
  return out;
}
export function parseLine(line) {
  const t = line.trim().replace(/^```(json)?$/, '').replace(/,$/, '');
  if (!t.startsWith('{')) return null;
  try { return JSON.parse(t); } catch { /* try the repair */ }
  try { return JSON.parse(repairJsonLine(t)); } catch { return null; }
}

/**
 * Streams one kit request from /api/practice/stream (the dev server, or Soma's
 * signed-in route). onLine(obj) gets each JSON line as it arrives. On an older
 * Soma deploy without that route it falls back to one /api/chat call and
 * replays the lines. signal: an AbortSignal.
 */
async function streamKit(text, ask, onLine, { speed = 'best', signal } = {}) {
  const status = await practiceStatus();
  if (!status.ok) throw new Error(status.reason);
  const material = String(text).slice(0, KIT_TEXT);
  let error = null;
  const take = (line) => { const o = parseLine(line); if (!o) return; if (o.__error) error = o.__error; else onLine(o); };
  if (status.via === 'chat') {
    const out = await askAIText(KIT_SYSTEM, `<material>\n${material}\n</material>\n\n${ask}`);
    out.split('\n').forEach(take);
    return;
  }
  let res;
  try {
    res = await fetch('/api/practice/stream', { method: 'POST', signal, headers: await aiHeaders(status.via), body: JSON.stringify({ purpose: 'practice', systemPrompt: KIT_SYSTEM, material, ask, speed }) });
  } catch (err) { if (err?.name === 'AbortError') throw err; throw new Error(NO_REPLY); }
  if (!res.ok || !res.body) {
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.status === 404) probe = null;
    throw new Error(ERRORS[data?.error] || (res.status === 401 ? ERRORS.auth_required : 'The AI couldn’t do that right now. Try again in a moment.'));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { take(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  }
  take(buf);
  if (error && error !== 'cancelled') throw new Error(ERRORS[error] || 'The AI stopped partway. Try again.');
}
/** Soma's /api/chat (signed in; older deploys only), returning the raw text. */
async function askAIText(system, content) {
  let res;
  try {
    res = await fetch('/api/chat', { method: 'POST', headers: await aiHeaders('chat'), body: JSON.stringify({ messages: [{ role: 'user', content }], systemPrompt: system, purpose: 'practice' }) });
  } catch { throw new Error(NO_REPLY); }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(ERRORS[data?.error] || (res.status === 401 ? ERRORS.auth_required : 'The AI couldn’t do that right now. Try again in a moment.'));
  return (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

const str = (x) => typeof x === 'string' && x.trim();
const clip = (x, n) => String(x).trim().slice(0, n);

/** Title, overview and a topic map for new material (fast model). */
export async function makeKit(text, fallbackTitle = 'Study kit') {
  let map = null;
  await streamKit(text, ASKS.map(), (o) => { if (!map && (o.title || o.topics)) map = o; }, { speed: 'fast' });
  if (!map) throw new Error(UNREADABLE);
  return {
    title: str(map.title) ? clip(map.title, 80) : fallbackTitle,
    overview: str(map.overview) ? clip(map.overview, 600) : '',
    topics: (Array.isArray(map.topics) ? map.topics : []).map((t) => (typeof t === 'string' ? { name: t } : t)).filter((t) => t && str(t.name)).map((t) => ({ name: clip(t.name, 64), src: str(t.src) ? clip(t.src, 12) : '' })).slice(0, 8),
  };
}

const cleanCard = (c) => (c && str(c.front) && str(c.back) ? { front: clip(c.front, 400), back: clip(c.back, 500), topic: str(c.topic) ? clip(c.topic, 40) : '', src: str(c.src) ? clip(c.src, 12) : '' } : null);
const cleanQuestion = (q) => (q && str(q.q) && Array.isArray(q.choices) && q.choices.length === 4 && q.choices.every((c) => str(c) || typeof c === 'number') && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4
  ? { q: clip(q.q, 600), choices: q.choices.map((c) => clip(c, 300)), answer: q.answer, why: str(q.why) ? clip(q.why, 300) : '', more: str(q.more) ? clip(q.more, 500) : '', topic: str(q.topic) ? clip(q.topic, 40) : '', level: ['easy', 'medium', 'hard'].includes(q.level) ? q.level : '', src: str(q.src) ? clip(q.src, 12) : '' } : null);
const cleanTopic = (t) => {
  if (!t || !str(t.name)) return null;
  const table = t.table && Array.isArray(t.table.cols) && Array.isArray(t.table.rows) && t.table.cols.length && t.table.rows.length
    ? { cols: t.table.cols.map((c) => clip(c, 80)).slice(0, 5), rows: t.table.rows.filter(Array.isArray).slice(0, 10).map((r) => r.map((c) => clip(c, 160)).slice(0, 5)) } : null;
  return {
    name: clip(t.name, 60), src: str(t.src) ? clip(t.src, 12) : '',
    points: (t.points || []).filter(str).map((p) => clip(p, 300)).slice(0, 6),
    terms: (t.terms || []).filter((x) => x && str(x.term) && str(x.def)).map((x) => ({ term: clip(x.term, 60), def: clip(x.def, 200) })).slice(0, 5),
    table, check: cleanQuestion(t.check),
  };
};

/**
 * Makes one part of a kit, streaming. part: cards | questions | guide.
 * onItem(item) is called as each card / question / guide piece arrives
 * (guide pieces: { kind:'summary', text } or { kind:'topic', ...topic }).
 * Returns the number of items received.
 */
export async function streamKitPart(text, part, { count = 12, avoid = [], topics = [], signal } = {}, onItem) {
  let n = 0;
  const names = topics.map((t) => (typeof t === 'string' ? t : t.name)).filter(Boolean);
  const ask = ASKS[part]({ count, topics: names, avoid: avoid.slice(-50).map((a) => String(a).slice(0, 120)) });
  await streamKit(text, ask, (o) => {
    let item = null;
    if (part === 'cards') item = cleanCard(o);
    else if (part === 'questions') item = cleanQuestion(o);
    else if (o.kind === 'summary' && str(o.text)) item = { kind: 'summary', text: clip(o.text, 800) };
    else if (o.kind === 'topic' || o.name) { const t = cleanTopic(o); if (t) item = { kind: 'topic', ...t }; }
    if (item && (part === 'guide' || n < count)) { n += 1; onItem(item); }
  }, { signal });
  if (!n) throw new Error('The AI came back empty. Try again.');
  return n;
}
