import { test, expect, type Page } from '@playwright/test';
import { setup, ask } from './event-day';

// Reported 2026-11-19: asked to plan for finals "due on the date and time I
// put in my calendar", Soma said it couldn't see them. They were four weeks
// out and Soma only got the next seven days. Calendar events that look like
// exams now come along from 60 days back to 60 days ahead, as dates only.
type ExamCtx = { exams?: string[] };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (offset: number, t: string) => { const d = new Date(); d.setDate(d.getDate() + offset); return new Date(`${key(d)}T${t}:00`); };
const ev = (id: string, summary: string, offset: number, from: string, to: string) =>
  ({ id, summary, start: { dateTime: day(offset, from).toISOString() }, end: { dateTime: day(offset, to).toISOString() }, source: { connectionId: 'c', calendarId: 'k' } });
const wd = (offset: number) => day(offset, '12:00').toLocaleDateString('en-US', { weekday: 'short' });

/** The wide exam-dates read (more than a month asked for) gets `wide`; the plan's own read is left alone. */
async function wideCalendar(page: Page, wide: unknown[] | 'fail') {
  await page.route('**/api/google-calendar-events', async route => {
    const { timeMin, timeMax } = route.request().postDataJSON() as { timeMin: string; timeMax: string };
    if (+new Date(timeMax) - +new Date(timeMin) < 40 * 86_400_000) return route.fallback();
    return wide === 'fail' ? route.fulfill({ status: 500, json: {} }) : route.fulfill({ json: { events: wide, incomplete: false } });
  });
}

test('exam dates 60 days back and ahead reach Soma; classes and far-off events do not', async ({ page }) => {
  let seen: ExamCtx | undefined;
  await setup(page, ctx => { seen = ctx as ExamCtx; return { reply: 'Noted.' }; });
  await wideCalendar(page, [
    ev('mt', 'Physics 5A Midterm 2', -30, '09:30', '10:59'),
    ev('p', 'Physics 5A Final', 26, '15:00', '18:00'),
    ev('cs', 'CS 61A Final', 29, '11:30', '14:30'),
    ev('m', 'MATH 53 Final', 29, '19:00', '22:00'),
    ev('m2', 'MATH 53 Final', 29, '19:00', '22:00'),
    ev('far', 'Spring Midterm', 90, '10:00', '11:00'),
    ev('lec', 'CS 61A Lecture', 29, '12:00', '12:59'),
  ]);
  await ask(page, 'when are my finals?');
  await expect(page.getByRole('log')).toContainText('Noted.');
  expect(seen!.exams).toEqual([
    `${wd(-30)} ${key(day(-30, '12:00'))} 09:30–10:59 Physics 5A Midterm 2 · past`,
    `${wd(26)} ${key(day(26, '12:00'))} 15:00–18:00 Physics 5A Final`,
    `${wd(29)} ${key(day(29, '12:00'))} 11:30–14:30 CS 61A Final`,
    `${wd(29)} ${key(day(29, '12:00'))} 19:00–22:00 MATH 53 Final`,
  ]);
});

test('no exam-like events, no exams key', async ({ page }) => {
  let seen: ExamCtx | undefined;
  await setup(page, ctx => { seen = ctx as ExamCtx; return { reply: 'Noted.' }; });
  await wideCalendar(page, [ev('lec', 'CS 61A Lecture', 10, '12:00', '12:59')]);
  await ask(page, 'when are my finals?');
  await expect(page.getByRole('log')).toContainText('Noted.');
  expect(seen!.exams).toBeUndefined();
});

test('a failed exam-dates read still gets a reply', async ({ page }) => {
  let seen: ExamCtx | undefined;
  await setup(page, ctx => { seen = ctx as ExamCtx; return { reply: 'Noted.' }; });
  await wideCalendar(page, 'fail');
  await ask(page, 'when are my finals?');
  await expect(page.getByRole('log')).toContainText('Noted.');
  expect(seen!.exams).toBeUndefined();
});
