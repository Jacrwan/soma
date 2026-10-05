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
    headers: { 'x-api-key': key!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: body.model === 'sonnet' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001', max_tokens: 4096, system, messages: body.messages }),
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
