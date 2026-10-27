import { test, expect } from '@playwright/test';
import { sameCourse } from '../src/lib/canvasDeepSync';

/**
 * How Gradescope courses find their Canvas course (mergeGradescope). Emory
 * names them "CS-170-1: Intro to Computer Science I - Fall 2026" in Canvas
 * and "FA26_CS_170_1" on Gradescope; dashes and underscores broke the match,
 * and a shared "Fall 2026" must never make two courses one.
 */
const cases: [string, string, boolean][] = [
  ['PHYSICS 7A - LEC 001 - Fall 2026', 'Physics 7A', true],
  ['CS 61A', 'COMPSCI 61A', true],
  ['Computer Science 61A', 'CS 61A', true],
  ['Biology 101', 'BIO 101', true],
  ['CHEM 1A', 'Chemistry 1A', true],
  ['CS-170-1: Intro to Computer Science I - Fall 2026', 'FA26_CS_170_1', true],
  ['MATH-221-3: Linear Algebra - Fall 2026', 'FA26_MATH_221_3', true],
  ['CS-170-1: Intro to Computer Science I - Fall 2026', 'MATH-221-3: Linear Algebra - Fall 2026', false],
  ['CS-170-1: Intro to Computer Science I', 'FA26_MATH_221_3', false],
  ['PHYS 7A LEC 001', 'MATH 1A LEC 001', false],
  ['MATH 1A', 'MATH 1B', false],
  ['CS 170', 'CS 171', false],
];

for (const [a, b, same] of cases) {
  test(`${a} ${same ? '=' : '≠'} ${b}`, () => {
    expect(sameCourse(a, b)).toBe(same);
  });
}
