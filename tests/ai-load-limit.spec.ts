import { test, expect } from '@playwright/test';
import { setup, ask } from './event-day';

// 2026-11-10: on the preview, "im gonna do the math homework after ruf large
// group today" got its first pass and then nothing. One of the loads before
// the full reply never finished, so the request to Sonnet was never sent and
// no error showed. Each load now has a time limit (LOAD_LIMIT_MS, 20s).

const stall = (path: string, only?: (url: URL) => boolean) => (url: URL) =>
  url.hostname === 'soma-regression.supabase.co' && url.pathname.endsWith(path) && (!only || only(url));
/** Holds the request open forever; resolves once one has arrived. */
function hold() {
  let arrived!: () => void;
  const seen = new Promise<void>(r => { arrived = r; });
  return { seen, handler: () => { arrived(); } };
}

test('a plan load that never finishes ends in a retry message, and nothing is sent', async ({ page }) => {
  let replies = 0;
  await setup(page, () => { replies++; return { reply: 'FULL SOMA' }; });
  const held = hold();
  await page.route(stall('/todo_sessions'), held.handler);
  await ask(page, 'im gonna do the math homework after ruf large group today');
  await held.seen;
  await page.clock.fastForward(21_000);
  await expect(page.getByRole('log')).toContainText("Soma couldn't load your plan");
  await expect(page.getByRole('log')).toContainText('Nothing was sent; please retry.');
  expect(replies).toBe(0);
});

test('documents that never load only cost the excerpts: the reply still goes', async ({ page }) => {
  let replied = false;
  await setup(page, () => { replied = true; return { reply: 'Planned without documents.' }; });
  const held = hold();
  await page.route(stall('/documents'), held.handler);
  await ask(page, 'im gonna do the math homework after ruf large group today');
  await held.seen;
  // Documents are read before the first pass and again with the plan.
  await page.clock.fastForward(21_000);
  await expect.poll(async () => { await page.clock.fastForward(21_000); return replied; }, { timeout: 10_000 }).toBe(true);
  await expect(page.getByRole('log')).toContainText('Planned without documents.');
});
