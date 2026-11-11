import { test, expect, type Page } from '@playwright/test';
import { setup, type Row } from './event-day';

const userId = '11111111-1111-4111-8111-111111111111';
const examDate = () => {
  const d = new Date(); d.setDate(d.getDate() + 14);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function checklist(page: Page) {
  const db = await setup(page, () => ({ reply: 'ok' }), rows => {
    rows.exam_plans = [{ id: 'mechanics', user_id: userId, subject_id: 'phys', title: 'Mechanics final', exam_date: examDate() }];
    rows.course_items = [{ id: 'practice', user_id: userId, subject_id: 'phys', exam_id: 'mechanics', label: 'Practice final', title: 'timed attempt, then review errors', minutes: 130, priority: 2, position: 0 }];
  });
  let writes = 0;
  await page.route('**/rest/v1/course_items?**', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    writes++;
    const id = new URL(route.request().url()).searchParams.get('id')?.slice(3);
    const row = db.course_items.find(x => x.id === id);
    if (row) Object.assign(row, route.request().postDataJSON());
    return route.fulfill({ json: null });
  });
  await page.goto('/documents');
  await page.getByRole('button', { name: /Mechanics final/ }).click();
  const slider = page.getByRole('slider').first();
  await expect(slider).toHaveAttribute('aria-valuenow', '2');
  return { db, slider, writes: () => writes };
}

test('dragging a saved priority previews the value and saves once on release', async ({ page }) => {
  const { db, slider, writes } = await checklist(page);
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 6 });
  try {
    await expect(slider).toHaveAttribute('aria-valuenow', '5');
    await expect(slider).not.toHaveAttribute('aria-disabled', 'true');
    expect(writes()).toBe(0);
  } finally { await page.mouse.up(); }
  await expect.poll(() => db.course_items[0].priority).toBe(5);
  expect(writes()).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: /Mechanics final/ }).click();
  await expect(page.getByRole('slider').first()).toHaveAttribute('aria-valuenow', '5');
});

test('canceling a priority drag keeps the saved priority', async ({ page }) => {
  const { slider, writes } = await checklist(page);
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
  await page.mouse.down();
  await slider.dispatchEvent('pointercancel');
  await page.mouse.up();
  await page.waitForTimeout(200);
  await expect(slider).toHaveAttribute('aria-valuenow', '2');
  expect(writes()).toBe(0);
});

test('Rebuild recovers the complete brain dump from the account after a fresh page load', async ({ page }) => {
  const settings: Record<string, unknown> = { onboardingCompleted: true, theme: 'light' };
  const db = await setup(page, () => ({ reply: 'ok' }), rows => {
    rows.exam_plans = [];
    rows.course_items = [];
    rows.todos.push({ id: 'final', user_id: userId, subject_id: 'phys', text: 'Mechanics final', due_date: examDate(), kind: 'exam', status: 'nothing' });
  });
  await page.route('**/rest/v1/settings*', async route => {
    if (route.request().method() === 'POST') {
      Object.assign(settings, route.request().postDataJSON().data);
      return route.fulfill({ json: null });
    }
    return route.fulfill({ json: { data: settings } });
  });
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Plan an exam' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan an exam' });
  await dialog.getByRole('combobox', { name: 'Exam', exact: true }).selectOption('final');
  const dump = 'Practice final and review my mistakes. '.repeat(135) + 'Keep this last requirement too.';
  await dialog.getByRole('textbox', { name: /Braindump/ }).fill(dump);
  await dialog.getByRole('button', { name: 'Use braindump as-is' }).click();
  await dialog.getByRole('button', { name: 'Approve checklist' }).click();
  await expect(dialog).toHaveCount(0);
  const id = String((db.exam_plans as Row[])[0].id);
  expect((settings.examBraindumps as Record<string, string>)[id]).toBe(dump);
  // Start with an empty device settings cache; only the server copy remains.
  await page.evaluate(() => localStorage.removeItem('soma_settings'));
  await page.reload();
  await page.getByRole('button', { name: /Mechanics final/ }).click();
  await page.getByRole('button', { name: 'Rebuild list' }).click();
  await expect(page.getByRole('dialog', { name: /Rebuild the list/ }).getByRole('textbox', { name: /Braindump/ })).toHaveValue(dump);
});

test('a brain dump sync failure stays visible and retry saves the same exam', async ({ page }) => {
  const settings: Record<string, unknown> = { onboardingCompleted: true, theme: 'light' };
  let failSync = true;
  const db = await setup(page, () => ({ reply: 'ok' }), rows => {
    rows.exam_plans = [];
    rows.course_items = [];
    rows.todos.push({ id: 'final', user_id: userId, subject_id: 'phys', text: 'Mechanics final', due_date: examDate(), kind: 'exam', status: 'nothing' });
  });
  await page.route('**/rest/v1/settings*', async route => {
    if (route.request().method() === 'POST') {
      if (failSync) return route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } });
      Object.assign(settings, route.request().postDataJSON().data);
      return route.fulfill({ json: null });
    }
    return route.fulfill({ json: { data: settings } });
  });
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Plan an exam' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan an exam' });
  await dialog.getByRole('combobox', { name: 'Exam', exact: true }).selectOption('final');
  await dialog.getByRole('textbox', { name: /Braindump/ }).fill('Practice final, then review my mistakes.');
  await dialog.getByRole('button', { name: 'Use braindump as-is' }).click();
  await dialog.getByRole('button', { name: 'Approve checklist' }).click();
  await expect(dialog.getByRole('alert')).toContainText('brain dump could not sync');
  expect(db.exam_plans).toHaveLength(1);
  const id = db.exam_plans[0].id;
  failSync = false;
  await dialog.getByRole('button', { name: 'Approve checklist' }).click();
  await expect(dialog).toHaveCount(0);
  expect(db.exam_plans).toHaveLength(1);
  expect(db.exam_plans[0].id).toBe(id);
  expect((settings.examBraindumps as Record<string, string>)[String(id)]).toBe('Practice final, then review my mistakes.');
});
