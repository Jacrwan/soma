import { test, expect } from '@playwright/test';
import {
  checkScheduleDay, examDateForCovers, examPrepLastDay, isExamish, todoLastDay,
} from '../src/lib/deadlineAnchor';
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

// Owner, 2026-11-10: a day the student names wins, flagged on the card; a day
// Soma picks never lands past the due date. Exams and exam prep stay hard.
test('a day the student asked for may pass an open assignment\'s due date, flagged', () => {
  const lab = { dueDate: '2026-11-10', status: 'nothing', text: 'CS 61A Lab 5' };
  expect(checkScheduleDay({ date: '2026-11-11', today: '2026-11-10', todo: lab })).toMatchObject({ ok: false });
  expect(checkScheduleDay({ date: '2026-11-11', today: '2026-11-10', todo: lab, asked: true })).toEqual({ ok: true, lastDay: '2026-11-10', lateOk: true });
  expect(checkScheduleDay({ date: '2026-11-11', today: '2026-11-10', todo: { ...lab, status: 'done' }, asked: true })).toMatchObject({ ok: false });
  expect(checkScheduleDay({ date: '2026-11-11', today: '2026-11-10', todo: { dueDate: '2026-11-10', kind: 'quiz', text: 'Quiz 4' }, asked: true })).toMatchObject({ ok: false });
  expect(checkScheduleDay({ date: '2026-11-14', today: '2026-11-10', examDate: '2026-11-14', asked: true })).toMatchObject({ ok: false });
});
