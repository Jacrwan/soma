import { test, expect, type Page } from '@playwright/test';
import { readRoutineItems, readRoutine, routineDay, routineLines } from '../src/lib/routine';
import { parseActions } from '../src/lib/agentActions';
import { stillNeeded } from '../src/lib/gradeMath';
import type { WeightedGrade } from '../src/lib/grades';
import { setup, ask, at, lineOf, lines, type Ctx } from './event-day';

// The weekly routine and plans over weeks (2026-11-05). The owner vented a
// month to another AI ("classes + gym + food + study all done by 9pm. then
// 9-11 ill do work on ... soma and studymate") and it "pretty much just built
// my life": Soma should do that with what it already knows. The routine (gym,
// meals with the walk, evening projects) lives in settings and shows on every
// day of the plan; study goes around it; a plan can reach up to 30 days when
// asked; and the grade lines say what each course still needs.

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = key(new Date());
const plus = (n: number) => { const d = new Date(`${TODAY}T12:00:00`); d.setDate(d.getDate() + n); return key(d); };
const weekday = new Date(`${TODAY}T12:00:00`).getDay();
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

// ── The routine itself ──────────────────────────────────────────────────────

test('routine items are checked: names for days, travel folded in, a window that can hold it', () => {
  const items = readRoutineItems([
    { title: 'Gym', days: ['Mon', 'tuesday', 3, 'Thu', 'Fri', 'Sat'], minutes: 90, after: '07:00', before: '21:00' },
    { title: 'Projects', days: EVERY_DAY, minutes: 120, start: '21:00' },
    { title: 'Lunch (with the walk)', days: EVERY_DAY, minutes: 70, after: '11:30', before: '14:30' },
    { title: 'Too tight', days: [1], minutes: 90, after: '12:00', before: '13:00' },
    { title: '', days: [1], minutes: 30 },
    { title: 'No days', days: [], minutes: 30 },
    { title: 'Gym', days: [0], minutes: 45 },
  ]);
  expect(items.map(i => [i.id, i.title, i.days, i.minutes])).toEqual([
    ['gym', 'Gym', [1, 2, 3, 4, 5, 6], 90],
    ['projects', 'Projects', EVERY_DAY, 120],
    ['lunch-with-the-walk', 'Lunch (with the walk)', EVERY_DAY, 70],
    ['gym-2', 'Gym', [0], 45],
  ]);
  expect(items[1]).toMatchObject({ start: '21:00' });
  expect(items[1].after).toBeUndefined();
  expect(readRoutine({ since: TODAY, items: [] })).toBeNull();
  expect(readRoutine({ since: 'soon', items })).toBeNull();
  expect(routineLines(readRoutine({ since: TODAY, items }))[0]).toBe('Gym · 90 min · Mon–Sat · between 07:00 and 21:00');
});

test('a day\'s routine goes around its classes: fixed items at their time, the rest in their windows, in order', () => {
  const routine = readRoutine({ since: TODAY, items: [
    { title: 'Lunch', days: EVERY_DAY, minutes: 70, after: '11:30', before: '14:30' },
    { title: 'Gym', days: EVERY_DAY, minutes: 90, after: '12:00', before: '21:00' },
    { title: 'Projects', days: EVERY_DAY, minutes: 120, start: '21:00' },
  ] });
  const date = new Date(`${TODAY}T00:00:00`);
  // A class 11–12:30, another 14–15:30, and an all-day "Finals week" banner.
  const blocks = routineDay(routine, date, 0, [[660, 750], [840, 930], [0, 1439]]);
  expect(blocks.map(b => [b.title, b.time])).toEqual([
    ['Lunch', '12:30–13:40'],
    ['Gym', '15:30–17:00'],
    ['Projects', '21:00–23:00'],
  ]);
  expect(blocks[0]).toMatchObject({ id: `routine:lunch:${TODAY}`, subject: 'Routine', external: true, routine: true, color: 'neutral' });
  // Work it out again and it lands in the same place: nothing moves when study is added.
  expect(routineDay(routine, date, 0, [[660, 750], [840, 930]]).map(b => b.time)).toEqual(blocks.map(b => b.time));
});

test('a routine starts the day it was saved, keeps to its days, and one with no room still shows', () => {
  const tomorrow = new Date(`${plus(1)}T00:00:00`);
  const routine = readRoutine({ since: plus(1), items: [
    { title: 'Gym', days: [tomorrow.getDay()], minutes: 90, after: '09:00', before: '11:00' },
    { title: 'Cardio', days: [(tomorrow.getDay() + 1) % 7], minutes: 30 },
  ] });
  expect(routineDay(routine, new Date(`${TODAY}T00:00:00`), 0, [])).toEqual([]);
  const busy = routineDay(routine, tomorrow, 1, [[540, 660]]);
  expect(busy.map(b => [b.title, b.time, b.note])).toEqual([['Gym', '', 'No open time in its window today']]);
});

test('Soma\'s routine card is checked like everything else it sends', () => {
  const [card, ...rest] = parseActions([
    { kind: 'routine', items: [{ title: 'Gym', days: ['Mon'], minutes: 90 }, { title: 'x', days: [], minutes: 9 }], studyHours: { start: '08:00', end: '21:00' }, why: 'Study done by 9' },
    { kind: 'routine', items: [{ title: 'Second', days: ['Mon'], minutes: 30 }] },
    { kind: 'routine', items: 'gym every day' },
  ]);
  expect(rest).toEqual([]);
  expect(card).toMatchObject({ kind: 'routine', studyHours: { start: '08:00', end: '21:00' }, why: 'Study done by 9' });
  expect(card.kind === 'routine' && card.items.map(i => i.title)).toEqual(['Gym']);
  expect(parseActions([{ kind: 'routine', items: [{ title: 'Gym', days: ['Mon'], minutes: 90 }], studyHours: { start: '9pm', end: '21:00' } }])[0]).not.toHaveProperty('studyHours');
});

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

// ── On the dashboard and in Soma ────────────────────────────────────────────

/** A routine already saved in this browser, before the dashboard opens. The
 *  shared setup writes its own settings after this runs, so the routine is
 *  added to whatever settings it writes. */
async function withRoutine(page: Page, items: unknown[]) {
  await page.addInitScript(routine => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'soma_settings') { const o = JSON.parse(v); if (o.routine === undefined) v = JSON.stringify({ ...o, routine }); }
      return write.call(this, k, v);
    };
  }, { since: TODAY, items });
}

test('a saved routine shows on the plan as Routine, and Soma sees it and places study around it', async ({ page }) => {
  let seen: Ctx | undefined;
  await withRoutine(page, [{ title: 'Lunch', days: EVERY_DAY, minutes: 60, after: '12:30', before: '14:00' }]);
  const db = await setup(page, ctx => { seen = ctx; return { reply: 'Physics after lunch.', changes: [{ action: 'move', id: lineOf(ctx, 'Physics HW 5: KK-5')!.split(' ')[0], date: TODAY, minutes: 60, after: '13:00' }] }; });
  // Lunch goes after the 12:00–12:59 lecture, at 13:00.
  await expect(page.getByRole('article').filter({ hasText: 'Lunch' })).toContainText('Routine');
  await ask(page, 'fit in physics');
  await expect(page.getByRole('log')).toContainText('Physics after lunch.');
  expect((seen as unknown as { routine: string[] }).routine).toEqual(['Lunch · 60 min · every day · between 12:30 and 14:00']);
  expect(lines(seen!.plan).find(l => l.includes(' Lunch'))).toMatch(/ 13:00–14:00 Lunch · routine$/);
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => db.todo_sessions.length).toBe(1);
  // Not on lunch (13:00–14:00), not on the 14:00 discussion: after it.
  expect(db.todo_sessions[0].start_time).toBe(at('15:00'));
});

test('a routine Soma proposes comes as a card: study in the same reply already goes around it, and Save puts it on the plan', async ({ page }) => {
  const saved: unknown[] = [];
  const db = await setup(page, ctx => ({
    reply: "Here's your routine, and Physics today.",
    actions: [{ kind: 'routine', items: [{ title: 'Gym', days: EVERY_DAY, minutes: 60, after: '13:00', before: '21:00' }], studyHours: { start: '08:00', end: '21:00' }, why: 'Study done by 9' }],
    changes: [{ action: 'move', id: lineOf(ctx, 'Physics HW 5: KK-5')!.split(' ')[0], date: TODAY, minutes: 60, after: '13:00' }],
  }));
  await page.route('https://soma-regression.supabase.co/rest/v1/settings**', route => {
    if (route.request().method() === 'POST') saved.push(route.request().postDataJSON());
    return route.fulfill({ json: route.request().method() === 'GET' ? { data: { onboardingCompleted: true, theme: 'light' } } : null });
  });
  await ask(page, 'gym 1.5 hours every day, study done by 9pm, then physics');
  const card = page.getByRole('region', { name: 'Weekly routine' });
  await expect(card).toContainText('Gym');
  await expect(card).toContainText('Study hours: 8:00 AM–9:00 PM');
  // The proposed gym takes 13:00–14:00, so Physics goes after the 14:00 discussion.
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(() => db.todo_sessions.length).toBe(1);
  expect(db.todo_sessions[0].start_time).toBe(at('15:00'));
  await card.getByRole('button', { name: 'Save routine' }).click();
  await expect(card).toContainText('Saved ✓');
  expect(saved).toHaveLength(1);
  expect((saved[0] as { data: { routine: { items: { title: string }[] }; studyWindow: { end: string } } }).data).toMatchObject({ routine: { items: [{ title: 'Gym' }] }, studyWindow: { end: '21:00' } });
  await expect(page.getByRole('article').filter({ hasText: 'Gym' }).first()).toContainText('Routine');
});

test('asked for a month, Soma sees thirty days and can plan the last of them', async ({ page }) => {
  let seen: (Ctx & { days: { d: string }[] }) | undefined;
  await setup(page, ctx => { seen = ctx as typeof seen; return { reply: 'Finals prep.', blocks: [{ title: 'Review: Physics final', subject: 'Physics 5A', date: plus(29), minutes: 60 }] }; });
  await page.route('**/api/chat', async route => {
    const body = route.request().postDataJSON();
    if (body.purpose === 'triage') return route.fulfill({ json: { content: [{ type: 'text', text: '{"route":"plan","docs":true,"month":true}' }] } });
    return route.fallback();
  });
  // Longer than the dashboard box used to take (1,000 characters), like the vent that started this.
  await ask(page, `plan my month until finals. ${'gym, classes, food, study by 9. '.repeat(40)}`);
  await expect(page.getByRole('log')).toContainText('Finals prep.');
  expect(seen!.days).toHaveLength(30);
  expect(seen!.days[29].d).toBe(plus(29));
  await expect(page.getByRole('log')).not.toContainText('outside the next');
  await expect(page.getByRole('button', { name: /^Accept/ }).first()).toBeVisible();
});

test('without asking for longer, a plan stays to the next seven days', async ({ page }) => {
  let seen: (Ctx & { days: { d: string }[] }) | undefined;
  await setup(page, ctx => { seen = ctx as typeof seen; return { reply: 'Too far.', blocks: [{ title: 'Review: Physics final', subject: 'Physics 5A', date: plus(20), minutes: 60 }] }; });
  await ask(page, 'plan physics');
  await expect(page.getByRole('log')).toContainText('outside the next seven days');
  expect(seen!.days).toHaveLength(7);
  expect(weekday).toBeGreaterThanOrEqual(0);
});

// ── Settings ────────────────────────────────────────────────────────────────

test('Settings → Study hours lists the routine; adding and removing saves at once, keeping other settings', async ({ page }) => {
  const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
  const posts: { data: Record<string, unknown> }[] = [];
  let stored: Record<string, unknown> = { onboardingCompleted: true, theme: 'light', canvasIcalUrl: 'https://example.instructure.com/feed.ics' };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') {
      if (req.method() === 'POST') { const b = req.postDataJSON(); posts.push(b); stored = b.data; return route.fulfill({ json: null }); }
      return route.fulfill({ json: { data: stored } });
    }
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/memory', r => r.fulfill({ json: { revision: 0, enabled: true, entries: [] } }));
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Study hours', exact: true }).click();
  await expect(page.getByText('Nothing yet. Tell Soma how your days go, or add things here.')).toBeVisible();
  const form = page.getByRole('form', { name: 'Add to your routine' });
  await form.getByLabel('Name').fill('Gym');
  await form.getByLabel('Minutes').fill('90');
  await form.getByRole('button', { name: 'Saturday' }).click();
  await form.getByRole('button', { name: 'Add to routine' }).click();
  const list = page.getByRole('list', { name: 'Your weekly routine' });
  await expect(list).toContainText('Gym · 1h 30m · Mon–Sat · between 7:00 AM and 11:00 PM');
  expect(posts.at(-1)!.data).toMatchObject({ canvasIcalUrl: 'https://example.instructure.com/feed.ics', routine: { since: TODAY, items: [{ id: 'gym', title: 'Gym', days: [1, 2, 3, 4, 5, 6], minutes: 90 }] } });
  // Changing study hours afterwards doesn't drop the routine from this browser.
  await page.getByLabel('Latest end').fill('21:00');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('soma_settings')!).routine.items[0].title)).toBe('Gym');
  await page.getByRole('button', { name: 'Remove Gym' }).click();
  await expect(page.getByText('Nothing yet. Tell Soma how your days go, or add things here.')).toBeVisible();
  expect(posts.at(-1)!.data.routine).toBeNull();
});

// ── The first pass doesn't answer a vent ────────────────────────────────────

test('a long message about classes, gym and grades reaches the full Soma, with weeks to plan, even when the first pass tries to answer it', async ({ page }) => {
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
  expect(seen!.days).toHaveLength(30);
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
