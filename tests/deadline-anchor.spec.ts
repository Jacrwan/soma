import { test, expect } from '@playwright/test';
import {
  checkScheduleDay, examDateForCovers, examPrepLastDay, isExamish, todoLastDay,
} from '../src/lib/deadlineAnchor';
import { placeBlocks, type ExamPlan } from '../src/lib/examPlan';
import type { CourseItem } from '../src/lib/courseItems';
import type { Snapshot } from '../src/components/DashboardV2/liveData';
import type { SomaSettings } from '../src/lib/storage';

/**
 * Hard schedule anchors (code, not the model): exam prep never on/after the
 * exam; assignments not after due unless already late and still open.
 */

test('exam prep last day is the day before the exam', () => {
  expect(examPrepLastDay('2026-11-14')).toBe('2026-11-13');
  expect(isExamish('exam')).toBe(true);
  expect(isExamish(undefined, 'Chem quiz 4')).toBe(true);
  expect(isExamish('homework', 'Problem set 5')).toBe(false);
});

test('assignments may land after due only when already late and still open', () => {
  const today = '2026-11-10';
  expect(todoLastDay({ dueDate: '2026-11-12', status: 'nothing', kind: 'homework' }, today)).toBe('2026-11-12');
  expect(todoLastDay({ dueDate: '2026-11-08', status: 'nothing', kind: 'homework' }, today)).toBeNull();
  expect(todoLastDay({ dueDate: '2026-11-08', status: 'done', kind: 'homework' }, today)).toBe('2026-11-08');
  expect(todoLastDay({ dueDate: '2026-11-14', kind: 'exam' }, today)).toBe('2026-11-14');
});

test('checkScheduleDay rejects exam prep on/after the exam and future post-due homework', () => {
  const today = '2026-11-10';
  expect(checkScheduleDay({ date: '2026-11-14', today, examDate: '2026-11-14' }).ok).toBe(false);
  expect(checkScheduleDay({ date: '2026-11-13', today, examDate: '2026-11-14' }).ok).toBe(true);
  expect(checkScheduleDay({ date: '2026-11-13', today, todo: { dueDate: '2026-11-12', status: 'nothing', kind: 'homework' } }).ok).toBe(false);
  expect(checkScheduleDay({ date: '2026-11-13', today, todo: { dueDate: '2026-11-08', status: 'nothing', kind: 'homework' } }).ok).toBe(true);
  expect(checkScheduleDay({ date: '2026-11-15', today, todo: { dueDate: '2026-11-14', kind: 'quiz', text: 'Physics quiz' } }).ok).toBe(false);
});

test('examDateForCovers resolves a shared exam from covered items', () => {
  const items = [
    { id: 'a', examId: 'e1' },
    { id: 'b', examId: 'e1' },
    { id: 'c', examId: 'e2' },
  ];
  const plans = [{ id: 'e1', examDate: '2026-11-14' }, { id: 'e2', examDate: '2026-12-01' }];
  expect(examDateForCovers(['a', 'b'], items, plans)).toBe('2026-11-14');
  expect(examDateForCovers(['a', 'c'], items, plans)).toBeUndefined();
  expect(examDateForCovers(undefined, items, plans)).toBeUndefined();
});

test('placeBlocks never lands on or after the exam day', () => {
  const settings = { studyWindow: { start: '08:00', end: '23:00' }, chunks: { min: 30 }, theme: 'light', timeFormat: '12h' } as SomaSettings;
  const empty = (): Snapshot => ({ blocks: [], subjects: [], todos: [], sessions: [], history: [], calendarError: '', items: [] });
  const exam: ExamPlan = { id: 'exam-1', subjectId: 'calc', title: 'Calc midterm', examDate: '2026-11-08' }; // Sunday
  // Origin is Saturday Nov 7 — only one day of prep before the exam.
  const origin = new Date(2026, 10, 7, 0, 0);
  const now = new Date(2026, 10, 7, 9, 0);
  const items: CourseItem[] = [
    { id: 'i1', subjectId: 'calc', examId: 'exam-1', label: 'WS 3', position: 0, minutes: 60, priority: 5 },
    { id: 'i2', subjectId: 'calc', examId: 'exam-1', label: 'Practice', position: 1, minutes: 90, priority: 4 },
  ];
  const { blocks, placed } = placeBlocks(exam, items, empty(), origin, settings, { name: 'Calc', color: 'blue' }, 'week', new Map(), now);
  expect(blocks.every(b => b.day === 0)).toBe(true);
  expect([...placed.values()].every(d => d === '2026-11-07')).toBe(true);
  expect([...placed.values()].every(d => d < exam.examDate)).toBe(true);
});
