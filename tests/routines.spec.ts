import { test, expect } from '@playwright/test';
import { guideRows, guidesOf, sectionsIn, mondayOf, rowForWeek } from '../src/lib/weekGuide';
import { findRoutines, guideWeeks, routineLines } from '../src/lib/routines';

// 2026-11-10: Soma couldn't tell which math homework the student meant,
// though the guide was uploaded and they had done "the previous week's set"
// on Tuesday nights and Wednesday mornings for weeks. Guides are now read as
// week rows, and routines are learned from what was done. Synthetic data.

const NOW = new Date(2026, 10, 10, 18, 0); // Tue Nov 10, 6 PM

const GUIDE = `Homework for Calc 2, Fall '26.
Lecture Dates   Reading   Homework
Sept 29, Oct 1 14.3
 1,2,3,9 \n 14.4 \n 4,5,6
Oct 6, 8 14.5 2,4,8
Oct 13, 15
 14.5 10,11 \n 14.6 1-3,7
Oct 20, 22 14.7 5,6 \n 14.8 3,9
Oct 27, 29 15.1 1,2 15.2 \n 3,4 15.3 5 15.4 6,7
Nov 3, 5 15.6 3,5 \n 15.7 2,4 \n 15.8 1,3 \n 15.9 2,4
Nov 10, 12 16.1 2,5 16.2 3,5 16.3 3,7
Nov 24 16.7, pp. 1127-1132 21,22`;

const doc = { id: 'g1', fileName: 'calc-hw.html', subjectId: 'calc', extractedText: GUIDE, extractionStatus: 'done' };

test('a dated guide becomes week rows: dates to section numbers, problem numbers left out', () => {
  const rows = guideRows(GUIDE, NOW);
  const nov3 = rows.find(r => r.label === 'Nov 3, 5')!;
  expect(nov3.sections).toEqual(['15.6', '15.7', '15.8', '15.9']);
  expect(nov3.dates.map(d => d.getDate())).toEqual([3, 5]);
  expect(rows.find(r => r.label === 'Sept 29, Oct 1')!.sections).toEqual(['14.3', '14.4']);
  expect(rows.find(r => r.label === 'Nov 24')!.sections).toEqual(['16.7']);
  // A syllabus naming a couple of dates is not a guide.
  expect(guideRows('Midterm Oct 14, final Dec 15. Read 1.2 first.', NOW)).toEqual([]);
});

test('the week a row belongs to is picked by its first lecture day', () => {
  const [guide] = guidesOf([doc], NOW);
  expect(rowForWeek(guide, mondayOf(NOW))!.label).toBe('Nov 10, 12');
  const lastMonday = new Date(mondayOf(NOW)); lastMonday.setDate(lastMonday.getDate() - 7);
  expect(rowForWeek(guide, lastMonday)!.sections).toEqual(['15.6', '15.7', '15.8', '15.9']);
  expect(guideWeeks([guide], id => id === 'calc' ? 'Calc 2' : undefined, NOW)).toEqual({
    'Calc 2': { thisWeek: 'Nov 10, 12: 16.1, 16.2, 16.3', lastWeek: 'Nov 3, 5: 15.6, 15.7, 15.8, 15.9', file: 'calc-hw.html' },
  });
});

test('section ranges in titles are read out', () => {
  expect(sectionsIn('Calc homework: 15.1–15.4')).toEqual(['15.1', '15.2', '15.3', '15.4']);
  expect(sectionsIn('Calc homework: 14.7, 14.8')).toEqual(['14.7', '14.8']);
  expect(sectionsIn('Calc homework')).toEqual([]);
});

const at = (m: number, d: number, h: number, min = 0) => new Date(2026, m - 1, d, h, min).toISOString();

/** Four weeks of "the previous week's set", Tuesday night then Wednesday morning. */
function history() {
  const weeks: [string, [number, number], [number, number]][] = [
    ['Calc homework: 14.5', [10, 13], [10, 14]],
    ['Calc homework: 14.5–14.6', [10, 20], [10, 21]],
    ['Calc homework: 14.7, 14.8', [10, 27], [10, 28]],
    ['Calc homework: 15.1–15.4', [11, 3], [11, 4]],
  ];
  const todos = weeks.map(([text], i) => ({ id: `t${i}`, text, subjectId: 'calc', status: 'done' }));
  const sessions = weeks.flatMap(([, tue, wed], i) => [
    { todoId: `t${i}`, startTime: at(tue[0], tue[1], 21, 30) },
    { todoId: `t${i}`, startTime: at(wed[0], wed[1], 9, 0) },
  ]);
  return { history: [], todos, sessions };
}

test('a routine is learned from checked-off blocks: the days, and which week\'s set', () => {
  const routines = findRoutines(history(), guidesOf([doc], NOW), NOW);
  expect(routines).toHaveLength(1);
  const [r] = routines;
  expect(r).toMatchObject({ subjectId: 'calc', kind: 'homework', slots: ['Tue around 21:30', 'Wed around 09:00'], weeks: 4, held: 4, lag: 1 });
  expect(r.next!.sections).toEqual(['15.6', '15.7', '15.8', '15.9']);
  const [line] = routineLines(routines, () => 'Calc 2');
  expect(line).toBe('Calc 2 homework: usually Tue around 21:30, Wed around 09:00 (4 of the last 4 weeks with this work); always the previous week\'s set; that\'s 15.6, 15.7, 15.8, 15.9 now (lectures Nov 3, 5, "calc-hw.html")');
});

test('two weeks is not a routine, and unfinished work does not count', () => {
  const h = history();
  h.todos = h.todos.map((t, i) => i < 2 ? { ...t, status: 'nothing' } : t);
  expect(findRoutines(h, guidesOf([doc], NOW), NOW)).toEqual([]);
});

test('Focus sessions count too, with times stored as UTC', () => {
  const tuesdays: [number, number][] = [[10, 20], [10, 27], [11, 3]];
  const history = tuesdays.map(([m, d]) => ({ subject_id: 'calc', task_text: 'Calc reading', start_time: at(m, d, 13).replace('Z', ''), duration_seconds: 3600 }));
  const [r] = findRoutines({ history, todos: [], sessions: [] }, [], NOW);
  expect(r).toMatchObject({ kind: 'reading', slots: ['Tue around 13:00'], held: 3 });
  expect(r.lag).toBeUndefined();
});

// The owner's Wednesday sessions start between 11:30 and 12:40. Cut into
// morning and afternoon, no part held three weeks; by weekday it's a habit.
test('a habit that straddles noon, or runs past midnight, is still one day', () => {
  const sittings: [number, number, number, number][] = [[10, 21, 11, 30], [10, 28, 12, 15], [11, 4, 12, 10], [11, 4, 12, 40]];
  const history = sittings.map(([m, d, h, min]) => ({ subject_id: 'calc', task_text: 'Calc homework', start_time: new Date(2026, m - 1, d, h, min).toISOString(), duration_seconds: 3600 }));
  // Tuesday night work that ran past midnight belongs to Tuesday.
  const nights: [number, number][] = [[10, 21], [10, 28], [11, 4]];
  history.push(...nights.map(([m, d]) => ({ subject_id: 'calc', task_text: 'Calc homework', start_time: new Date(2026, m - 1, d, 1, 0).toISOString(), duration_seconds: 3600 })));
  const [r] = findRoutines({ history, todos: [], sessions: [] }, [], NOW);
  expect(r.slots).toEqual(['Tue around 01:00', 'Wed around 12:00']);
});
