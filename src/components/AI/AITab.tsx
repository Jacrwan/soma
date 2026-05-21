import { useState, useRef, useEffect, useMemo } from 'react';
import { storage } from '../../lib/storage';
import { sendMessage } from '../../lib/ai';
import { TimeBlock, Subject, Todo, ChatMessage, ChatSession } from '../../types';
import SubjectDot from '../shared/SubjectDot';
import styles from './AITab.module.css';

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

function getOrCreateToday(sessions: ChatSession[]): { session: ChatSession; all: ChatSession[] } {
  const todayKey = getTodayKey();
  const existing = sessions.find(s => s.date === todayKey);
  if (existing) return { session: existing, all: sessions };
  const session: ChatSession = {
    id: crypto.randomUUID(),
    date: todayKey,
    title: makeSessionTitle(todayKey),
    messages: [],
    createdAt: new Date().toISOString(),
  };
  return { session, all: [session, ...sessions] };
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
    .replace(/<schedule>[\s\S]*?<\/schedule>/g, '')
    .replace(/<todos>[\s\S]*?<\/todos>/g, '')
    .trim();
}

function formatMessage(content: string): string {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>');
}

function parseScheduleBlocks(content: string): TimeBlock[] | null {
  const match = content.match(/<schedule>([\s\S]*?)<\/schedule>/);
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

function parseTodos(content: string): string[] | null {
  const match = content.match(/<todos>([\s\S]*?)<\/todos>/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch { return null; }
}

// ── System prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
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
        return `- ${a.name} | ${a.courseName} | Due: ${due} | Status: ${status}${desc}`;
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

  return `You are Soma, a personal study assistant. Help the user plan their day.

Today is ${date}.

Their subjects: ${subjectsStr}

Upcoming assignments (next 14 days):
${assignmentsStr}

Current schedule:
${blocksStr}
${gcalStr ? `\nExisting calendar events (read-only, do not schedule over these):\n${gcalStr}` : ''}
${announcementsStr ? `\nRecent course announcements:\n${announcementsStr}` : ''}
${modulesStr ? `\nCourse modules (structure):\n${modulesStr}` : ''}
When the user asks you to generate a schedule or todo list, respond with:
1. A friendly natural language explanation
2. A JSON block wrapped in <schedule> tags containing an array of TimeBlock objects
3. A JSON block wrapped in <todos> tags containing an array of todo strings

TimeBlock format: { subjectId, task, startTime (ISO), endTime (ISO), source: "ai" }
Match subjectId to the user's existing subjects by name (case-insensitive).

If you can't match a subject, use the "Other" subject.
Always ask clarifying questions if the user's request is vague.
Never generate a schedule without asking what time the user wants to start and end their day.`;
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
  todos: string[];
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>✅ Todo List</div>
      <div className={styles.cardBody}>
        {todos.map((t, i) => (
          <div key={i} className={styles.todoRow}>• {t}</div>
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

// ── Main component ──────────────────────────────────────────────────────────

export default function AITab({ onSwitchToToday }: { onSwitchToToday: () => void }) {
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

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const subjects = storage.getSubjects();

  const systemPromptCache = useRef<{ prompt: string; canvasTs: number | null; dateKey: string } | null>(null);

  function getCachedSystemPrompt(): string {
    const canvasTs = storage.getCacheTimestamp();
    const dateKey = getTodayKey();
    const cached = systemPromptCache.current;
    if (cached && cached.canvasTs === canvasTs && cached.dateKey === dateKey) return cached.prompt;
    const prompt = buildSystemPrompt();
    systemPromptCache.current = { prompt, canvasTs, dateKey };
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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function updateSession(id: string, fn: (s: ChatSession) => ChatSession) {
    setSessions(prev => {
      const next = prev.map(s => s.id === id ? fn(s) : s);
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

  function newChat() {
    const todayKey = getTodayKey();
    const session: ChatSession = {
      id: crypto.randomUUID(),
      date: todayKey,
      title: makeSessionTitle(todayKey),
      messages: [],
      createdAt: new Date().toISOString(),
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

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    const messagesWithUser = [...session.messages, userMsg];

    setInput('');
    setLoading(true);
    updateSession(activeSessionId, s => ({ ...s, messages: messagesWithUser }));

    try {
      const systemPrompt = getCachedSystemPrompt();
      const apiMessages = messagesWithUser.slice(-10).map(m => ({ role: m.role, content: m.content }));
      const planningKeywords = ['schedule', 'study plan', 'plan my day', 'generate'];
      const needsSonnet = planningKeywords.some(kw => text.toLowerCase().includes(kw));
      const response = await sendMessage(apiMessages, systemPrompt, needsSonnet ? 'sonnet' : undefined);
      const scheduleBlocks = parseScheduleBlocks(response) ?? undefined;
      const todos = parseTodos(response) ?? undefined;
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(), role: 'assistant', content: response, scheduleBlocks, todos,
      };
      updateSession(activeSessionId, s => ({ ...s, messages: [...s.messages, assistantMsg] }));
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(), role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to get response.'}`,
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
    const newTodos: Todo[] = blocks
      .filter(b => b.task && !existingTexts.has(b.task))
      .map(b => ({ id: crypto.randomUUID(), text: b.task, status: 'nothing' as const, subjectId: b.subjectId }));
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

  async function acceptTodos(msgId: string, todoTexts: string[]) {
    const activeSubjects = storage.getSubjects().filter(s => !s.archived);
    const subjectNames = activeSubjects.map(s => s.name);

    let subjectAssignments: string[] = todoTexts.map(() => 'Unassigned');
    const canvasAssignments = storage.getCachedAssignments();
    let assignmentIds: (number | null)[] = todoTexts.map(() => null);
    try {
      const assignmentList = canvasAssignments.map(a => ({ id: a.id, name: a.name, courseName: a.courseName, dueAt: a.dueAt }));
      const systemPrompt = 'You are a todo categorizer and matcher. Given a list of todos, a list of subjects, and a list of Canvas assignments, return a JSON object with two keys: "subjects" (array of subject names in the same order as the todos, exactly matching one of the provided subject names or "Unassigned" if none fit) and "assignmentIds" (array of Canvas assignment IDs (numbers) or null for each todo, in the same order). Respond with only the raw JSON object, no markdown.';
      const userMessage = `Subjects: ${JSON.stringify(subjectNames)}\nAssignments: ${JSON.stringify(assignmentList)}\nTodos:\n${todoTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
      const response = await sendMessage([{ role: 'user', content: userMessage }], systemPrompt);
      const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());
      if (Array.isArray(parsed.subjects) && parsed.subjects.length === todoTexts.length) subjectAssignments = parsed.subjects;
      if (Array.isArray(parsed.assignmentIds) && parsed.assignmentIds.length === todoTexts.length) assignmentIds = parsed.assignmentIds;
    } catch { /* leave unassigned/null */ }

    const newTodos: Todo[] = todoTexts.map((text, i) => {
      const subject = activeSubjects.find(s => s.name.toLowerCase() === subjectAssignments[i]?.toLowerCase());
      return { id: crypto.randomUUID(), text, status: 'nothing' as const, subjectId: subject?.id, assignmentId: assignmentIds[i] ?? undefined };
    });
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

  return (
    <div className={styles.layout}>
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarTitle}>Chats</span>
          <button className={styles.newChatBtn} onClick={newChat} title="New chat">✎</button>
        </div>
        <div className={styles.sessionList}>
          {sortedSessions.map(session => (
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
        </div>
      </div>

      {/* ── Chat area ───────────────────────────────────────────────────── */}
      <div className={styles.chatArea}>
        <div className={styles.chatHeader}>
          <span className={styles.chatTitle}>{activeSession?.title ?? 'AI Scheduling'}</span>
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
            </div>
          ))}
          {loading && (
            <div className={`${styles.messageRow} ${styles.assistantRow}`}>
              <div className={`${styles.bubble} ${styles.assistantBubble} ${styles.thinkingBubble}`}>…</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className={styles.inputRow}>
          <input
            className={styles.textInput}
            placeholder="Message Soma…"
            value={input}
            disabled={loading}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button
            className={styles.sendBtn}
            onClick={send}
            disabled={loading || !input.trim()}
          >Send</button>
        </div>
      </div>
    </div>
  );
}
