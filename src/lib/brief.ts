import { storage } from './storage';
import { recentChanges, subjectForCourse, type SnapshotChange } from './canvasDeepSync';
import { isSubmittable } from '../types';

/**
 * The morning brief on the dashboard: what's due today and tomorrow and not
 * done, what changed in the last day, and what was planned yesterday but
 * didn't happen. Worked out here from what Soma already has, with no AI call,
 * so it costs nothing however often the dashboard opens. "Plan my day" is the
 * one step that asks the AI, and only when the student clicks it.
 */

export type BriefItem = { title: string; course: string; due: string; source: 'canvas' | 'gradescope' | 'webassign' | 'task' };
export type Brief = { today: BriefItem[]; tomorrow: BriefItem[]; changed: SnapshotChange[]; slipped: BriefItem[] };

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (d: Date, days: number) => { const x = new Date(d); x.setDate(x.getDate() + days); return x; };
const short = (name: string) => name.split(/[:,]| - /)[0].trim().slice(0, 30);

export function buildBrief(now = new Date()): Brief {
  const today = key(now), tomorrow = key(shift(now, 1)), yesterday = key(shift(now, -1));
  const subjects = new Map(storage.getSubjects().map(s => [s.id, s.name]));
  const status = storage.getAssignmentStatus() as Record<string, string>;
  const due: BriefItem[] = [];

  for (const a of storage.getCachedAssignments()) {
    const course = subjectForCourse(storage.getSubjects(), a.courseId, a.courseName);
    if (!a.dueAt || course?.archived) continue;
    const done = (status[String(a.id)] ?? (a.status === 'done' ? 'done' : '')) === 'done';
    if (done) continue;
    const d = new Date(a.dueAt);
    // Due at 12:30 AM on Friday is Thursday night's work: count it for Thursday.
    const day = d.getHours() < 3 ? key(shift(d, -1)) : key(d);
    if (day !== today && day !== tomorrow) continue;
    due.push({ title: a.name, course: short(course?.name ?? a.courseName), due: a.dueAt, source: a.platform ?? 'canvas' });
  }
  const canvasIds = new Set(storage.getCachedAssignments().map(a => a.id));
  const slipped: BriefItem[] = [];
  for (const t of storage.getTodos()) {
    if (t.status === 'done') continue;
    const course = t.subjectId ? short(subjects.get(t.subjectId) ?? '') : '';
    if (t.dueDate && (isSubmittable(t.kind) || t.assignmentId) && !(t.assignmentId && canvasIds.has(t.assignmentId))) {
      const day = t.dueDate.slice(0, 10);
      if (day === today || day === tomorrow) due.push({ title: t.text, course, due: day, source: 'task' });
    }
    // Planned for yesterday and not checked off: it didn't happen (or wasn't marked).
    if (t.date === yesterday && !t.dueDate?.startsWith(yesterday)) slipped.push({ title: t.text, course, due: t.date, source: 'task' });
  }
  const dayOf = (i: BriefItem) => i.source === 'task' ? i.due : (new Date(i.due).getHours() < 3 ? key(shift(new Date(i.due), -1)) : key(new Date(i.due)));
  const byTime = (a: BriefItem, b: BriefItem) => a.due.localeCompare(b.due);
  return {
    today: due.filter(i => dayOf(i) === today).sort(byTime),
    tomorrow: due.filter(i => dayOf(i) === tomorrow).sort(byTime),
    changed: recentChanges(1, undefined, now.getTime()).slice(0, 5),
    slipped: slipped.slice(0, 5),
  };
}

export const briefIsEmpty = (b: Brief) => !b.today.length && !b.tomorrow.length && !b.changed.length && !b.slipped.length;

/** What "Plan my day" asks Soma, naming what the brief found so the plan starts there. */
export function planMyDayPrompt(b: Brief): string {
  const list = (items: BriefItem[]) => items.map(i => `${i.title}${i.course ? ` (${i.course})` : ''}`).join('; ');
  return [
    'Plan my day.',
    b.today.length ? `Due today: ${list(b.today)}.` : '',
    b.tomorrow.length ? `Due tomorrow: ${list(b.tomorrow)}.` : '',
    b.changed.length ? `Changed since yesterday: ${b.changed.map(c => `${c.name} (${c.type === 'due_moved' ? 'due date moved' : c.type === 'new' ? 'new' : c.type})`).join('; ')}.` : '',
    b.slipped.length ? `Didn't happen yesterday: ${list(b.slipped)}.` : '',
  ].filter(Boolean).join(' ').slice(0, 500);
}

const DISMISSED = 'soma_brief_dismissed';
export const briefDismissedToday = () => { try { return localStorage.getItem(DISMISSED) === key(new Date()); } catch { return false; } };
export const dismissBriefToday = () => { try { localStorage.setItem(DISMISSED, key(new Date())); } catch { /* shows again next load */ } };
