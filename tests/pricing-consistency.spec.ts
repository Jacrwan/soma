import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Prices used to be written out by hand in six places, and three of them still
// said $4.99 after the price went to $5.99 — so a student could be quoted one
// price when starting the trial and charged another.
// Prices now live only in src/lib/pricing.ts; that is the one file allowed to
// spell them out.
const MONTHLY = '$10.99', SEMESTER = '$28.99';
const PRICING_FILE = join('src', 'lib', 'pricing.ts');

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
    if (file === PRICING_FILE) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const price of line.match(/\$\d+\.\d{2}/g) ?? []) {
        offenders.push(`${file}:${i + 1} ${price}`);
      }
    });
  }
  expect(offenders).toEqual([]);
});

test('the pricing page and the terms quote the same price', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByText(MONTHLY).first()).toBeVisible();
  await page.getByRole("button", { name: /4 months/ }).first().click();
  await expect(page.getByText(SEMESTER).first()).toBeVisible();

  await page.goto('/terms');
  await expect(page.getByText(`${MONTHLY} USD per month`)).toBeVisible();
  await expect(page.getByText(`${SEMESTER} USD every 4 months`)).toBeVisible();
});
