import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Due-soon reminders (extension/due.js, and remind() in background.js): what
 * counts as due soon and not handed in, the toolbar badge, and when a
 * notification fires. Runs the extension's own scripts in a blank page with
 * the chrome.* APIs they use stubbed and recorded.
 */

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const HOUR = 3600 * 1000;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOUR).toISOString();

type Work = { key: string; site: string; name: string; course: string; note: string };

/** Synthetic snapshots: Canvas, Gradescope and WebAssign, with a linked twin. */
const snapshots = () => ({
  'school.instructure.com': {
    kind: 'canvas', host: 'school.instructure.com',
    courses: [{ id: 1, name: 'CS-170-1: Intro to Computer Science I - Fall 2026', courseCode: 'CS-170-1' }],
    assignments: [
      // Links to Gradescope, where it was submitted: Canvas never learns.
      { id: 10, courseId: 1, name: 'Coding Problem 3', dueAt: at(5), htmlUrl: 'https://school.instructure.com/a/10', workflowState: 'unsubmitted', submissionTypes: ['external_tool'] },
      // Handed in on paper: never "submitted" in Canvas, so never nagged about.
      { id: 11, courseId: 1, name: 'Worksheet 2', dueAt: at(6), htmlUrl: 'https://school.instructure.com/a/11', workflowState: 'unsubmitted', submissionTypes: ['on_paper'] },
      { id: 12, courseId: 1, name: 'Reflection essay', dueAt: at(20), htmlUrl: 'https://school.instructure.com/a/12', workflowState: 'unsubmitted', submissionTypes: ['online_upload'] },
      { id: 13, courseId: 1, name: 'Quiz 5', dueAt: at(2), htmlUrl: 'https://school.instructure.com/a/13', workflowState: 'submitted', submittedAt: at(-1), submissionTypes: ['online_quiz'] },
      { id: 14, courseId: 1, name: 'Next week project', dueAt: at(100), htmlUrl: 'https://school.instructure.com/a/14', workflowState: 'unsubmitted', submissionTypes: ['online_upload'] },
      { id: 15, courseId: 1, name: 'Already past', dueAt: at(-3), htmlUrl: 'https://school.instructure.com/a/15', workflowState: 'unsubmitted', submissionTypes: ['online_upload'] },
    ],
  },
  'www.gradescope.com': {
    kind: 'gradescope', host: 'www.gradescope.com',
    courses: [{ id: 2, shortName: 'FA26_CS_170_1', name: 'CS-170-1: Intro to Computer Science I - Fall 2026' }],
    assignments: [
      { id: 20, courseId: 2, name: 'Coding Problem 3', dueAt: at(5), htmlUrl: 'https://www.gradescope.com/courses/2/assignments/20', status: 'submitted' },
      { id: 21, courseId: 2, name: 'Lab 6 - String Handling', dueAt: at(30), htmlUrl: 'https://www.gradescope.com/courses/2/assignments/21', status: 'not_submitted' },
    ],
  },
  'www.webassign.net': {
    kind: 'webassign', host: 'www.webassign.net',
    courses: [{ id: 3, name: 'PHYS 151, Fall 2026' }],
    assignments: [
      { id: 30, courseId: 3, name: 'HW8', dueAt: at(2), htmlUrl: 'https://www.webassign.net/web/Student/Assignment-Responses/last?dep=30', status: 'in_progress', parts: 17, answered: 5 },
      { id: 31, courseId: 3, name: 'HW7', dueAt: at(4), htmlUrl: 'https://www.webassign.net/web/Student/Assignment-Responses/last?dep=31', status: 'complete', parts: 10, answered: 10 },
    ],
  },
});

async function loadDue(page: Page) {
  await page.goto('about:blank');
  await page.addScriptTag({ content: read('extension/due.js') });
}

test('due soon: only open work in the next 48 hours, one row per piece of work', async ({ page }) => {
  await loadDue(page);
  const soon = await page.evaluate(s => (self as unknown as { somaDue: { dueSoon: (s: unknown) => Work[] } }).somaDue.dueSoon(s), snapshots());
  expect(soon.map(w => w.name)).toEqual(['HW8', 'Reflection essay', 'Lab 6 - String Handling']);
  // Progress from WebAssign, and the course's short name.
  expect(soon[0]).toMatchObject({ site: 'webassign', course: 'PHYS 151', note: '5 of 17 parts answered' });
  expect(soon[2]).toMatchObject({ site: 'gradescope', course: 'CS-170-1' });
});

test('due soon: an unsubmitted Gradescope twin is listed once, as Gradescope', async ({ page }) => {
  await loadDue(page);
  const s = snapshots();
  s['www.gradescope.com'].assignments[0].status = 'not_submitted';
  const soon = await page.evaluate(x => (self as unknown as { somaDue: { dueSoon: (s: unknown) => Work[] } }).somaDue.dueSoon(x), s);
  const cp3 = soon.filter(w => w.name === 'Coding Problem 3');
  expect(cp3).toHaveLength(1);
  expect(cp3[0].site).toBe('gradescope');
});

/** background.js with the chrome APIs it uses stubbed; returns what it did. */
async function loadBackground(page: Page, store: Record<string, unknown>) {
  await page.goto('about:blank');
  await page.evaluate(initial => {
    const w = window as unknown as Record<string, unknown>;
    const log = { badge: [] as string[], notes: [] as { id: string; title: string; message: string; priority: number }[], opened: [] as string[] };
    const data: Record<string, unknown> = { ...initial };
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
    const on = (name: string) => ({ addListener: (f: (...a: unknown[]) => void) => { (listeners[name] ??= []).push(f); } });
    w.__log = log; w.__data = data; w.__fire = (name: string, ...a: unknown[]) => Promise.all((listeners[name] ?? []).map(f => f(...a)));
    w.importScripts = () => {};
    w.chrome = {
      storage: { local: {
        get: async (k: string | string[]) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter(x => x in data).map(x => [x, structuredClone(data[x])])),
        set: async (o: Record<string, unknown>) => { Object.assign(data, structuredClone(o)); },
      }, onChanged: on('storage') },
      action: { setBadgeText: async ({ text }: { text: string }) => { log.badge.push(text); }, setBadgeBackgroundColor: async () => {} },
      notifications: { create: (id: string, o: { title: string; message: string; priority: number }) => { log.notes.push({ id, ...o }); }, clear: () => {}, onClicked: on('click') },
      tabs: { create: async ({ url }: { url: string }) => { log.opened.push(url); }, query: async () => [] },
      alarms: { create: () => {}, onAlarm: on('alarm') },
      permissions: { getAll: async () => ({ origins: [] }), onAdded: on('added'), onRemoved: on('removed') },
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {}, executeScript: async () => {} },
      runtime: { onMessage: on('message'), onInstalled: on('installed'), onStartup: on('startup'), sendMessage: async () => undefined },
      offscreen: { hasDocument: async () => true, createDocument: async () => {} },
    };
  }, store);
  for (const f of ['common.js', 'due.js', 'background.js']) await page.addScriptTag({ content: read(`extension/${f}`) });
}

const remind = (page: Page) => page.evaluate(() => (window as unknown as { remind: () => Promise<void> }).remind());
const log = (page: Page) => page.evaluate(() => (window as unknown as { __log: { badge: string[]; notes: { id: string; title: string; message: string; priority: number }[]; opened: string[] } }).__log);

test('reminders: a badge count, one notice per stage, and a click opens the work', async ({ page }) => {
  await loadBackground(page, { snapshots: snapshots() });
  await remind(page);
  let l = await log(page);
  expect(l.badge.at(-1)).toBe('3');
  // HW8 (2 h) is in its last three hours; the essay (20 h) is within a day; Lab 6 (30 h) is neither yet.
  expect(l.notes.map(n => [n.title.split(' is due')[0], n.priority])).toEqual([['HW8', 2], ['Reflection essay', 0]]);
  expect(l.notes[0].message).toBe('PHYS 151 · 5 of 17 parts answered');

  // Running again (every 15 minutes) doesn't repeat a stage already sent.
  await remind(page);
  l = await log(page);
  expect(l.notes).toHaveLength(2);

  await page.evaluate(id => (window as unknown as { __fire: (n: string, ...a: unknown[]) => Promise<unknown> }).__fire('click', id), l.notes[0].id);
  await expect.poll(async () => (await log(page)).opened).toEqual(['https://www.webassign.net/web/Student/Assignment-Responses/last?dep=30']);
});

test('reminders: the day-before notice is followed by the three-hours notice', async ({ page }) => {
  const s = snapshots();
  await loadBackground(page, { snapshots: s, reminded: { 'school.instructure.com:12': { stage: 'day', url: 'https://school.instructure.com/a/12' } } });
  // The essay is now 2 hours out.
  await page.evaluate(() => {
    const d = (window as unknown as { __data: { snapshots: Record<string, { assignments: { id: number; dueAt: string }[] }> } }).__data;
    d.snapshots['school.instructure.com'].assignments.find(a => a.id === 12)!.dueAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  });
  await remind(page);
  const titles = (await log(page)).notes.map(n => n.title.split(' is due')[0]);
  expect(titles).toContain('Reflection essay');
});

test('reminders and badge can each be turned off', async ({ page }) => {
  await loadBackground(page, { snapshots: snapshots(), settings: { reminders: false, badge: false } });
  await remind(page);
  const l = await log(page);
  expect(l.notes).toHaveLength(0);
  expect(l.badge.at(-1)).toBe('');
});
