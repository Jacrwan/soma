// Practice questions and study sets written by Claude, always on a server.
// Inside Soma (somastudy.app/game) the game shares the student's sign-in, so it
// can read their course notes from Supabase and ask Soma's /api/chat (the
// 'practice' purpose: no memory, nothing learned, billed to the student's AI
// budget). In dev, the Epoch/Soma vite server answers /api/practice itself
// (server/practice-api.js), so studying works with no sign-in on localhost.

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

// Where the AI lives. In dev (standalone Epoch, or Soma's local vite) the dev
// server answers /api/practice with its own server-side key, no sign-in. In
// production there is no such route, so the game uses Soma's signed-in /api/chat.
let probe = null; // { at, local }
async function localAI() {
  if (probe && (probe.local?.ready || Date.now() - probe.at < 15000)) return probe.local;
  let local = null;
  try {
    const res = await fetch('/api/practice', { headers: { accept: 'application/json' } });
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) {
      const data = await res.json();
      if (data?.service === 'epoch-practice') local = data;
    }
  } catch { /* no dev endpoint */ }
  probe = { at: Date.now(), local };
  return local;
}

/**
 * Whether AI studying can run here: { ok, via: 'local'|'soma', label } or
 * { ok: false, reason } with a sentence a student can act on.
 */
export async function practiceStatus() {
  const local = await localAI();
  if (local?.ready) return { ok: true, via: 'local', label: 'Claude, running on this computer' };
  const s = session();
  if (s && !(s.expiresAt && s.expiresAt < Date.now() + 30_000)) return { ok: true, via: 'soma', label: 'Soma AI' };
  if (local) return { ok: false, reason: 'The AI isn’t set up on this computer yet: the dev server found no EPOCH_ANTHROPIC_API_KEY. Add it to .env.development.local and restart the server.' };
  if (s) return { ok: false, reason: 'Your Soma sign-in has expired. Open Soma once to refresh it, then come back.' };
  return { ok: false, reason: 'AI studying runs through Soma. Open Epoch from Soma (somastudy.app/game) while signed in.' };
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
  bad_key: 'The AI key on this computer was rejected. Check EPOCH_ANTHROPIC_API_KEY and restart the dev server.',
  server_not_configured: 'The AI isn’t set up on the server yet.',
  context_too_long: 'That’s too much text for one go. Paste fewer notes and try again.',
  response_incomplete: 'The answer got cut off. Try again with fewer items.',
  refused: 'The AI wouldn’t write material on that. Try wording the topic differently.',
  file_too_large: 'That file is over 20 MB. Try a smaller file, or split it.',
  image_too_large: 'That photo is over 5 MB. Try a smaller photo or a screenshot.',
  video_file: 'Video files can’t be read yet. Paste a YouTube link instead, or paste the transcript as text.',
  bad_video_link: 'That doesn’t look like a YouTube link. Copy the link from the video’s Share button.',
  video_unavailable: 'Couldn’t open that video. It may be private, age-restricted or removed.',
  no_captions: 'That video has no captions to read. Try another video, or paste its transcript as text.',
  unsupported_file: 'That kind of file can’t be read. Use a PDF, Word (.docx), PowerPoint (.pptx), text file or a photo of your notes.',
  old_format: 'That’s an older file format. Save it as PDF (or .docx / .pptx) and upload that.',
  empty_source: 'There wasn’t enough text in that to study from. Try another file, or paste your notes.',
  unreadable_file: 'Couldn’t read that file. If it’s a PDF, try exporting it again, or paste the text.',
  local_only: 'Uploads work on the local build for now. Paste your notes as text instead.',
};
const NO_REPLY = 'Couldn’t reach the AI. Check your connection and try again.';
const UNREADABLE = 'The AI sent back something unreadable. Try again.';

/** One call to the AI (local dev endpoint or Soma's /api/chat). Returns the parsed JSON it wrote. */
async function askAI(system, content) {
  const status = await practiceStatus();
  if (!status.ok) throw new Error(status.reason);
  const local = status.via === 'local';
  const s = local ? null : session();
  let res;
  try {
    res = await fetch(local ? '/api/practice' : '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(s ? { Authorization: `Bearer ${s.token}` } : {}) },
      body: JSON.stringify({ messages: [{ role: 'user', content }], systemPrompt: system, purpose: 'practice' }),
    });
  } catch { throw new Error(NO_REPLY); }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    if (local && res.status === 404) probe = null; // dev server restarted without the endpoint
    throw new Error(ERRORS[data?.error] || (res.status === 401 ? ERRORS.auth_required : 'The AI couldn’t do that right now. Try again in a moment.'));
  }
  const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { throw new Error(UNREADABLE); }
}

/** Asks the AI for a round of questions on an item (or on a course when item is free study). */
export async function makePractice(item, count = 5, topic = null) {
  const s = session();
  let notes = { text: '', files: [] };
  if (s) try { notes = await courseNotes(topic ? { ...item, name: `${topic} ${topic} ${item.name}` } : item, s.token); } catch { /* questions without notes still work */ }
  const ask = `${notes.text ? `Course notes:\n${notes.text}\n\n` : ''}Write ${count} practice questions ${topic ? `on the topic "${topic}" ` : ''}for "${item.name}" in ${item.courseName || 'this course'}.`;
  const out = await askAI(SYSTEM, ask);
  const questions = (out.questions || []).filter((q) => q && typeof q.q === 'string' && Array.isArray(q.choices) && q.choices.length === 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4).slice(0, count);
  if (!questions.length) throw new Error(UNREADABLE);
  return { questions, files: notes.files };
}

// --- Study Hall: sets built from what the student wants to study ----------------------
// Every set comes from the AI on a server (askAI: the dev server's /api/practice,
// or Soma's /api/chat with the 'practice' purpose); the browser never sees a key.
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
  const s = session();
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
  if (status.via !== 'local') throw new Error(ERRORS.local_only);
  if (file && file.size > 20 * 1024 * 1024) throw new Error(ERRORS.file_too_large);
  const body = file ? { kind: 'file', name: file.name, data: await toBase64(file) } : { kind: 'video', url };
  let res;
  try {
    res = await fetch('/api/practice/source', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch { throw new Error(NO_REPLY); }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || data?.error) throw new Error(ERRORS[data?.error] || (res.status === 413 ? ERRORS.file_too_large : 'Couldn’t read that. Try again in a moment.'));
  return data;
}

const KIT_TEXT = 50000; // characters of material sent with each request
const material = (text) => `The student's material:\n<material>\n${String(text).slice(0, KIT_TEXT)}\n</material>`;
const KIT_SYSTEM = `You set up a study kit from a student's material (notes, slides, a reading or a video transcript).
Return only JSON: {"title":"short title for what this is about (not the file name)","overview":"2 or 3 plain sentences on what the material covers","topics":["main topic","..."]}
- 3 to 8 topics, each 1 to 5 words, in the order the material covers them.`;

/** Title, overview and topics for new material. */
export async function makeKit(text, fallbackTitle = 'Study kit') {
  const out = await askAI(KIT_SYSTEM, material(text));
  return {
    title: typeof out.title === 'string' && out.title.trim() ? out.title.trim().slice(0, 80) : fallbackTitle,
    overview: typeof out.overview === 'string' ? out.overview.trim().slice(0, 600) : '',
    topics: Array.isArray(out.topics) ? out.topics.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 40)).slice(0, 8) : [],
  };
}

const PART_SYSTEM = {
  cards: `You make flashcards from a student's material. Use only what the material covers.
Return only JSON: {"cards":[{"front":"a term, question or prompt","back":"the answer, short and exact"}]}
- One fact or idea per card. Mix definitions, why/how, formulas, steps and examples. Backs under 30 words.`,
  questions: `You write practice questions from a student's material, like the ones on a real test. Use only what the material covers.
Return only JSON: {"questions":[{"q":"question","choices":["A","B","C","D"],"answer":0,"why":"one or two sentences on why the answer is right"}]}
- Exactly 4 choices each, exactly one right ("answer" is its index 0-3). Wrong choices are believable mistakes. No "all/none of the above".
- Test understanding and application, not trivia about page numbers. Mix easy, medium and hard.`,
  guide: `You write a study guide from a student's material: what they need to know, organised and short. Use only what the material covers.
Return only JSON: {"summary":"3 to 5 sentences: the big picture","sections":[{"heading":"topic","points":["key idea, short and exact","..."]}],"terms":[{"term":"key term","def":"one-line definition"}],"watch":["a common mistake or thing tests like to ask"]}
- 3 to 7 sections with 2 to 6 points each. Up to 12 terms. 2 to 5 watch-outs.`,
};

/** Makes one part of a kit on request. part: cards | questions | guide. avoid: fronts/questions already made. */
export async function makeKitPart(text, part, { count = 12, avoid = [], kitTitle = '' } = {}) {
  const ask = `${material(text)}\n\n${part === 'guide' ? `Write the study guide${kitTitle ? ` for "${kitTitle}"` : ''}.`
    : `Make ${count} ${part === 'cards' ? 'flashcards' : 'practice questions'}${kitTitle ? ` for "${kitTitle}"` : ''}.${avoid.length ? ` Don't repeat these:\n${avoid.slice(-60).map((a) => `- ${String(a).slice(0, 120)}`).join('\n')}` : ''}`}`;
  const out = await askAI(PART_SYSTEM[part], ask);
  const str = (x) => typeof x === 'string' && x.trim();
  if (part === 'cards') {
    const cards = (out.cards || []).filter((c) => c && str(c.front) && str(c.back)).slice(0, count);
    if (!cards.length) throw new Error(UNREADABLE);
    return { cards };
  }
  if (part === 'questions') {
    const questions = (out.questions || []).filter((q) => q && str(q.q) && Array.isArray(q.choices) && q.choices.length === 4 && q.choices.every(str) && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4).slice(0, count);
    if (!questions.length) throw new Error(UNREADABLE);
    return { questions };
  }
  const sections = (out.sections || []).filter((x) => x && str(x.heading)).map((x) => ({ heading: x.heading.trim(), points: (x.points || []).filter(str) }));
  if (!sections.length) throw new Error(UNREADABLE);
  return {
    summary: str(out.summary) ? out.summary.trim() : '',
    sections,
    terms: (out.terms || []).filter((t) => t && str(t.term) && str(t.def)).slice(0, 16),
    watch: (out.watch || []).filter(str).slice(0, 6),
  };
}
