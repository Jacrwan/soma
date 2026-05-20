import { useState, useRef, useEffect } from 'react';
import { storage } from '../../lib/storage';
import { sendMessage } from '../../lib/ai';
import { TimeBlock, Subject, Todo } from '../../types';
import SubjectDot from '../shared/SubjectDot';
import styles from './AITab.module.css';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  scheduleBlocks?: TimeBlock[];
  todos?: string[];
  scheduleDismissed?: boolean;
  todosDismissed?: boolean;
}

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

const CHAT_KEY = 'soma_chat_history';

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHistory(msgs: ChatMessage[]) {
  localStorage.setItem(CHAT_KEY, JSON.stringify(msgs));
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
  console.log('[todos] raw tag match:', match ? match[1].trim() : 'NO MATCH');
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    console.log('[todos] parsed array:', parsed);
    return parsed;
  } catch (e) {
    console.error('[todos] JSON.parse failed:', e);
    return null;
  }
}


function buildSystemPrompt(): string {
  const subjects = storage.getSubjects();
  const assignments = storage.getCachedAssignments();
  const announcements = storage.getCachedAnnouncements();
  const modules = storage.getCachedModules();
  const blocks = storage.getTimeBlocks().filter(b => isToday(b.startTime));

  const now = new Date();

  const date = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const subjectsStr = subjects
    .map(s => `${s.name} (id: ${s.id})`)
    .join(', ');

  const upcoming = assignments;

  const assignmentStatus = storage.getAssignmentStatus();
  const statusLabel: Record<string, string> = {
    not_started: 'not started',
    in_progress: 'in progress',
    done: 'done',
  };
  console.log('[buildSystemPrompt] assignmentStatus:', assignmentStatus);
  console.log('[buildSystemPrompt] first 3 assignment lookups:', upcoming.slice(0, 3).map(a => ({
    id: a.id,
    name: a.name,
    rawStatus: assignmentStatus[String(a.id)] ?? '(not set)',
    label: statusLabel[assignmentStatus[String(a.id)] ?? 'not_started'] ?? 'not started',
  })));
  const assignmentsStr = upcoming.length > 0
    ? upcoming.map(a => {
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

  const courseIds = [...new Set(upcoming.map(a => a.courseId))];

  const announcementsStr = courseIds.length > 0
    ? courseIds.map(cid => {
        const courseAnn = announcements.filter(a => a.courseId === cid).slice(0, 5);
        if (courseAnn.length === 0) return null;
        const courseName = upcoming.find(a => a.courseId === cid)?.courseName ?? `Course ${cid}`;
        const items = courseAnn.map(a =>
          `  - ${a.title}: ${a.message.slice(0, 500)}`
        ).join('\n');
        return `${courseName}:\n${items}`;
      }).filter(Boolean).join('\n\n')
    : '';

  const modulesStr = courseIds.length > 0
    ? courseIds.map(cid => {
        const courseMods = modules
          .filter(m => m.courseId === cid)
          .sort((a, b) => a.position - b.position);
        if (courseMods.length === 0) return null;
        const courseName = upcoming.find(a => a.courseId === cid)?.courseName ?? `Course ${cid}`;
        const items = courseMods.map(m => `  - ${m.name}`).join('\n');
        return `${courseName}:\n${items}`;
      }).filter(Boolean).join('\n\n')
    : '';

  return `You are Soma, a personal study assistant. Help the user plan their day.

Today is ${date}.

Their subjects: ${subjectsStr}

Upcoming assignments (next 14 days):
${assignmentsStr}

Current schedule:
${blocksStr}
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

// ── Sub-components ───────────────────────────────────────────────────────

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

// ── Main component ───────────────────────────────────────────────────────

export default function AITab({ onSwitchToToday }: { onSwitchToToday: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory());
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const subjects = storage.getSubjects();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const systemPrompt = buildSystemPrompt();
      const apiMessages = next.map(m => ({ role: m.role, content: m.content }));
      const response = await sendMessage(apiMessages, systemPrompt);
      const scheduleBlocks = parseScheduleBlocks(response) ?? undefined;
      const todos = parseTodos(response) ?? undefined;
      console.log('[todos] attached to message:', todos);
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response,
        scheduleBlocks,
        todos,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to get response.'}`,
      }]);
    } finally {
      setLoading(false);
    }
  }

  function acceptSchedule(msgId: string, blocks: TimeBlock[]) {
    const existing = storage.getTimeBlocks().filter(b => !isToday(b.startTime));
    storage.setTimeBlocks([...existing, ...blocks]);
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, scheduleDismissed: true } : m));
    onSwitchToToday();
  }

  function dismissSchedule(msgId: string) {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, scheduleDismissed: true } : m));
  }

  async function acceptTodos(msgId: string, todoTexts: string[]) {
    console.log('[todos] acceptTodos called with:', todoTexts);
    const subjects = storage.getSubjects().filter(s => !s.archived);
    const subjectNames = subjects.map(s => s.name);

    let subjectAssignments: string[] = todoTexts.map(() => 'Unassigned');
    try {
      const systemPrompt = 'You are a todo categorizer. Given a list of todos and a list of subjects, assign each todo to the most appropriate subject. Respond with only a JSON array of subject names in the same order as the todos, exactly matching one of the provided subject names or "Unassigned" if none fit.';
      const userMessage = `Subjects: ${JSON.stringify(subjectNames)}.\nTodos:\n${todoTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
      const response = await sendMessage([{ role: 'user', content: userMessage }], systemPrompt);
      console.log('[todos] categorization response:', response);
      const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());
      if (Array.isArray(parsed) && parsed.length === todoTexts.length) {
        subjectAssignments = parsed;
      }
    } catch (e) {
      console.warn('[todos] categorization failed, leaving unassigned:', e);
    }

    const assignments = storage.getCachedAssignments();
    let assignmentIds: (number | null)[] = todoTexts.map(() => null);
    if (assignments.length > 0) {
      try {
        const systemPrompt = 'You are a todo-to-assignment matcher. Given a list of todos and a list of Canvas assignments, for each todo return the ID of the most relevant assignment it belongs to, or null if none fit. Respond with only a JSON array of assignment IDs (numbers) or nulls, in the same order as the todos.';
        const assignmentList = assignments.map(a => ({
          id: a.id,
          name: a.name,
          courseName: a.courseName,
          dueAt: a.dueAt,
        }));
        const userMessage = `Assignments: ${JSON.stringify(assignmentList)}\nTodos:\n${todoTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
        const response = await sendMessage([{ role: 'user', content: userMessage }], systemPrompt);
        const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());
        if (Array.isArray(parsed) && parsed.length === todoTexts.length) {
          assignmentIds = parsed;
        }
      } catch (e) {
        console.warn('[todos] assignment matching failed:', e);
      }
    }

    const newTodos: Todo[] = todoTexts.map((text, i) => {
      const assignedName = subjectAssignments[i];
      const subject = subjects.find(s => s.name.toLowerCase() === assignedName?.toLowerCase());
      const assignmentId = assignmentIds[i] ?? undefined;
      return { id: crypto.randomUUID(), text, status: 'nothing' as const, subjectId: subject?.id, assignmentId };
    });

    console.log('[todos] matched pairs:', newTodos.map(t => ({
      text: t.text,
      subject: subjects.find(s => s.id === t.subjectId)?.name ?? 'Unassigned',
      assignment: assignments.find(a => a.id === t.assignmentId)?.name ?? null,
    })));
    storage.setTodos(newTodos);
    console.log('[todos] soma_todos in localStorage:', localStorage.getItem('soma_todos'));
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, todosDismissed: true } : m));
    onSwitchToToday();
  }

  function dismissTodos(msgId: string) {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, todosDismissed: true } : m));
  }

  function clearChat() {
    setMessages([]);
    localStorage.removeItem(CHAT_KEY);
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>AI Scheduling</span>
        <button className={styles.clearKeyBtn} onClick={clearChat}>Clear chat</button>
      </div>

      <div className={styles.messageList}>
        {messages.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyHint}>
              Start by describing what you need to accomplish today.
            </div>
            <div className={styles.suggestions}>
              {['Plan my day', 'What should I study first?', 'Generate a schedule for today'].map(s => (
                <button key={s} className={styles.suggestionBtn} onClick={() => setInput(s)}>
                  {s}
                </button>
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
  );
}
