// The Study Hall: real studying, built around what the student wants to study.
// 1. What: an upcoming Canvas item, a whole course, or any topic they type,
//    plus their own notes if they paste some (Soma notes are added on the server side).
// 2. How: a quiz, flashcards, explain-it (Claude grades a written answer) or
//    practice problems with worked steps. How many, how hard.
// 3. Flashcards become decks that come back on a spaced schedule (Leitner boxes).
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
@media (max-width: 640px) { .sh-modes { grid-template-columns: repeat(2, 1fr); } }
`;

const MODES = [
  { id: 'quiz', icon: '❓', name: 'Quiz', hint: 'Multiple choice' },
  { id: 'cards', icon: '🃏', name: 'Flashcards', hint: 'Saved, spaced review' },
  { id: 'explain', icon: '✍️', name: 'Explain it', hint: 'Write it, get graded' },
  { id: 'problems', icon: '🧮', name: 'Problems', hint: 'Worked steps' },
];

/**
 * Opens the Study Hall. ctx: {
 *   state, save(), upcoming: [{ id, name, courseName, kind, due }], courses: [{ id, name }],
 *   ai: { makeStudySet, gradeExplain }, status(): { ok, reason },
 *   reward({ item, right, wrong, minutes }) -> string (a line for the results screen),
 *   onClose()
 * } prefill: { itemId, topic, mode }
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
    for (const k of kids.flat()) if (k != null) n.append(k);
    return n;
  };
  function frame(title, sub, ...body) {
    root.replaceChildren(h('div', { class: 'sh-card' },
      h('div', { class: 'sh-head' }, h('div', {}, h('h2', { text: title }), sub ? h('small', { text: sub }) : null), h('button', { class: 'sh-x', text: '✕', title: 'Close (Esc)', onclick: close })),
      h('div', { class: 'sh-body' }, ...body)));
  }
  function close() {
    if (root.hidden) return;
    root.hidden = true;
    root.replaceChildren();
    const done = ctx?.onClose;
    ctx = null;
    done?.();
  }
  // While open, keys belong to the Study Hall (typing answers mustn't move the hero).
  addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopImmediatePropagation();
  }, true);

  // --- 1 + 2: what and how --------------------------------------------------------------
  function pickScreen(prefill = {}) {
    const pick = { source: prefill.topic ? 'topic' : prefill.itemId ? 'item' : ctx.upcoming.length ? 'item' : 'topic', itemId: prefill.itemId || ctx.upcoming[0]?.id || null, courseId: ctx.courses[0]?.id || null, topic: prefill.topic || '', notes: '', mode: prefill.mode || 'quiz', count: 8, level: 'mixed' };
    const status = ctx.status();
    const what = h('div');
    const draw = () => {
      const tabs = h('div', { class: 'sh-tabs' }, [['item', 'Something due'], ['course', 'A course'], ['topic', 'My own topic']].map(([id, name]) => h('button', { class: `sh-tab ${pick.source === id ? 'on' : ''}`, text: name, onclick: () => { pick.source = id; draw(); } })));
      let chooser;
      if (pick.source === 'item') chooser = ctx.upcoming.length
        ? h('div', { class: 'sh-list' }, ctx.upcoming.map((a) => h('button', { class: `sh-pick ${pick.itemId === a.id ? 'on' : ''}`, onclick: () => { pick.itemId = a.id; draw(); } }, h('b', { text: a.name }), h('small', { text: `${a.kind === 'boss' ? 'Exam' : 'Assignment'} · ${a.courseName}${a.due ? ` · ${a.due}` : ''}` }))))
        : h('p', { class: 'sh-note', text: 'Nothing coming up from Canvas. Pick a course or type your own topic.' });
      else if (pick.source === 'course') chooser = ctx.courses.length
        ? h('div', { class: 'sh-tabs' }, ctx.courses.map((c) => h('button', { class: `sh-chip ${pick.courseId === c.id ? 'on' : ''}`, text: c.name, onclick: () => { pick.courseId = c.id; draw(); } })))
        : h('p', { class: 'sh-note', text: 'No courses yet. Type your own topic instead.' });
      else {
        chooser = h('input', { class: 'sh-input', placeholder: 'e.g. eigenvectors, the Krebs cycle, Chapter 5 of Hamlet', value: pick.topic, maxlength: 140 });
        chooser.addEventListener('input', () => { pick.topic = chooser.value; go.disabled = !ready(); });
        setTimeout(() => chooser.focus(), 0);
      }
      const notes = h('textarea', { class: 'sh-notes', placeholder: 'Optional: paste your notes, a study guide or lecture slides text. Questions will come from these.', maxlength: 9000 });
      notes.value = pick.notes;
      notes.addEventListener('input', () => { pick.notes = notes.value; });
      const modes = h('div', { class: 'sh-modes' }, MODES.map((m) => h('button', { class: `sh-mode ${pick.mode === m.id ? 'on' : ''}`, onclick: () => { pick.mode = m.id; draw(); } }, h('i', { text: m.icon }), h('b', { text: m.name }), h('small', { text: m.hint }))));
      const chips = (label, key, vals) => h('div', { class: 'sh-row' }, h('span', { text: label }), vals.map(([v, t]) => h('button', { class: `sh-chip ${pick[key] === v ? 'on' : ''}`, text: t, onclick: () => { pick[key] = v; draw(); } })));
      const go = h('button', { class: 'sh-go', text: 'Start', onclick: () => start(pick) });
      go.disabled = !ready() || !status.ok;
      what.replaceChildren(...[
        h('div', { class: 'sh-step', text: '1 · What do you want to study?' }), tabs, chooser, notes,
        h('div', { class: 'sh-step', text: '2 · How?' }), modes,
        chips('How many', 'count', [[5, '5'], [8, '8'], [12, '12'], [20, '20']]),
        chips('Level', 'level', [['easy', 'Easy'], ['mixed', 'Mixed'], ['hard', 'Hard']]),
        status.ok ? null : h('p', { class: 'sh-err', text: status.reason }),
        go,
      ].filter(Boolean));
    };
    const ready = () => (pick.source === 'item' ? Boolean(pick.itemId) : pick.source === 'course' ? Boolean(pick.courseId) : pick.topic.trim().length >= 2);
    draw();
    const due = dueCards(ctx.state);
    const decks = Object.values(ctx.state.decks || {}).sort((a, b) => b.created - a.created);
    const deckList = decks.length ? h('div', {},
      h('div', { class: 'sh-step', text: `Your flashcard decks${due.length ? ` · ${due.length} due` : ''}` }),
      due.length ? h('button', { class: 'sh-go', style: 'margin:8px 0', text: `Review ${due.length} due card${due.length === 1 ? '' : 's'}`, onclick: () => reviewCards(due.slice(0, 40), 'Review') }) : null,
      h('div', { class: 'sh-decks' }, decks.slice(0, 8).map((d) => {
        const n = dueCards(ctx.state, Date.now(), d.id).length;
        return h('div', { class: 'sh-deck' }, h('b', { text: d.title }), h('em', { text: `${d.cards.length} cards${n ? ` · ${n} due` : ''}` }),
          h('button', { class: 'sh-ghost', text: 'Study', onclick: () => reviewCards(d.cards.map((card) => ({ deck: d, card })), d.title) }),
          h('button', { class: 'sh-ghost', text: '🗑', title: 'Delete deck', onclick: () => { deleteDeck(ctx.state, d.id); ctx.save(); pickScreen(pick); } }));
      }))) : null;
    frame('Study Hall', 'Real studying, on what you choose. Every right answer powers up your hero.', what, deckList);
  }

  // --- generating ---------------------------------------------------------------------------
  async function start(pick) {
    const item = pick.source === 'item' ? ctx.upcoming.find((a) => a.id === pick.itemId) : null;
    const course = pick.source === 'course' ? ctx.courses.find((c) => c.id === pick.courseId)?.name : item?.courseName || '';
    const what = { topic: pick.source === 'topic' ? pick.topic.trim() : '', course, item: item ? { name: item.name, courseName: item.courseName, courseId: item.courseId } : null, notes: pick.notes };
    frame('Study Hall', 'Writing your set…', h('p', { class: 'sh-note', text: `Claude is reading ${pick.notes.trim() ? 'your notes' : 'your course notes'} and writing ${pick.count} ${MODES.find((m) => m.id === pick.mode).name.toLowerCase()}. This takes a few seconds.` }), h('div', { class: 'sh-progress' }, h('i', { style: 'width:35%' })));
    try {
      const set = await ctx.ai.makeStudySet(what, pick.mode, pick.count, pick.level);
      if (root.hidden) return;
      const source = { item: item || null, course, topic: what.topic };
      if (pick.mode === 'quiz') runQuiz(set, source, pick);
      else if (pick.mode === 'cards') {
        const deck = addDeck(ctx.state, { title: set.title, course, itemId: item?.id || null, cards: set.cards });
        ctx.save();
        reviewCards(deck.cards.map((card) => ({ deck, card })), set.title, source);
      } else if (pick.mode === 'explain') runExplain(set, source, pick);
      else runProblems(set, source, pick);
    } catch (err) {
      if (root.hidden) return;
      frame('Study Hall', 'That didn’t work', h('p', { class: 'sh-err', text: err.message || String(err) }), h('div', { class: 'sh-row' }, h('button', { class: 'sh-go', text: 'Try again', onclick: () => start(pick) }), h('button', { class: 'sh-ghost', text: 'Back', onclick: () => pickScreen(pick) })));
    }
  }
  const bar = (i, n) => h('div', { class: 'sh-progress' }, h('i', { style: `width:${Math.round((i / n) * 100)}%` }));
  function results(title, lines, pick, extra = null) {
    frame(title, null, ...lines.map((t) => h('p', { class: 'sh-why', text: t })), extra, h('div', { class: 'sh-row' },
      pick ? h('button', { class: 'sh-go', text: 'Another round', onclick: () => start(pick) }) : null,
      h('button', { class: 'sh-ghost', text: 'Study something else', onclick: () => pickScreen(pick || {}) }),
      h('button', { class: 'sh-ghost', text: 'Done', onclick: close })));
  }

  // --- quiz ---------------------------------------------------------------------------------
  function runQuiz(set, source, pick) {
    let i = 0, right = 0, wrong = 0;
    const missed = [];
    const show = () => {
      const q = set.questions[i];
      let answered = false;
      const why = h('div');
      const next = h('button', { class: 'sh-go', text: i + 1 < set.questions.length ? 'Next' : 'Finish', hidden: true, onclick: () => { i += 1; if (i < set.questions.length) show(); else finish(); } });
      const choices = h('div', { class: 'sh-choices' }, q.choices.map((c, k) => h('button', { class: 'sh-choice', text: `${'ABCD'[k]}. ${c}`, onclick: (e) => {
        if (answered) return;
        answered = true;
        const ok = k === q.answer;
        if (ok) right += 1; else { wrong += 1; missed.push(q); }
        e.currentTarget.classList.add(ok ? 'right' : 'wrong');
        choices.children[q.answer].classList.add('right');
        why.replaceChildren(h('div', { class: 'sh-why', text: `${ok ? 'Right. ' : 'Not quite. '}${q.why || ''}` }));
        next.hidden = false;
        ctx.onAnswer?.(source, q, ok);
      } })));
      frame(set.title, `Question ${i + 1} of ${set.questions.length} · ${right} right`, bar(i, set.questions.length), h('div', { class: 'sh-q', text: q.q }), choices, why, next);
    };
    const finish = () => results(`${right} of ${right + wrong} right`, [ctx.reward({ ...source, right, wrong }), missed.length ? `The ${missed.length} you missed come back for review.` : 'A perfect round.'].filter(Boolean), pick);
    show();
  }

  // --- flashcards ---------------------------------------------------------------------------
  function reviewCards(list, title, source = null) {
    if (!list.length) return results('Nothing due', ['All caught up on these cards. Come back tomorrow, or make a new deck.'], null);
    let i = 0, good = 0, again = 0;
    const queue = [...list];
    const show = () => {
      const { deck, card } = queue[i];
      let back = false;
      const face = h('div', { class: 'sh-flip', onclick: () => flip() }, h('small', { text: 'Front · tap to flip' }), card.front);
      const rate = h('div', { class: 'sh-rate', hidden: true },
        h('button', { class: 'again', text: 'Again', onclick: () => grade('again') }),
        h('button', { class: 'good', text: 'Good', onclick: () => grade('good') }),
        h('button', { class: 'easy', text: 'Easy', onclick: () => grade('easy') }));
      const flip = () => { back = !back; face.className = `sh-flip ${back ? 'back' : ''}`; face.replaceChildren(h('small', { text: back ? 'Back' : 'Front · tap to flip' }), back ? card.back : card.front); rate.hidden = !back; };
      const grade = (g) => {
        rateCard(ctx.state, deck.id, card.id, g);
        if (g === 'again') { again += 1; queue.push(queue[i]); } else good += 1;
        i += 1;
        if (i < queue.length && i < list.length * 2) show(); else finish();
      };
      frame(title, `Card ${Math.min(i + 1, queue.length)} of ${queue.length} · ${deck.title}`, bar(i, queue.length), face, rate, h('p', { class: 'sh-note', text: 'Space flips · 1 Again · 2 Good · 3 Easy' }));
      keyHandler = (e) => { if (e.key === ' ') { e.preventDefault(); flip(); } else if (back && '123'.includes(e.key)) grade(['again', 'good', 'easy'][Number(e.key) - 1]); };
    };
    const finish = () => {
      keyHandler = null;
      ctx.save();
      results(`${good} card${good === 1 ? '' : 's'} remembered`, [ctx.reward({ ...(source || {}), right: good, wrong: again, cards: true }), 'Cards you knew come back in a few days; the ones you didn’t, sooner. Find them under "Your flashcard decks".'].filter(Boolean), null);
    };
    show();
  }
  let keyHandler = null;
  addEventListener('keydown', (e) => { if (!root.hidden && keyHandler && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) keyHandler(e); });

  // --- explain it -------------------------------------------------------------------------
  function runExplain(set, source, pick) {
    let i = 0, total = 0;
    const show = () => {
      const p = set.prompts[i];
      const box = h('textarea', { class: 'sh-answer', placeholder: 'Explain it in your own words, like you’re teaching a friend.' });
      const out = h('div');
      const submit = h('button', { class: 'sh-go', text: 'Check my answer', onclick: async () => {
        if (box.value.trim().length < 15) return void out.replaceChildren(h('p', { class: 'sh-err', text: 'Write a bit more first, a few sentences at least.' }));
        submit.disabled = true; submit.textContent = 'Claude is reading it…';
        try {
          const g = await ctx.ai.gradeExplain(p, box.value);
          total += g.score;
          ctx.onAnswer?.(source, { q: p.q, choices: [], answer: 0, why: p.points.join(' · ') }, g.score >= 70);
          out.replaceChildren(h('div', { class: 'sh-score', text: `${g.score}/100` }),
            g.got.length ? h('ul', { class: 'sh-got' }, g.got.map((t) => h('li', { text: t }))) : null,
            g.missed.length ? h('ul', { class: 'sh-missed' }, g.missed.map((t) => h('li', { text: t }))) : null,
            g.tip ? h('p', { class: 'sh-why', text: g.tip }) : null,
            h('button', { class: 'sh-go', text: i + 1 < set.prompts.length ? 'Next question' : 'Finish', onclick: () => { i += 1; if (i < set.prompts.length) show(); else finish(); } }));
          submit.remove();
        } catch (err) { submit.disabled = false; submit.textContent = 'Check my answer'; out.replaceChildren(h('p', { class: 'sh-err', text: err.message })); }
      } });
      frame(set.title, `Question ${i + 1} of ${set.prompts.length}`, bar(i, set.prompts.length), h('div', { class: 'sh-q', text: p.q }), box, submit, out);
      setTimeout(() => box.focus(), 0);
    };
    const finish = () => {
      const avg = Math.round(total / set.prompts.length);
      const right = Math.round((avg / 100) * set.prompts.length);
      results(`Average ${avg}/100`, [ctx.reward({ ...source, right, wrong: set.prompts.length - right, written: true })], pick);
    };
    show();
  }

  // --- practice problems ----------------------------------------------------------------
  function runProblems(set, source, pick) {
    let i = 0, right = 0, wrong = 0;
    const show = () => {
      const p = set.problems[i];
      const work = h('textarea', { class: 'sh-answer', placeholder: 'Work it out here (optional), then reveal the solution.' });
      const sol = h('div');
      const reveal = h('button', { class: 'sh-go', text: 'Show solution', onclick: () => {
        reveal.remove();
        sol.replaceChildren(h('div', { class: 'sh-step', text: 'Solution' }), h('ol', { class: 'sh-steps' }, p.steps.map((s) => h('li', { text: s }))), h('div', { class: 'sh-why', text: `Answer: ${p.answer}` }),
          h('div', { class: 'sh-row' }, h('span', { text: 'Did you get it?' }),
            h('button', { class: 'sh-chip', text: 'Got it', onclick: () => next(true) }),
            h('button', { class: 'sh-chip', text: 'Not this time', onclick: () => next(false) })));
      } });
      const next = (ok) => { if (ok) right += 1; else wrong += 1; ctx.onAnswer?.(source, { q: p.q, choices: [], answer: 0, why: `${p.steps.join(' ')} Answer: ${p.answer}` }, ok); i += 1; if (i < set.problems.length) show(); else results(`${right} of ${right + wrong} solved`, [ctx.reward({ ...source, right, wrong })], pick); };
      frame(set.title, `Problem ${i + 1} of ${set.problems.length}`, bar(i, set.problems.length), h('div', { class: 'sh-q', text: p.q }), work, reveal, sol);
    };
    show();
  }

  return {
    isOpen: () => !root.hidden,
    open(context, prefill = {}) {
      ctx = context;
      root.hidden = false;
      pickScreen(prefill);
    },
    close,
  };
}
