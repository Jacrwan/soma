import { test, expect } from '@playwright/test';
import { setup, ask, acceptedTimes, at } from './event-day';

// Soma against the real model, on the Monday reported 2026-10-05. The mocked
// tests prove the app resolves whatever the model sends; these prove the model
// sends something it can resolve, for different ways of saying the same thing.
// They call Anthropic and cost money, so they run only with a key:
//   ANTHROPIC_API_KEY=... npx playwright test tests/ai-real-model.spec.ts
const key = process.env.ANTHROPIC_API_KEY;
test.skip(!key, 'needs ANTHROPIC_API_KEY');
test.describe.configure({ timeout: 120_000 });

// The same request api/chat.ts makes (without saved memory).
async function realModel(body: Record<string, unknown>) {
  const system = [
    ...(body.systemPrompt ? [{ type: 'text', text: body.systemPrompt }] : []),
    ...(body.context ? [{ type: 'text', text: body.context }] : []),
  ];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 16000, output_config: { effort: 'medium' }, fallbacks: 'default', system, messages: body.messages }),
  });
  const data = await res.json() as { content?: { type: string; text?: string }[] };
  const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') ?? '';
  console.log(`\n--- model said:\n${text}`);
  return text;
}

// [what the student typed, the session it should become]
const cases: [string, [string, string]][] = [
  ["im gonna work on the physics homework thats due tomorrow from now until the physics 5a discussion; im skipping cs61a lecture and the math discussion", ['12:28', '16:00']],
  ['physics hw from now till my physics discussion, skipping lecture and math', ['12:28', '16:00']],
  ['just do one physics hw session from right now to 4', ['12:28', '16:00']],
  ["I'm not going to cs 61a or math 53 today, I'll do KK-5 until discussion starts", ['12:28', '16:00']],
  ['physics homework in the gap between the cs lecture and the math discussion', ['12:59', '14:00']],
  ['after the math discussion do the physics homework until my physics discussion', ['14:59', '16:00']],
];
for (const [said, [from, to]] of cases) {
  test(`real model: "${said}"`, async ({ page }) => {
    const db = await setup(page, (_ctx, body) => realModel(body));
    await ask(page, said);
    await expect(page.getByRole('button', { name: /^Accept/ }).first()).toBeVisible({ timeout: 60_000 });
    expect(await acceptedTimes(page, db)).toEqual([[at(from), at(to)]]);
  });
}

// Reported 2026-11-03: asked for last week's homework, Soma took the one open
// homework task, from weeks ago, instead of what the guide lists for last week.
test('real model: last week\'s homework comes from the guide, not an old open task', async ({ page }) => {
  const label = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const back = (days: number) => { const d = new Date(monday); d.setDate(d.getDate() - days); return d; };
  const guide = [[21, '14.3, 14.4, 14.5, 14.6'], [14, '14.7, 14.8'], [7, '15.1, 15.2, 15.3, 15.4'], [0, '15.5, 15.6']]
    .map(([days, work]) => `Homework for ${label(back(days as number))} & ${label(back((days as number) - 2))} lectures: ${work}`).join('\n');
  const db = await setup(page, (_ctx, body) => realModel(body), d => {
    d.subjects.push({ id: 'math', user_id: 'u', name: 'Math 53', color: '#42a5f5', archived: false });
    d.todos.push({ id: 't-old', user_id: 'u', text: 'Math 53 homework: 14.3-14.6', subject_id: 'math', status: 'nothing', date: back(14).toLocaleDateString('en-CA') });
    d.documents = [{ id: 'd1', user_id: 'u', subject_id: 'math', file_name: 'MATH53-homework-guide.pdf', storage_path: 'x', file_type: 'application/pdf', size_bytes: 10, doc_type: 'syllabus', created_at: new Date().toISOString(), extraction_status: 'done', extracted_text: guide }];
  });
  await ask(page, 'schedule me to do the math homework from last week');
  await expect(page.getByRole('button', { name: /^Accept/ }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('log')).toContainText('15.1');
  await page.getByRole('button', { name: /^Accept/ }).first().click();
  await expect.poll(() => db.todos.some(t => String(t.text).includes('15.1'))).toBe(true);
  expect(db.todos.find(t => t.id === 't-old')?.text).toBe('Math 53 homework: 14.3-14.6');
});
