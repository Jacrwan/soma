export type SubjectColor =
  | '#ef5350' | '#42a5f5' | '#66bb6a' | '#ab47bc'
  | '#ffa726' | '#26c6da' | '#ec407a' | '#8d6e63';

export interface Subject {
  id: string;
  name: string;
  color: SubjectColor;
  totalTimeToday: number; // seconds
  archived?: boolean;
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
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  scheduleBlocks?: TimeBlock[];
  todos?: string[];
  scheduleDismissed?: boolean;
  todosDismissed?: boolean;
}

export interface ChatSession {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  messages: ChatMessage[];
  createdAt: string; // ISO
}
