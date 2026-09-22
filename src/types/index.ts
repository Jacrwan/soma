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

export type DocumentType = 'syllabus' | 'reading' | 'guide' | 'notes' | 'assignment' | 'slides' | 'other';

export type ExtractionStatus = 'pending' | 'processing' | 'done' | 'failed' | 'unsupported';

export interface SomaDocument {
  id: string;
  subjectId: string | null;
  fileName: string;
  storagePath: string;
  fileType: string;
  sizeBytes: number;
  docType: DocumentType;
  createdAt: string;
  extractionStatus: ExtractionStatus;
  extractedText: string | null;
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

export interface TodoSession {
  id: string;
  todoId: string;
  date: string;         // YYYY-MM-DD
  startTime?: string;   // ISO timestamptz
  endTime?: string;     // ISO timestamptz
  todoText?: string;    // joined from todos.text
  subjectId?: string;   // joined from todos.subject_id
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

/**
 * What a task is, as the course-site import classifies it. Only some of these
 * are work that gets handed in; the rest are how you prepare for it.
 */
export type TodoKind =
  | 'homework' | 'lab' | 'project' | 'exam' | 'quiz'
  | 'reading' | 'discussion' | 'other';

export const TODO_KINDS: TodoKind[] =
  ['homework', 'lab', 'project', 'exam', 'quiz', 'reading', 'discussion', 'other'];

/** The kinds that have to be submitted, and so belong on Deadlines. */
export const SUBMITTABLE_KINDS: TodoKind[] = ['homework', 'lab', 'project', 'exam', 'quiz'];

export const isSubmittable = (kind?: TodoKind | null): boolean =>
  !!kind && (SUBMITTABLE_KINDS as string[]).includes(kind);

/** Anything the import did not classify, or that was written by hand. */
export const asTodoKind = (value: unknown): TodoKind | undefined =>
  typeof value === 'string' && (TODO_KINDS as string[]).includes(value) ? value as TodoKind : undefined;

export interface Todo {
  id: string;
  text: string;
  status: 'nothing' | 'in_progress' | 'done';
  subjectId?: string;
  dueDate?: string;
  /** Unset for tasks written by hand, and for rows older than the column. */
  kind?: TodoKind;
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
  // Which connected account + calendar this came from — populated by the
  // multi-calendar aggregator so events from different calendars can be
  // told apart in the UI. Absent for events from the legacy single-token path.
  source?: {
    connectionId: string;
    googleEmail: string;
    calendarId: string;
    calendarSummary: string;
    color?: string;
  };
}

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
}

export interface GoogleCalendarConnection {
  id: string;
  googleEmail: string;
  selectedCalendars: GoogleCalendarInfo[];
  createdAt: string;
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
  todos?: AiTodo[];
  todosDismissed?: boolean;
  todosAccepted?: boolean;
  confirmText?: string;
}

export interface ChatSession {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  messages: ChatMessage[];
  createdAt: string; // ISO
  subjectKey?: string; // 'general' | 'subject_<id>' — undefined treated as 'general'
}
