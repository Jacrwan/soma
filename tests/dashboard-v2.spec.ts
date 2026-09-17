import { test, expect } from '@playwright/test';

test('mock dashboard completes work and previews proposals without backend requests', async ({ page }) => {
  const backend: string[] = [];
  page.on('request', request => { if (/supabase|\/api\//.test(request.url())) backend.push(request.url()); });
  await page.goto('/dashboard-v2');
  await expect(page.getByText('180 min planned across your subjects')).toBeVisible();
  await page.screenshot({path:'test-results/dashboard-v2-desktop.png',fullPage:true});
  await page.getByRole('button', { name: 'Complete: Problem set 04', exact: true }).click();
  await expect(page.getByTestId('progress-Mathematics')).toHaveAttribute('style',/--fill: 100%/);
  await page.getByLabel('What do you need to work on?').fill('Review chemistry');
  await page.getByRole('button', { name: 'Send to Soma' }).click();
  await expect(page.getByRole('heading', { name: 'Review chemistry' })).toBeVisible();
  await expect(page.getByRole('log')).toContainText('I’ve made an example');
  await expect(page.getByText('1h 30m open', {exact:true})).toBeVisible();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.getByText('210 min planned across your subjects')).toBeVisible();
  await page.getByLabel('Track time').uncheck();
  await expect(page.getByRole('button', { name: 'Start focus: Review chemistry' })).toHaveCount(0);
  expect(backend).toEqual([]);
});

test('focus pause and completion preserve planned times', async ({ page }) => {
  await page.goto('/dashboard-v2');
  await page.getByRole('button', {name:'Start focus: Problem set 04',exact:true}).click();
  await page.getByRole('button', {name:'Pause',exact:true}).click();
  await expect(page.getByText('13:00–14:00')).toBeVisible();
  await page.getByRole('button', {name:'Stop',exact:true}).click();
  await page.getByRole('button', {name:'Finished',exact:true}).click();
  await expect(page.getByTestId('progress-Mathematics')).toHaveAttribute('style',/--fill: 100%/);
  await expect(page.getByText('13:00–14:00')).toBeVisible();
});

test('mobile dashboard fits viewport and chat has reply space', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/dashboard-v2');
  await expect(page.getByRole('log', {name:'Conversation'})).toBeVisible();
  await expect(page.getByRole('button', {name:/Switch to.*theme/})).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/dashboard-v2-mobile.png',fullPage:true});
});

test('desktop dashboard fits one screen at common laptop sizes', async ({ page }) => {
  for (const size of [{width:1440,height:900},{width:1366,height:768},{width:1280,height:720}]) {
    await page.setViewportSize(size);
    await page.goto('/dashboard-v2');
    await expect(page.getByRole('heading', {name:'Ask Soma'})).toBeVisible();
    await page.screenshot({path:'test-results/dashboard-v2-compact.png',fullPage:true});
    expect(await page.evaluate(() => ({height:document.documentElement.scrollHeight, viewport:innerHeight}))).toEqual({height:size.height,viewport:size.height});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({path:'test-results/dashboard-v2-compact.png',fullPage:true});
});
