import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Flashcard, FlashcardDeck,
  loadDecks, saveDeck, deleteDeck, newCard, newDeck,
  FLASHCARDS_EVENT,
} from '../../lib/flashcards';
import { Subject } from '../../types';
import { storage } from '../../lib/storage';
import { knowledgeStrike } from '../../lib/bosses';
import styles from './Flashcards.module.css';

type View =
  | { name: 'list' }
  | { name: 'edit'; deck: FlashcardDeck }
  | { name: 'study'; deckId: string };

export default function FlashcardsMode({ subjects, initialStudyId }: { subjects: Subject[]; initialStudyId?: string }) {
  const [decks, setDecks] = useState<FlashcardDeck[]>(loadDecks);
  const [view, setView] = useState<View>(
    initialStudyId && loadDecks().some((d) => d.id === initialStudyId)
      ? { name: 'study', deckId: initialStudyId }
      : { name: 'list' },
  );

  // Jump to study mode when initialStudyId changes (e.g. clicked from Library).
  useEffect(() => {
    if (initialStudyId && loadDecks().some((d) => d.id === initialStudyId)) {
      setView({ name: 'study', deckId: initialStudyId });
    }
  }, [initialStudyId]);

  // Keep in sync if decks change elsewhere (e.g. another tab/component).
  useEffect(() => {
    const refresh = () => setDecks(loadDecks());
    window.addEventListener(FLASHCARDS_EVENT, refresh);
    return () => window.removeEventListener(FLASHCARDS_EVENT, refresh);
  }, []);

  if (view.name === 'edit') {
    return (
      <DeckEditor
        deck={view.deck}
        subjects={subjects}
        onDone={() => setView({ name: 'list' })}
        onStudy={(id) => setView({ name: 'study', deckId: id })}
      />
    );
  }

  if (view.name === 'study') {
    const deck = decks.find((d) => d.id === view.deckId);
    if (!deck) return null;
    return <StudyView deck={deck} onExit={() => setView({ name: 'list' })} />;
  }

  return (
    <DeckList
      decks={decks}
      subjects={subjects}
      onCreate={() => setView({ name: 'edit', deck: newDeck() })}
      onEdit={(deck) => setView({ name: 'edit', deck })}
      onStudy={(id) => setView({ name: 'study', deckId: id })}
    />
  );
}

// ── Deck list ─────────────────────────────────────────────────────────────────

function DeckList({ decks, subjects, onCreate, onEdit, onStudy }: {
  decks: FlashcardDeck[];
  subjects: Subject[];
  onCreate: () => void;
  onEdit: (deck: FlashcardDeck) => void;
  onStudy: (id: string) => void;
}) {
  function subjectName(id?: string) {
    return id ? subjects.find((s) => s.id === id)?.name : undefined;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.listHeader}>
        <span className={styles.stepLabel}>Your decks</span>
        <button className={styles.primaryBtn} onClick={onCreate}>+ New deck</button>
      </div>

      {decks.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No flashcard decks yet</p>
          <p className={styles.emptyText}>
            Build a deck of cards and study it right here in Soma — no AI, no Google Doc.
          </p>
          <button className={styles.primaryBtn} onClick={onCreate}>Create your first deck</button>
        </div>
      ) : (
        <div className={styles.deckGrid}>
          {decks.map((deck) => {
            const name = subjectName(deck.subjectId);
            return (
              <div key={deck.id} className={styles.deckCard}>
                <button className={styles.deckMain} onClick={() => onStudy(deck.id)}>
                  <span className={styles.deckTitle}>{deck.title || 'Untitled deck'}</span>
                  <span className={styles.deckMeta}>
                    {deck.cards.length} card{deck.cards.length === 1 ? '' : 's'}
                    {name ? ` · ${name}` : ''}
                  </span>
                </button>
                <div className={styles.deckActions}>
                  <button className={styles.studyBtn} onClick={() => onStudy(deck.id)}>Study</button>
                  <button className={styles.ghostBtn} onClick={() => onEdit(deck)}>Edit</button>
                  <button
                    className={styles.ghostBtn}
                    onClick={() => { if (confirm('Delete this deck?')) deleteDeck(deck.id); }}
                  >Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Deck editor ─────────────────────────────────────────────────────────────

function DeckEditor({ deck: initial, subjects, onDone, onStudy }: {
  deck: FlashcardDeck;
  subjects: Subject[];
  onDone: () => void;
  onStudy: (id: string) => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [subjectId, setSubjectId] = useState(initial.subjectId ?? '');
  const [cards, setCards] = useState<Flashcard[]>(initial.cards.length ? initial.cards : [newCard()]);

  function updateCard(id: string, field: 'front' | 'back', value: string) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  }
  function addCard() { setCards((prev) => [...prev, newCard()]); }
  function removeCard(id: string) {
    setCards((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== id) : prev));
  }

  const filled = cards.filter((c) => c.front.trim() || c.back.trim());
  const canSave = title.trim().length > 0 && filled.length > 0;

  function build(): FlashcardDeck {
    return {
      ...initial,
      title: title.trim(),
      subjectId: subjectId || undefined,
      cards: filled.map((c) => ({ ...c, front: c.front.trim(), back: c.back.trim() })),
      updatedAt: new Date().toISOString(),
    };
  }

  function handleSave() {
    if (!canSave) return;
    saveDeck(build());
    onDone();
  }

  function handleSaveAndStudy() {
    if (!canSave) return;
    const d = build();
    saveDeck(d);
    onStudy(d.id);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.listHeader}>
        <button className={styles.backBtn} onClick={onDone}>← Back</button>
        <span className={styles.stepLabel}>{initial.title ? 'Edit deck' : 'New deck'}</span>
      </div>

      <div className={styles.editorTop}>
        <input
          className={styles.input}
          placeholder="Deck title — e.g. Bio Ch. 4 vocab"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        {subjects.length > 0 && (
          <select
            className={styles.input}
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
          >
            <option value="">No subject</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      <div className={styles.cardEditList}>
        {cards.map((card, i) => (
          <div key={card.id} className={styles.cardEditRow}>
            <span className={styles.cardNum}>{i + 1}</span>
            <textarea
              className={styles.cardField}
              placeholder="Front (question / term)"
              value={card.front}
              onChange={(e) => updateCard(card.id, 'front', e.target.value)}
              rows={2}
            />
            <textarea
              className={styles.cardField}
              placeholder="Back (answer / definition)"
              value={card.back}
              onChange={(e) => updateCard(card.id, 'back', e.target.value)}
              rows={2}
            />
            <button
              className={styles.removeCardBtn}
              onClick={() => removeCard(card.id)}
              disabled={cards.length === 1}
              aria-label="Remove card"
            >×</button>
          </div>
        ))}
      </div>

      <button className={styles.addCardBtn} onClick={addCard}>+ Add card</button>

      <div className={styles.editorActions}>
        <button className={styles.primaryBtn} onClick={handleSaveAndStudy} disabled={!canSave}>
          Save & study
        </button>
        <button className={styles.secondaryBtn} onClick={handleSave} disabled={!canSave}>
          Save
        </button>
      </div>
    </div>
  );
}

// ── Study view (in-app flip-through) ───────────────────────────────────────────

function StudyView({ deck, onExit }: { deck: FlashcardDeck; onExit: () => void }) {
  // `order` holds the card indices for this round; a "review missed" round
  // narrows it to the cards the user didn't know — lightweight spaced repetition.
  const [order, setOrder] = useState<number[]>(() => deck.cards.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<Record<number, 'known' | 'missed'>>({});
  const [done, setDone] = useState(false);

  const card = useMemo(() => deck.cards[order[pos]], [deck.cards, order, pos]);
  const knownCount = Object.values(results).filter((r) => r === 'known').length;
  const missedIdx = order.filter((i) => results[i] === 'missed');

  function startRound(indices: number[]) {
    setOrder(indices);
    setResults({});
    setPos(0);
    setFlipped(false);
    setDone(false);
  }
  function shuffle() {
    const s = [...order];
    for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; }
    startRound(s);
  }
  function grade(verdict: 'known' | 'missed') {
    setResults((prev) => ({ ...prev, [order[pos]]: verdict }));
    if (pos >= order.length - 1) setDone(true);
    else { setPos((p) => p + 1); setFlipped(false); }
  }
  function back() { if (pos > 0) { setPos((p) => p - 1); setFlipped(false); } }

  // Knowledge strike: finishing a study round bursts the matching boss once.
  const struckRef = useRef(false);
  useEffect(() => {
    if (done && !struckRef.current && deck.subjectId) {
      struckRef.current = true;
      knowledgeStrike(deck.subjectId, storage.getCachedAssignments(), 10 + knownCount * 2);
    }
  }, [done, deck.subjectId, knownCount]);

  // Keyboard: Space/Enter flips; once flipped, ←/→ grade missed/known.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (done) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlipped((f) => !f); }
      else if (flipped && e.key === 'ArrowRight') { e.preventDefault(); grade('known'); }
      else if (flipped && e.key === 'ArrowLeft') { e.preventDefault(); grade('missed'); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flipped, done, pos, order]); // eslint-disable-line react-hooks/exhaustive-deps

  if (done) {
    const pct = Math.round((knownCount / order.length) * 100);
    return (
      <div className={styles.wrap}>
        <div className={styles.listHeader}>
          <button className={styles.backBtn} onClick={onExit}>← Decks</button>
          <span className={styles.stepLabel}>{deck.title || 'Untitled deck'}</span>
        </div>
        <div className={styles.results}>
          <span className={styles.resultsScore}>{knownCount}/{order.length}</span>
          <span className={styles.resultsLbl}>{pct}% known this round</span>
          <div className={styles.resultsActions}>
            {missedIdx.length > 0 && (
              <button className={styles.primaryBtn} onClick={() => startRound(missedIdx)}>
                Review {missedIdx.length} missed
              </button>
            )}
            <button className={styles.secondaryBtn} onClick={() => startRound(deck.cards.map((_, i) => i))}>
              Restart all
            </button>
            <button className={styles.ghostBtn} onClick={onExit}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.listHeader}>
        <button className={styles.backBtn} onClick={onExit}>← Decks</button>
        <span className={styles.stepLabel}>{deck.title || 'Untitled deck'}</span>
        <button className={styles.ghostBtn} onClick={shuffle}>Shuffle</button>
      </div>

      <div className={styles.studyProgress}>
        Card {pos + 1} of {order.length}
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${((pos + 1) / order.length) * 100}%` }} />
        </div>
      </div>

      <button
        className={`${styles.studyCard}${flipped ? ` ${styles.studyCardFlipped}` : ''}`}
        onClick={() => setFlipped((f) => !f)}
        aria-live="polite"
      >
        <span className={styles.studyFace}>{flipped ? 'BACK' : 'FRONT'}</span>
        <span key={`${pos}-${flipped}`} className={styles.studyText}>{(flipped ? card?.back : card?.front) || '—'}</span>
        <span className={styles.flipHint}>Click or press Space to flip</span>
      </button>

      <div className={styles.studyActions}>
        <div className={`${styles.studyNav}${flipped ? ` ${styles.hidden}` : ''}`}>
          <button className={styles.secondaryBtn} onClick={back} disabled={pos === 0} tabIndex={flipped ? -1 : 0}>← Prev</button>
          <button className={styles.primaryBtn} onClick={() => setFlipped(true)} tabIndex={flipped ? -1 : 0}>Show answer</button>
        </div>
        <div className={`${styles.gradeRow}${!flipped ? ` ${styles.hidden}` : ''}`}>
          <button className={styles.missBtn} onClick={() => grade('missed')} tabIndex={!flipped ? -1 : 0}>Review again</button>
          <button className={styles.knowBtn} onClick={() => grade('known')} tabIndex={!flipped ? -1 : 0}>Got it</button>
        </div>
      </div>
    </div>
  );
}
