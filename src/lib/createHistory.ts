export interface SavedCreation {
  id: string;
  kind: 'doc' | 'slides';
  title: string;
  url: string;
  templateLabel: string;
  sourceLabel: string;
  createdAt: string;
  subjectId?: string;
}

const HISTORY_KEY = 'soma_create_history';
const MAX_HISTORY = 30;
export const CREATE_HISTORY_EVENT = 'soma_create_history_updated';

export function loadCreateHistory(): SavedCreation[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}

export function saveCreateHistory(items: SavedCreation[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
  window.dispatchEvent(new Event(CREATE_HISTORY_EVENT));
}

export function appendToCreateHistory(entry: Omit<SavedCreation, 'id'>): void {
  saveCreateHistory([{ id: crypto.randomUUID(), ...entry }, ...loadCreateHistory()]);
}

export function clearCreateHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
  window.dispatchEvent(new Event(CREATE_HISTORY_EVENT));
}
