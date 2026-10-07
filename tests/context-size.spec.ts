import { test, expect } from '@playwright/test';
import { realisticWeek } from './context-size';

// A question cost 4¢, most of it ~12,000 tokens of plan data written as
// repetitive JSON (2026-10-06). Entries are now one short line each, grouped
// by day. On this realistic week the context was ~5,900 tokens before.
test('a realistic week\'s plan data stays compact, with every fact still there', async ({ page }) => {
  const { live, context } = await realisticWeek(page);
  expect(live.length).toBeLessThan(12_500);   // ≈3,700 tokens; it was 19,481 characters
  const plan = Object.values(context.plan as Record<string, string[]>).flat();
  expect(plan.find(l => l.includes('Physics 5A Lecture'))).toMatch(/^b[0-9a-z]{6} 09:30–10:59 Physics 5A Lecture · calendar event$/);
  expect(plan.find(l => l.includes('Midterm 2 Practice'))).toMatch(/^b[0-9a-z]{6} 19:00–20:30 CS 61A Midterm 2 Practice — Instance 1 \(\d+\) · CS 61A/);
  const lastWeek = Object.values(context.lastWeek as Record<string, string[]>).flat();
  expect(lastWeek.some(l => / · Completed · did 80m · log \w{3} \d\d-\d\d 13:00–14:30 80m$/.test(l))).toBe(true);
  const tasks = Object.values(context.tasks as Record<string, string[]>).flat();
  expect(tasks).toHaveLength(20);
  expect(tasks[0]).toMatch(/ · due \w{3} \d{4}-\d\d-\d\d/);
});
