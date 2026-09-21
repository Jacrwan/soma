import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Prices used to be written out by hand in six places, and three of them still
// said $4.99 after the price went to $5.99 — so a student could be quoted one
// price when starting the trial and charged another.
const MONTHLY = '$4.99', ANNUAL = '$49.99', ANNUAL_PER_MONTH = '$4.17';
const ALLOWED = new Set([MONTHLY, ANNUAL, ANNUAL_PER_MONTH]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

test('every price written in the app is the current one', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles('src')) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const price of line.match(/\$\d+\.\d{2}/g) ?? []) {
        if (!ALLOWED.has(price)) offenders.push(`${file}:${i + 1} ${price}`);
      }
    });
  }
  expect(offenders).toEqual([]);
});

test('the pricing page and the terms quote the same price', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByText(MONTHLY).first()).toBeVisible();
  await page.getByRole("button", { name: /Annual/ }).first().click();
  await expect(page.getByText(ANNUAL).first()).toBeVisible();

  await page.goto('/terms');
  await expect(page.getByText(`${MONTHLY} USD per month`)).toBeVisible();
  await expect(page.getByText(`${ANNUAL} USD per year`)).toBeVisible();
});
