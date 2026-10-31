import { test, expect, type Page } from '@playwright/test';
import { subjectForCourse } from '../src/lib/canvasDeepSync';
import { triaged } from './triage';

/**
 * Synced Canvas work goes under the student's own course, the same on every
 * page and for Soma (subjectForCourse, 2026-10-28). It used to match by exact
 * name only: a course the student had made ("Physics 5A") got a Canvas twin
 * ("PHYSICS 5A - LEC 001 - Fall 2026"), and a course they renamed showed its
 * Canvas name on Deadlines and to Soma, and stayed there when archived.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return key(d); };
type Row = Record<string, unknown>;

async function setup(page: Page, subjects: Row[]) {
  const state = { subjects: subjects.map(s => ({ user_id: account.id, color: '#42a5f5', archived: false, source: 'manual', ...s })), inserted: [] as Row[], prompt: '' };
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, walkthroughCompleted: true, theme: 'light' } } });
    // The sites this account already connected (src/lib/canvasExtension.ts).
    if (table === 'canvas_snapshots' && req.method() === 'GET') return route.fulfill({ json: ['school.instructure.com', 'www.gradescope.com'].map(host => ({ host, payload: null })) });
    if (table === 'subjects') {
      if (req.method() === 'POST') { const b = req.postDataJSON(); for (const s of (Array.isArray(b) ? b : [b]) as Row[]) { state.inserted.push(s); state.subjects.push(s as typeof state.subjects[number]); } }
      if (req.method() === 'PATCH') {
        const id = url.searchParams.get('id')?.slice(3);
        state.subjects = state.subjects.map(s => s.id === id ? { ...s, ...req.postDataJSON() } : s);
      }
      return route.fulfill({ json: req.method() === 'GET' ? state.subjects : null });
    }
    return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/chat', route => { if (triaged(route)) return;
    state.prompt = (b => `${b.systemPrompt}\n${b.context ?? ''}`)(route.request().postDataJSON());
    return route.fulfill({ json: { content: [{ text: JSON.stringify({ reply: 'Noted.', blocks: [] }) }] } });
  });
  return state;
}

const snapshot = (course: { id: number; name: string }) => ({
  v: 1, host: 'school.instructure.com', syncedAt: new Date().toISOString(),
  courses: [{ ...course, courseCode: course.name, currentScore: 91, currentGrade: 'A-', weighted: false }], groups: [],
  assignments: [{ id: 901, courseId: course.id, name: 'Problem Set 4', dueAt: `${offset(1)}T18:00:00Z`, htmlUrl: 'https://school.instructure.com/courses/1/assignments/901', description: '', pointsPossible: 10, workflowState: 'unsubmitted' }],
  announcements: [{ id: 5, courseId: course.id, title: 'Midterm room change', message: 'The midterm is in Hall B.', postedAt: new Date().toISOString() }],
});

/** The extension's hand-off, once Deadlines is listening. */
async function sync(page: Page, course: { id: number; name: string }) {
  await page.goto('/deadlines');
  await expect(page.getByRole('link', { name: 'Add to Chrome' })).toBeVisible();
  await page.evaluate(s => window.postMessage({ source: 'soma-extension', type: 'canvas_snapshot', snapshot: s }, window.location.origin), snapshot(course));
}

async function askSoma(page: Page) {
  await page.goto('/dashboard');
  await page.getByLabel('What do you need to work on?').fill('What should I do first?');
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect(page.getByRole('log')).toContainText('Noted.');
}

/** Deadlines' course filter: one entry per course its rows are under. */
const courses = async (page: Page) => {
  await expect(page.getByText('Problem Set 4')).toBeVisible();
  return page.getByLabel('Filter by course').locator('option').allTextContents();
};

test('the match: Canvas id, then name, then department and number, never last term\'s course', () => {
  const physics = { name: 'Physics 5A' };
  const renamed = { name: 'Biology', canvasCourseId: 456 };
  const lastTerm = { name: 'MATH 1A - Spring 2026', canvasCourseId: 100, archived: true };
  const subjects = [physics, renamed, lastTerm];
  expect(subjectForCourse(subjects, 456, 'BIOL 101 - Fall 2026')).toBe(renamed);
  expect(subjectForCourse(subjects, 789, 'PHYSICS 5A - LEC 001 - Fall 2026')).toBe(physics);
  expect(subjectForCourse(subjects, 789, 'physics 5a')).toBe(physics);
  expect(subjectForCourse(subjects, 200, 'MATH 1A - Fall 2026')).toBeUndefined();
  expect(subjectForCourse(subjects, 790, 'Physics 5B')).toBeUndefined();
  // A course already linked to another Canvas course keeps it: a lab section doesn't join it.
  expect(subjectForCourse([{ name: 'PHYS 151', canvasCourseId: 1 }], 2, 'PHYS-151-LAB1')).toBeUndefined();
  // Gradescope and change records don't know the Canvas id.
  expect(subjectForCourse([{ name: 'PHYS 151', canvasCourseId: 1 }], 0, 'PHYS 151 Fall 2026')).toBeDefined();
});

test('a course the student made is linked to Canvas, not made twice, and its name is used everywhere', async ({ page }) => {
  const state = await setup(page, [{ id: 'phys', name: 'Physics 5A' }]);
  await sync(page, { id: 789, name: 'PHYSICS 5A - LEC 001 - Fall 2026' });
  expect(await courses(page)).toEqual(['All courses', 'Physics 5A']);
  await expect.poll(() => state.subjects.find(s => s.id === 'phys')?.canvas_course_id).toBe(789);
  expect(state.inserted).toHaveLength(0);
  // Still the student's own course: disconnecting Canvas won't archive it.
  expect(state.subjects.find(s => s.id === 'phys')?.source).toBe('manual');

  await askSoma(page);
  expect(state.prompt).toContain('Problem Set 4 — Physics 5A —');
  expect(state.prompt).toContain('· Physics 5A · Midterm room change');
  expect(state.prompt).toContain('- Physics 5A: A-');
  expect(state.prompt).not.toContain('LEC 001');
});

test('a course renamed in Soma keeps its name on Deadlines and for Soma', async ({ page }) => {
  const state = await setup(page, [{ id: 'bio', name: 'Biology', source: 'canvas', canvas_course_id: 456 }]);
  await sync(page, { id: 456, name: 'BIOL 101 - Fall 2026' });
  expect(await courses(page)).toEqual(['All courses', 'Biology']);
  expect(state.inserted).toHaveLength(0);

  await askSoma(page);
  expect(state.prompt).toContain('Problem Set 4 — Biology —');
  expect(state.prompt).toContain('· Biology · Midterm room change');
  expect(state.prompt).not.toContain('BIOL 101 - Fall 2026');
});

test('an archived course, renamed, hides its work and announcements everywhere', async ({ page }) => {
  const state = await setup(page, [{ id: 'bio', name: 'Biology', source: 'canvas', canvas_course_id: 456, archived: true }]);
  await sync(page, { id: 456, name: 'BIOL 101 - Fall 2026' });
  await expect(page.getByText('Problem Set 4')).toHaveCount(0);
  expect(state.inserted).toHaveLength(0);

  await askSoma(page);
  expect(state.prompt).not.toContain('Problem Set 4');
  expect(state.prompt).not.toContain('Midterm room change');
});

test('last term\'s archived course doesn\'t take this term\'s work: a new course is made', async ({ page }) => {
  const state = await setup(page, [{ id: 'old', name: 'MATH 1A - Spring 2026', source: 'canvas', canvas_course_id: 100, archived: true }]);
  await sync(page, { id: 200, name: 'MATH 1A - Fall 2026' });
  expect(await courses(page)).toEqual(['All courses', 'MATH 1A - Fall 2026']);
  await expect.poll(() => state.inserted.length).toBe(1);
  expect(state.inserted[0]).toMatchObject({ name: 'MATH 1A - Fall 2026', canvas_course_id: 200 });
});

test('What changed: an announcement sits under its course, by the student\'s name and colour, though Canvas\'s name was cut short', async ({ page }) => {
  await setup(page, [{ id: 'tr', name: 'Translation', color: '#ab47bc', source: 'canvas', canvas_course_id: 456 }]);
  const long = { id: 456, name: 'Learning about Translation through Film' };
  await sync(page, long);
  // A second sync carries the change the extension worked out, with the course name cut to 30 characters.
  await page.evaluate(s => window.postMessage({ source: 'soma-extension', type: 'canvas_snapshot', snapshot: s }, window.location.origin), {
    ...snapshot(long), syncedAt: new Date(Date.now() + 1000).toISOString(),
    changes: [{ at: new Date().toISOString(), site: 'canvas', type: 'announcement', name: 'Midterm room change', course: 'Learning about Translation thr', url: '' }],
  });
  const region = page.getByRole('region', { name: 'What changed' });
  await expect(region).toContainText('Midterm room change');
  const row = region.getByRole('listitem');
  // The kind of change first, then the course, then the announcement.
  expect((await row.innerText()).split('\n').map(s => s.trim()).filter(Boolean)).toEqual(['Announcement', 'Translation', 'Midterm room change']);
  await expect(row.locator('span[style*="background"]')).toHaveCSS('background-color', 'rgb(171, 71, 188)');
});
