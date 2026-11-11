/**
 * Hard schedule anchors — code, not the model.
 *
 * Exam prep (coverage-list items): last day is the day before the exam.
 * Exam/quiz tasks themselves: may land on the due day, never after.
 * Assignments / other dated work: may land on or before the due day; after
 * the due day only when the work is still open (not submitted / not done),
 * or when the student named that day themselves (flagged on the card).
 */

export type AnchorTodo = {
  dueDate?: string;
  kind?: string;
  status?: string;
  text?: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export function isExamish(kind?: string, title?: string) {
  if (kind === 'exam' || kind === 'quiz') return true;
  return !!title && /\b(exam|midterm|final|quiz|test)\b/i.test(title);
}

/** Last day exam-prep work may land (the day before the exam). */
export function examPrepLastDay(examDate: string): string | null {
  const day = examDate.slice(0, 10);
  return DAY.test(day) ? addDays(day, -1) : null;
}

/**
 * Inclusive last day a todo may be scheduled on.
 * `null` = no hard limit (undated, or already-late open assignment).
 */
export function todoLastDay(todo: AnchorTodo, today: string): string | null {
  const due = todo.dueDate?.slice(0, 10);
  if (!due || !DAY.test(due)) return null;
  const open = todo.status !== 'done';
  if (isExamish(todo.kind, todo.text)) return due;
  // Assignment still open after its due date: catch-up may place it later.
  if (open && due < today.slice(0, 10)) return null;
  return due;
}

export type ScheduleCheck =
  | { ok: true; lastDay: string | null; lateOk?: boolean }
  | { ok: false; lastDay: string | null; why: string; lateOk?: boolean };

/**
 * Whether `date` is allowed for this work.
 * Pass `examDate` when the block covers an exam study list (prep, not the exam task).
 */
export function checkScheduleDay(opts: {
  date: string;
  today: string;
  todo?: AnchorTodo | null;
  examDate?: string | null;
  /**
   * The student named this day themselves ("do the lab tomorrow"). An open
   * assignment may then land after its due date, flagged on its card (owner,
   * 2026-11-10: what the student asks now wins; Soma itself never picks a
   * day past the due date). Exam prep and exams themselves stay hard.
   */
  asked?: boolean;
}): ScheduleCheck {
  const date = opts.date.slice(0, 10);
  const today = opts.today.slice(0, 10);
  if (!DAY.test(date)) return { ok: false, lastDay: null, why: 'that day isn\'t a valid date' };

  if (opts.examDate) {
    const last = examPrepLastDay(opts.examDate);
    if (last && date > last) {
      return {
        ok: false,
        lastDay: last,
        why: `exam prep can't land on or after the exam (${opts.examDate.slice(0, 10)}); latest is ${last}`,
      };
    }
    return { ok: true, lastDay: last };
  }

  const todo = opts.todo;
  if (!todo) return { ok: true, lastDay: null };
  const last = todoLastDay(todo, today);
  const due = todo.dueDate?.slice(0, 10);
  const lateOk = !!(due && DAY.test(due) && due < today && todo.status !== 'done' && !isExamish(todo.kind, todo.text));
  if (last && date > last && opts.asked && todo.status !== 'done' && !isExamish(todo.kind, todo.text)) {
    return { ok: true, lastDay: last, lateOk: true };
  }
  if (last && date > last) {
    return {
      ok: false,
      lastDay: last,
      lateOk,
      why: isExamish(todo.kind, todo.text)
        ? `can't schedule after ${due}`
        : `can't schedule after its due date (${due}) while it isn't late yet`,
    };
  }
  return { ok: true, lastDay: last, lateOk };
}

/** Resolve the exam date for a set of covered course-item ids, if they share one exam. */
export function examDateForCovers(
  coverIds: string[] | undefined,
  items: { id: string; examId?: string }[],
  plans: { id: string; examDate: string }[],
): string | undefined {
  if (!coverIds?.length) return undefined;
  const examIds = new Set(
    coverIds.map(id => items.find(i => i.id === id)?.examId).filter((x): x is string => !!x),
  );
  if (examIds.size !== 1) return undefined;
  const id = [...examIds][0];
  return plans.find(p => p.id === id)?.examDate;
}
