import { test, expect } from '@playwright/test';
import { setup, ask, lineOf, type Ctx } from './event-day';
import { datesIn, search, type SearchDoc } from '../src/lib/docSearch';

// Reported 2026-11-03: "schedule me to do the math homework from last week"
// got "Math 53 homework: 14.3-14.6", when last week's was 15.1-15.4. That task
// was from October 21: its block had aged out of what Soma sees, so it looked
// like a new open task with nothing to say how old it was. And the search for
// the guide looked for the words "last week", which a guide listing work by
// lecture date doesn't contain.

const label = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const mondayOf = (weeksAgo: number) => {
  const d = new Date(); d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - weeksAgo * 7);
  return d;
};
const iso = (d: Date) => d.toLocaleDateString('en-CA');
const later = (d: Date, days: number) => { const x = new Date(d); x.setDate(x.getDate() + days); return x; };

// A term's guide, one entry a week, by lecture date. `sections(0)` is this week's.
const sections = (weeksAgo: number) => `section-${40 - weeksAgo}`;
const guideText = Array.from({ length: 41 }, (_, i) => {
  const ago = 20 - i, monday = mondayOf(ago);
  return `Math 53 homework for ${label(monday)} & ${label(later(monday, 2))} lectures: ${sections(ago)}. Show all work, staple the pages, and put your discussion section number on the front. Late homework is not accepted, and the lowest two homework scores are dropped at the end of the term.\n`;
}).join('\n');
const guide = { id: 'd-guide', user_id: 'u', subject_id: 'math', file_name: 'MATH53-homework-guide.pdf', storage_path: 'x', file_type: 'application/pdf', size_bytes: 10, doc_type: 'syllabus', created_at: new Date().toISOString(), extraction_status: 'done', extracted_text: guideText };
// Another course's guide, full of the same words, shouldn't crowd it out.
const physics = { ...guide, id: 'd-phys', subject_id: 'phys', file_name: 'PHYS-homework.pdf', extracted_text: Array.from({ length: 30 }, (_, i) => `Physics homework week ${i}: last week of the unit, math review and homework help. Physics homework is due every week, and last week's homework goes over the math.`).join('\n\n') };

test('"the math homework from last week" sends the part of the guide dated last week', async ({ page }) => {
  let context = '';
  await setup(page, (_ctx, body) => { context = String(body.context); return { reply: 'ok' }; }, db => {
    db.subjects.push({ id: 'math', user_id: 'u', name: 'Math 53', color: '#42a5f5', archived: false });
    db.documents = [guide, physics];
  });
  await ask(page, 'schedule me to do the math homework from last week');
  await expect(page.getByRole('log')).toContainText('ok');
  expect(context).toContain(`${sections(1)}.`);
});

test('an open task says how old it is, so an old one can\'t pass for last week\'s', async ({ page }) => {
  const old = later(new Date(), -13);
  let ctx: Ctx | undefined, instructions = '';
  await setup(page, (c, body) => { ctx = c; instructions = String(body.systemPrompt); return { reply: 'ok' }; }, db => {
    db.subjects.push({ id: 'math', user_id: 'u', name: 'Math 53', color: '#42a5f5', archived: false });
    db.todos.push({ id: 't-old', user_id: 'u', text: 'Math 53 homework: 14.3-14.6', subject_id: 'math', status: 'nothing', date: iso(old) });
    db.todos.push({ id: 't-new', user_id: 'u', text: 'Math 53 quiz prep', subject_id: 'math', status: 'nothing', date: iso(new Date()) });
  });
  await ask(page, 'schedule me to do the math homework from last week');
  await expect(page.getByRole('log')).toContainText('ok');
  const m = String(old.getMonth() + 1).padStart(2, '0'), d = String(old.getDate()).padStart(2, '0');
  expect(lineOf(ctx!, 'Math 53 homework: 14.3-14.6')).toMatch(new RegExp(` · from [A-Z][a-z]{2} ${m}-${d}$`));
  expect(lineOf(ctx!, 'Math 53 quiz prep')).not.toContain('from');
  expect(instructions).toContain('WORK NAMED BY ITS WEEK OR DATE');
});

const asDoc = (id: string, subjectId: string, extractedText: string): SearchDoc => ({ id, fileName: `${id}.pdf`, docType: 'syllabus', subjectId, extractedText });

test('dates are read the ways a guide writes them', () => {
  expect([...datesIn('Homework for Sep 29 & Oct 1 lectures')].sort()).toEqual(['09-29', '10-01']);
  expect([...datesIn('Lectures on October 27, 29 and 31.')].sort()).toEqual(['10-27', '10-29', '10-31']);
  expect([...datesIn('Due 27 Oct, or 11/3, or 2026-11-05')].sort()).toEqual(['10-27', '11-03', '11-05']);
  // Words that start like months, and numbers that only look like dates.
  expect([...datesIn('A decimal 5, a market 12, section 14.3, 13/40 points, may 45')]).toEqual([]);
});

test('work dated around now doesn\'t push out the passages that best answer the question', () => {
  const filler = (word: string, n: number) => Array.from({ length: n }, (_, i) => `${word} entry ${i} with some general reminders about the course and how it runs each term.`).join(' ');
  const policy = `The late policy: homework may be turned in one day late for half credit. ${filler('policy', 12)}`;
  const dated = Array.from({ length: 30 }, (_, i) => `Oct 27 lecture ${i}: ${filler('lecture', 12)}`).join('\n\n');
  const found = search([asDoc('math', 'math', `${dated}\n\n${policy}`)], 'what is the late policy for homework', { subjectIds: ['math'], dates: ['10-27'] });
  expect(found.map(p => p.text).join('\n')).toContain('The late policy');
  expect(found.some(p => p.text.includes('Oct 27'))).toBe(true);
  expect(found.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(9000);
});
