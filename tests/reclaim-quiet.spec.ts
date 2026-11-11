import { test, expect } from '@playwright/test';
import { setup } from './event-day';

// Review 2026-11-10: the within-day reclaim read the whole plan (five
// database reads and a calendar fetch) every minute in every open tab, even
// when nothing had been missed. It now checks the plan already on screen and
// reads again only when a block actually needs to move.
test('with nothing missed, the dashboard does not re-read the plan every minute', async ({ page }) => {
  await setup(page, () => ({ reply: 'ok' }));
  // Let the page finish loading first, then count.
  await page.clock.runFor(61_000);
  await page.waitForTimeout(300);
  let reads = 0;
  page.on('request', r => { if (new URL(r.url()).pathname.endsWith('/rest/v1/todo_sessions')) reads++; });
  for (let i = 0; i < 3; i++) await page.clock.runFor(61_000);
  await page.waitForTimeout(300);
  expect(reads).toBe(0);
});
