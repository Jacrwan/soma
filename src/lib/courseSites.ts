import { supabase } from './supabase';
import { storage } from './storage';
import { asTodoKind, type Todo } from '../types';
import { itemsToApply, sameDeadline, sameTitle, type CourseSite, type SavedRow, type Seen, type SiteItem } from './courseSiteMatch';

export { sameDeadline, sameTitle, itemsToApply } from './courseSiteMatch';
export type { CourseSite, SavedRow, SiteItem } from './courseSiteMatch';

/**
 * Course websites Soma keeps checking after an import (cs61a.org and the like).
 *
 * A Canvas feed stays current on its own; a course website was read once and
 * never again, so a moved due date or a newly posted homework never reached
 * the student. Importing from a web address now saves the site in settings
 * (`courseSites`, so every device shares it), and while Soma is open each
 * site is read again once it is CHECK_EVERY old.
 *
 * Cheap by design: the server fingerprints the page text and answers "same
 * page" without the model, so the AI only runs when the page changed.
 *
 * What a re-check changes, without asking: due dates of tasks this course
 * already has, and items posted since the last read (upcoming, with their date
 * quoted from the page). Items the student left unticked at import, or deleted
 * since, were already seen and are never re-added. Nothing is ever deleted.
 */

export const CHECK_EVERY = 2 * 60 * 60 * 1000;
export const COURSE_SITES_CHANGED = 'soma_course_sites_changed';

/** Focus time is filed under a task's title; a task with any is never renamed here. */
async function hasLoggedTime(title: string): Promise<boolean> {
  const { data, error } = await supabase.from('timer_sessions').select('id').eq('task_text', title).limit(1);
  return !!error || !!data?.length;   // can't tell → treat as used
}

/**
 * Save items into one course: a task already there (the one the AI named as
 * the same assignment, the same title, or the same deadline worded
 * differently) gets its date updated; anything else is added.
 * A task the course renamed takes the page's name only while it is untouched
 * (not started, no Focus time under its title); otherwise it keeps its own.
 * `rows` fills in as each one saves, so a failure part-way can say how far it got.
 */
export async function saveSiteItems(subjectId: string, items: SiteItem[], rows: SavedRow[] = []): Promise<SavedRow[]> {
  // The course's tasks, kept up to date as this import saves: saving doesn't
  // touch the cache, so two items of one import couldn't see each other.
  const known = (await storage.fetchAllTodos()).filter(t => t.subjectId === subjectId);
  const remember = (t: Todo) => { const at = known.findIndex(k => k.id === t.id); if (at < 0) known.push(t); else known[at] = t; };
  for (const item of items) {
    const kind = asTodoKind(item.type);
    const named = item.sameAs !== undefined ? known.find(t => t.text === item.sameAs) : undefined;
    const existing = named ?? known.find(t => sameTitle(t.text, item.title))
      ?? known.find(t => sameDeadline({ title: t.text, due: t.dueDate, kind: t.kind }, { title: item.title, due: item.due, kind }));
    // The receipt names the task as it is stored, which keeps its own wording.
    if (existing) {
      const rename = !!named && !sameTitle(existing.text, item.title)
        && existing.status === 'nothing' && !(await hasLoggedTime(existing.text));
      if (rename) {
        const next = { ...existing, text: item.title, dueDate: item.due, date: existing.date === existing.dueDate ? item.due : existing.date, kind: kind ?? existing.kind };
        await storage.saveTodo(next);
        remember(next);
        rows.push({ title: item.title, due: item.due, time: item.time, change: 'updated', was: existing.text });
        continue;
      }
      if (existing.dueDate === item.due) {
        // Same date, but the row may predate the kind column: fill it in
        // so re-importing is how older tasks get classified.
        if (kind && existing.kind !== kind) { const next = { ...existing, kind }; await storage.saveTodo(next); remember(next); }
        rows.push({ title: existing.text, due: item.due, time: item.time, change: 'unchanged' });
        continue;
      }
      const next = { ...existing, dueDate: item.due, date: existing.date === existing.dueDate ? item.due : existing.date, kind: kind ?? existing.kind };
      await storage.saveTodo(next);
      remember(next);
      rows.push({ title: existing.text, due: item.due, time: item.time, change: 'updated' });
    } else {
      const next: Todo = { id: crypto.randomUUID(), text: item.title, status: 'nothing', subjectId, dueDate: item.due, date: item.due, kind };
      await storage.saveTodo(next);
      remember(next);
      rows.push({ title: item.title, due: item.due, time: item.time, change: 'added' });
    }
  }
  return rows;
}

/** Remove tasks the page no longer lists, chosen by the student at import. Only ever called from the import screen. */
export async function removeGoneTasks(ids: string[], rows: SavedRow[] = []): Promise<SavedRow[]> {
  const todos = await storage.fetchAllTodos();
  for (const id of ids) {
    const t = todos.find(x => x.id === id);
    if (!t) continue;
    await storage.deleteTodo(id);
    rows.push({ title: t.text, due: t.dueDate ?? t.date, time: null, change: 'removed' });
  }
  return rows;
}

/** What a re-read is told the student already has: the imported tasks (they carry a kind), at most 150. */
export function existingForRead(todos: Todo[], subjectId?: string) {
  return todos
    .filter(t => t.kind && (!subjectId || t.subjectId === subjectId))
    .sort((a, b) => (b.dueDate ?? '').localeCompare(a.dueDate ?? ''))
    .slice(0, 150)
    .map(t => ({ title: t.text, due: t.dueDate ?? null }));
}

const asSeen = (items: SiteItem[]): Seen[] => items.map(i => ({ title: i.title, due: i.due, kind: asTodoKind(i.type) ?? null }));

/** Saved sites, read defensively: settings are synced JSON, never trusted as-is. */
export function readSites(raw: unknown): CourseSite[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(v => {
    const s = v as Partial<CourseSite>;
    if (typeof s?.url !== 'string' || !/^https:\/\//.test(s.url) || typeof s.courseId !== 'string') return [];
    const seen = Array.isArray(s.seen) ? s.seen.filter(x => typeof x?.title === 'string' && typeof x?.due === 'string') : [];
    return [{ url: s.url, courseId: s.courseId, checkedAt: typeof s.checkedAt === 'string' ? s.checkedAt : new Date(0).toISOString(), pageHash: typeof s.pageHash === 'string' ? s.pageHash : undefined, seen, lastChange: s.lastChange }];
  });
}

export async function getCourseSites(): Promise<CourseSite[]> {
  const raw = (await storage.getSettings()).courseSites ?? [];
  storage.setCachedCourseSites(raw);
  return readSites(raw);
}

/** Change the saved list against what is stored now, so two writers don't undo each other. */
async function updateSites(change: (sites: CourseSite[]) => CourseSite[]): Promise<CourseSite[]> {
  const next = change(await getCourseSites());
  await storage.saveSettings({ courseSites: next });
  storage.setCachedCourseSites(next);
  window.dispatchEvent(new Event(COURSE_SITES_CHANGED));
  return next;
}

/** After an import from a web address: keep checking that site for this course. */
export function trackCourseSite(url: string, courseId: string, items: SiteItem[], pageHash?: string) {
  const site: CourseSite = { url, courseId, checkedAt: new Date().toISOString(), pageHash, seen: asSeen(items) };
  return updateSites(sites => [...sites.filter(s => !(s.url === url && s.courseId === courseId)), site]);
}

export function untrackCourseSite(url: string, courseId: string) {
  return updateSites(sites => sites.filter(s => !(s.url === url && s.courseId === courseId)));
}

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

let running: Promise<void> | null = null;

/** Re-read every saved site that is due for a check. One run at a time. */
export function checkCourseSites(now = Date.now()): Promise<void> {
  running ??= run(now).finally(() => { running = null; });
  return running;
}

async function run(now: number) {
  // The list read at sign-in says whether anything is due: no request (and no
  // auth lock) on the timer when there are no sites, or none is due yet.
  const isDue = (s: CourseSite) => now - Date.parse(s.checkedAt) >= CHECK_EVERY;
  if (!readSites(storage.getCachedCourseSites()).some(isDue)) return;
  const due = (await getCourseSites()).filter(isDue);
  if (!due.length) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const today = localToday();
  // Read from the server, not the cache: a cache not loaded yet would look
  // like every course was deleted. A failed read stops the run (it throws).
  const courses = new Set((await storage.fetchSubjects()).filter(s => !s.archived).map(s => s.id));
  let changedTodos = false;
  for (const site of due) {
    // A course that was deleted or archived stops being checked.
    if (!courses.has(site.courseId)) { await untrackCourseSite(site.url, site.courseId); continue; }
    let next: CourseSite = { ...site, checkedAt: new Date().toISOString() };
    try {
      const response = await fetch('/api/import-schedule', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: site.url, today, existing: existingForRead(await storage.fetchAllTodos(), site.courseId), ...(site.pageHash ? { known: site.pageHash } : {}) }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await response.json().catch(() => null) as { unchanged?: boolean; items?: SiteItem[]; pageHash?: string } | null;
      if (response.ok && body && !body.unchanged && Array.isArray(body.items)) {
        const courseTodos = (await storage.fetchAllTodos()).filter(t => t.subjectId === site.courseId);
        const rows = await saveSiteItems(site.courseId, itemsToApply(body.items, site.seen, courseTodos, today));
        const added = rows.filter(r => r.change === 'added').length, updated = rows.filter(r => r.change === 'updated').length;
        next = { ...next, pageHash: body.pageHash, seen: asSeen(body.items), ...(added || updated ? { lastChange: { at: next.checkedAt, added, updated } } : {}) };
        if (added || updated) changedTodos = true;
      }
      // Anything else (budget used, site down, signed out of Premium) waits
      // for the next check rather than retrying every few minutes.
    } catch (err) {
      console.error('[courseSites] check failed:', err instanceof Error ? err.message : err);
    }
    await updateSites(sites => sites.map(s => (s.url === site.url && s.courseId === site.courseId ? next : s)));
  }
  if (changedTodos) {
    await storage.fetchAllTodos();
    window.dispatchEvent(new Event('soma_todos_changed'));
  }
}
