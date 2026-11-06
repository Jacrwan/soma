import { storage } from './storage';
import { readHabits, type Habits } from './habits';

/** Fired when habits change, so every copy on screen updates. */
export const HABITS_CHANGED = 'soma_habits_changed';

/** This browser's copy, checked. */
export const localHabits = (): Habits => readHabits(storage.getSomaSettings().habits);

/**
 * Saves habits: the server copy first (saveSettings merges, never replaces),
 * then this browser's. A failed save throws and changes neither. Saves run one
 * at a time, in order: a check tapped while the habit was still being added
 * otherwise raced it, and the older save could land last and undo the check.
 */
let queue: Promise<unknown> = Promise.resolve();
export function saveHabits(habits: Habits): Promise<void> {
  const run = queue.then(async () => {
    await storage.saveSettings({ habits });
    storage.setSomaSettings({ ...storage.getSomaSettings(), habits });
    window.dispatchEvent(new Event(HABITS_CHANGED));
  });
  queue = run.catch(() => {});
  return run;
}

/** The server's copy, which is newer when habits were checked on another device. */
export async function loadHabits(): Promise<Habits> {
  const remote = await storage.getSettings();
  if (remote.habits === undefined) return localHabits();
  const habits = readHabits(remote.habits);
  storage.setSomaSettings({ ...storage.getSomaSettings(), habits });
  return habits;
}
