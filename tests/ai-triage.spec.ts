import { test, expect, type Page } from '@playwright/test';
import { setup, ask } from './event-day';
import { createChatHandler } from '../api/chat';

// "Hello" cost 8¢ (2026-10-06): Sonnet read the whole plan, the instructions
// and every uploaded document to say hi. A cheap first pass now answers small
// talk itself and sends the rest to Sonnet at the effort it needs, with the
// documents only when they matter.

const doc = { id: 'd1', user_id: 'u', subject_id: 'phys', file_name: 'MATH53-homework-guide.pdf', storage_path: 'x', file_type: 'application/pdf', size_bytes: 10, doc_type: 'syllabus', created_at: new Date().toISOString(), extraction_status: 'done', extracted_text: 'Homework for Sep 29 & Oct 1 lectures: 14.3, 14.4, 14.5' };

async function withFirstPass(page: Page, answer: string) {
  const calls: Record<string, unknown>[] = [];
  await page.route('**/api/chat', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    calls.push(body);
    if (body.purpose === 'triage') return route.fulfill({ json: { content: [{ type: 'text', text: answer }] } });
    return route.fallback();
  });
  return calls;
}

test('small talk is answered by the first pass, without the plan or documents', async ({ page }) => {
  await setup(page, () => ({ reply: 'FULL SOMA' }), d => { d.documents = [doc]; });
  const calls = await withFirstPass(page, '{"reply":"Hi! What are we working on?"}');
  await ask(page, 'hello');
  await expect(page.getByRole('log')).toContainText('Hi! What are we working on?');
  await expect(page.getByRole('log')).not.toContainText('FULL SOMA');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ purpose: 'triage' });
  expect(String(calls[0].systemPrompt)).toContain('"MATH53-homework-guide.pdf"');
  expect(String(calls[0].systemPrompt)).not.toContain('14.3, 14.4');
  expect(calls[0].context).toBeUndefined();
});

test('a question goes to Sonnet at low effort, without documents it doesn\'t need', async ({ page }) => {
  await setup(page, () => ({ reply: 'Answer.' }), d => { d.documents = [doc]; });
  const calls = await withFirstPass(page, '{"route":"ask"}');
  await ask(page, 'what do i have tomorrow?');
  await expect(page.getByRole('log')).toContainText('Answer.');
  const main = calls.find(c => c.purpose !== 'triage')!;
  expect(main).toMatchObject({ model: 'sonnet', effort: 'low' });
  expect(String(main.systemPrompt)).not.toContain('STUDENT DOCUMENTS');
});

test('planning goes to Sonnet at medium effort, with documents when they matter', async ({ page }) => {
  await setup(page, () => ({ reply: 'Planned.' }), d => { d.documents = [doc]; });
  const calls = await withFirstPass(page, '{"route":"plan","docs":true}');
  await ask(page, "schedule last week's math homework tonight");
  await expect(page.getByRole('log')).toContainText('Planned.');
  const main = calls.find(c => c.purpose !== 'triage')!;
  expect(main).toMatchObject({ model: 'sonnet', effort: 'medium' });
  expect(String(main.systemPrompt)).toContain('14.3, 14.4, 14.5');
});

test('a first pass that can\'t be read sends the message to the full Soma', async ({ page }) => {
  await setup(page, () => ({ reply: 'Full answer.' }), d => { d.documents = [doc]; });
  const calls = await withFirstPass(page, 'sure! I think this is a planning question');
  await ask(page, 'move my physics block');
  await expect(page.getByRole('log')).toContainText('Full answer.');
  const main = calls.find(c => c.purpose !== 'triage')!;
  expect(main).toMatchObject({ effort: 'medium' });
  expect(String(main.systemPrompt)).toContain('STUDENT DOCUMENTS');
});

test('the server runs the first pass without memory, records it apart, and honours low effort', async () => {
  let memoryLookups = 0, learned = 0; const recorded: unknown[] = []; let sent: Record<string, unknown> | undefined;
  const handler = createChatHandler({
    authorize: async () => ({ ok: true, userId: 'u' }), apiKey: () => 'k', limited: () => false, budget: async () => null,
    memory: async () => { memoryLookups++; return 'MEMORY'; }, learn: async () => { learned++; }, defer: t => { void t; },
    record: async (...a: unknown[]) => { recorded.push(a); },
    request: async (_u: string, init: { body: string }) => { sent = JSON.parse(init.body); return Response.json({ model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 900, output_tokens: 20 }, content: [{ type: 'text', text: '{"route":"ask"}' }] }); },
  } as never);
  const res = { status: () => res, json: () => res, setHeader: () => {}, end: () => res };
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { messages: [{ role: 'user', content: 'hi' }], systemPrompt: 'Front desk', purpose: 'triage' } }, res);
  expect([memoryLookups, learned]).toEqual([0, 0]);
  expect((recorded[0] as unknown[])[1]).toBe('triage');
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { messages: [{ role: 'user', content: 'hi' }], systemPrompt: 'Soma', model: 'sonnet', effort: 'low' } }, res);
  expect(sent).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'low' } });
});
