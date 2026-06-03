// In-app flashcards. Decks live in localStorage (same approach as
// createHistory.ts) — they are studied inside Soma and never exported to Drive.

export interface Flashcard {
  id: string;
  front: string;
  back: string;
}

export interface FlashcardDeck {
  id: string;
  title: string;
  subjectId?: string;
  cards: Flashcard[];
  createdAt: string;
  updatedAt: string;
}

const DECKS_KEY = 'soma_flashcard_decks';
export const FLASHCARDS_EVENT = 'soma_flashcards_updated';

export function loadDecks(): FlashcardDeck[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DECKS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(decks: FlashcardDeck[]): void {
  localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
  window.dispatchEvent(new Event(FLASHCARDS_EVENT));
}

/** Insert or update a deck, keeping the most recently updated first. */
export function saveDeck(deck: FlashcardDeck): void {
  const rest = loadDecks().filter((d) => d.id !== deck.id);
  persist([deck, ...rest]);
}

export function deleteDeck(id: string): void {
  persist(loadDecks().filter((d) => d.id !== id));
}

export function newCard(): Flashcard {
  return { id: crypto.randomUUID(), front: '', back: '' };
}

export function newDeck(): FlashcardDeck {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: '',
    cards: [newCard(), newCard()],
    createdAt: now,
    updatedAt: now,
  };
}
