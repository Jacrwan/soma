import type { Locator } from '@playwright/test';

/**
 * Set an end time. The end is a list of times counted from the start (like
 * Google Calendar), with "Other time…" for anything off the list; before a
 * start is chosen it's a plain time field.
 */
export async function setEnd(field: Locator, value: string) {
  if (await field.evaluate(e => e.tagName) !== 'SELECT') return field.fill(value);
  if (await field.locator(`option[value="${value}"]`).count()) { await field.selectOption(value); return; }
  await field.selectOption('other');
  const label = await field.getAttribute('aria-label');
  await field.page().getByLabel(`${label}, other time`, { exact: true }).fill(value);
}
