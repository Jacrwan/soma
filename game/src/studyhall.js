// The Study Hall: study kits made from what the student brings.
// 1. Bring material: upload a file (PDF, Word, slides, text, a photo of notes),
//    paste text, or paste a YouTube link. Claude sets up a kit: title, overview, topics.
// 2. Inside the kit, nothing is made until asked: flashcards (a deck on a spaced
//    schedule, Leitner boxes), practice questions, or a study guide summary.
// Rules for decks are plain functions (tested in tests/study.test.js); the UI is
// its own overlay so it doesn't depend on the rest of the HUD.

const DAY = 86400000;
export const BOX_DAYS = [0, 1, 3, 7, 16, 35]; // days until a card is due again, by box
export const DECK_MAX = 60, CARD_MAX = 80;

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Saves a new deck of flashcards. Returns the deck. */
export function addDeck(state, { title, course = '', itemId = null, cards }, now = Date.now()) {
  const decks = state.decks || (state.decks = {});
  const ids = Object.keys(decks);
  if (ids.length >= DECK_MAX) delete decks[ids.sort((a, b) => decks[a].created - decks[b].created)[0]];
  const deck = {
    id: uid(), title: String(title || 'Deck').slice(0, 80), course, itemId, created: now,
    cards: cards.slice(0, CARD_MAX).map((c) => ({ id: uid(), front: String(c.front).slice(0, 300), back: String(c.back).slice(0, 400), box: 0, due: now })),
  };
  decks[deck.id] = deck;
  return deck;
}
/** Cards due now, across every deck (or one deck), soonest first. */
export function dueCards(state, now = Date.now(), deckId = null) {
  const out = [];
  for (const deck of Object.values(state.decks || {})) {
    if (deckId && deck.id !== deckId) continue;
    for (const card of deck.cards) if (card.due <= now) out.push({ deck, card });
  }
  return out.sort((a, b) => a.card.due - b.card.due);
}
/** Rates a card: 'again' back to box 0 (seen again this round), 'good' up one box, 'easy' up two. */
export function rateCard(state, deckId, cardId, grade, now = Date.now()) {
  const card = state.decks?.[deckId]?.cards.find((c) => c.id === cardId);
  if (!card) return null;
  card.box = grade === 'again' ? 0 : Math.min(BOX_DAYS.length - 1, card.box + (grade === 'easy' ? 2 : 1));
  card.due = grade === 'again' ? now + 60000 : now + BOX_DAYS[card.box] * DAY;
  card.seen = (card.seen || 0) + 1;
  return card;
}
export function deleteDeck(state, deckId) { if (state.decks) delete state.decks[deckId]; }
/** Adds cards to an existing deck (new cards are due now). */
export function addCards(state, deckId, cards, now = Date.now()) {
  const deck = state.decks?.[deckId];
  if (!deck) return null;
  for (const c of cards) if (deck.cards.length < CARD_MAX * 2) deck.cards.push({ id: uid(), front: String(c.front).slice(0, 300), back: String(c.back).slice(0, 400), box: 0, due: now });
  return deck;
}

// --- Study kits ---------------------------------------------------------------------------
// A kit is what the student brought (kept as text in its own localStorage key, so the
// save stays small) plus a title, overview and topics. Its flashcards are a deck;
// practice questions and the study guide are kept on the kit once made.
export const KIT_MAX = 30;
const KIT_KEY = (id) => `epoch.kit.${id}`;
const kitMemory = new Map(); // when localStorage is unavailable or full
export function saveKitText(id, text) {
  kitMemory.set(id, text);
  try { localStorage.setItem(KIT_KEY(id), text); } catch { /* memory only */ }
}
export function kitText(id) {
  try { const t = localStorage.getItem(KIT_KEY(id)); if (t) return t; } catch { /* no storage */ }
  return kitMemory.get(id) || '';
}
/** Saves a new kit and its material. Returns the kit. */
export function addKit(state, { title, overview = '', topics = [], source = {}, chars = 0, cut = false }, text, now = Date.now()) {
  const kits = state.kits || (state.kits = {});
  const ids = Object.keys(kits);
  if (ids.length >= KIT_MAX) deleteKit(state, ids.sort((x, y) => (kits[x].opened || kits[x].created) - (kits[y].opened || kits[y].created))[0]);
  const kit = { id: uid(), title: String(title || 'Study kit').slice(0, 80), overview: String(overview).slice(0, 600), topics: topics.slice(0, 8), source, chars, cut, created: now, deckId: null, questions: null, guide: null };
  kits[kit.id] = kit;
  saveKitText(kit.id, text);
  return kit;
}
/** Deletes a kit, its deck and its stored material. */
export function deleteKit(state, id) {
  const kit = state.kits?.[id];
  if (!kit) return;
  if (kit.deckId) deleteDeck(state, kit.deckId);
  delete state.kits[id];
  kitMemory.delete(id);
  try { localStorage.removeItem(KIT_KEY(id)); } catch { /* no storage */ }
}
/** A short "what's made" label for the kit list. */
export function kitMade(state, kit) {
  const deck = kit.deckId && state.decks?.[kit.deckId];
  const bits = [deck && `🃏 ${deck.cards.length}`, kit.questions?.length && `❓ ${kit.questions.length}`, kit.guide && '📘'].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'Nothing made yet';
}

// --- UI ----------------------------------------------------------------------------------
const CSS = `
#studyhall { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgba(12, 10, 24, 0.72); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); font-family: inherit; }
#studyhall[hidden] { display: none; }
.sh-card { width: min(760px, calc(100vw - 24px)); max-height: calc(100vh - 32px); overflow: auto; border-radius: 22px; background: #1d1934; border: 2px solid rgba(255,255,255,0.1); box-shadow: 0 24px 60px rgba(0,0,0,0.55); color: #fff6e6; }
.sh-head { display: flex; align-items: center; gap: 12px; padding: 16px 20px; background: linear-gradient(180deg, #4b7bd8, #3a62b8); border-radius: 20px 20px 0 0; }
.sh-head h2 { margin: 0; font-size: 22px; } .sh-head small { opacity: .85; font-weight: 700; }
.sh-head .sh-x { margin-left: auto; width: 34px; height: 34px; border-radius: 10px; border: 0; background: #e5483d; color: #fff; font: inherit; font-size: 18px; font-weight: 900; cursor: pointer; box-shadow: 0 3px 0 #9a2a22; }
.sh-body { padding: 18px 20px 20px; display: grid; gap: 14px; }
.sh-step { font-size: 12px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; color: #ffd878; }
.sh-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.sh-tab, .sh-chip { padding: 7px 12px; border-radius: 999px; border: 0; background: rgba(255,255,255,0.08); color: #fff6e6; font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; }
.sh-tab.on, .sh-chip.on { background: #f2c14e; color: #1d1830; }
.sh-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; max-height: 210px; overflow: auto; }
.sh-pick { text-align: left; padding: 10px 12px; border-radius: 12px; border: 2px solid transparent; background: rgba(255,255,255,0.06); color: inherit; font: inherit; cursor: pointer; }
.sh-pick b { display: block; font-size: 13.5px; } .sh-pick small { color: rgba(255,255,255,0.6); font-size: 11.5px; font-weight: 700; }
.sh-pick.on { border-color: #f2c14e; background: rgba(242,193,78,0.14); }
.sh-input, .sh-notes, .sh-answer { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 12px; border: 2px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.25); color: #fff; font: inherit; font-size: 14px; }
.sh-notes { min-height: 70px; resize: vertical; } .sh-answer { min-height: 110px; resize: vertical; }
.sh-modes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.sh-mode { padding: 12px 10px; border-radius: 14px; border: 2px solid transparent; background: rgba(255,255,255,0.06); color: inherit; font: inherit; cursor: pointer; text-align: center; }
.sh-mode b { display: block; font-size: 14.5px; margin-top: 4px; } .sh-mode small { display: block; font-size: 11px; color: rgba(255,255,255,0.6); font-weight: 700; margin-top: 2px; }
.sh-mode i { font-style: normal; font-size: 24px; }
.sh-mode.on { border-color: #f2c14e; background: rgba(242,193,78,0.14); }
.sh-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.sh-row > span { font-size: 12.5px; font-weight: 800; color: rgba(255,255,255,0.7); margin-right: 4px; }
.sh-go { justify-self: start; padding: 11px 22px; border-radius: 14px; border: 0; background: #3ec45a; color: #fff; font: inherit; font-size: 16px; font-weight: 900; cursor: pointer; box-shadow: 0 4px 0 #1f7a33; }
.sh-go:disabled { opacity: .45; cursor: default; }
.sh-ghost { padding: 9px 16px; border-radius: 12px; border: 0; background: rgba(255,255,255,0.1); color: #fff; font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; }
.sh-note { margin: 0; font-size: 12.5px; color: rgba(255,255,255,0.65); }
.sh-err { margin: 0; padding: 10px 12px; border-radius: 12px; background: rgba(229,72,61,0.18); color: #ffd2cd; font-weight: 700; font-size: 13.5px; }
.sh-progress { height: 8px; border-radius: 99px; background: rgba(255,255,255,0.1); overflow: hidden; } .sh-progress i { display: block; height: 100%; background: linear-gradient(90deg, #f2c14e, #ffe08a); transition: width .3s; }
.sh-q { font-size: 18px; font-weight: 800; line-height: 1.35; }
.sh-choices { display: grid; gap: 8px; }
.sh-choice { text-align: left; padding: 12px 14px; border-radius: 12px; border: 2px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: inherit; font: inherit; font-size: 15px; cursor: pointer; }
.sh-choice.right { border-color: #3ec45a; background: rgba(62,196,90,0.18); } .sh-choice.wrong { border-color: #e5483d; background: rgba(229,72,61,0.18); }
.sh-why { padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,0.06); font-size: 14px; line-height: 1.4; }
.sh-flip { min-height: 190px; display: grid; place-items: center; padding: 22px; border-radius: 18px; background: #fffaf0; color: #2a2238; font-size: 20px; font-weight: 800; text-align: center; line-height: 1.35; cursor: pointer; box-shadow: 0 8px 0 #cfc5ad; }
.sh-flip.back { background: #eaf6ff; box-shadow: 0 8px 0 #b3cde0; }
.sh-flip small { display: block; margin-bottom: 8px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #9a6a12; }
.sh-rate { display: flex; gap: 8px; } .sh-rate button { flex: 1; padding: 11px; border-radius: 12px; border: 0; font: inherit; font-size: 14.5px; font-weight: 900; cursor: pointer; color: #fff; }
.sh-rate .again { background: #e5483d; } .sh-rate .good { background: #3a62b8; } .sh-rate .easy { background: #3ec45a; }
.sh-steps { margin: 0; padding-left: 20px; display: grid; gap: 6px; font-size: 14.5px; line-height: 1.4; }
.sh-score { font-size: 34px; font-weight: 900; color: #ffd878; }
.sh-got li { color: #b9f0c4; } .sh-missed li { color: #ffc9c2; }
.sh-decks { display: grid; gap: 6px; }
.sh-deck { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 12px; background: rgba(255,255,255,0.05); }
.sh-deck b { flex: 1; font-size: 14px; } .sh-deck em { font-style: normal; font-size: 12px; font-weight: 800; color: #ffd878; }
.sh-intro { margin: 0; font-size: 14.5px; line-height: 1.45; color: rgba(255,255,255,0.85); }
.sh-ai { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 12px; font-size: 13px; font-weight: 800; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.75); }
.sh-ai.ok { background: rgba(62,196,90,0.14); color: #b9f0c4; } .sh-ai.bad { background: rgba(229,72,61,0.16); color: #ffd2cd; }
.sh-ai i { width: 9px; height: 9px; border-radius: 50%; background: currentColor; flex: none; }
.sh-ai.wait i { animation: sh-pulse 1s ease-in-out infinite; }
.sh-sub { font-size: 12.5px; font-weight: 800; color: rgba(255,255,255,0.6); margin: 2px 0 -6px; }
.sh-modes.big { grid-template-columns: repeat(2, 1fr); }
.sh-modes.big .sh-mode { display: grid; grid-template-columns: 40px 1fr; align-items: center; column-gap: 10px; text-align: left; padding: 12px 14px; }
.sh-modes.big .sh-mode i { grid-row: span 2; font-size: 28px; text-align: center; }
.sh-modes.big .sh-mode b { margin: 0; font-size: 15.5px; } .sh-modes.big .sh-mode small { font-size: 12px; line-height: 1.35; margin: 2px 0 0; color: rgba(255,255,255,0.7); }
.sh-more { border-radius: 12px; background: rgba(255,255,255,0.04); padding: 8px 12px; }
.sh-more summary { cursor: pointer; font-size: 13px; font-weight: 800; color: rgba(255,255,255,0.75); }
.sh-more[open] summary { margin-bottom: 10px; } .sh-more > div { display: grid; gap: 10px; }
.sh-gobar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.sh-gobar .sh-note { flex: 1; min-width: 180px; }
.sh-load { display: grid; gap: 12px; padding: 18px 4px; text-align: center; }
.sh-load .sh-q { font-size: 17px; }
.sh-spin { width: 46px; height: 46px; margin: 0 auto; border-radius: 50%; border: 5px solid rgba(255,255,255,0.12); border-top-color: #f2c14e; animation: sh-rot .9s linear infinite; }
.sh-indet { height: 8px; border-radius: 99px; background: rgba(255,255,255,0.1); overflow: hidden; position: relative; }
.sh-indet i { position: absolute; top: 0; bottom: 0; width: 35%; border-radius: 99px; background: linear-gradient(90deg, #f2c14e, #ffe08a); animation: sh-slide 1.4s ease-in-out infinite; }
.sh-oops { display: grid; gap: 12px; padding: 8px 0; } .sh-oops .sh-q { font-size: 17px; }
@keyframes sh-rot { to { transform: rotate(360deg); } }
@keyframes sh-slide { from { left: -35%; } to { left: 100%; } }
@keyframes sh-pulse { 50% { opacity: .3; } }
.sh-src { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.sh-src button { padding: 12px 10px; border-radius: 14px; border: 2px solid transparent; background: rgba(255,255,255,0.06); color: inherit; font: inherit; font-size: 14.5px; font-weight: 900; cursor: pointer; }
.sh-src button i { display: block; font-style: normal; font-size: 24px; margin-bottom: 2px; }
.sh-src button.on { border-color: #f2c14e; background: rgba(242,193,78,0.14); }
.sh-drop { display: grid; place-items: center; gap: 6px; min-height: 130px; padding: 18px; border-radius: 16px; border: 2px dashed rgba(255,255,255,0.22); background: rgba(0,0,0,0.18); text-align: center; cursor: pointer; }
.sh-drop.over, .sh-drop:hover { border-color: #f2c14e; background: rgba(242,193,78,0.08); }
.sh-drop b { font-size: 15.5px; } .sh-drop small { color: rgba(255,255,255,0.6); font-weight: 700; font-size: 12px; }
.sh-drop .sh-file { padding: 6px 12px; border-radius: 999px; background: #f2c14e; color: #1d1830; font-weight: 900; font-size: 13px; }
.sh-paste { min-height: 160px; resize: vertical; }
.sh-kits { display: grid; gap: 8px; }
.sh-kit { display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-radius: 14px; border: 0; background: rgba(255,255,255,0.06); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.sh-kit:hover { background: rgba(255,255,255,0.1); }
.sh-kit > i { font-style: normal; font-size: 24px; } .sh-kit div { flex: 1; min-width: 0; }
.sh-kit b { display: block; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .sh-kit small { color: rgba(255,255,255,0.6); font-size: 12px; font-weight: 700; }
.sh-kit em { font-style: normal; font-size: 12px; font-weight: 900; color: #ffd878; white-space: nowrap; }
.sh-topics { display: flex; flex-wrap: wrap; gap: 6px; } .sh-topics span { padding: 5px 10px; border-radius: 999px; background: rgba(255,255,255,0.08); font-size: 12.5px; font-weight: 800; }
.sh-parts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.sh-part { display: grid; align-content: start; gap: 8px; padding: 14px; border-radius: 16px; background: rgba(255,255,255,0.06); border: 2px solid rgba(255,255,255,0.06); }
.sh-part > i { font-style: normal; font-size: 30px; } .sh-part b { font-size: 16px; } .sh-part small { color: rgba(255,255,255,0.65); font-size: 12.5px; font-weight: 700; line-height: 1.35; }
.sh-part.made { border-color: rgba(62,196,90,0.45); }
.sh-part .sh-go, .sh-part .sh-ghost { justify-self: stretch; text-align: center; font-size: 14px; padding: 10px 12px; }
.sh-guide { overflow-wrap: anywhere; }
.sh-guide h3 { margin: 14px 0 6px; font-size: 16px; color: #ffd878; } .sh-guide ul { margin: 0; padding-left: 20px; display: grid; gap: 5px; font-size: 14.5px; line-height: 1.4; }
.sh-guide dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 0; font-size: 14px; } .sh-guide dt { font-weight: 900; color: #cfe4ff; } .sh-guide dd { margin: 0; color: rgba(255,255,255,0.85); }
.sh-guide .sh-why { font-size: 15px; }
.sh-danger { margin-left: auto; padding: 9px 14px; border-radius: 12px; border: 0; background: transparent; color: #ff9d94; font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; }
@media (max-width: 640px) { .sh-parts, .sh-src { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .sh-modes, .sh-modes.big { grid-template-columns: 1fr; } }
`;

const SOURCE_ICON = { pdf: '📄', doc: '📝', slides: '📊', text: '📋', image: '📷', video: '🎬' };
const SOURCE_NAME = { pdf: 'PDF', doc: 'Word document', slides: 'Slides', text: 'Pasted text', image: 'Photo of notes', video: 'Video' };
const ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.csv,.html,.png,.jpg,.jpeg,.webp,.gif';

/**
 * Opens the Study Hall. ctx: {
 *   state, save(),
 *   ai: { readMaterial({file|url}), makeKit(text, title), makeKitPart(text, part, opts) },
 *   status(): { ok, label } | { ok: false, reason } (or a Promise of it),
 *   reward({ topic, right, wrong, cards }) -> string (a line for the results screen),
 *   onAnswer(source, q, ok), onClose()
 * }
 */
export function createStudyHall() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const root = document.createElement('div');
  root.id = 'studyhall';
  root.hidden = true;
  document.body.append(root);
  let ctx = null;
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v === true) n.setAttribute(k, ''); else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k);
    return n;
  };
  function frame(title, sub, ...body) {
    keyHandler = null;
    root.replaceChildren(h('div', { class: 'sh-card' },
      h('div', { class: 'sh-head' }, h('div', {}, h('h2', { text: title }), sub ? h('small', { text: sub }) : null), h('button', { class: 'sh-x', text: '✕', title: 'Close (Esc)', onclick: close })),
      h('div', { class: 'sh-body' }, ...body.flat())));
    root.querySelector('.sh-card').scrollTop = 0;
  }
  function close() {
    if (root.hidden) return;
    runId += 1;
    root.hidden = true;
    root.replaceChildren();
    const done = ctx?.onClose;
    ctx = null;
    done?.();
  }
  // While open, keys belong to the Study Hall (typing mustn't move the hero).
  addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopImmediatePropagation();
  }, true);

  let aiStatus = null;
  const aiBadge = () => {
    if (!aiStatus) return h('div', { class: 'sh-ai wait' }, h('i'), 'Checking the AI…');
    if (aiStatus.ok) return h('div', { class: 'sh-ai ok' }, h('i'), `AI ready · ${aiStatus.label || 'Claude'}`);
    return h('div', { class: 'sh-ai bad' }, h('i'), aiStatus.reason || 'The AI isn’t available right now.');
  };
  async function checkAI() {
    try { aiStatus = await ctx.status(); } catch { aiStatus = { ok: false, reason: 'Couldn’t check the AI. Check your connection and try again.' }; }
    return aiStatus;
  }
  const friendly = (err) => {
    const msg = err?.message || String(err || '');
    if (!msg || /failed to fetch|networkerror|load failed/i.test(msg)) return 'Couldn’t reach the AI. Check your connection and try again.';
    return msg;
  };
  const bar = (i, n) => h('div', { class: 'sh-progress' }, h('i', { style: `width:${Math.round((i / n) * 100)}%` }));
  let runId = 0; // bumps on cancel/close so a late answer is ignored

  /** A waiting screen with a timer and a way back. Returns { run, stop }. */
  function waiting(title, line, note, back) {
    const run = ++runId;
    const secs = h('p', { class: 'sh-note', text: 'Usually 5 to 30 seconds.' });
    const t0 = Date.now();
    const tick = setInterval(() => { if (run !== runId || !secs.isConnected) return clearInterval(tick); const s = Math.round((Date.now() - t0) / 1000); secs.textContent = s < 35 ? `${s}s · usually 5 to 30 seconds` : `${s}s · still working, long material takes longer`; }, 1000);
    frame(title, null, h('div', { class: 'sh-load' }, h('div', { class: 'sh-spin' }), h('div', { class: 'sh-q', text: line }), note ? h('p', { class: 'sh-note', text: note }) : null,
      h('div', { class: 'sh-indet' }, h('i')), secs, h('div', {}, h('button', { class: 'sh-ghost', text: 'Cancel', onclick: () => { runId += 1; clearInterval(tick); back(); } }))));
    return { live: () => run === runId && !root.hidden, stop: () => clearInterval(tick) };
  }
  function oops(title, err, retry, back, backText = 'Back') {
    frame(title, null, h('div', { class: 'sh-oops' },
      h('p', { class: 'sh-err', text: friendly(err) }),
      h('div', { class: 'sh-row' }, retry ? h('button', { class: 'sh-go', text: 'Try again', onclick: retry }) : null, h('button', { class: 'sh-ghost', text: backText, onclick: back }))));
  }

  // --- home: make a kit, or open one -------------------------------------------------------
  const draft = { tab: 'file', file: null, text: '', url: '' };
  function home() {
    let go, badge;
    const panel = h('div', { class: 'sh-body', style: 'padding:0' });
    const ready = () => (draft.tab === 'file' ? Boolean(draft.file) : draft.tab === 'text' ? draft.text.trim().length >= 80 : /youtu\.?be/.test(draft.url));
    const refreshGo = () => { go.disabled = !ready() || !aiStatus?.ok; };
    const drawPanel = () => {
      if (draft.tab === 'file') {
        const input = h('input', { type: 'file', accept: ACCEPT, hidden: true });
        input.addEventListener('change', () => { draft.file = input.files[0] || null; drawPanel(); refreshGo(); });
        const drop = h('div', { class: 'sh-drop', role: 'button', tabindex: '0', onclick: () => input.click() },
          draft.file ? h('span', { class: 'sh-file', text: `${draft.file.name} · ${draft.file.size < 1048576 ? `${Math.max(1, Math.round(draft.file.size / 1024))} KB` : `${(draft.file.size / 1048576).toFixed(1)} MB`}` }) : h('i', { style: 'font-size:30px;font-style:normal', text: '📤' }),
          h('b', { text: draft.file ? 'Click to choose a different file' : 'Drop a file here, or click to choose' }),
          h('small', { text: 'PDF, Word (.docx), PowerPoint (.pptx), text, or a photo of your notes · up to 20 MB' }), input);
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('over'));
        drop.addEventListener('drop', (e) => { e.preventDefault(); draft.file = e.dataTransfer.files[0] || null; drawPanel(); refreshGo(); });
        panel.replaceChildren(drop);
      } else if (draft.tab === 'text') {
        const box = h('textarea', { class: 'sh-input sh-paste', placeholder: 'Paste your notes, a reading, slide text or a transcript.', maxlength: 60000 });
        box.value = draft.text;
        const count = h('p', { class: 'sh-note' });
        const upd = () => { const n = box.value.trim().length; count.textContent = n < 80 ? `A few sentences at least (${n} characters so far).` : `${n.toLocaleString()} characters.`; };
        box.addEventListener('input', () => { draft.text = box.value; upd(); refreshGo(); });
        upd();
        panel.replaceChildren(box, count);
        setTimeout(() => box.focus(), 0);
      } else {
        const link = h('input', { class: 'sh-input', placeholder: 'Paste a YouTube link, e.g. https://youtu.be/…', value: draft.url, 'aria-label': 'YouTube link' });
        link.addEventListener('input', () => { draft.url = link.value.trim(); refreshGo(); });
        link.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !go.disabled) createKit(); });
        panel.replaceChildren(link, h('p', { class: 'sh-note', text: 'Claude studies from the video’s captions, so lectures and explainers work best.' }));
        setTimeout(() => link.focus(), 0);
      }
    };
    const tabs = h('div', { class: 'sh-src' }, [['file', '📤', 'Upload a file'], ['text', '📋', 'Paste text'], ['video', '🎬', 'Video link']].map(([id, icon, name]) =>
      h('button', { class: draft.tab === id ? 'on' : '', onclick: (e) => { draft.tab = id; for (const b of tabs.children) b.classList.toggle('on', b === e.currentTarget); drawPanel(); refreshGo(); } }, h('i', { text: icon }), name)));
    drawPanel();
    go = h('button', { class: 'sh-go', text: 'Make my study kit', onclick: createKit });
    badge = aiBadge();

    const kits = Object.values(ctx.state.kits || {}).sort((a, b) => (b.opened || b.created) - (a.opened || a.created));
    const due = dueCards(ctx.state);
    const list = kits.length ? [
      h('div', { class: 'sh-step', text: 'Your study kits' }),
      due.length ? h('button', { class: 'sh-go', style: 'justify-self:start', text: `Review ${due.length} due flashcard${due.length === 1 ? '' : 's'}`, onclick: () => reviewCards(due.slice(0, 40), 'Due flashcards', null, home) }) : null,
      h('div', { class: 'sh-kits' }, kits.map((k) => h('button', { class: 'sh-kit', onclick: () => openKit(k.id) },
        h('i', { text: SOURCE_ICON[k.source?.kind] || '📚' }),
        h('div', {}, h('b', { text: k.title }), h('small', { text: `${SOURCE_NAME[k.source?.kind] || 'Notes'}${k.source?.name && k.source.kind !== 'text' ? ` · ${k.source.name}` : ''}` })),
        h('em', { text: kitMade(ctx.state, k) }))))] : [];
    frame('Study Hall', 'Turn your material into a study kit',
      h('p', { class: 'sh-intro', text: 'Bring what you’re studying. Claude turns it into a study kit, then makes flashcards, practice questions or a study guide whenever you ask.' }),
      badge,
      h('div', { class: 'sh-step', text: 'New study kit' }), tabs, panel,
      h('div', { class: 'sh-gobar' }, go, h('p', { class: 'sh-note', text: 'Nothing is made until you pick it inside the kit.' })),
      list);
    refreshGo();
    const opened = ctx;
    checkAI().then(() => { if (ctx !== opened || !badge?.isConnected) return; const next = aiBadge(); badge.replaceWith(next); badge = next; refreshGo(); });
  }

  async function createKit() {
    const tab = draft.tab;
    const label = tab === 'file' ? draft.file?.name : tab === 'video' ? 'that video' : 'your notes';
    const w = waiting('New study kit', tab === 'file' ? `Reading ${label}…` : tab === 'video' ? 'Getting the video’s captions…' : 'Reading your notes…',
      tab === 'file' && /\.(png|jpe?g|webp|gif)$/i.test(draft.file?.name || '') ? 'Claude is reading your photo; handwriting can take a little longer.' : null, home);
    try {
      let src;
      if (tab === 'text') src = { title: 'Pasted notes', text: draft.text.trim().slice(0, 60000), kind: 'text' };
      else src = await ctx.ai.readMaterial(tab === 'file' ? { file: draft.file } : { url: draft.url });
      if (!w.live()) return;
      const sub = root.querySelector('.sh-load .sh-q');
      if (sub) sub.textContent = 'Building your study kit…';
      const info = await ctx.ai.makeKit(src.text, src.title);
      w.stop();
      if (!w.live()) return;
      const kit = addKit(ctx.state, { ...info, source: { kind: src.kind, name: tab === 'file' ? draft.file.name : src.title }, chars: src.text.length, cut: Boolean(src.cut) }, src.text);
      ctx.save();
      Object.assign(draft, { file: null, text: '', url: '' });
      openKit(kit.id);
    } catch (err) {
      w.stop();
      if (!root.hidden) oops('Couldn’t make that kit', err, createKit, home, 'Back');
    }
  }

  // --- a kit: overview, then flashcards / practice questions / study guide on request ------
  function openKit(id) {
    const kit = ctx.state.kits?.[id];
    if (!kit) return home();
    kit.opened = Date.now();
    const text = kitText(kit.id);
    const deck = kit.deckId && ctx.state.decks?.[kit.deckId];
    const due = deck ? dueCards(ctx.state, Date.now(), deck.id).length : 0;
    const part = (icon, name, made, info, buttons) => h('div', { class: `sh-part ${made ? 'made' : ''}` }, h('i', { text: icon }), h('b', { text: name }), h('small', { text: info }), buttons);
    const missing = !text;
    const cards = deck
      ? part('🃏', 'Flashcards', true, `${deck.cards.length} cards${due ? ` · ${due} due now` : ' · none due'}. Cards you miss come back sooner.`, [
        h('button', { class: 'sh-go', text: due ? `Study ${due} due` : 'Study all', onclick: () => reviewCards((due ? dueCards(ctx.state, Date.now(), deck.id) : deck.cards.map((card) => ({ deck, card }))), kit.title, kit, () => openKit(id)) }),
        h('button', { class: 'sh-ghost', text: '+ 12 more cards', disabled: missing, onclick: () => makePart(kit, 'cards') })])
      : part('🃏', 'Flashcards', false, 'A deck that comes back on a schedule, so it sticks.', h('button', { class: 'sh-go', text: 'Make flashcards', disabled: missing, onclick: () => makePart(kit, 'cards') }));
    const quiz = kit.questions?.length
      ? part('❓', 'Practice questions', true, `${kit.questions.length} questions${kit.lastScore ? ` · last time ${kit.lastScore}` : ''}. See why after each answer.`, [
        h('button', { class: 'sh-go', text: 'Take them', onclick: () => runQuiz(kit) }),
        h('button', { class: 'sh-ghost', text: 'New questions', disabled: missing, onclick: () => makePart(kit, 'questions') })])
      : part('❓', 'Practice questions', false, 'Test-style multiple choice. Every right answer earns XP.', h('button', { class: 'sh-go', text: 'Make questions', disabled: missing, onclick: () => makePart(kit, 'questions') }));
    const guide = kit.guide
      ? part('📘', 'Study guide', true, 'The summary, key ideas, terms and what tests like to ask.', [
        h('button', { class: 'sh-go', text: 'Open guide', onclick: () => showGuide(kit) }),
        h('button', { class: 'sh-ghost', text: 'Rewrite it', disabled: missing, onclick: () => makePart(kit, 'guide') })])
      : part('📘', 'Study guide', false, 'A summary with the key ideas, terms and watch-outs.', h('button', { class: 'sh-go', text: 'Make study guide', disabled: missing, onclick: () => makePart(kit, 'guide') }));
    frame(kit.title, `${SOURCE_NAME[kit.source?.kind] || 'Notes'}${kit.source?.name && kit.source.kind !== 'text' ? ` · ${kit.source.name}` : ''}`,
      kit.overview ? h('p', { class: 'sh-intro', text: kit.overview }) : null,
      kit.topics?.length ? h('div', { class: 'sh-topics' }, kit.topics.map((t) => h('span', { text: t }))) : null,
      kit.cut ? h('p', { class: 'sh-note', text: 'This was long, so the kit uses the first part of it.' }) : null,
      missing ? h('p', { class: 'sh-err', text: 'The material for this kit isn’t on this computer any more, so nothing new can be made from it. What’s already made still works.' }) : null,
      h('div', { class: 'sh-step', text: 'What do you want to study with?' }),
      h('div', { class: 'sh-parts' }, cards, quiz, guide),
      h('div', { class: 'sh-row' }, h('button', { class: 'sh-ghost', text: '← All kits', onclick: home }),
        h('button', { class: 'sh-danger', text: 'Delete kit', onclick: () => { if (confirm(`Delete “${kit.title}” and its flashcards?`)) { deleteKit(ctx.state, kit.id); ctx.save(); home(); } } })));
    ctx.save();
  }

  async function makePart(kit, part) {
    const names = { cards: '12 flashcards', questions: '10 practice questions', guide: 'your study guide' };
    const w = waiting(kit.title, `Claude is writing ${names[part]}…`, part === 'guide' ? 'Pulled only from your material.' : 'Straight from your material.', () => openKit(kit.id));
    const deck = kit.deckId && ctx.state.decks?.[kit.deckId];
    const avoid = part === 'cards' ? (deck?.cards || []).map((c) => c.front) : part === 'questions' ? (kit.questions || []).map((q) => q.q) : [];
    try {
      const out = await ctx.ai.makeKitPart(kitText(kit.id), part, { count: part === 'cards' ? 12 : 10, avoid, kitTitle: kit.title });
      w.stop();
      if (!w.live()) return;
      if (part === 'cards') {
        if (deck) addCards(ctx.state, deck.id, out.cards);
        else kit.deckId = addDeck(ctx.state, { title: kit.title, cards: out.cards }).id;
        ctx.save();
        const d = ctx.state.decks[kit.deckId];
        const fresh = d.cards.slice(-out.cards.length).map((card) => ({ deck: d, card }));
        reviewCards(fresh, kit.title, kit, () => openKit(kit.id));
      } else if (part === 'questions') {
        kit.questions = out.questions;
        kit.lastScore = '';
        ctx.save();
        runQuiz(kit);
      } else {
        kit.guide = out;
        ctx.save();
        showGuide(kit);
      }
    } catch (err) {
      w.stop();
      if (!root.hidden) oops('Couldn’t make that', err, () => makePart(kit, part), () => openKit(kit.id), 'Back to the kit');
    }
  }

  function showGuide(kit) {
    const g = kit.guide;
    frame(kit.title, 'Study guide', h('div', { class: 'sh-guide' },
      g.summary ? h('p', { class: 'sh-why', text: g.summary }) : null,
      g.sections.map((s) => [h('h3', { text: s.heading }), h('ul', {}, s.points.map((p) => h('li', { text: p })))]),
      g.terms?.length ? [h('h3', { text: 'Key terms' }), h('dl', {}, g.terms.map((t) => [h('dt', { text: t.term }), h('dd', { text: t.def })]))] : null,
      g.watch?.length ? [h('h3', { text: 'Watch out for' }), h('ul', {}, g.watch.map((p) => h('li', { text: p })))] : null),
    h('div', { class: 'sh-row' }, h('button', { class: 'sh-go', text: '← Back to the kit', onclick: () => openKit(kit.id) })));
  }

  // --- practice questions ---------------------------------------------------------------------
  function runQuiz(kit) {
    const list = kit.questions;
    const source = { topic: kit.title };
    let i = 0, right = 0, wrong = 0;
    const show = () => {
      const q = list[i];
      let answered = false;
      const why = h('div');
      const next = h('button', { class: 'sh-go', text: i + 1 < list.length ? 'Next' : 'Finish', hidden: true, onclick: () => { i += 1; if (i < list.length) show(); else finish(); } });
      const choices = h('div', { class: 'sh-choices' }, q.choices.map((c, k) => h('button', { class: 'sh-choice', text: `${'ABCD'[k]}. ${c}`, onclick: (e) => {
        if (answered) return;
        answered = true;
        const ok = k === q.answer;
        if (ok) right += 1; else wrong += 1;
        e.currentTarget.classList.add(ok ? 'right' : 'wrong');
        choices.children[q.answer].classList.add('right');
        why.replaceChildren(h('div', { class: 'sh-why', text: `${ok ? 'Right. ' : 'Not quite. '}${q.why || ''}` }));
        next.hidden = false;
        ctx.onAnswer?.(source, q, ok);
      } })));
      frame(kit.title, `Question ${i + 1} of ${list.length} · ${right} right`, bar(i, list.length), h('div', { class: 'sh-q', text: q.q }), choices, why, next);
      keyHandler = (e) => { if (!answered && '1234'.includes(e.key)) choices.children[Number(e.key) - 1]?.click(); else if (answered && e.key === 'Enter') next.click(); };
    };
    const finish = () => {
      kit.lastScore = `${right}/${right + wrong}`;
      ctx.save();
      results(`${right} of ${right + wrong} right`, [ctx.reward({ ...source, right, wrong }), wrong ? 'Make new questions any time from the kit, or take these again.' : 'A perfect round.'].filter(Boolean), kit);
    };
    show();
  }
  function results(title, lines, kit) {
    frame(title, null, ...lines.map((t) => h('p', { class: 'sh-why', text: t })), h('div', { class: 'sh-row' },
      kit ? h('button', { class: 'sh-go', text: '← Back to the kit', onclick: () => openKit(kit.id) }) : h('button', { class: 'sh-go', text: '← Study Hall', onclick: home }),
      h('button', { class: 'sh-ghost', text: 'Done', onclick: close })));
  }

  // --- flashcards -----------------------------------------------------------------------------
  function reviewCards(list, title, kit, back) {
    if (!list.length) return results('Nothing due', ['All caught up on these cards. Come back tomorrow, or add more.'], kit);
    let i = 0, good = 0, again = 0;
    const queue = [...list];
    const show = () => {
      const { deck, card } = queue[i];
      let flipped = false;
      const face = h('div', { class: 'sh-flip', onclick: () => flip() }, h('small', { text: 'Front · tap to flip' }), card.front);
      const rate = h('div', { class: 'sh-rate', hidden: true },
        h('button', { class: 'again', text: 'Again', onclick: () => grade('again') }),
        h('button', { class: 'good', text: 'Good', onclick: () => grade('good') }),
        h('button', { class: 'easy', text: 'Easy', onclick: () => grade('easy') }));
      const flip = () => { flipped = !flipped; face.className = `sh-flip ${flipped ? 'back' : ''}`; face.replaceChildren(h('small', { text: flipped ? 'Back' : 'Front · tap to flip' }), flipped ? card.back : card.front); rate.hidden = !flipped; };
      const grade = (g) => {
        rateCard(ctx.state, deck.id, card.id, g);
        if (g === 'again') { again += 1; queue.push(queue[i]); } else good += 1;
        i += 1;
        if (i < queue.length && i < list.length * 2) show(); else finish();
      };
      frame(title, `Card ${Math.min(i + 1, queue.length)} of ${queue.length}`, bar(i, queue.length), face, rate,
        h('div', { class: 'sh-row' }, h('p', { class: 'sh-note', style: 'flex:1', text: 'Space flips · 1 Again · 2 Good · 3 Easy' }), h('button', { class: 'sh-ghost', text: 'Stop', onclick: () => { ctx.save(); back(); } })));
      keyHandler = (e) => { if (e.key === ' ') { e.preventDefault(); flip(); } else if (flipped && '123'.includes(e.key)) grade(['again', 'good', 'easy'][Number(e.key) - 1]); };
    };
    const finish = () => {
      ctx.save();
      results(`${good} card${good === 1 ? '' : 's'} remembered`, [ctx.reward({ topic: kit?.title || null, right: good, wrong: again, cards: true }), 'Cards you knew come back in a few days; the ones you didn’t, sooner.'].filter(Boolean), kit);
    };
    show();
  }
  let keyHandler = null;
  addEventListener('keydown', (e) => { if (!root.hidden && keyHandler && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) keyHandler(e); });

  return {
    isOpen: () => !root.hidden,
    open(context, prefill = {}) {
      ctx = context;
      root.hidden = false;
      void prefill;
      home();
    },
    close,
  };
}
