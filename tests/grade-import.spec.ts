import { test, expect } from '@playwright/test';
import { detectColumns, parseDate, parseDelimited, parseScore, planImport } from '../src/lib/gradeImport';

/**
 * Importing scores from a spreadsheet (2026-10-28): CSV/TSV and pasted cells
 * read in src/lib/gradeImport.ts, columns found by header or content, and
 * what each row would do. The .xlsx reader needs a browser and is covered in
 * grades.spec.ts. All data here is made up.
 */

test('CSV and pasted cells read into rows: quotes, commas inside quotes, tabs, blank lines', () => {
  expect(parseDelimited('Assignment,Score\n"Lab 1, part A",9\n\n"He said ""hi""",3\n')).toEqual([['Assignment', 'Score'], ['Lab 1, part A', '9'], ['He said "hi"', '3']]);
  expect(parseDelimited('﻿Name\tScore\r\nHW 1\t18 / 20\r\n')).toEqual([['Name', 'Score'], ['HW 1', '18 / 20']]);
  expect(parseDelimited('Name;Score\nHW 1;18,5')).toEqual([['Name', 'Score'], ['HW 1', '18,5']]);
});

test('a score cell reads as a fraction, a percent or a number; anything else is no score', () => {
  expect(parseScore('18.0 / 20.0')).toEqual({ score: 18, max: 20 });
  expect(parseScore('18/20')).toEqual({ score: 18, max: 20 });
  expect(parseScore('7 out of 10')).toEqual({ score: 7, max: 10 });
  expect(parseScore('92%')).toEqual({ score: 92, max: 100 });
  expect(parseScore('1,200')).toEqual({ score: 1200, max: null });
  expect(parseScore('8 / 10 pts')).toEqual({ score: 8, max: 10 });
  for (const c of ['Submitted', 'No Submission', '-', '', '9/1/2026']) expect(parseScore(c)).toBeNull();
});

test('dates read from ISO, US, month names (Gradescope) and spreadsheet day numbers', () => {
  expect(parseDate('2026-09-05')).toBe('2026-09-05');
  expect(parseDate('9/5/2026')).toBe('2026-09-05');
  expect(parseDate('9/5/26')).toBe('2026-09-05');
  expect(parseDate('Sep 05 at 11:59PM', 2026)).toBe('2026-09-05');
  expect(parseDate('Fri, Oct 2, 2026')).toBe('2026-10-02');
  expect(parseDate('46270')).toBe('2026-09-05');
  expect(parseDate('Hog')).toBeNull();
});

test('columns are found by header, or by what they hold when there is none', () => {
  const gradescope = parseDelimited('Name\tStatus\tReleased\tDue\nHomework 2\t1.5 / 2.0\tSep 08\tSep 12 at 11:59PM\nLab 04\tSubmitted\t\t');
  expect(detectColumns(gradescope)).toEqual({ header: true, map: { name: 0, score: 1, max: null, category: null, date: 2 } });
  const sheet = parseDelimited('Assignment,Category,Points Earned,Points Possible\nHW 1,Homework,18,20');
  expect(detectColumns(sheet)).toEqual({ header: true, map: { name: 0, score: 2, max: 3, category: 1, date: null } });
  const bare = parseDelimited('HW 1,9/1/2026,18/20\nHW 2,9/8/2026,20/20\nQuiz 1,9/10/2026,7/10');
  expect(detectColumns(bare)).toEqual({ header: false, map: { name: 0, score: 2, max: null, category: null, date: 1 } });
  expect(detectColumns(parseDelimited('a\nb')).map).toBeNull();
});

test('each row says what importing it would do', () => {
  const table = parseDelimited('Assignment,Score,Out of,Category\nHW 1,18,20,Homework\nHog,25,25,Projects\nLab 04,,10,Labs\nCell structure homework,9,10,\nHW 1,19,20,Homework');
  const { map, header } = detectColumns(table);
  const rows = planImport(table, map!, header, { entries: [{ id: 'b', name: 'hog' }], synced: ['Cell structure homework'] });
  expect(rows.map(r => [r.name, r.score, r.max, r.status, r.category])).toEqual([
    ['HW 1', 18, 20, 'new', 'Homework'],
    ['Hog', 25, 25, 'update', 'Projects'],
    ['Lab 04', null, null, 'no-score', 'Labs'],
    ['Cell structure homework', 9, 10, 'synced', ''],
    // A second row of the same name replaces the first.
    ['HW 1', 19, 20, 'update', 'Homework'],
  ]);
  expect(rows[1].entryId).toBe('b');
});
