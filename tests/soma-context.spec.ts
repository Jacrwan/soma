import { test, expect } from '@playwright/test';
import { stillNeeded } from '../src/lib/gradeMath';
import type { WeightedGrade } from '../src/lib/grades';
import { setup, ask, lines, type Ctx } from './event-day';

// What Soma knows before it plans (2026-11-05). The owner vented a month to
// another AI and it "pretty much just built my life"; Soma answered the same
// vent from its first pass, which never sees the calendar, and asked for class
// times that were on it. Long messages now always reach the full Soma, which
// is told to use what it knows; the grade lines say what each course still
// needs; and a reply plans seven days (a 30-day view and a weekly routine
// shipped the same day and were taken out).

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = key(new Date());
const plus = (n: number) => { const d = new Date(`${TODAY}T12:00:00`); d.setDate(d.getDate() + n); return key(d); };

// ── What a course still needs ───────────────────────────────────────────────

test('a course graded by weights says what the rest of it needs for each letter, worked out in code', () => {
  const cat = (name: string, weight: number, percent: number | null) => ({ category: { id: name, name, weight, points: null, covers: '', drop: 0, match: [] }, percent, earned: percent ?? 0, possible: percent === null ? 0 : 100, count: percent === null ? 0 : 1, dropped: 0 });
  const w: WeightedGrade = { percent: 80, letter: 'B-', categories: [cat('Homework', 30, 90), cat('Midterms', 40, 72.5), cat('Final', 30, null)], uncategorized: 0, mode: 'weights', counted: 70, total: 100, earned: 0 };
  const scale = [{ letter: 'A', min: 93 }, { letter: 'A-', min: 90 }, { letter: 'B+', min: 87 }, { letter: 'B', min: 83 }, { letter: 'B-', min: 80 }];
  // B: (83×100 − 80×70) / 30 = 90 on the final.
  expect(stillNeeded(w, scale)).toEqual({ ungraded: ['Final 30%'], left: 30, needs: [
    { letter: 'B-', percent: 80 }, { letter: 'B', percent: 90 }, { letter: 'B+', percent: 104 },
  ] });
  expect(stillNeeded({ ...w, counted: 100 }, scale)).toBeNull();
  expect(stillNeeded(w, null)).toBeNull();
  expect(stillNeeded({ ...w, mode: 'points' }, scale)).toBeNull();
});

test('even "plan my month" sees seven days: the 30-day view is gone, and a long message still gets through', async ({ page }) => {
  // A 30-day view made a month of vague blocks at once; the owner had it taken
  // out (2026-11-05). A first pass that still says "month" changes nothing.
  let seen: (Ctx & { days: { d: string }[] }) | undefined;
  await setup(page, ctx => { seen = ctx as typeof seen; return { reply: 'Finals prep.', blocks: [{ title: 'Review: Physics final', subject: 'Physics 5A', date: plus(20), minutes: 60 }] }; });
  await page.route('**/api/chat', async route => {
    const body = route.request().postDataJSON();
    if (body.purpose === 'triage') return route.fulfill({ json: { content: [{ type: 'text', text: '{"route":"plan","docs":true,"month":true}' }] } });
    return route.fallback();
  });
  // Longer than the dashboard box used to take (1,000 characters), like the vent that started this.
  await ask(page, `plan my month until finals. ${'gym, classes, food, study by 9. '.repeat(40)}`);
  await expect(page.getByRole('log')).toContainText('Finals prep.');
  expect(seen!.days).toHaveLength(7);
  await expect(page.getByRole('log')).toContainText('outside the next seven days');
});

test('without asking for longer, a plan stays to the next seven days', async ({ page }) => {
  let seen: (Ctx & { days: { d: string }[] }) | undefined;
  await setup(page, ctx => { seen = ctx as typeof seen; return { reply: 'Too far.', blocks: [{ title: 'Review: Physics final', subject: 'Physics 5A', date: plus(20), minutes: 60 }] }; });
  await ask(page, 'plan physics');
  await expect(page.getByRole('log')).toContainText('outside the next seven days');
  expect(seen!.days).toHaveLength(7);
});

// ── The first pass doesn't answer a vent ────────────────────────────────────

test('a long message about classes, gym and grades reaches the full Soma, even when the first pass tries to answer it', async ({ page }) => {
  // 2026-11-05: the first pass, which never sees the calendar, answered the
  // owner's vent itself and asked for "your exact class times and locations".
  let seen: (Ctx & { days: { d: string }[] }) | undefined;
  await setup(page, ctx => { seen = ctx as typeof seen; return { reply: 'FULL SOMA' }; });
  await page.route('**/api/chat', async route => {
    if (route.request().postDataJSON().purpose === 'triage') return route.fulfill({ json: { content: [{ type: 'text', text: '{"reply":"That\'s a great plan! What are your exact class times and locations?"}' }] } });
    return route.fallback();
  });
  await ask(page, "you need to build a schedule for me for the next month to keep me busy. classes + gym + food + study all done by 9pm, then 9-11 projects. physics 5a is at 69%, math 53 85%, cs 61a 74%, midterm retake next tuesday.");
  await expect(page.getByRole('log')).toContainText('FULL SOMA');
  await expect(page.getByRole('log')).not.toContainText('class times and locations');
  expect(seen!.days).toHaveLength(7);
  // The class times it asked for were right there.
  expect(lines(seen!.plan).some(l => / CS 61A Lecture · calendar event$/.test(l))).toBe(true);
});

test('a short hello is still answered by the first pass alone', async ({ page }) => {
  let full = 0;
  await setup(page, () => { full++; return { reply: 'FULL SOMA' }; });
  await page.route('**/api/chat', async route => {
    if (route.request().postDataJSON().purpose === 'triage') return route.fulfill({ json: { content: [{ type: 'text', text: '{"reply":"Hi! What are we working on?"}' }] } });
    return route.fallback();
  });
  await ask(page, 'hey soma, how are you?');
  await expect(page.getByRole('log')).toContainText('Hi! What are we working on?');
  expect(full).toBe(0);
});

test('Soma is told to use what it already knows before asking, and never to ask for locations', async ({ page }) => {
  let system = '';
  await setup(page, () => ({ reply: 'ok' }));
  await page.route('**/api/chat', async route => {
    const body = route.request().postDataJSON();
    if (body.purpose !== 'triage') system = JSON.stringify(body.systemPrompt);
    return route.fallback();
  });
  await ask(page, 'plan my week');
  await expect(page.getByRole('log')).toContainText('ok');
  expect(system).toContain('USE WHAT YOU KNOW');
  expect(system).toContain('never ask where things are');
  expect(system).toContain('Never answer a request for a plan with only questions');
});
