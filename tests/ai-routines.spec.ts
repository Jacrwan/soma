import { test, expect } from '@playwright/test';
import { setup, ask, type Row } from './event-day';

// 2026-11-10: "im doing all of last week's math homework after the large
// group" got "I couldn't tell from your documents which sections were
// assigned last week", though the guide was uploaded and the student had done
// the previous week's set on Tuesday nights and Wednesday mornings for
// weeks. And a month-old open task's sections ("14.3–14.6") came back as the
// new block's name. Synthetic data, dated relative to today.

const user = '11111111-1111-4111-8111-111111111111';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monday = (weeks: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7 * weeks); return d; };
const plus = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const label = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = (d: Date, h: number) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x.toISOString(); };

/** One row a week, lectures Monday and Wednesday: week -5 is chapter 10, … this week chapter 15, next week 16. */
const GUIDE = ['Homework, Fall term', ...Array.from({ length: 7 }, (_, i) => {
  const mon = monday(i - 5), chapter = 10 + i;
  return `${label(mon)}, ${plus(mon, 2).getDate()} ${chapter}.1 1,2,3 ${chapter}.2 4,5`;
})].join('\n');

function seed(db: Record<string, Row[]>) {
  db.subjects.push({ id: 'math', user_id: user, name: 'MATH 53', color: '#42a5f5', archived: false });
  db.documents = [{ id: 'g1', user_id: user, subject_id: 'math', file_name: 'hw-guide.html', storage_path: 'x', file_type: 'text/html', size_bytes: 4000, doc_type: 'assignment', created_at: new Date().toISOString(), extraction_status: 'done', extracted_text: GUIDE }];
  // The previous week's set, Tuesday night and Wednesday morning, four weeks running.
  for (let w = -4; w <= -1; w++) {
    const chapter = 10 + (w + 5) - 1;
    const id = `hw${w}`;
    db.todos.push({ id, user_id: user, text: `Math homework: ${chapter}.1–${chapter}.2`, subject_id: 'math', status: 'done', date: key(plus(monday(w), 1)) });
    db.todo_sessions.push({ id: `${id}-tue`, user_id: user, todo_id: id, date: key(plus(monday(w), 1)), start_time: at(plus(monday(w), 1), 21), end_time: at(plus(monday(w), 1), 23) });
    db.todo_sessions.push({ id: `${id}-wed`, user_id: user, todo_id: id, date: key(plus(monday(w), 2)), start_time: at(plus(monday(w), 2), 9), end_time: at(plus(monday(w), 2), 10) });
  }
  // A month-old task naming old sections, never done.
  db.todos.push({ id: 'old', user_id: user, text: 'Math homework: 9.3–9.6', subject_id: 'math', status: 'nothing', date: key(plus(monday(-5), 1)) });
}

test('Soma is told the routine and which sections it points to this week', async ({ page }) => {
  let ctx: Record<string, unknown> | undefined;
  await setup(page, c => { ctx = c as unknown as Record<string, unknown>; return { reply: 'ok' }; }, seed);
  await ask(page, "im doing all of last week'sm ath homework after the large group");
  await expect(page.getByRole('log')).toContainText('ok');
  const routines = ctx!.routines as string[];
  expect(routines).toHaveLength(1);
  expect(routines[0]).toMatch(/^MATH 53 homework: usually Tue around 21:00, Wed around 09:00 \(4 of the last 4 weeks with this work\); always the previous week's set; that's 14\.1, 14\.2 now/);
  expect(ctx!.guideWeeks).toEqual({ 'MATH 53': { thisWeek: expect.stringMatching(/: 15\.1, 15\.2$/), lastWeek: expect.stringMatching(/: 14\.1, 14\.2$/), file: 'hw-guide.html' } });
});

test('a month-old task naming other sections doesn\'t rename a new block', async ({ page }) => {
  await setup(page, () => ({ reply: "Here's the plan:", blocks: [{ title: 'Math homework', subject: 'MATH 53', minutes: 60 }] }), seed);
  await ask(page, 'plan the math homework');
  await expect(page.getByRole('log')).toContainText("Here's the plan");
  await expect(page.getByRole('log')).not.toContainText('9.3–9.6');
  await expect(page.getByRole('log')).toContainText('Math homework');
});
