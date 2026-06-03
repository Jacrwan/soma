import type { CreateDocSpec, CreateSlidesSpec } from './aiArtifacts';

// Study materials kept *inside* Soma (no Google Doc/Slide created). They are
// rendered by an in-app reader. Persisted in localStorage like createHistory.ts.

export interface NativeCreation {
  id: string;
  kind: 'doc' | 'slides';
  title: string;
  templateLabel: string;
  subjectId?: string;
  createdAt: string;
  docSpec?: CreateDocSpec;
  slidesSpec?: CreateSlidesSpec;
}

const KEY = 'soma_native_library';
const MAX = 50;
export const NATIVE_LIBRARY_EVENT = 'soma_native_library_updated';

export function loadNativeLibrary(): NativeCreation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(items: NativeCreation[]): void {
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  window.dispatchEvent(new Event(NATIVE_LIBRARY_EVENT));
}

export function saveNativeCreation(item: NativeCreation): void {
  const rest = loadNativeLibrary().filter((c) => c.id !== item.id);
  persist([item, ...rest]);
}

export function deleteNativeCreation(id: string): void {
  persist(loadNativeLibrary().filter((c) => c.id !== id));
}
