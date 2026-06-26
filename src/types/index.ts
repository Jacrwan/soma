export type SubjectColor =
  | '#ef5350' | '#42a5f5' | '#66bb6a' | '#ab47bc'
  | '#ffa726' | '#26c6da' | '#ec407a' | '#8d6e63';

export interface Subject {
  id: string;
  name: string;
  color: SubjectColor;
  totalTimeToday: number; // seconds
  archived?: boolean;
  order?: number;
  source?: 'manual' | 'canvas';
  canvasCourseId?: number;
}

export interface TimeBlock {
  id: string;
  subjectId: string;
  task: string;
  startTime: string;   // ISO
  endTime: string;     // ISO
  source: 'manual' | 'ai' | 'canvas';
  timerSessionId?: string;
}

export interface TimerSession {
  id: string;
  subjectId: string;
  task: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  linkedBlockId?: string;
  pauseDurationSeconds?: number;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  courseId: number;
  courseName: string;
  dueAt: string;
  htmlUrl: string;
  status: 'not_started' | 'in_progress' | 'done';
  description?: string;
  submittedAt?: string | null;
  score?: number | null;
  pointsPossible?: number | null;
}

export interface CanvasCourse {
  id: number;
  name: string;
  courseCode: string;
}

export interface CanvasAnnouncement {
  id: number;
  title: string;
  message: string;
  postedAt: string;
  htmlUrl: string;
  courseId: number;
}

export interface CanvasModule {
  id: number;
  name: string;
  position: number;
  courseId: number;
}

export interface CanvasGrade {
  courseId: number;
  courseName: string;
  courseCode: string;
  currentScore: number | null;
  currentGrade: string | null;
  finalScore: number | null;
  finalGrade: string | null;
}

export interface Todo {
  id: string;
  text: string;
  status: 'nothing' | 'in_progress' | 'done';
  subjectId?: string;
  dueDate?: string;
  assignmentId?: number;
  date: string; // YYYY-MM-DD
  estimatedMinutes?: number;
  notes?: string;
  order?: number;
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  htmlLink?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

export interface AiTodo {
  text: string;
  subjectId?: string;
  assignmentId?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  scheduleBlocks?: TimeBlock[];
  todos?: AiTodo[];
  scheduleDismissed?: boolean;
  todosDismissed?: boolean;
  scheduleAccepted?: boolean;
  todosAccepted?: boolean;
}

export interface ChatSession {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  messages: ChatMessage[];
  createdAt: string; // ISO
  subjectKey?: string; // 'general' | 'subject_<id>' — undefined treated as 'general'
}
