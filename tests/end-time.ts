import type { Locator } from '@playwright/test';

/** Set an end time: a plain time field, with the length shown beside it. */
export async function setEnd(field: Locator, value: string) {
  await field.fill(value);
}
