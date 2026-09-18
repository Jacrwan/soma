import { useState, useRef, useEffect, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { useNavigate } from 'react-router-dom';
import { storage } from '../../lib/storage';
import { formatDateTime, useTimeFormat } from '../../lib/timeFormat';
import { sendMessage } from '../../lib/ai';
import { listDocuments, DOCUMENTS_CHANGED_EVENT } from '../../lib/documents';
import { buildDocumentsSection } from '../../lib/aiContext';
import { friendlyError } from '../../lib/errors';
import { useSubscription, hasAIAccess, startCheckout } from '../../lib/subscription';
import { SubjectColor, Todo, ChatMessage, ChatSession, AiTodo } from '../../types';
import { SkeletonBlock } from '../UI/Skeleton';
import TrialSetupModal from '../Trial/TrialSetupModal';
import styles from './AITab.module.css';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
  // eslint-disable-next-line no-var
  var SpeechRecognition: any;
}

function SessionListSkeleton() {
  return (
    <div style={{ padding: '6px 0' }}>
      {[148, 112, 164].map((w, i) => (
        <div key={i} style={{ padding: '7px 16px' }}>
          <SkeletonBlock width={w} height={13} />
        </div>
      ))}
    </div>
  );
}

// ── Date/session helpers ────────────────────────────────────────────────────

function fmtSessionTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return formatDateTime(d);
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getTodayKey(): string {
  const now = new Date();
  const effective = now.getHours() < 5
    ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
    : now;
  const y = effective.getFullYear();
  const m = String(effective.getMonth() + 1).padStart(2, '0');
  const d = String(effective.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function makeSessionTitle(dateKey: string): string {
  const [y, mo, d] = dateKey.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function migrateLegacy(sessions: ChatSession[]): ChatSession[] {
  const raw = localStorage.getItem('soma_chat_history');
  if (!raw) return sessions;
  try {
    const messages: ChatMessage[] = JSON.parse(raw);
    if (!messages.length) { localStorage.removeItem('soma_chat_history'); return sessions; }
    const todayKey = getTodayKey();
    if (sessions.some(s => s.date === todayKey && s.messages.length > 0)) return sessions;
    const migrated: ChatSession = {
      id: crypto.randomUUID(),
      date: todayKey,
      title: makeSessionTitle(todayKey),
      messages,
      createdAt: new Date().toISOString(),
    };
    localStorage.removeItem('soma_chat_history');
    return [migrated, ...sessions.filter(s => s.date !== todayKey)];
  } catch { return sessions; }
}

// ── Message formatting ──────────────────────────────────────────────────────

function isToday(iso: string) {
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear()
    && d.getMonth() === n.getMonth()
    && d.getDate() === n.getDate();
}


function fmtTime12(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
  return `${h}:${m} ${ampm}`;
}

function stripTags(content: string) {
  return content
    .replace(/<schedule>[\s\S]*?<\/(?:schedule|todos)>/g, '')
    .replace(/<todos>[\s\S]*?<\/(?:todos|schedule)>/g, '')
    .replace(/<createDoc\b[\s\S]*?<\/createDoc>/g, '')
    .replace(/<createSlides\b[\s\S]*?<\/createSlides>/g, '')
    .replace(/<soma-action>[\s\S]*?<\/soma-action>/g, '')
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
    .replace(/<[a-zA-Z][a-zA-Z0-9]*[^>]+name="soma-action"[^>]*>[\s\S]*?<\/[a-zA-Z][a-zA-Z0-9]*>/g, '')
    .replace(/<raw>[\s\S]*?<\/raw>/g, '')
    .replace(/<artifact[^>]*>[\s\S]*?<\/artifact>/g, '')
    .trim();
}

function formatMessage(content: string): string {
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>');
  // Split on paragraph breaks (2+ newlines), wrap each in <p>, convert remaining \n to <br>
  const html = escaped
    .split(/\n{2,}/)
    .map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['strong', 'p', 'br'], ALLOWED_ATTR: [] });
}

function parseTodos(content: string): AiTodo[] | null {
  const match = content.match(/<todos>([\s\S]*?)<\/(?:todos|schedule)>/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return null;
    return parsed.map(item => ({
      text: typeof item === 'string' ? item : String(item.text ?? ''),
      subjectId: item.subjectId ?? undefined,
      assignmentId: typeof item.assignmentId === 'number' ? item.assignmentId : undefined,
    })).filter(t => t.text);
  } catch { return null; }
}

const SUBJECT_COLORS: SubjectColor[] = ['#ef5350','#42a5f5','#66bb6a','#ab47bc','#ffa726','#26c6da','#ec407a','#8d6e63'];

type SomaAction =
  | { action: 'create_subject'; name: string; color: SubjectColor }
  | { action: 'update_subject'; subject_id: string; name?: string; color?: SubjectColor }
  | { action: 'archive_subject'; subject_id: string }
  | { action: 'delete_subject'; subject_id: string }
  | { action: 'create_todo'; title: string; subject_id?: string; due_date?: string; sessions?: Array<{ date: string; start_time: string; end_time: string }> }
  | { action: 'update_todo'; todo_id: string; title?: string; due_date?: string; notes?: string }
  | { action: 'complete_todo'; todo_id: string }
  | { action: 'delete_todo'; todo_id: string }
  | { action: 'create_session'; todo_id: string; date: string; start_time: string; end_time: string }
  | { action: 'delete_session'; session_id: string }
  | { action: 'update_session'; session_id: string; start_time?: string; end_time?: string };

function parseSingleSomaAction(json: string): SomaAction | null {
  try {
    const p = JSON.parse(json.trim());
    if (p.action === 'create_subject' && typeof p.name === 'string' && p.name.trim()) {
      const color: SubjectColor = SUBJECT_COLORS.includes(p.color) ? p.color : '#42a5f5';
      return { action: 'create_subject', name: p.name.trim(), color };
    }
    if (p.action === 'update_subject' && typeof p.subject_id === 'string')
      return {
        action: 'update_subject',
        subject_id: p.subject_id,
        name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : undefined,
        color: SUBJECT_COLORS.includes(p.color) ? p.color : undefined,
      };
    if (p.action === 'archive_subject' && typeof p.subject_id === 'string')
      return { action: 'archive_subject', subject_id: p.subject_id };
    if (p.action === 'delete_subject' && typeof p.subject_id === 'string')
      return { action: 'delete_subject', subject_id: p.subject_id };
    if (p.action === 'create_todo' && typeof p.title === 'string' && p.title.trim())
      return {
        action: 'create_todo',
        title: p.title.trim(),
        subject_id: typeof p.subject_id === 'string' ? p.subject_id : undefined,
        due_date: typeof p.due_date === 'string' ? p.due_date : undefined,
        sessions: Array.isArray(p.sessions)
          ? (p.sessions as unknown[])
              .filter((s): s is Record<string, string> =>
                typeof s === 'object' && s !== null &&
                typeof (s as Record<string, unknown>).date === 'string' &&
                typeof (s as Record<string, unknown>).start_time === 'string' &&
                typeof (s as Record<string, unknown>).end_time === 'string',
              )
              .map(s => ({ date: s.date, start_time: s.start_time, end_time: s.end_time }))
          : undefined,
      };
    if (p.action === 'update_todo' && typeof p.todo_id === 'string')
      return {
        action: 'update_todo',
        todo_id: p.todo_id,
        title: typeof p.title === 'string' && p.title.trim() ? p.title.trim() : undefined,
        due_date: typeof p.due_date === 'string' ? p.due_date : undefined,
        notes: typeof p.notes === 'string' ? p.notes : undefined,
      };
    if (p.action === 'complete_todo' && typeof p.todo_id === 'string')
      return { action: 'complete_todo', todo_id: p.todo_id };
    if (p.action === 'delete_todo' && typeof p.todo_id === 'string')
      return { action: 'delete_todo', todo_id: p.todo_id };
    if (p.action === 'create_session' &&
        typeof p.todo_id === 'string' &&
        typeof p.date === 'string' &&
        typeof p.start_time === 'string' &&
        typeof p.end_time === 'string')
      return { action: 'create_session', todo_id: p.todo_id, date: p.date, start_time: p.start_time, end_time: p.end_time };
    if (p.action === 'delete_session' && typeof p.session_id === 'string')
      return { action: 'delete_session', session_id: p.session_id };
    if (p.action === 'update_session' && typeof p.session_id === 'string')
      return {
        action: 'update_session',
        session_id: p.session_id,
        start_time: typeof p.start_time === 'string' ? p.start_time : undefined,
        end_time: typeof p.end_time === 'string' ? p.end_time : undefined,
      };
    return null;
  } catch { return null; }
}

function parseSomaActions(content: string): SomaAction[] {
  const actions: SomaAction[] = [];
  let m: RegExpExecArray | null;

  // Primary: <soma-action>JSON</soma-action> (may appear multiple times)
  const primary = /<soma-action>([\s\S]*?)<\/soma-action>/g;
  while ((m = primary.exec(content)) !== null) {
    const action = parseSingleSomaAction(m[1]);
    if (action) actions.push(action);
  }
  if (actions.length > 0) return actions;

  // Fallback 1: model-invented wrapper with name="soma-action" attribute
  const namedWrapper = /<[a-zA-Z][a-zA-Z0-9]*[^>]+name="soma-action"[^>]*>([\s\S]*?)<\/[a-zA-Z][a-zA-Z0-9]*>/g;
  while ((m = namedWrapper.exec(content)) !== null) {
    const action = parseSingleSomaAction(m[1]);
    if (action) actions.push(action);
  }
  if (actions.length > 0) return actions;

  // Fallback 2: <artifact> tags containing JSON with an "action" field
  const artifactWrapper = /<artifact[^>]*>([\s\S]*?)<\/artifact>/g;
  while ((m = artifactWrapper.exec(content)) !== null) {
    const action = parseSingleSomaAction(m[1]);
    if (action) actions.push(action);
  }
  return actions;
}

async function executeSomaAction(action: SomaAction): Promise<string | null> {
  switch (action.action) {
    case 'create_subject': {
      const existing = storage.getSubjects();
      if (!existing.some(s => s.name.toLowerCase() === action.name.toLowerCase())) {
        storage.setSubjects([...existing, {
          id: crypto.randomUUID(), name: action.name, color: action.color,
          totalTimeToday: 0, source: 'manual' as const,
        }]);
      }
      window.dispatchEvent(new Event('soma_subjects_changed'));
      return `✓ Created subject: "${action.name}"`;
    }
    case 'update_subject': {
      const subj = storage.getSubjects().find(s => s.id === action.subject_id);
      if (!subj) return null;
      const updated = {
        ...subj,
        ...(action.name ? { name: action.name } : {}),
        ...(action.color ? { color: action.color } : {}),
      };
      storage.setSubjects(storage.getSubjects().map(s => s.id === action.subject_id ? updated : s));
      window.dispatchEvent(new Event('soma_subjects_changed'));
      return `✓ Updated subject: "${updated.name}"`;
    }
    case 'archive_subject': {
      const subj = storage.getSubjects().find(s => s.id === action.subject_id);
      if (!subj) return null;
      storage.setSubjects(storage.getSubjects().map(s => s.id === action.subject_id ? { ...s, archived: true } : s));
      window.dispatchEvent(new Event('soma_subjects_changed'));
      return `✓ Archived: ${subj.name}`;
    }
    case 'delete_subject': {
      const subj = storage.getSubjects().find(s => s.id === action.subject_id);
      if (!subj) return null;
      storage.setSubjects(storage.getSubjects().filter(s => s.id !== action.subject_id));
      window.dispatchEvent(new Event('soma_subjects_changed'));
      return `✓ Deleted subject: "${subj.name}"`;
    }
    case 'create_todo': {
      console.log('[soma] create_todo action payload:', JSON.stringify(action));
      // Validate subject_id — reject silently-wrong assignments
      let resolvedSubjectId: string | undefined = undefined;
      if (action.subject_id) {
        const exists = storage.getSubjects().some(s => s.id === action.subject_id && !s.archived);
        if (exists) {
          resolvedSubjectId = action.subject_id;
        } else {
          console.warn('[soma] create_todo — subject_id not found in current subjects:', action.subject_id, '— leaving unassigned');
        }
      }
      const totalSessionMins = Array.isArray(action.sessions) && action.sessions.length > 0
        ? action.sessions.reduce((sum, sess) => {
            const s = new Date(sess.start_time).getTime();
            const e = new Date(sess.end_time).getTime();
            return sum + Math.round((e - s) / 60_000);
          }, 0)
        : 0;

      // Dedup: if a non-done todo with the same title + subject already exists, reuse it.
      const existingTodo = storage.getTodos().find(t =>
        t.text.trim().toLowerCase() === action.title.trim().toLowerCase() &&
        t.subjectId === resolvedSubjectId &&
        t.status !== 'done',
      );

      let todoId: string;
      if (existingTodo) {
        todoId = existingTodo.id;
        console.log('[soma] create_todo — reusing existing todo:', todoId, action.title);
      } else {
        const newTodo: Todo = {
          id: crypto.randomUUID(),
          text: action.title,
          status: 'nothing',
          subjectId: resolvedSubjectId,
          dueDate: action.due_date,
          date: action.due_date ?? getTodayKey(),
          estimatedMinutes: totalSessionMins > 0 ? totalSessionMins : undefined,
        };
        todoId = newTodo.id;
        storage.setTodos([...storage.getTodos(), newTodo]);
        window.dispatchEvent(new Event('soma_todos_changed'));
      }

      if (action.sessions && action.sessions.length > 0) {
        await Promise.all(action.sessions.map(async sess => {
          try {
            await storage.saveTodoSession({ todoId, date: sess.date, startTime: sess.start_time, endTime: sess.end_time });
          } catch (err) {
            console.error('[soma] session save failed:', JSON.stringify({ sess, error: String(err) }));
          }
        }));
        window.dispatchEvent(new Event('soma_todo_sessions_changed'));
      }
      const subjectNote = action.subject_id && !resolvedSubjectId ? ' (subject not found — left unassigned)' : '';
      const dedupNote = existingTodo ? ' (existing todo reused)' : '';
      return `✓ Added todo: "${action.title}"${subjectNote}${dedupNote}`;
    }
    case 'update_todo': {
      const todo = storage.getTodos().find(t => t.id === action.todo_id);
      if (!todo) return null;
      const updated: Todo = {
        ...todo,
        ...(action.title ? { text: action.title } : {}),
        ...(action.due_date !== undefined ? { dueDate: action.due_date || undefined } : {}),
        ...(action.notes !== undefined ? { notes: action.notes || undefined } : {}),
      };
      storage.setTodos(storage.getTodos().map(t => t.id === action.todo_id ? updated : t));
      window.dispatchEvent(new Event('soma_todos_changed'));
      return `✓ Updated todo: "${updated.text}"`;
    }
    case 'complete_todo': {
      const todo = storage.getTodos().find(t => t.id === action.todo_id);
      if (!todo) return null;
      storage.setTodos(storage.getTodos().map(t => t.id === action.todo_id ? { ...t, status: 'done' } : t));
      window.dispatchEvent(new Event('soma_todos_changed'));
      return `✓ Completed: "${todo.text}"`;
    }
    case 'delete_todo': {
      const allTodos = storage.getTodos();
      const todo = allTodos.find(t => t.id === action.todo_id);
      console.log('[soma] delete_todo fired — todo_id:', action.todo_id,
        '| found in cache:', todo ? `"${todo.text}"` : 'NOT FOUND — firing direct Supabase delete anyway');
      // Await the direct Supabase delete so the row is gone before this promise resolves
      try {
        await storage.deleteTodo(action.todo_id);
      } catch (err) {
        console.warn('[soma] delete_todo — Supabase delete failed:', err);
      }
      // Remove from in-memory cache regardless of whether it was found above — ensures
      // the next fetchIncompleteTodos() and the next system-prompt injection see a clean list
      const filtered = allTodos.filter(t => t.id !== action.todo_id);
      if (filtered.length !== allTodos.length) {
        storage.setTodos(filtered);
      }
      window.dispatchEvent(new Event('soma_todos_changed'));
      return todo ? `✓ Deleted todo: "${todo.text}"` : '✓ Todo deleted';
    }
    case 'create_session': {
      const todo = storage.getTodos().find(t => t.id === action.todo_id);
      if (!todo) return `✗ Todo not found for session: ${action.todo_id}`;
      await storage.saveTodoSession({
        todoId: action.todo_id,
        date: action.date,
        startTime: action.start_time,
        endTime: action.end_time,
      });
      window.dispatchEvent(new Event('soma_todo_sessions_changed'));
      return `✓ Scheduled session for "${todo.text}"`;
    }
    case 'delete_session': {
      await storage.deleteTodoSession(action.session_id);
      window.dispatchEvent(new Event('soma_todo_sessions_changed'));
      return `✓ Deleted session`;
    }
    case 'update_session': {
      await storage.updateTodoSession(action.session_id, {
        startTime: action.start_time,
        endTime: action.end_time,
      });
      window.dispatchEvent(new Event('soma_todo_sessions_changed'));
      return `✓ Updated session`;
    }
  }
}

// ── System prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(activeSubjectKey?: string): string {
  const allSubjects = storage.getSubjects();
  const subjects = allSubjects.filter(s => !s.archived);
  const archivedCourseNames = new Set(allSubjects.filter(s => s.archived).map(s => s.name));
  const assignments = storage.getCachedAssignments();
  const announcements: import('../../types').CanvasAnnouncement[] = [];
  const modules: import('../../types').CanvasModule[] = [];
  const gcalEvents = storage.getCachedGoogleEvents().filter(
    e => !!e.start.dateTime && isToday(e.start.dateTime),
  );

  const now = new Date();
  const date = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const subjectsStr = subjects.length > 0
    ? subjects.map(s => `- ${s.name} | id: ${s.id} | source: ${s.source ?? 'manual'}`).join('\n')
    : 'None';

  const assignmentStatus = storage.getAssignmentStatus() as Record<string, string>;
  const incompleteAssignments = assignments.filter(a =>
    !archivedCourseNames.has(a.courseName) &&
    assignmentStatus[String(a.id)] !== 'done' &&
    a.status !== 'done',
  );
  const assignmentsStr = incompleteAssignments.length > 0
    ? incompleteAssignments.map(a => {
        const due = new Date(a.dueAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        return `- ${a.name} — ${a.courseName} — Due ${due}`;
      }).join('\n')
    : 'None';
  const uniqueCourses = [...new Set(
    assignments.filter(a => !archivedCourseNames.has(a.courseName)).map(a => a.courseName).filter(Boolean),
  )];
  const coursesStr = uniqueCourses.length > 0 ? uniqueCourses.join(', ') : 'None synced from Canvas';

  const gcalStr = gcalEvents.length > 0
    ? gcalEvents.map(e => {
        const start = fmtTime12(e.start.dateTime!);
        const end = e.end.dateTime ? fmtTime12(e.end.dateTime) : start;
        return `- ${e.summary ?? '(No title)'}: ${start} – ${end}`;
      }).join('\n')
    : '';

  const courseIds = [...new Set(assignments.map(a => a.courseId))];
  const announcementsStr = courseIds.length > 0
    ? courseIds.map(cid => {
        const courseAnn = announcements.filter(a => a.courseId === cid).slice(0, 5);
        if (courseAnn.length === 0) return null;
        const courseName = assignments.find(a => a.courseId === cid)?.courseName ?? `Course ${cid}`;
        return `${courseName}:\n${courseAnn.map(a => `  - ${a.title}: ${a.message.slice(0, 500)}`).join('\n')}`;
      }).filter(Boolean).join('\n\n')
    : '';

  const modulesStr = courseIds.length > 0
    ? courseIds.map(cid => {
        const courseMods = modules.filter(m => m.courseId === cid).sort((a, b) => a.position - b.position);
        if (courseMods.length === 0) return null;
        const courseName = assignments.find(a => a.courseId === cid)?.courseName ?? `Course ${cid}`;
        return `${courseName}:\n${courseMods.map(m => `  - ${m.name}`).join('\n')}`;
      }).filter(Boolean).join('\n\n')
    : '';

  function fmt12(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
  }

  const { schoolHours, workHours, personalHours, schoolHoursEnabled, workHoursEnabled, personalHoursEnabled } = storage.getSomaSettings();
  const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

  function fmtWeek(week: typeof schoolHours, label: string): string {
    const lines = DAY_NAMES
      .map(day => {
        const avail = week[day];
        if (!avail.start || !avail.end) return null;
        const blocked = avail.blocked.length > 0
          ? `, blocked ${avail.blocked.map(b => `${fmt12(b.start)}–${fmt12(b.end)}`).join(', ')}`
          : '';
        return `  ${day.charAt(0).toUpperCase() + day.slice(1)}: ${fmt12(avail.start)}–${fmt12(avail.end)}${blocked}`;
      })
      .filter(Boolean);
    return lines.length > 0 ? `${label}:\n${lines.join('\n')}` : '';
  }

  const scheduleStr = [
    schoolHoursEnabled !== false ? fmtWeek(schoolHours, 'In class (unavailable for studying)') : '',
    workHoursEnabled !== false ? fmtWeek(workHours, 'At work (unavailable for studying)') : '',
    personalHoursEnabled !== false ? fmtWeek(personalHours, 'Free time (available for studying)') : '',
  ].filter(Boolean).join('\n\n');
  const availabilityStr = scheduleStr;

  const activeSubject = activeSubjectKey && activeSubjectKey !== 'general'
    ? subjects.find(s => `subject_${s.id}` === activeSubjectKey)
    : null;
  const subjectFocusStr = activeSubject
    ? `\nThe user is currently in the ${activeSubject.name} chat. Prioritize ${activeSubject.name}-related questions and context in your responses when relevant.\n`
    : '';

  return `You are Soma, a personal study assistant. Help the user plan their day.
${subjectFocusStr}
Today is ${date}.

The user's current subjects (use these exact IDs in any soma-actions):
${subjectsStr}
Canvas courses: ${coursesStr}

The user's upcoming incomplete assignments are:
${assignmentsStr}

If there are no upcoming assignments, say so clearly and do not make up or hallucinate any assignments.

Use this information to help the user plan their study schedule, prioritize tasks, and answer questions about their workload. Always refer to today's actual date when discussing deadlines.
${buildDocumentsSection(subjects)}
User availability:
${availabilityStr || 'Not set — ask the user what time they want to start and end.'}
${gcalStr ? `\nExisting calendar events (read-only, do not schedule over these):\n${gcalStr}` : ''}
${announcementsStr ? `\nRecent course announcements:\n${announcementsStr}` : ''}
${modulesStr ? `\nCourse modules (structure):\n${modulesStr}` : ''}
When the user asks you to generate a schedule or study plan, use <soma-action> create_todo blocks — one per task. Do NOT use <schedule> tags; they are not supported.

When the user asks for a simple checklist (things to do for an assignment, etc.) with no specific times, you may use <todos> tags as a quick-add shortcut:
Todo item format: [{"text":"...","subjectId":"uuid-here","assignmentId":12345}]
Use the exact subject IDs from the subjects list above. Use the exact assignment IDs from the assignments list above. Set subjectId to null if no subject applies. Set assignmentId to null if not linked to a Canvas assignment.
Match subjectId to the user's existing subjects by name (case-insensitive).
SUBJECT ASSIGNMENT: When assigning a todo to a subject, you MUST match by subject name semantically. Physics study tasks must go under a subject with 'Physics' or 'Berkeley' in the name. Machine Learning tasks go under 'Machine Learning'. Never assign physics content to a machine learning subject. If no matching subject exists, ask the user which subject to use before creating the todos. Never default to an unrelated subject.

SCHEDULING RULES — follow these exactly when generating a schedule:

What to schedule:
- Only real work blocks tied to the user's actual assignments, subjects, or todos
- Each block must have a specific, meaningful task name (e.g. "Study for Macroeconomics Final", "Work on Desmos Art project", "Read Chapter 4 — Organic Chemistry")

What to never schedule:
- Generic breaks (Break 1, Break 2, Short break, etc.)
- Meals of any kind (Lunch, Dinner, Breakfast, Meal break, etc.)
- "Free time" or "Buffer" blocks
- Placeholder or filler blocks with no real purpose
- Anything not directly tied to the user's actual work

Scheduling logic:
- Use the user's personal hours (free time) as the available study window
- Treat school hours and work hours as unavailable — do not schedule over them
- Prioritize assignments by deadline: soonest due first
- Space tasks naturally — the user will take breaks on their own; do not insert them
- If there is not enough time in the available window to fit all tasks, do not silently drop tasks — tell the user what couldn't fit and ask which assignments to prioritize

If you can't match a subject, use the "Other" subject.
Always ask clarifying questions if the user's request is vague.
If the user's availability is set above, use it to constrain the schedule automatically — do not ask for start/end times unless the user asks to override them. If availability is not set, ask the user what time they want to start and end their day before generating a schedule.

SUBJECT & TODO MANAGEMENT:
You have full capability to manage the user's subjects and todos. You are not limited to suggestions — you can act directly. Use <soma-action> blocks to make changes. The blocks execute in the background and the user will see a confirmation automatically.

IMPORTANT RULES:
- Always use the exact IDs from the subjects and todos lists injected above. Never invent or guess IDs.
- If you cannot find an item by its name or description, tell the user it wasn't found rather than guessing.
- Convert all natural language dates to ISO format (YYYY-MM-DD) based on today's date shown above (e.g. "tonight" or "today" → today's date, "tomorrow" → tomorrow's date, "next Friday" → calculate the date).
- For destructive actions (delete, archive, complete) always confirm with the user first before emitting the block.
- For safe actions (create, update) emit immediately once you have enough context — do not make the user confirm twice.
- You cannot modify settings, billing, subscriptions, or authentication. Only subjects and todos.
- IMPORTANT: Never wrap soma-actions in <artifact> tags. Always use exactly <soma-action>{...}</soma-action> — no other wrapper tags. The parser only recognizes <soma-action> tags.
- SUBJECT ASSIGNMENT: When assigning a todo to a subject, you MUST match by subject name semantically. Physics study tasks must go under a subject with 'Physics' or 'Berkeley' in the name. Machine Learning tasks go under 'Machine Learning'. Never assign physics content to a machine learning subject. If no matching subject exists, ask the user which subject to use before creating the todos. Never default to an unrelated subject.
- When creating multiple todos (e.g. a weekly schedule), emit ALL soma-action blocks in a single response — one per task. Do not stop after the first one. It is required to emit all of them in the same message. Example for a 3-day schedule:
<soma-action>{"action":"create_todo","title":"Task 1","subject_id":"...","due_date":"2026-06-29"}</soma-action>
<soma-action>{"action":"create_todo","title":"Task 2","subject_id":"...","due_date":"2026-06-30"}</soma-action>
<soma-action>{"action":"create_todo","title":"Task 3","subject_id":"...","due_date":"2026-07-01"}</soma-action>
All blocks must appear in the same response. Each create_todo MUST have a different due_date matching the specific day that task is assigned to — never default all tasks to today.

Available colors for subjects: #ef5350 (red), #42a5f5 (blue), #66bb6a (green), #ab47bc (purple), #ffa726 (orange), #26c6da (cyan), #ec407a (pink), #8d6e63 (brown).

── TODO ACTIONS ──────────────────────────────────────────────────────────────

Create a todo (emit immediately once you have a title; ask once for missing info if needed):
<soma-action>{"action":"create_todo","title":"[task title]","subject_id":"[exact id or omit if none]","due_date":"YYYY-MM-DD"}</soma-action>

Create a todo with a time block in one step (only when the user specifies a time):
<soma-action>{"action":"create_todo","title":"[task]","subject_id":"[exact id or omit]","due_date":"YYYY-MM-DD","sessions":[{"date":"YYYY-MM-DD","start_time":"YYYY-MM-DDTHH:MM:SS","end_time":"YYYY-MM-DDTHH:MM:SS"}]}</soma-action>

Update a todo (any combination of fields; omit fields you are not changing):
<soma-action>{"action":"update_todo","todo_id":"[exact id]","title":"[new title]","due_date":"YYYY-MM-DD","notes":"[notes]"}</soma-action>

Mark a todo complete (confirm first: "Should I mark '[task]' as done?"):
<soma-action>{"action":"complete_todo","todo_id":"[exact id]"}</soma-action>

Delete a todo (confirm first: "Should I delete '[task]'? This can't be undone."):
<soma-action>{"action":"delete_todo","todo_id":"[exact id]"}</soma-action>

CRITICAL — deleting todos: Always match todos by name from the current todos list injected above — never rely on IDs from previous messages or memory. If you cannot find the todo by name in the current list, tell the user it was not found rather than claiming it was deleted. Only say something was deleted after you have emitted a delete_todo soma-action with a valid ID from the current list.

── SESSION ACTIONS ───────────────────────────────────────────────────────────

Sessions are time blocks shown on the Day View timeline. Each session belongs to a todo and has a start_time and end_time. A single todo can have multiple sessions (e.g. the same task at 9am and again at 2pm in a day, or sessions on different days).

Schedule a time block for an existing todo:
<soma-action>{"action":"create_session","todo_id":"[exact todo id]","date":"YYYY-MM-DD","start_time":"YYYY-MM-DDTHH:MM:SS","end_time":"YYYY-MM-DDTHH:MM:SS"}</soma-action>

Update a session's time (confirm first if it changes something the user set):
<soma-action>{"action":"update_session","session_id":"[exact session id from injected list]","start_time":"YYYY-MM-DDTHH:MM:SS","end_time":"YYYY-MM-DDTHH:MM:SS"}</soma-action>

Delete a session (confirm first):
<soma-action>{"action":"delete_session","session_id":"[exact session id from injected list]"}</soma-action>

Session rules:
- Use create_session when the todo already exists and the user asks to schedule it at a time.
- Use sessions array in create_todo when creating a new todo that already has a time.
- When the user wants the same task at two different times in a day, emit two create_session blocks for the same todo_id.
- All times are ISO datetime strings in local time (no trailing Z).

── SUBJECT ACTIONS ───────────────────────────────────────────────────────────

Create a subject (ask first: "Would you like me to create a [Name] project?"):
<soma-action>{"action":"create_subject","name":"[Name]","color":"#42a5f5"}</soma-action>

Update a subject name or color (emit immediately):
<soma-action>{"action":"update_subject","subject_id":"[exact id]","name":"[new name]","color":"#hexcolor"}</soma-action>

Archive a subject (confirm first: "Should I archive [Name]?"):
<soma-action>{"action":"archive_subject","subject_id":"[exact id]"}</soma-action>

Permanently delete a subject (confirm first: "Are you sure you want to delete [Name]? This is irreversible."):
<soma-action>{"action":"delete_subject","subject_id":"[exact id]"}</soma-action>`;
}

// ── Sub-components ──────────────────────────────────────────────────────────

function TodoCard({
  todos, onAccept, onDismiss, accepted,
}: {
  todos: AiTodo[];
  onAccept: () => void;
  onDismiss: () => void;
  accepted?: boolean;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>✅ Todo List</div>
      <div className={styles.cardBody}>
        {todos.map((t, i) => (
          <div key={i} className={styles.todoRow}>• {t.text}</div>
        ))}
      </div>
      <div className={styles.cardActions}>
        {accepted ? (
          <button className={`${styles.cardBtn} ${styles.cardBtnAccent} ${styles.cardBtnConfirmed}`} disabled>
            <span style={{ color: '#5B6AF0' }}>✓</span> Added to Day View
          </button>
        ) : (
          <>
            <button className={`${styles.cardBtn} ${styles.cardBtnAccent}`} onClick={onAccept}>Accept Todos</button>
            <button className={styles.cardBtn} onClick={onDismiss}>Dismiss</button>
          </>
        )}
      </div>
    </div>
  );
}

interface SessionRowProps {
  session: ChatSession;
  isActive: boolean;
  isConfirming: boolean;
  onSelect: () => void;
  onDeleteClick: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function SessionRow({ session, isActive, isConfirming, onSelect, onDeleteClick, onConfirm, onCancel }: SessionRowProps) {
  if (isConfirming) {
    return (
      <div className={styles.sessionRowConfirm}>
        <span className={styles.sessionConfirmText}>Delete?</span>
        <button className={styles.sessionConfirmYes} onClick={e => { e.stopPropagation(); onConfirm(); }}>Delete</button>
        <button className={styles.sessionConfirmNo} onClick={e => { e.stopPropagation(); onCancel(); }}>Cancel</button>
      </div>
    );
  }

  const firstUserMsg = session.messages.find(m => m.role === 'user');
  const displayTitle = firstUserMsg
    ? firstUserMsg.content.replace(/\n/g, ' ').slice(0, 50)
    : 'New chat';

  return (
    <div
      className={`${styles.sessionRow}${isActive ? ` ${styles.sessionRowActive}` : ''}`}
      onClick={onSelect}
    >
      <div className={styles.sessionInfo}>
        <span className={styles.sessionTitle}>{displayTitle}</span>
        <span className={styles.sessionTimestamp}>{fmtSessionTimestamp(session.createdAt)}</span>
      </div>
      <button
        className={styles.sessionDeleteBtn}
        title="Delete chat"
        onClick={e => { e.stopPropagation(); onDeleteClick(); }}
      >×</button>
    </div>
  );
}

function ThinkingIndicator() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = elapsed % 60;
  const mins = Math.floor(elapsed / 60);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  return (
    <div className={`${styles.messageRow} ${styles.assistantRow}`}>
      <div className={`${styles.bubble} ${styles.assistantBubble} ${styles.thinkingBubble}`}>
        <span className={styles.thinkingDots}>
          <span className={styles.thinkingDot} />
          <span className={styles.thinkingDot} />
          <span className={styles.thinkingDot} />
        </span>
        <span className={styles.thinkingTimer}>{timeStr}</span>
      </div>
    </div>
  );
}

// ── Locked screen ───────────────────────────────────────────────────────────

function AILockedScreen({ status }: { status: string }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const starIcon = (
    <svg className={styles.lockedIcon} width="28" height="28" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1L8.1 5.9L13 7L8.1 8.1L7 13L5.9 8.1L1 7L5.9 5.9Z"/>
    </svg>
  );

  // Trial ended — offer 7-day payment extension
  if (status === 'trial_expired') {
    async function handleExtend() {
      setLoading(true);
      setError('');
      try { await startCheckout(); }
      catch (e: any) { setError(e?.message ?? 'Something went wrong.'); setLoading(false); }
    }
    return (
      <div className={styles.lockedLayout}>
        <div className={styles.lockedCard}>
          {starIcon}
          <h2 className={styles.lockedTitle}>Your free trial has ended</h2>
          <p className={styles.lockedDesc}>
            Add a payment method to get <strong>7 more days free</strong>, then $4.99/mo after that. Cancel anytime.
          </p>
          {error && <p className={styles.lockedError}>{error}</p>}
          <button className={styles.lockedBtn} onClick={handleExtend} disabled={loading}>
            {loading ? 'Loading…' : 'Get 7 more days free'}
          </button>
          <p className={styles.lockedMeta}>$4.99/mo after trial · Cancel anytime</p>
        </div>
      </div>
    );
  }

  // Extension expired — full subscription required
  if (status === 'trial_extension_expired') {
    return (
      <div className={styles.lockedLayout}>
        <div className={styles.lockedCard}>
          {starIcon}
          <h2 className={styles.lockedTitle}>Your extended trial has ended</h2>
          <p className={styles.lockedDesc}>
            Subscribe to Soma Premium to continue using AI features.
          </p>
          <button className={styles.lockedBtn} onClick={() => navigate('/pricing')}>
            Subscribe — $4.99/mo
          </button>
          <p className={styles.lockedMeta}>Cancel anytime</p>
        </div>
      </div>
    );
  }

  // Free user — show trial setup modal (plan selection + card upfront)
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      {showModal && (
        <TrialSetupModal
          onComplete={() => navigate(0 as any)}
          onSkip={() => setShowModal(false)}
        />
      )}
      <div className={styles.lockedLayout}>
        <div className={styles.lockedCard}>
          {starIcon}
          <h2 className={styles.lockedTitle}>AI planning is included with Soma Premium</h2>
          <p className={styles.lockedDesc}>
            Get AI-powered scheduling, todo generation, and study planning.
            Start your <strong>21-day free trial</strong> — no charge until the trial ends.
          </p>
          <button className={styles.lockedBtn} onClick={() => setShowModal(true)}>
            Start free trial
          </button>
          <p className={styles.lockedMeta}>$5.99/mo after trial · Cancel anytime</p>
        </div>
      </div>
    </>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function AITab({ onSwitchToToday }: { onSwitchToToday: () => void }) {
  useTimeFormat(); // re-render when the 12h/24h preference changes
  const subscription = useSubscription();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const [activeSessionId, setActiveSessionId] = useState<string>(storage.getActiveSessionId);

  const [currentSubjectKey, setCurrentSubjectKey] = useState<string>('general');

  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceTriggered, setVoiceTriggered] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // getCanvasIcalUrl() below is read fresh on every render, but the value it
  // reads is populated asynchronously by loadTokens(). If this tab renders
  // before that resolves, the "Connect Canvas" banner can get stuck showing
  // for an account that's actually connected, since nothing here re-renders
  // once the real value lands. This forces one re-render when it does.
  const [, forceCanvasStatusRecheck] = useState(0);
  useEffect(() => {
    let cancelled = false;
    storage.whenTokensLoaded().then(() => {
      if (!cancelled) forceCanvasStatusRecheck(n => n + 1);
    });
    return () => { cancelled = true; };
  }, []);

  const systemPromptCache = useRef<{ prompt: string; canvasTs: number | null; dateKey: string; subjectKey: string; subjectsV: number } | null>(null);
  const subjectsVersion = useRef(0);

  // Invalidate the prompt cache whenever subjects or documents change mid-conversation
  useEffect(() => {
    const bump = () => { subjectsVersion.current += 1; };
    window.addEventListener('soma_subjects_changed', bump);
    window.addEventListener(DOCUMENTS_CHANGED_EVENT, bump);
    return () => {
      window.removeEventListener('soma_subjects_changed', bump);
      window.removeEventListener(DOCUMENTS_CHANGED_EVENT, bump);
    };
  }, []);

  // Populate the documents cache on mount so the system prompt has content
  // even if the user never visits the Documents page this session.
  useEffect(() => {
    void listDocuments().catch(() => {});
  }, []);

  function getCachedSystemPrompt(subjectKey: string): string {
    const canvasTs = storage.getCacheTimestamp();
    const dateKey = getTodayKey();
    const subjectsV = subjectsVersion.current;
    const cached = systemPromptCache.current;
    if (
      cached &&
      cached.canvasTs === canvasTs &&
      cached.dateKey === dateKey &&
      cached.subjectKey === subjectKey &&
      cached.subjectsV === subjectsV
    ) return cached.prompt;
    const prompt = buildSystemPrompt(subjectKey);
    systemPromptCache.current = { prompt, canvasTs, dateKey, subjectKey, subjectsV };
    return prompt;
  }

  const messages = useMemo(
    () => sessions.find(s => s.id === activeSessionId)?.messages ?? [],
    [sessions, activeSessionId],
  );

  const sortedSessions = useMemo(
    () => [...sessions]
      .filter(s => s.messages.length > 0 || s.id === activeSessionId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [sessions, activeSessionId],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadSessions() {
      try {
        let remote = await storage.fetchChatSessions();

        // One-time migration: if Supabase is empty, push any localStorage sessions up
        if (remote.length === 0) {
          let local = storage.getChatSessions();
          local = migrateLegacy(local);
          if (local.length > 0) {
            await storage.migrateChatSessions(local);
            localStorage.removeItem('soma_chat_sessions');
            localStorage.removeItem('soma_chat_history');
            remote = await storage.fetchChatSessions();
          }
        }

        if (cancelled) return;

        if (remote.length === 0) {
          const todayKey = getTodayKey();
          const fresh: ChatSession = {
            id: crypto.randomUUID(),
            date: todayKey,
            title: makeSessionTitle(todayKey),
            messages: [],
            createdAt: new Date().toISOString(),
          };
          await storage.upsertChatSession(fresh);
          remote = [fresh];
        }

        setSessions(remote);

        const savedId = storage.getActiveSessionId();
        if (savedId && remote.some(s => s.id === savedId)) {
          setActiveSessionId(savedId);
          const s = remote.find(x => x.id === savedId);
          if (s?.subjectKey) setCurrentSubjectKey(s.subjectKey);
        } else {
          const todayKey = getTodayKey();
          const today = remote.find(s => s.date === todayKey) ?? remote[0];
          const fallbackId = today?.id ?? '';
          setActiveSessionId(fallbackId);
          storage.setActiveSessionId(fallbackId);
          if (today?.subjectKey) setCurrentSubjectKey(today.subjectKey);
        }
      } catch (err) {
        console.error('[AITab] failed to load sessions from Supabase:', err);
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    }
    loadSessions();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (voiceTriggered && input.trim() && !loading) {
      send();
    }
  }, [voiceTriggered]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  function updateSession(id: string, fn: (s: ChatSession) => ChatSession) {
    setSessions(prev => {
      const next = prev.map(s => s.id !== id ? s : fn(s));
      const updated = next.find(s => s.id === id);
      if (updated) {
        console.log('[storage] upsertChatSession payload:', updated);
        void storage.upsertChatSession(updated).catch(err => console.error('[AITab] upsertChatSession:', err));
      }
      return next;
    });
  }

  function selectSession(id: string) {
    setActiveSessionId(id);
    storage.setActiveSessionId(id);
    setDeleteConfirmId(null);
    setInput('');
    const s = sessions.find(x => x.id === id);
    if (s?.subjectKey) setCurrentSubjectKey(s.subjectKey);
  }

  function newChat() {
    const todayKey = getTodayKey();
    const session: ChatSession = {
      id: crypto.randomUUID(),
      date: todayKey,
      title: makeSessionTitle(todayKey),
      messages: [],
      createdAt: new Date().toISOString(),
      subjectKey: currentSubjectKey,
    };
    setSessions(prev => [session, ...prev]);
    void storage.upsertChatSession(session).catch(err => console.error('[AITab] newChat upsert:', err));
    setActiveSessionId(session.id);
    storage.setActiveSessionId(session.id);
    setInput('');
  }

  function deleteSession(id: string) {
    void storage.deleteChatSession(id).catch(err => console.error('[AITab] deleteSession:', err));
    const next = sessions.filter(s => s.id !== id);
    if (id === activeSessionId) {
      if (next.length > 0) {
        const sorted = [...next].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setActiveSessionId(sorted[0].id);
        storage.setActiveSessionId(sorted[0].id);
      } else {
        const todayKey = getTodayKey();
        const fresh: ChatSession = {
          id: crypto.randomUUID(),
          date: todayKey,
          title: makeSessionTitle(todayKey),
          messages: [],
          createdAt: new Date().toISOString(),
        };
        void storage.upsertChatSession(fresh).catch(err => console.error('[AITab] deleteSession fresh:', err));
        storage.setActiveSessionId(fresh.id);
        setSessions([fresh]);
        setActiveSessionId(fresh.id);
        setDeleteConfirmId(null);
        return;
      }
    }
    setSessions(next);
    setDeleteConfirmId(null);
  }

  function stopSpeaking() {
    window.speechSynthesis.cancel();
  }

  function speakText(text: string) {
    stopSpeaking();
    const clean = text
      .replace(/<[^>]+>/g, '')
      .replace(/\*\*/g, '')
      .replace(/^[-•]\s*/gm, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .trim();
    if (!clean) return;
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  }

  function toggleVoice() {
    if (voiceActive) {
      recognitionRef.current?.stop();
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    stopSpeaking();
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognitionRef.current = recognition;

    let finalTranscript = '';

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += t;
        } else {
          interim = t;
        }
      }
      setInput(finalTranscript + interim);
    };

    recognition.onend = () => {
      setVoiceActive(false);
      recognitionRef.current = null;
      if (finalTranscript.trim()) {
        setVoiceTriggered(true);
      }
    };

    recognition.onerror = () => {
      setVoiceActive(false);
      recognitionRef.current = null;
    };

    setVoiceActive(true);
    recognition.start();
  }

  async function send() {
    const text = input.trim();
    if (!text || loading || !activeSessionId) return;

    const isVoice = voiceTriggered;
    setVoiceTriggered(false);
    stopSpeaking();

    const session = sessions.find(s => s.id === activeSessionId);
    if (!session) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    const messagesWithUser = [...session.messages, userMsg];

    setInput('');
    setLoading(true);
    updateSession(activeSessionId, s => ({ ...s, messages: messagesWithUser }));

    try {
      let systemPrompt = getCachedSystemPrompt(currentSubjectKey);
      try {
        const incompleteTodos = await storage.fetchIncompleteTodos();
        if (incompleteTodos.length > 0) {
          const subjectNameMap = new Map(storage.getSubjects().map(s => [s.id, s.name]));
          const todosStr = incompleteTodos.map(t => {
            const subjectName = t.subjectId ? (subjectNameMap.get(t.subjectId) ?? 'Unknown') : 'None';
            return `- ${t.text} | id: ${t.id} | subject: ${subjectName} | due: ${t.date ?? 'none'}`;
          }).join('\n');
          systemPrompt += `\n\nThe user's current todos (use these exact IDs in any soma-actions):\n${todosStr}`;
        }
      } catch { /* non-critical */ }
      try {
        const todayKey = getTodayKey();
        const todaySessions = await storage.fetchTodoSessions(todayKey);
        if (todaySessions.length > 0) {
          const subjectNameMap = new Map(storage.getSubjects().map(s => [s.id, s.name]));
          const sessionsStr = todaySessions.map(s => {
            const subjectName = s.subjectId ? (subjectNameMap.get(s.subjectId) ?? 'Unknown') : 'None';
            const start = s.startTime ? fmtTime12(s.startTime) : '?';
            const end = s.endTime ? fmtTime12(s.endTime) : '?';
            return `- ${s.todoText ?? 'Untitled'} | session_id: ${s.id} | subject: ${subjectName} | ${start}–${end}`;
          }).join('\n');
          systemPrompt += `\n\nThe user's scheduled sessions for today (use these exact session_ids for update/delete):\n${sessionsStr}`;
        }
      } catch { /* non-critical */ }
      if (isVoice) {
        systemPrompt += `\n\nIMPORTANT — VOICE MODE: The student is speaking to you by voice. Keep your response concise and conversational — short sentences, no bullet lists, no markdown formatting, no special tags like <todos>, <createDoc>, <createSlides>, or <soma-action>. Respond as if you are talking back to them naturally. Still be helpful and accurate, just speak in plain conversational sentences. Describe any schedule or tasks conversationally (e.g. "I'd start with calc at 9, then chem at 11") rather than using structured blocks.`;
      }
      const apiMessages = [
        ...messagesWithUser.slice(-10, -1).map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: text },
      ];
      const planningKeywords = ['schedule', 'study plan', 'plan my day', 'generate'];
      const needsSonnet = planningKeywords.some(kw => text.toLowerCase().includes(kw));
      const response = await sendMessage(apiMessages, systemPrompt, needsSonnet ? 'sonnet' : undefined);
      const todos = parseTodos(response) ?? undefined;
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(), role: 'assistant', content: response, todos,
      };
      updateSession(activeSessionId, s => ({ ...s, messages: [...s.messages, assistantMsg] }));

      const somaActions = parseSomaActions(response);
      if (somaActions.length > 0) {
        Promise.all(somaActions.map(a => executeSomaAction(a))).then(confirms => {
          const msgs = confirms.filter(Boolean) as string[];
          if (msgs.length > 0) {
            const confirmText = msgs.join('\n');
            updateSession(activeSessionId, s => ({
              ...s,
              messages: s.messages.map(m =>
                m.id === assistantMsg.id ? { ...m, confirmText } : m,
              ),
            }));
          }
        });
      }

      if (isVoice) speakText(response);
    } catch (err: unknown) {
      const code = (err as { message?: string })?.message ?? '';
      const content = code === 'subscription_required'
        ? 'Your subscription has expired. Visit Settings → Subscription to manage your plan.'
        : code === 'rate_limit'
        ? 'Rate limit reached — please wait a moment and try again.'
        : code === 'context_too_long'
        ? 'Your message was too long for a single response. Try asking for a shorter plan.'
        : code === 'overloaded'
        ? 'The AI is overloaded right now — please try again in a few seconds.'
        : code.startsWith('api_error:')
        ? `Something went wrong (${code.replace('api_error:', 'error ')}). Please try again.`
        : friendlyError('ai');
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(), role: 'assistant',
        content,
      };
      updateSession(activeSessionId, s => ({ ...s, messages: [...s.messages, errorMsg] }));
    } finally {
      setLoading(false);
    }
  }

  function acceptTodos(msgId: string, todos: AiTodo[]) {
    const todayKey = getTodayKey();
    const newTodos: Todo[] = todos.map(item => ({
      id: crypto.randomUUID(),
      text: item.text,
      status: 'nothing' as const,
      subjectId: item.subjectId,
      assignmentId: item.assignmentId,
      date: todayKey,
    }));
    storage.setTodos(newTodos);

    updateSession(activeSessionId, s => ({
      ...s, messages: s.messages.map(m => m.id === msgId ? { ...m, todosAccepted: true } : m),
    }));
    onSwitchToToday();
  }

  function dismissTodos(msgId: string) {
    updateSession(activeSessionId, s => ({
      ...s, messages: s.messages.map(m => m.id === msgId ? { ...m, todosDismissed: true } : m),
    }));
  }


  if (subscription.status === 'loading') {
    return (
      <div className={styles.layout}>
        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <SkeletonBlock width={60} height={13} />
          </div>
          <SessionListSkeleton />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '32px 40px', gap: 20 }}>
          <div style={{ alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SkeletonBlock width={260} height={14} borderRadius={10} />
            <SkeletonBlock width={180} height={14} borderRadius={10} />
          </div>
          <div style={{ alignSelf: 'flex-end', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SkeletonBlock width={200} height={14} borderRadius={10} />
          </div>
          <div style={{ alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SkeletonBlock width={300} height={14} borderRadius={10} />
            <SkeletonBlock width={220} height={14} borderRadius={10} />
            <SkeletonBlock width={160} height={14} borderRadius={10} />
          </div>
        </div>
      </div>
    );
  }

  if (!hasAIAccess(subscription.status)) {
    return <AILockedScreen status={subscription.status} />;
  }

  return (
    <div className={styles.layout}>
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <button className={styles.newChatBtnFull} onClick={newChat}>+ New Chat</button>
        </div>

        <div className={styles.sessionList}>
          {sessionsLoading ? <SessionListSkeleton /> : sortedSessions.map(session => (
            <SessionRow
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              isConfirming={deleteConfirmId === session.id}
              onSelect={() => selectSession(session.id)}
              onDeleteClick={() => setDeleteConfirmId(session.id)}
              onConfirm={() => deleteSession(session.id)}
              onCancel={() => setDeleteConfirmId(null)}
            />
          ))}
          {!sessionsLoading && sortedSessions.every(s => s.messages.length === 0) && (
            <p className={styles.sessionEmptyHint}>No chats yet</p>
          )}
        </div>
      </div>

      {/* ── Chat area ───────────────────────────────────────────────────── */}
      <div className={styles.chatArea}>
        <div className={styles.messageList}>
          {messages.length === 0 && (() => {
            const canvasConnected = Boolean(storage.getCanvasIcalUrl());
            const chips = canvasConnected
              ? ['Plan my week', "What's due soon?", 'Help me focus today']
              : ['Plan my day', 'What should I study first?'];
            return (
              <div className={styles.emptyState}>
                <div className={styles.emptyHint}>Start by describing what you need to accomplish today.</div>
                {!canvasConnected && (
                  <div className={styles.canvasBanner}>
                    Connect Canvas to let Soma see your assignments.{' '}
                    <a href="/canvas" className={styles.canvasBannerLink}>Connect</a>
                  </div>
                )}
                <div className={styles.suggestions}>
                  {chips.map(s => (
                    <button key={s} className={styles.suggestionBtn} onClick={() => setInput(s)}>{s}</button>
                  ))}
                </div>
              </div>
            );
          })()}
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`${styles.messageRow} ${msg.role === 'user' ? styles.userRow : styles.assistantRow}`}
            >
              <div
                className={`${styles.bubble} ${msg.role === 'user' ? styles.userBubble : styles.assistantBubble}`}
                dangerouslySetInnerHTML={{ __html: formatMessage(stripTags(msg.content)) }}
              />
              {msg.role === 'assistant' && msg.todos && !msg.todosDismissed && (
                <TodoCard
                  todos={msg.todos}
                  onAccept={() => acceptTodos(msg.id, msg.todos!)}
                  onDismiss={() => dismissTodos(msg.id)}
                  accepted={msg.todosAccepted}
                />
              )}
              {msg.role === 'assistant' && msg.confirmText && (
                <div className={styles.somaActionConfirm}>
                  {msg.confirmText}
                </div>
              )}
            </div>
          ))}
          {loading && <ThinkingIndicator />}
          <div ref={messagesEndRef} />
        </div>

        <div className={styles.inputAreaWrapper}>
          <div className={styles.inputRow}>
            <textarea
              ref={textareaRef}
              className={styles.textInput}
              placeholder="Message Soma…"
              value={input}
              disabled={loading}
              rows={1}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button
              className={`${styles.micBtn}${voiceActive ? ` ${styles.micBtnActive}` : ''}`}
              onClick={toggleVoice}
              disabled={loading}
              title={voiceActive ? 'Stop listening' : 'Voice input'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="1" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <line x1="12" y1="17" x2="12" y2="23" />
              </svg>
            </button>
            <button
              className={styles.sendBtn}
              onClick={send}
              disabled={loading || !input.trim()}
            >Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}
