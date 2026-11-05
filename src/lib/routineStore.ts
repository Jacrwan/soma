import { storage } from './storage';
import { readRoutine, type Routine, type RoutineItem } from './routine';

/** Fired when the routine changes, so plans re-read it. */
export const ROUTINE_CHANGED = 'soma_routine_changed';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** The saved routine, checked. */
export const currentRoutine = (): Routine | null => readRoutine(storage.getSomaSettings().routine);

/**
 * Saves the weekly routine (and, with it, new study hours if given). The
 * server copy is merged first (saveSettings never replaces), then this
 * browser's; a failed save throws and leaves both as they were. No items
 * clears the routine. Days before it was first saved keep no routine blocks.
 */
export async function saveRoutine(items: RoutineItem[], studyHours?: { start: string; end: string }): Promise<void> {
  const local = storage.getSomaSettings();
  const routine: Routine | null = items.length ? { since: currentRoutine()?.since ?? today(), items } : null;
  const studyWindow = studyHours ? { ...local.studyWindow, start: studyHours.start, end: studyHours.end, off: false } : local.studyWindow;
  await storage.saveSettings({ routine, ...(studyHours ? { studyWindow } : {}) });
  storage.setSomaSettings({ ...storage.getSomaSettings(), routine, studyWindow });
  window.dispatchEvent(new Event(ROUTINE_CHANGED));
}
