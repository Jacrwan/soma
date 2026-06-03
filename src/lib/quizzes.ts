// In-app quizzes (native, editable). Stored in localStorage like flashcards.ts.
// Structure is the common "question set" shape — original implementation, not
// tied to any third-party product's UI or assets.

export type QuestionKind = 'choice' | 'written';

export interface QuizQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  options: string[];     // choice questions
  correctIndex: number;  // choice questions
  answer: string;        // written questions (accepted answer)
  explanation: string;
}

export interface Quiz {
  id: string;
  title: string;
  subjectId?: string;
  questions: QuizQuestion[];
  createdAt: string;
  updatedAt: string;
}

const KEY = 'soma_quizzes';
export const QUIZZES_EVENT = 'soma_quizzes_updated';

export function loadQuizzes(): Quiz[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(quizzes: Quiz[]): void {
  localStorage.setItem(KEY, JSON.stringify(quizzes));
  window.dispatchEvent(new Event(QUIZZES_EVENT));
}

export function saveQuiz(quiz: Quiz): void {
  const rest = loadQuizzes().filter((q) => q.id !== quiz.id);
  persist([quiz, ...rest]);
}

export function deleteQuiz(id: string): void {
  persist(loadQuizzes().filter((q) => q.id !== id));
}

export function newQuestion(kind: QuestionKind = 'choice'): QuizQuestion {
  return {
    id: crypto.randomUUID(),
    kind,
    prompt: '',
    options: kind === 'choice' ? ['', ''] : [],
    correctIndex: 0,
    answer: '',
    explanation: '',
  };
}

export function newQuiz(): Quiz {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: '',
    questions: [newQuestion('choice')],
    createdAt: now,
    updatedAt: now,
  };
}

/** Case/space-insensitive comparison for written answers. */
export function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}
