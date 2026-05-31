import { useState, useRef, useEffect, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { useNavigate } from 'react-router-dom';
import { storage } from '../../lib/storage';
import { sendMessage } from '../../lib/ai';
import { createGoogleDoc, createGoogleSlides } from '../../lib/googleDocs';
import { parseCreateDoc, parseCreateSlides, CREATE_TEMPLATES, generatePreview, CreateTemplate } from '../../lib/aiArtifacts';
import { readDriveFile, fileTypeLabel, getFolderContentsForPrompt, readCachedFolderSection, getFolderContentsCacheTs, hasTruncatedFolderFiles } from '../../lib/googleDrive';
import { useGooglePicker, PickedFile } from '../../lib/useGooglePicker';
import { friendlyError } from '../../lib/errors';
import { useSubscription, hasAIAccess, startTrial, startCheckout } from '../../lib/subscription';
import { SavedCreation, loadCreateHistory, appendToCreateHistory, CREATE_HISTORY_EVENT } from '../../lib/createHistory';
import { TimeBlock, Subject, Todo, ChatMessage, ChatSession, AiTodo, CanvasAssignment } from '../../types';
import SubjectDot from '../shared/SubjectDot';
import { SkeletonBlock } from '../UI/Skeleton';
import TrialConfirmModal from '../UI/TrialConfirmModal';
import styles from './AITab.module.css';

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

function getOrCreateTodayForSubject(sessions: ChatSession[], subjectKey: string): { session: ChatSession; all: ChatSession[] } {
  const todayKey = getTodayKey();
  const existing = sessions.find(s => s.date === todayKey && (s.subjectKey ?? 'general') === subjectKey);
  if (existing) return { session: existing, all: sessions };
  const session: ChatSession = {
    id: crypto.randomUUID(),
    date: todayKey,
    title: makeSessionTitle(todayKey),
    messages: [],
    createdAt: new Date().toISOString(),
    subjectKey,
  };
  return { session, all: [session, ...sessions] };
}

function getOrCreateToday(sessions: ChatSession[]): { session: ChatSession; all: ChatSession[] } {
  return getOrCreateTodayForSubject(sessions, 'general');
}

// ── Message formatting ──────────────────────────────────────────────────────

function isToday(iso: string) {
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear()
    && d.getMonth() === n.getMonth()
    && d.getDate() === n.getDate();
}

function fmtBlockTime(iso: string) {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtDuration(startIso: string, endIso: string) {
  const mins = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000;
  if (mins >= 60 && mins % 60 === 0) return `${mins / 60}h`;
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${mins}m`;
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
    .trim();
}

function formatMessage(content: string): string {
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>');
  return DOMPurify.sanitize(escaped, { ALLOWED_TAGS: ['strong'], ALLOWED_ATTR: [] });
}

function parseScheduleBlocks(content: string): TimeBlock[] | null {
  const match = content.match(/<schedule>([\s\S]*?)<\/(?:schedule|todos)>/);
  if (!match) return null;
  try {
    const raw: Partial<TimeBlock>[] = JSON.parse(match[1].trim());
    return raw.map(b => ({
      id: crypto.randomUUID(),
      subjectId: b.subjectId ?? '',
      task: b.task ?? '',
      startTime: b.startTime ?? '',
      endTime: b.endTime ?? '',
      source: 'ai' as const,
    }));
  } catch { return null; }
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

// ── System prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(activeSubjectKey?: string): string {
  const subjects = storage.getSubjects();
  const assignments = storage.getCachedAssignments();
  const announcements = storage.getCachedAnnouncements();
  const modules = storage.getCachedModules();
  const blocks = storage.getTimeBlocks().filter(b => isToday(b.startTime));
  const gcalEvents = storage.getCachedGoogleEvents().filter(
    e => !!e.start.dateTime && isToday(e.start.dateTime),
  );

  const now = new Date();
  const date = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const subjectsStr = subjects.map(s => `${s.name} (id: ${s.id})`).join(', ');

  const assignmentStatus = storage.getAssignmentStatus() as Record<string, string>;
  const statusLabel: Record<string, string> = {
    not_started: 'not started',
    in_progress: 'in progress',
    done: 'done',
  };
  const assignmentsStr = assignments.length > 0
    ? assignments.map(a => {
        const due = new Date(a.dueAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const status = statusLabel[assignmentStatus[String(a.id)] ?? 'not_started'] ?? 'not started';
        const desc = a.description ? `\n  Description: ${a.description.slice(0, 300)}` : '';
        return `- ${a.name} (id: ${a.id}) | ${a.courseName} | Due: ${due} | Status: ${status}${desc}`;
      }).join('\n')
    : 'None';

  const blocksStr = blocks.length > 0
    ? blocks.map(b => {
        const subj = subjects.find(s => s.id === b.subjectId);
        return `- ${fmtBlockTime(b.startTime)}–${fmtBlockTime(b.endTime)}: ${subj?.name ?? 'Unknown'} — ${b.task}`;
      }).join('\n')
    : 'No blocks scheduled yet';

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

  const driveConnected = !!storage.getGoogleDriveToken();
  const folderSection = readCachedFolderSection();
  const folderHasTruncated = hasTruncatedFolderFiles();

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

Their subjects: ${subjectsStr}

Upcoming assignments (next 14 days):
${assignmentsStr}
${folderSection ? `\nIMPORTANT: The study materials below are real file contents you have already read and fully know. When the user references any topic, subject, or file — even loosely or by nickname — match it to the closest file in your study materials and answer from it directly. Never say you cannot access files, cannot see folders, or need the user to share anything. You already have the content. "AP Government review", "AP Gov study guide", "the review sheet" etc. should all map to the AP Government file.\n\nYou have full knowledge of the following study materials from the user's Google Drive folder. Reference them naturally when relevant, as if you've already read them:\n\n${folderSection}\n${folderHasTruncated ? '\nNote: Some files were too large to include in full. The user may not get complete answers about those files.\n' : ''}` : ''}
User availability:
${availabilityStr || 'Not set — ask the user what time they want to start and end.'}

Current schedule:
${blocksStr}
${gcalStr ? `\nExisting calendar events (read-only, do not schedule over these):\n${gcalStr}` : ''}
${announcementsStr ? `\nRecent course announcements:\n${announcementsStr}` : ''}
${modulesStr ? `\nCourse modules (structure):\n${modulesStr}` : ''}
When the user asks you to generate a schedule or todo list, respond with:
1. A friendly natural language explanation
2. If generating a schedule: a JSON array wrapped in <schedule>...</schedule> tags
3. If generating todos: a JSON array wrapped in <todos>...</todos> tags

CRITICAL: Always close <schedule> with </schedule> and <todos> with </todos>. Never mix closing tags.

CRITICAL: NEVER output both <schedule> and <todos> in the same response. Choose exactly one:
- Use <schedule> when the user asks to plan their day, create a schedule, or asks what to do today with a time structure. Accepting a schedule automatically creates todos, so adding <todos> alongside a <schedule> is always wrong and redundant.
- Use <todos> when the user asks for a task list, things to do for a specific assignment, or a checklist — only when no time structure is needed.

Schedule item format: { subjectId, task, startTime (ISO), endTime (ISO), source: "ai" }
Todo item format: [{"text":"...","subjectId":"uuid-here","assignmentId":12345}]
Use the exact subject IDs from the subjects list above. Use the exact assignment IDs from the assignments list above. Set subjectId to null if no subject applies. Set assignmentId to null if not linked to a Canvas assignment.
Match subjectId to the user's existing subjects by name (case-insensitive).
${driveConnected ? `
GOOGLE DRIVE — CREATING FILES:
The user has connected Google Drive, so you can create real Google Docs and Google Slides for them when they ask.

When the user asks you to create/write a Google Doc, take notes into a doc, write an essay/summary in Docs, or answer a homework assignment in a doc, respond with:
1. One short sentence confirming what you're creating.
2. A <createDoc> block containing the full content:
<createDoc title="Short descriptive title">
The full document text goes here. Write it in full — this exact text becomes the Google Doc body. Use plain text with line breaks; you may use simple markdown like ** for emphasis and - for lists.
</createDoc>

When the user asks you to create a Google Slides presentation / slide deck / slides, respond with:
1. One short sentence confirming what you're creating.
2. A <createSlides> block. Use "== " to start each slide (its title) and "- " for each bullet:
<createSlides title="Deck title">
== First slide title
- First bullet point
- Second bullet point
== Second slide title
- A bullet
- Another bullet
</createSlides>

CRITICAL rules for file creation:
- Always close <createDoc> with </createDoc> and <createSlides> with </createSlides>.
- Put the FULL content inside the block — never say "I'll create it" without the block, and never put placeholder text. The block is what actually gets created.
- Use a <createDoc> OR a <createSlides> block, never both, and never alongside <schedule>/<todos>.
- If an assignment or file was attached to the message, use its actual content when answering or summarizing.
- Keep the natural-language part outside the block very short — the real output lives in the file.
` : `
NOTE: The user has NOT connected Google Drive. If they ask you to create a Google Doc or Slides, briefly tell them to connect Google Drive in Settings → Integrations first, then offer to write the content directly in chat instead.
`}
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
If the user's availability is set above, use it to constrain the schedule automatically — do not ask for start/end times unless the user asks to override them. If availability is not set, ask the user what time they want to start and end their day before generating a schedule.`;
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ScheduleCard({
  blocks, subjects, onAccept, onDismiss,
}: {
  blocks: TimeBlock[];
  subjects: Subject[];
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>📅 Proposed Schedule</div>
      <div className={styles.cardBody}>
        {blocks.map(b => {
          const subj = subjects.find(s => s.id === b.subjectId);
          return (
            <div key={b.id} className={styles.scheduleRow}>
              <span className={styles.scheduleTime}>{fmtBlockTime(b.startTime)}</span>
              {subj && <SubjectDot color={subj.color} size={8} />}
              <span className={styles.scheduleTask}>
                {subj ? `${subj.name} — ${b.task}` : b.task}
              </span>
              <span className={styles.scheduleDur}>{fmtDuration(b.startTime, b.endTime)}</span>
            </div>
          );
        })}
      </div>
      <div className={styles.cardActions}>
        <button className={`${styles.cardBtn} ${styles.cardBtnAccent}`} onClick={onAccept}>Accept Schedule</button>
        <button className={styles.cardBtn} onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

function TodoCard({
  todos, onAccept, onDismiss,
}: {
  todos: AiTodo[];
  onAccept: () => void;
  onDismiss: () => void;
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
        <button className={`${styles.cardBtn} ${styles.cardBtnAccent}`} onClick={onAccept}>Accept Todos</button>
        <button className={styles.cardBtn} onClick={onDismiss}>Dismiss</button>
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

  const msgCount = session.messages.length;
  return (
    <div
      className={`${styles.sessionRow}${isActive ? ` ${styles.sessionRowActive}` : ''}`}
      onClick={onSelect}
    >
      <div className={styles.sessionInfo}>
        <span className={styles.sessionTitle}>{session.title}</span>
        {msgCount > 0 && (
          <span className={styles.sessionCount}>{msgCount} msg{msgCount !== 1 ? 's' : ''}</span>
        )}
      </div>
      <button
        className={styles.sessionDeleteBtn}
        title="Delete chat"
        onClick={e => { e.stopPropagation(); onDeleteClick(); }}
      >×</button>
    </div>
  );
}

// ── Files panel ─────────────────────────────────────────────────────────────

function fmtFileDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function FilesPanel({ subjects, onClose }: { subjects: Subject[]; onClose: () => void }) {
  const [history, setHistory] = useState<SavedCreation[]>(() => loadCreateHistory());
  const [sort, setSort] = useState<'date' | 'type'>('date');

  useEffect(() => {
    const handler = () => setHistory(loadCreateHistory());
    window.addEventListener(CREATE_HISTORY_EVENT, handler);
    return () => window.removeEventListener(CREATE_HISTORY_EVENT, handler);
  }, []);

  const groups = useMemo(() => {
    const groupMap = new Map<string, SavedCreation[]>();
    for (const item of history) {
      const key = item.subjectId ?? 'general';
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(item);
    }
    for (const items of groupMap.values()) {
      items.sort((a, b) => {
        if (sort === 'type' && a.kind !== b.kind) return a.kind === 'doc' ? -1 : 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    }
    return [...groupMap.entries()].sort(([keyA, itemsA], [keyB, itemsB]) => {
      if (keyA === 'general') return 1;
      if (keyB === 'general') return -1;
      const latestA = Math.max(...itemsA.map(i => new Date(i.createdAt).getTime()));
      const latestB = Math.max(...itemsB.map(i => new Date(i.createdAt).getTime()));
      return latestB - latestA;
    });
  }, [history, sort]);

  return (
    <div className={styles.filesPanel}>
      <div className={styles.filesPanelHeader}>
        <span className={styles.filesPanelTitle}>Files</span>
        <div className={styles.filesSortRow}>
          <button
            className={`${styles.filesSortBtn}${sort === 'date' ? ` ${styles.filesSortBtnActive}` : ''}`}
            onClick={() => setSort('date')}
          >Date</button>
          <button
            className={`${styles.filesSortBtn}${sort === 'type' ? ` ${styles.filesSortBtnActive}` : ''}`}
            onClick={() => setSort('type')}
          >Type</button>
        </div>
        <button className={styles.filesPanelClose} onClick={onClose} title="Close files panel">✕</button>
      </div>

      {history.length === 0 ? (
        <div className={styles.filesEmpty}>No files generated yet</div>
      ) : (
        <div className={styles.filesList}>
          {groups.map(([groupKey, items]) => {
            const subject = groupKey !== 'general' ? subjects.find(s => s.id === groupKey) : null;
            return (
              <div key={groupKey} className={styles.filesGroup}>
                <div className={styles.filesGroupHeader}>
                  {subject
                    ? <SubjectDot color={subject.color} size={7} />
                    : <span className={styles.filesGroupDotGeneral} />}
                  <span className={styles.filesGroupLabel}>{subject?.name ?? 'General'}</span>
                </div>
                {items.map(item => (
                  item.url ? (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.filesItem}
                    >
                      <span className={styles.filesItemIcon}>{item.kind === 'slides' ? '📊' : '📄'}</span>
                      <div className={styles.filesItemInfo}>
                        <span className={styles.filesItemTitle}>{item.title}</span>
                        <span className={styles.filesItemDate}>{fmtFileDate(item.createdAt)}</span>
                      </div>
                    </a>
                  ) : (
                    <div key={item.id} className={`${styles.filesItem} ${styles.filesItemUnavailable}`}>
                      <span className={styles.filesItemIcon}>{item.kind === 'slides' ? '📊' : '📄'}</span>
                      <div className={styles.filesItemInfo}>
                        <span className={styles.filesItemTitle}>{item.title}</span>
                        <span className={styles.filesItemUnavailableLabel}>Unavailable</span>
                      </div>
                    </div>
                  )
                ))}
              </div>
            );
          })}
        </div>
      )}
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

  // Free user — confirm then start the 3-week trial
  const [showModal, setShowModal] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    setError('');
    try {
      await startTrial();
      navigate(0 as any);
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
      setLoading(false);
    }
  }

  return (
    <>
      {showModal && (
        <TrialConfirmModal
          onConfirm={handleConfirm}
          onCancel={() => setShowModal(false)}
          loading={loading}
          error={error}
        />
      )}
      <div className={styles.lockedLayout}>
        <div className={styles.lockedCard}>
          {starIcon}
          <h2 className={styles.lockedTitle}>AI planning is included with Soma Premium</h2>
          <p className={styles.lockedDesc}>
            Get AI-powered scheduling, todo generation, and study planning.
            Start your <strong>3-week free trial</strong> — no charge today.
          </p>
          <button className={styles.lockedBtn} onClick={() => setShowModal(true)}>
            Start free trial
          </button>
          <p className={styles.lockedMeta}>$4.99/mo after trial · Cancel anytime</p>
        </div>
      </div>
    </>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function AITab({ onSwitchToToday }: { onSwitchToToday: () => void }) {
  const subscription = useSubscription();

  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    let s = storage.getChatSessions();
    s = migrateLegacy(s);
    const { all } = getOrCreateToday(s);
    storage.setChatSessions(all);
    return all;
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const all = storage.getChatSessions();
    const savedId = storage.getActiveSessionId();
    if (savedId && all.some(s => s.id === savedId)) return savedId;
    const todayKey = getTodayKey();
    const today = all.find(s => s.date === todayKey);
    const fallback = today?.id ?? all[0]?.id ?? '';
    storage.setActiveSessionId(fallback);
    return fallback;
  });

  const [currentSubjectKey, setCurrentSubjectKey] = useState<string>(() => {
    const savedId = storage.getActiveSessionId();
    if (savedId) {
      const all = storage.getChatSessions();
      const saved = all.find(s => s.id === savedId);
      if (saved?.subjectKey) return saved.subjectKey;
    }
    return 'general';
  });

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [sidebarMounted, setSidebarMounted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const subjects = storage.getSubjects();

  const [driveToken, setDriveToken] = useState(() => storage.getGoogleDriveToken());
  const [docUrls, setDocUrls] = useState<Record<string, string>>({});
  const [docLoadingId, setDocLoadingId] = useState<string | null>(null);
  const [docErrors, setDocErrors] = useState<Record<string, string>>({});
  const [saveAsDocMode, setSaveAsDocMode] = useState(false);

  // ── Quick-create ─────────────────────────────────────────────────────────
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickTemplate, setQuickTemplate] = useState<CreateTemplate | null>(null);
  const [quickSourceType, setQuickSourceType] = useState<'topic' | 'assignment' | 'subject' | 'file'>('topic');
  const [quickTopic, setQuickTopic] = useState('');
  const [quickAssignmentId, setQuickAssignmentId] = useState<number | null>(null);
  const [quickSubjectId, setQuickSubjectId] = useState('');
  const [quickInstructions, setQuickInstructions] = useState('');
  const [quickGenerating, setQuickGenerating] = useState(false);
  const [quickError, setQuickError] = useState('');
  const [quickDriveFile, setQuickDriveFile] = useState<{ id: string; title: string } | null>(null);
  const [quickDriveLoading, setQuickDriveLoading] = useState(false);

  const QUICK_ICONS: Record<string, string> = {
    notes: '📝', quiz: '🃏', studyguide: '📋', slides: '📊', outline: '✏️', summary: '📄',
  };

  const [filesPanelOpen, setFilesPanelOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('soma_files_panel_open') === 'true'; }
    catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem('soma_files_panel_open', String(filesPanelOpen)); }
    catch { /* ignore */ }
  }, [filesPanelOpen]);

  // AI-created artifacts (doc / slides) keyed by message id
  interface Artifact { kind: 'doc' | 'slides'; title: string; status: 'creating' | 'done' | 'error'; url?: string; error?: string }
  const [artifacts, setArtifacts] = useState<Record<string, Artifact>>({});

  // Attached Google Drive file (via Google Picker)
  interface AttachedFile { id: string; title: string; content: string; mimeType: string }
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachError, setAttachError] = useState('');

  useEffect(() => {
    const handler = () => setDriveToken(storage.getGoogleDriveToken());
    window.addEventListener('soma_gdrive_updated', handler);
    return () => window.removeEventListener('soma_gdrive_updated', handler);
  }, []);

  function friendlyAttachError(err: Error): string {
    switch (err.message) {
      case 'no_access':            return "Can't read that file — make sure it's shared with your Google account.";
      case 'not_found':            return 'File not found.';
      case 'unsupported_type':     return "This file type can't be read. Open it in Google Docs/Slides first, then attach.";
      case 'google_token_expired': return 'Google access expired — reconnect Google Drive in Settings.';
      default:                     return 'Could not read file. Try again.';
    }
  }

  function onPickDriveFile(file: PickedFile) {
    if (!driveToken) return;
    setAttachLoading(true);
    setAttachError('');
    readDriveFile(driveToken, file.id)
      .then(({ title, content, mimeType }) =>
        setAttachedFile({ id: file.id, title, content, mimeType }))
      .catch((err: Error) => setAttachError(friendlyAttachError(err)))
      .finally(() => setAttachLoading(false));
  }

  const { openPicker } = useGooglePicker(driveToken, onPickDriveFile);

  function onPickQuickFile(file: PickedFile) {
    setQuickDriveFile({ id: file.id, title: file.name });
  }
  const { openPicker: openQuickPicker } = useGooglePicker(driveToken, onPickQuickFile);

  const assignments: CanvasAssignment[] = storage.getCachedAssignments();
  const nonArchivedSubjects = subjects.filter(s => !s.archived);

  async function handleQuickGenerate() {
    if (!quickTemplate || quickGenerating) return;
    setQuickGenerating(true);
    setQuickError('');

    try {
      let sourceLabel = '';
      let sourceContext = '';
      const MAX_FILE = 12_000;

      if (quickSourceType === 'topic') {
        sourceLabel = quickTopic.trim();
        if (!sourceLabel) { setQuickError('Enter a topic.'); return; }
      } else if (quickSourceType === 'assignment') {
        const a = assignments.find(x => x.id === quickAssignmentId);
        if (!a) { setQuickError('Select an assignment.'); return; }
        sourceLabel = `${a.name} (${a.courseName})`;
        sourceContext = [
          `Assignment: ${a.name}`,
          `Course: ${a.courseName}`,
          a.dueAt ? `Due: ${new Date(a.dueAt).toLocaleDateString()}` : '',
          a.description ? `Details: ${a.description}` : '',
        ].filter(Boolean).join('\n');
      } else if (quickSourceType === 'subject') {
        const s = nonArchivedSubjects.find(x => x.id === quickSubjectId);
        if (!s) { setQuickError('Select a subject.'); return; }
        sourceLabel = s.name;
      } else if (quickSourceType === 'file') {
        if (!quickDriveFile) { setQuickError('Select a Drive file.'); return; }
        if (!driveToken) { setQuickError('Connect Google Drive in Settings first.'); return; }
        setQuickDriveLoading(true);
        const { title, content } = await readDriveFile(driveToken, quickDriveFile.id);
        setQuickDriveLoading(false);
        sourceLabel = title;
        sourceContext = content.length > MAX_FILE
          ? `${content.slice(0, MAX_FILE)}\n\n[Truncated]`
          : content;
      }

      const preview = await generatePreview({
        template: quickTemplate,
        sourceLabel,
        sourceContext,
        instructions: quickInstructions.trim() || undefined,
      });

      // Build a human-readable preview — shown in the bubble after stripTags removes the XML
      let previewText: string;
      if (preview.kind === 'slides' && preview.slidesSpec) {
        previewText = preview.slidesSpec.slides
          .map(s => `**${s.title}**${s.bullets.length > 0 ? '\n' + s.bullets.map(b => `• ${b}`).join('\n') : ''}`)
          .join('\n\n');
      } else {
        previewText = preview.docSpec?.content ?? '';
      }

      const icon = QUICK_ICONS[quickTemplate.id] ?? quickTemplate.icon;
      const msgContent = `${icon} **${quickTemplate.label}: ${preview.title}**\n\n${previewText}\n\n${preview.rawContent}`;

      const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: msgContent };
      updateSession(activeSessionId, s => ({ ...s, messages: [...s.messages, assistantMsg] }));
      void runCreation(assistantMsg.id, preview.rawContent, currentSubjectKey);

      setQuickTemplate(null);
      setQuickTopic('');
      setQuickAssignmentId(null);
      setQuickSubjectId('');
      setQuickInstructions('');
      setQuickDriveFile(null);
    } catch (err: unknown) {
      const msg = (err as Error).message;
      setQuickDriveLoading(false);
      setQuickError(
        msg === 'generation_failed'    ? 'Could not generate content. Try rephrasing.'
        : msg === 'subscription_required' ? 'Subscription required.'
        : msg === 'google_token_expired'  ? 'Google access expired — reconnect Drive in Settings.'
        : 'Something went wrong. Try again.',
      );
    } finally {
      setQuickGenerating(false);
    }
  }

  async function saveToDoc(msgId: string, content: string) {
    const token = storage.getGoogleDriveToken();
    if (!token) return;
    setDocLoadingId(msgId);
    setDocErrors(prev => { const next = { ...prev }; delete next[msgId]; return next; });
    try {
      const title = content.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Soma AI Response';
      const { docUrl } = await createGoogleDoc(token, title, content);
      setDocUrls(prev => ({ ...prev, [msgId]: docUrl }));
      appendToCreateHistory({
        kind: 'doc', title, url: docUrl, templateLabel: 'AI Response', sourceLabel: '',
        createdAt: new Date().toISOString(),
        subjectId: currentSubjectKey.startsWith('subject_') ? currentSubjectKey.slice('subject_'.length) : undefined,
      });
    } catch (err: any) {
      const msg = err?.message === 'google_token_expired'
        ? 'Google access expired — reconnect Google Drive in Settings.'
        : 'Could not create doc. Try again.';
      setDocErrors(prev => ({ ...prev, [msgId]: msg }));
    } finally {
      setDocLoadingId(null);
    }
  }

  // Execute an AI-requested creation (doc or slides) and track its status per message.
  async function runCreation(msgId: string, response: string, subjectKey: string) {
    const docSpec = parseCreateDoc(response);
    const slidesSpec = parseCreateSlides(response);
    if (!docSpec && !slidesSpec) return;

    const kind: Artifact['kind'] = slidesSpec ? 'slides' : 'doc';
    const title = (slidesSpec?.title ?? docSpec?.title ?? 'Untitled').slice(0, 80);

    if (!driveToken) {
      setArtifacts(prev => ({
        ...prev,
        [msgId]: { kind, title, status: 'error', error: 'Connect Google Drive in Settings to create files.' },
      }));
      return;
    }

    const subjectId = subjectKey.startsWith('subject_') ? subjectKey.slice('subject_'.length) : undefined;
    setArtifacts(prev => ({ ...prev, [msgId]: { kind, title, status: 'creating' } }));
    try {
      let url: string;
      if (slidesSpec) {
        const { presentationUrl } = await createGoogleSlides(driveToken, slidesSpec.title, slidesSpec.slides);
        url = presentationUrl;
      } else {
        const { docUrl } = await createGoogleDoc(driveToken, docSpec!.title, docSpec!.content);
        url = docUrl;
      }
      setArtifacts(prev => ({ ...prev, [msgId]: { kind, title, status: 'done', url } }));
      appendToCreateHistory({ kind, title, url, templateLabel: 'AI Chat', sourceLabel: '', createdAt: new Date().toISOString(), subjectId });
    } catch (err: unknown) {
      const e = err as Error & { presentationUrl?: string };
      // Slides population partly failed but the deck exists — still link to it
      if (e.presentationUrl) {
        setArtifacts(prev => ({ ...prev, [msgId]: { kind, title, status: 'done', url: e.presentationUrl } }));
        appendToCreateHistory({ kind, title, url: e.presentationUrl!, templateLabel: 'AI Chat', sourceLabel: '', createdAt: new Date().toISOString(), subjectId });
        return;
      }
      const msg = e.message === 'google_token_expired'
        ? 'Google access expired — reconnect Google Drive in Settings.'
        : kind === 'slides' ? 'Could not create the presentation. Try again.'
        : 'Could not create the doc. Try again.';
      setArtifacts(prev => ({ ...prev, [msgId]: { kind, title, status: 'error', error: msg } }));
    }
  }

  const systemPromptCache = useRef<{ prompt: string; canvasTs: number | null; dateKey: string; folderCacheTs: number; subjectKey: string } | null>(null);

  function getCachedSystemPrompt(subjectKey: string): string {
    const canvasTs = storage.getCacheTimestamp();
    const dateKey = getTodayKey();
    const folderCacheTs = getFolderContentsCacheTs();
    const cached = systemPromptCache.current;
    if (
      cached &&
      cached.canvasTs === canvasTs &&
      cached.dateKey === dateKey &&
      cached.folderCacheTs === folderCacheTs &&
      cached.subjectKey === subjectKey
    ) return cached.prompt;
    const prompt = buildSystemPrompt(subjectKey);
    systemPromptCache.current = { prompt, canvasTs, dateKey, folderCacheTs, subjectKey };
    return prompt;
  }

  const messages = useMemo(
    () => sessions.find(s => s.id === activeSessionId)?.messages ?? [],
    [sessions, activeSessionId],
  );

  const sortedSessions = useMemo(
    () => [...sessions]
      .filter(s => {
        const key = s.subjectKey ?? 'general';
        return key === currentSubjectKey && (s.messages.length > 0 || s.id === activeSessionId);
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [sessions, activeSessionId, currentSubjectKey],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => { setSidebarMounted(true); }, []);

  function updateSession(id: string, fn: (s: ChatSession) => ChatSession) {
    setSessions(prev => {
      const next = prev.map(s => {
        if (s.id !== id) return s;
        return fn(s);
      });
      storage.setChatSessions(next);
      return next;
    });
  }

  function selectSession(id: string) {
    setActiveSessionId(id);
    storage.setActiveSessionId(id);
    setDeleteConfirmId(null);
    setInput('');
  }

  function selectSubject(subjectKey: string) {
    setCurrentSubjectKey(subjectKey);
    setDeleteConfirmId(null);
    setInput('');
    const { session, all } = getOrCreateTodayForSubject(sessions, subjectKey);
    if (all.length !== sessions.length) {
      storage.setChatSessions(all);
      setSessions(all);
    }
    setActiveSessionId(session.id);
    storage.setActiveSessionId(session.id);
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
    setSessions(prev => {
      const next = [session, ...prev];
      storage.setChatSessions(next);
      return next;
    });
    setActiveSessionId(session.id);
    storage.setActiveSessionId(session.id);
    setInput('');
  }

  function deleteSession(id: string) {
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
        const withFresh = [fresh];
        storage.setChatSessions(withFresh);
        storage.setActiveSessionId(fresh.id);
        setSessions(withFresh);
        setActiveSessionId(fresh.id);
        setDeleteConfirmId(null);
        return;
      }
    }
    storage.setChatSessions(next);
    setSessions(next);
    setDeleteConfirmId(null);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading || !activeSessionId) return;

    const session = sessions.find(s => s.id === activeSessionId);
    if (!session) return;

    // Build display content (shown in chat bubble) — short, no raw file dump
    const displayContent = attachedFile
      ? `📎 **${attachedFile.title}**\n\n${text}`
      : text;

    // Build API content — includes the full file for the AI's context
    const MAX_FILE_CHARS = 12_000;
    let apiContent = text;
    if (attachedFile) {
      const fileBody = attachedFile.content.length > MAX_FILE_CHARS
        ? `${attachedFile.content.slice(0, MAX_FILE_CHARS)}\n\n[Content truncated — file is too long to include in full]`
        : attachedFile.content;
      const kind = fileTypeLabel(attachedFile.mimeType);
      apiContent = `[Attached Google ${kind}: "${attachedFile.title}"]\n\n${fileBody}\n\n---\n\n${text}`;
    }

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: displayContent };
    const messagesWithUser = [...session.messages, userMsg];

    setInput('');
    setAttachedFile(null);
    setAttachError('');
    setLoading(true);
    updateSession(activeSessionId, s => ({ ...s, messages: messagesWithUser }));

    try {
      await getFolderContentsForPrompt(); // warm folder cache; buildSystemPrompt reads it synchronously
      const systemPrompt = getCachedSystemPrompt(currentSubjectKey);
      // For previous messages use stored content; for the current message use the doc-injected version
      const apiMessages = [
        ...messagesWithUser.slice(-10, -1).map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: apiContent },
      ];
      const planningKeywords = ['schedule', 'study plan', 'plan my day', 'generate'];
      const needsSonnet = planningKeywords.some(kw => text.toLowerCase().includes(kw));
      const response = await sendMessage(apiMessages, systemPrompt, needsSonnet ? 'sonnet' : undefined);
      const scheduleBlocks = parseScheduleBlocks(response) ?? undefined;
      const todos = parseTodos(response) ?? undefined;
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(), role: 'assistant', content: response, scheduleBlocks, todos,
      };
      updateSession(activeSessionId, s => ({ ...s, messages: [...s.messages, assistantMsg] }));

      // If the AI was asked to create a Doc or Slides, execute it now
      void runCreation(assistantMsg.id, response, currentSubjectKey);

      // Auto-save to Google Doc if mode is on (and the AI didn't already create one)
      if (saveAsDocMode && driveToken && !parseCreateDoc(response) && !parseCreateSlides(response)) {
        const docTitle = text.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Soma AI Response';
        const msgId = assistantMsg.id;
        const capturedSubjectKey = currentSubjectKey;
        createGoogleDoc(driveToken, docTitle, stripTags(response)).then(({ docUrl }) => {
          setDocUrls(prev => ({ ...prev, [msgId]: docUrl }));
          appendToCreateHistory({
            kind: 'doc', title: docTitle, url: docUrl, templateLabel: 'AI Response', sourceLabel: '',
            createdAt: new Date().toISOString(),
            subjectId: capturedSubjectKey.startsWith('subject_') ? capturedSubjectKey.slice('subject_'.length) : undefined,
          });
        }).catch(() => {});
      }
    } catch (err: unknown) {
      const content = (err as { message?: string })?.message === 'subscription_required'
        ? 'Your subscription has expired. Visit Settings → Subscription to manage your plan.'
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

  function acceptSchedule(msgId: string, blocks: TimeBlock[]) {
    const existing = storage.getTimeBlocks().filter(b => !isToday(b.startTime));
    storage.setTimeBlocks([...existing, ...blocks]);

    const existingTodos = storage.getTodos();
    const existingTexts = new Set(existingTodos.map(t => t.text));
    const todayKey = getTodayKey();
    const newTodos: Todo[] = blocks
      .filter(b => b.task && !existingTexts.has(b.task))
      .map(b => ({ id: crypto.randomUUID(), text: b.task, status: 'nothing' as const, subjectId: b.subjectId, date: todayKey }));
    if (newTodos.length > 0) storage.setTodos([...existingTodos, ...newTodos]);

    updateSession(activeSessionId, s => ({
      ...s, messages: s.messages.map(m => m.id === msgId ? { ...m, scheduleDismissed: true } : m),
    }));
    onSwitchToToday();
  }

  function dismissSchedule(msgId: string) {
    updateSession(activeSessionId, s => ({
      ...s, messages: s.messages.map(m => m.id === msgId ? { ...m, scheduleDismissed: true } : m),
    }));
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
      ...s, messages: s.messages.map(m => m.id === msgId ? { ...m, todosDismissed: true } : m),
    }));
    onSwitchToToday();
  }

  function dismissTodos(msgId: string) {
    updateSession(activeSessionId, s => ({
      ...s, messages: s.messages.map(m => m.id === msgId ? { ...m, todosDismissed: true } : m),
    }));
  }

  const activeSession = sessions.find(s => s.id === activeSessionId);

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
          <span className={styles.sidebarTitle}>Chats</span>
          <button className={styles.newChatBtn} onClick={newChat} title="New chat">✎</button>
        </div>
        {/* Subject picker */}
        <div className={styles.subjectPicker}>
          <button
            className={`${styles.subjectPickerRow}${currentSubjectKey === 'general' ? ` ${styles.subjectPickerRowActive}` : ''}`}
            onClick={() => selectSubject('general')}
          >
            <span className={styles.subjectDotGeneral} />
            <span className={styles.subjectPickerLabel}>General</span>
          </button>
          {subjects.filter(s => !s.archived).map(s => (
            <button
              key={s.id}
              className={`${styles.subjectPickerRow}${currentSubjectKey === `subject_${s.id}` ? ` ${styles.subjectPickerRowActive}` : ''}`}
              onClick={() => selectSubject(`subject_${s.id}`)}
            >
              <SubjectDot color={s.color} size={8} />
              <span className={styles.subjectPickerLabel}>{s.name}</span>
            </button>
          ))}
        </div>

        <div className={styles.sessionList}>
          {!sidebarMounted ? <SessionListSkeleton /> : sortedSessions.map(session => (
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
          {sidebarMounted && sortedSessions.every(s => s.messages.length === 0) && (
            <p className={styles.sessionEmptyHint}>No messages yet</p>
          )}
        </div>
      </div>

      {/* ── Chat area ───────────────────────────────────────────────────── */}
      <div className={styles.chatArea}>
        <div className={styles.chatHeader}>
          <span className={styles.chatTitle}>{activeSession?.title ?? 'AI Scheduling'}</span>
          <button
            className={`${styles.filesPanelToggle}${filesPanelOpen ? ` ${styles.filesPanelToggleActive}` : ''}`}
            onClick={() => setFilesPanelOpen(p => !p)}
            title={filesPanelOpen ? 'Close files panel' : 'View generated files'}
          >📁</button>
        </div>

        <div className={styles.messageList}>
          {messages.length === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyHint}>Start by describing what you need to accomplish today.</div>
              <div className={styles.suggestions}>
                {['Plan my day', 'What should I study first?', 'Generate a schedule for today'].map(s => (
                  <button key={s} className={styles.suggestionBtn} onClick={() => setInput(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`${styles.messageRow} ${msg.role === 'user' ? styles.userRow : styles.assistantRow}`}
            >
              <div
                className={`${styles.bubble} ${msg.role === 'user' ? styles.userBubble : styles.assistantBubble}`}
                dangerouslySetInnerHTML={{ __html: formatMessage(stripTags(msg.content)) }}
              />
              {msg.role === 'assistant' && msg.scheduleBlocks && !msg.scheduleDismissed && (
                <ScheduleCard
                  blocks={msg.scheduleBlocks}
                  subjects={subjects}
                  onAccept={() => acceptSchedule(msg.id, msg.scheduleBlocks!)}
                  onDismiss={() => dismissSchedule(msg.id)}
                />
              )}
              {msg.role === 'assistant' && msg.todos && !msg.todosDismissed && (
                <TodoCard
                  todos={msg.todos}
                  onAccept={() => acceptTodos(msg.id, msg.todos!)}
                  onDismiss={() => dismissTodos(msg.id)}
                />
              )}
              {msg.role === 'assistant' && artifacts[msg.id] && (
                <div className={styles.artifactCard}>
                  <span className={styles.artifactIcon}>{artifacts[msg.id].kind === 'slides' ? '📊' : '📄'}</span>
                  <div className={styles.artifactInfo}>
                    <span className={styles.artifactTitle}>{artifacts[msg.id].title}</span>
                    <span className={styles.artifactStatus}>
                      {artifacts[msg.id].status === 'creating'
                        ? `Creating Google ${artifacts[msg.id].kind === 'slides' ? 'Slides' : 'Doc'}…`
                        : artifacts[msg.id].status === 'error'
                        ? artifacts[msg.id].error
                        : `Created in Google ${artifacts[msg.id].kind === 'slides' ? 'Slides' : 'Docs'}`}
                    </span>
                  </div>
                  {artifacts[msg.id].status === 'done' && artifacts[msg.id].url && (
                    <a
                      className={styles.artifactOpen}
                      href={artifacts[msg.id].url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >Open ↗</a>
                  )}
                </div>
              )}
              {msg.role === 'assistant' && driveToken && !artifacts[msg.id] && (
                <div className={styles.docActionRow}>
                  {docUrls[msg.id] ? (
                    <a
                      className={styles.docLink}
                      href={docUrls[msg.id]}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Opened in Google Docs ↗
                    </a>
                  ) : (
                    <button
                      className={styles.saveDocBtn}
                      disabled={docLoadingId === msg.id}
                      onClick={() => saveToDoc(msg.id, stripTags(msg.content))}
                    >
                      {docLoadingId === msg.id ? 'Saving…' : 'Save to Google Doc'}
                    </button>
                  )}
                  {docErrors[msg.id] && (
                    <span className={styles.docError}>{docErrors[msg.id]}</span>
                  )}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className={`${styles.messageRow} ${styles.assistantRow}`}>
              <div className={`${styles.bubble} ${styles.assistantBubble} ${styles.thinkingBubble}`}>…</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className={styles.inputAreaWrapper}>
          {/* Attached Google Drive file chip */}
          {(attachLoading || attachedFile || attachError) && (
            <div className={styles.docChip}>
              {attachLoading && (
                <span className={styles.docChipLoading}>📎 Reading file…</span>
              )}
              {attachError && !attachLoading && (
                <span className={styles.docChipError}>⚠ {attachError}
                  <button className={styles.docChipRemove} onClick={() => setAttachError('')}>✕</button>
                </span>
              )}
              {attachedFile && !attachLoading && (
                <>
                  <span className={styles.docChipIcon}>📎</span>
                  <span className={styles.docChipTitle}>{attachedFile.title}</span>
                  <span className={styles.docChipKind}>{fileTypeLabel(attachedFile.mimeType)}</span>
                  <button
                    className={styles.docChipRemove}
                    onClick={() => { setAttachedFile(null); setAttachError(''); }}
                    title="Remove attached file"
                  >✕</button>
                </>
              )}
            </div>
          )}

          {hasTruncatedFolderFiles() && (
            <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--warning, #f59e0b)', opacity: 0.85 }}>
              ⚠️ Some study materials were too large to include in full. Answers about those files may be incomplete.
            </p>
          )}

          {/* Quick-create chips */}
          {quickOpen && !quickTemplate && (
            <div className={styles.quickChipsRow}>
              {CREATE_TEMPLATES.map(t => (
                <button
                  key={t.id}
                  className={styles.quickChip}
                  onClick={() => { setQuickTemplate(t); setQuickError(''); setQuickSourceType('topic'); }}
                  disabled={loading || quickGenerating}
                >
                  {QUICK_ICONS[t.id] ?? t.icon} {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Quick-create form */}
          {quickTemplate && (
            <div className={styles.quickForm}>
              <div className={styles.quickFormHeader}>
                <span className={styles.quickFormTitle}>
                  {QUICK_ICONS[quickTemplate.id] ?? quickTemplate.icon} {quickTemplate.label}
                </span>
                <button className={styles.quickFormClose} onClick={() => { setQuickTemplate(null); setQuickError(''); }}>✕</button>
              </div>
              <div className={styles.quickFormBody}>
                {/* Source type tabs */}
                <div className={styles.quickSourceTabs}>
                  {(['topic', 'assignment', 'subject', 'file'] as const).map(st => (
                    <button
                      key={st}
                      className={`${styles.quickSourceTab}${quickSourceType === st ? ` ${styles.quickSourceTabActive}` : ''}`}
                      onClick={() => { setQuickSourceType(st); setQuickError(''); }}
                    >
                      {st === 'topic' ? 'Topic' : st === 'assignment' ? 'Assignment' : st === 'subject' ? 'Subject' : 'Drive file'}
                    </button>
                  ))}
                </div>

                {/* Source input */}
                {quickSourceType === 'topic' && (
                  <input
                    className={styles.quickInput}
                    placeholder="e.g. Photosynthesis, the French Revolution…"
                    value={quickTopic}
                    onChange={e => setQuickTopic(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleQuickGenerate(); }}
                    autoFocus
                  />
                )}
                {quickSourceType === 'assignment' && (
                  assignments.length > 0 ? (
                    <select
                      className={styles.quickSelect}
                      value={quickAssignmentId ?? ''}
                      onChange={e => setQuickAssignmentId(e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">Choose an assignment…</option>
                      {assignments.map(a => (
                        <option key={a.id} value={a.id}>{a.name} — {a.courseName}</option>
                      ))}
                    </select>
                  ) : (
                    <p className={styles.quickEmptyNote}>No Canvas assignments synced.</p>
                  )
                )}
                {quickSourceType === 'subject' && (
                  nonArchivedSubjects.length > 0 ? (
                    <select
                      className={styles.quickSelect}
                      value={quickSubjectId}
                      onChange={e => setQuickSubjectId(e.target.value)}
                    >
                      <option value="">Choose a subject…</option>
                      {nonArchivedSubjects.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  ) : (
                    <p className={styles.quickEmptyNote}>No subjects yet.</p>
                  )
                )}
                {quickSourceType === 'file' && (
                  driveToken ? (
                    <div className={styles.quickFileRow}>
                      <button
                        className={styles.quickPickFileBtn}
                        onClick={() => openQuickPicker()}
                        disabled={quickDriveLoading}
                      >
                        {quickDriveFile ? 'Change file' : 'Choose from Drive'}
                      </button>
                      {quickDriveFile && (
                        <span className={styles.quickFileChip}>
                          <span className={styles.quickFileChipTitle}>{quickDriveFile.title}</span>
                          <button className={styles.quickFileChipRemove} onClick={() => setQuickDriveFile(null)}>✕</button>
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className={styles.quickEmptyNote}>Connect Google Drive in Settings to use Drive files.</p>
                  )
                )}

                {/* Extra instructions */}
                <textarea
                  className={styles.quickTextarea}
                  placeholder="Extra instructions (optional)"
                  value={quickInstructions}
                  onChange={e => setQuickInstructions(e.target.value)}
                  rows={2}
                />

                {/* Actions */}
                <div className={styles.quickFormActions}>
                  <button
                    className={styles.quickGenerateBtn}
                    onClick={handleQuickGenerate}
                    disabled={quickGenerating || quickDriveLoading}
                  >
                    {quickGenerating ? 'Generating…' : `Generate ${quickTemplate.output === 'slides' ? 'Slides' : 'Doc'}`}
                  </button>
                  <button className={styles.quickCancelBtn} onClick={() => { setQuickTemplate(null); setQuickError(''); }}>
                    Cancel
                  </button>
                  {quickError && <span className={styles.quickError}>{quickError}</span>}
                </div>
              </div>
            </div>
          )}

          <div className={styles.inputRow}>
            <button
              className={`${styles.quickToggleBtn}${quickOpen ? ` ${styles.quickToggleBtnActive}` : ''}`}
              onClick={() => { setQuickOpen(p => !p); if (quickOpen) setQuickTemplate(null); }}
              title={quickOpen ? 'Hide quick actions' : 'Quick create'}
              disabled={loading}
            >✨</button>
            {driveToken && (
              <button
                className={styles.driveBtn}
                onClick={() => openPicker()}
                disabled={loading || attachLoading}
                title="Attach a file from Google Drive"
              >📁</button>
            )}
            <input
              className={styles.textInput}
              placeholder={attachedFile ? `Ask about "${attachedFile.title}"…` : driveToken ? 'Message Soma… (click 📁 to attach a Drive file)' : 'Message Soma…'}
              value={input}
              disabled={loading}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            {driveToken && (
              <button
                className={`${styles.saveDocToggleBtn}${saveAsDocMode ? ` ${styles.saveDocToggleBtnActive}` : ''}`}
                onClick={() => setSaveAsDocMode(p => !p)}
                title={saveAsDocMode ? 'Auto-save responses to Google Docs: ON — click to turn off' : 'Click to auto-save AI responses to Google Docs'}
              >📄</button>
            )}
            <button
              className={styles.sendBtn}
              onClick={send}
              disabled={loading || (!input.trim() && !attachedFile)}
            >Send</button>
          </div>
        </div>
      </div>

      {/* ── Files panel ─────────────────────────────────────────────────── */}
      {filesPanelOpen && (
        <FilesPanel subjects={subjects} onClose={() => setFilesPanelOpen(false)} />
      )}
    </div>
  );
}
