import { Subject, TimeBlock, TimerSession, CanvasAssignment, Todo } from '../types';

const KEYS = {
  subjects: 'soma_subjects',
  timeBlocks: 'soma_blocks',
  timerSessions: 'soma_sessions',
  canvasToken: 'canvas_token',
  canvasBaseUrl: 'canvas_base_url',
  assignmentStatus: 'canvas_assignment_status',
  cachedAssignments: 'soma_canvas_cache',
  anthropicKey: 'anthropic_api_key',
  todos: 'soma_todos',
};

const DEFAULT_SUBJECTS: Subject[] = [
  { id: '1', name: 'Math',     color: '#ef5350', totalTimeToday: 0 },
  { id: '2', name: 'Science',  color: '#42a5f5', totalTimeToday: 0 },
  { id: '3', name: 'English',  color: '#66bb6a', totalTimeToday: 0 },
  { id: '4', name: 'History',  color: '#ab47bc', totalTimeToday: 0 },
  { id: '5', name: 'Language', color: '#ffa726', totalTimeToday: 0 },
  { id: '6', name: 'Other',    color: '#26c6da', totalTimeToday: 0 },
];

function get<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function set(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const storage = {
  getSubjects: (): Subject[] => get(KEYS.subjects, DEFAULT_SUBJECTS),
  setSubjects: (v: Subject[]) => set(KEYS.subjects, v),

  getTimeBlocks: (): TimeBlock[] => get(KEYS.timeBlocks, []),
  setTimeBlocks: (v: TimeBlock[]) => set(KEYS.timeBlocks, v),

  getTimerSessions: (): TimerSession[] => get(KEYS.timerSessions, []),
  setTimerSessions: (v: TimerSession[]) => set(KEYS.timerSessions, v),

  getCanvasToken: (): string => get(KEYS.canvasToken, ''),
  setCanvasToken: (v: string) => set(KEYS.canvasToken, v),

  getCanvasBaseUrl: (): string => get(KEYS.canvasBaseUrl, ''),
  setCanvasBaseUrl: (v: string) => set(KEYS.canvasBaseUrl, v),

  getAssignmentStatus: (): Record<number, string> => get(KEYS.assignmentStatus, {}),
  setAssignmentStatus: (v: Record<number, string>) => set(KEYS.assignmentStatus, v),

  getCachedAssignments: (): CanvasAssignment[] => get(KEYS.cachedAssignments, []),
  setCachedAssignments: (v: CanvasAssignment[]) => set(KEYS.cachedAssignments, v),

  getAnthropicKey: (): string => get(KEYS.anthropicKey, ''),
  setAnthropicKey: (v: string) => set(KEYS.anthropicKey, v),

  getTodos: (): Todo[] => get(KEYS.todos, []),
  setTodos: (v: Todo[]) => set(KEYS.todos, v),
};
