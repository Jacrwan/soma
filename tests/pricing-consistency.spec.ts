import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PRICES, price, perMonth, studentSavings, annualSavings } from '../src/lib/pricing';

// Prices used to be typed out on six screens, and three were left behind when
// the price changed — so a student could be quoted one price while starting a
// trial and charged another. Every screen now reads src/lib/pricing.ts, and
// this test fails if a price is written by hand again.
const ALLOWED = new Set([
  price('base', 'monthly'), price('base', 'annual'), perMonth('base'),
  price('student', 'monthly'), price('student', 'annual'), perMonth('student'),
  '$10',   // the arbitration threshold in the Terms, not a price
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

test('no screen writes a price by hand', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles('src')) {
    if (file.endsWith('lib/pricing.ts')) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      // Prices only: two decimal places, or two digits or more. This skips
      // regex replacements like $1 and the free tier's $0.
      for (const found of line.match(/\$\d+\.\d{2}|\$\d{2,}\b/g) ?? []) {
        if (!ALLOWED.has(found)) offenders.push(`${file}:${i + 1} ${found}`);
      }
    });
  }
  expect(offenders).toEqual([]);
});

test('the prices add up', () => {
  expect(PRICES.student.monthly).toBeLessThan(PRICES.base.monthly);
  expect(PRICES.student.annual).toBeLessThan(PRICES.base.annual);
  expect(PRICES.base.annual).toBeLessThan(PRICES.base.monthly * 12);      // a year must beat twelve months
  expect(PRICES.student.annual).toBeLessThan(PRICES.student.monthly * 12);
  expect(annualSavings('base')).toBe(17);
  expect(annualSavings('student')).toBe(32);
  expect(studentSavings('monthly')).toBe(31);
  expect(studentSavings('annual')).toBe(44);
});

test('the pricing page and the terms quote the same prices', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByText(price('base', 'monthly')).first()).toBeVisible();
  await page.getByRole('button', { name: /Annual/ }).first().click();
  await expect(page.getByText(price('base', 'annual')).first()).toBeVisible();

  await page.goto('/terms');
  await expect(page.getByText(`${price('base', 'monthly')} USD per month`)).toBeVisible();
  await expect(page.getByText(`${price('student', 'monthly')} USD per month`)).toBeVisible();

  await page.goto('/billing');
  await expect(page.getByRole('cell', { name: `${price('base', 'annual')} / year` })).toBeVisible();
  await expect(page.getByRole('cell', { name: `${price('student', 'annual')} / year` })).toBeVisible();
});
