import { useEffect, useMemo, useState } from 'react';
import {
  Flashcard, FlashcardDeck,
  loadDecks, saveDeck, deleteDeck, newCard, newDeck,
  FLASHCARDS_EVENT,
} from '../../lib/flashcards';
import { Subject } from '../../types';
import styles from './Flashcards.module.css';

type View =
  | { name: 'list' }
  | { name: 'edit'; deck: FlashcardDeck }
  | { name: 'study'; deckId: string };

export default function FlashcardsMode({ subjects }: { subjects: Subject[] }) {
  const [decks, setDecks] = useState<FlashcardDeck[]>(loadDecks);
  const [view, setView] = useState<View>({ name: 'list' });

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
  const [order, setOrder] = useState<number[]>(() => deck.cards.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const card = useMemo(() => deck.cards[order[pos]], [deck.cards, order, pos]);
  const atEnd = pos >= order.length - 1;
  const atStart = pos <= 0;

  function go(delta: number) {
    setFlipped(false);
    setPos((p) => Math.min(order.length - 1, Math.max(0, p + delta)));
  }
  function shuffle() {
    const shuffled = [...order];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setOrder(shuffled);
    setPos(0);
    setFlipped(false);
  }
  function restart() { setPos(0); setFlipped(false); }

  // Keyboard: Space/Enter flips, arrows navigate.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlipped((f) => !f); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [order.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <div
            className={styles.progressFill}
            style={{ width: `${((pos + 1) / order.length) * 100}%` }}
          />
        </div>
      </div>

      <button
        className={`${styles.studyCard}${flipped ? ` ${styles.studyCardFlipped}` : ''}`}
        onClick={() => setFlipped((f) => !f)}
        aria-live="polite"
      >
        <span className={styles.studyFace}>{flipped ? 'BACK' : 'FRONT'}</span>
        <span className={styles.studyText}>
          {(flipped ? card?.back : card?.front) || '—'}
        </span>
        <span className={styles.flipHint}>Click or press Space to flip</span>
      </button>

      <div className={styles.studyNav}>
        <button className={styles.secondaryBtn} onClick={() => go(-1)} disabled={atStart}>
          ← Prev
        </button>
        {atEnd ? (
          <button className={styles.primaryBtn} onClick={restart}>Restart</button>
        ) : (
          <button className={styles.primaryBtn} onClick={() => go(1)}>Next →</button>
        )}
      </div>
    </div>
  );
}
