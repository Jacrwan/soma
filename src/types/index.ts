export type SubjectColor =
  | '#ef5350' | '#42a5f5' | '#66bb6a' | '#ab47bc'
  | '#ffa726' | '#26c6da' | '#ec407a' | '#8d6e63';

export interface Subject {
  id: string;
  name: string;
  color: SubjectColor;
  totalTimeToday: number; // seconds
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
}

export interface CanvasCourse {
  id: number;
  name: string;
  courseCode: string;
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
}
