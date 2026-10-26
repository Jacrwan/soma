import { test, expect } from '@playwright/test';
import { createChatHandler } from '../api/chat';
import { setup, ask } from './event-day';

/**
 * Streamed replies (api/chat.ts relayStream, src/lib/ai.ts readStream): the
 * reply shows as it's written instead of after a long wait. Cost is the
 * point of care: every streamed reply is still counted against the
 * student's budget, including one that fails part-way.
 */

/** Anthropic's streaming events for a reply of `chunks`, ending with `stop`. */
function anthropicStream(chunks: string[], stop = 'end_turn', opts: { breakAfter?: number } = {}) {
  const enc = new TextEncoder();
  const events = [
    { type: 'message_start', message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 1200, cache_read_input_tokens: 4000, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'secret reasoning' } },
    ...chunks.map(t => ({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: t } })),
    { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 350 } },
    { type: 'message_stop' },
  ];
  const cut = opts.breakAfter ?? events.length;
  return new ReadableStream<Uint8Array>({
    start(c) {
      // Split across reads in awkward places, as a network does.
      const text = events.slice(0, cut).map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
      for (let i = 0; i < text.length; i += 37) c.enqueue(enc.encode(text.slice(i, i + 37)));
      // A dropped connection comes after what already arrived.
      if (opts.breakAfter !== undefined) setTimeout(() => c.error(new Error('connection reset')), 5);
      else c.close();
    },
  });
}

function fakeRes() {
  const out = { status: 200, headers: {} as Record<string, string>, body: '', ended: false, json: undefined as unknown };
  const res = {
    status(s: number) { out.status = s; return res; }, json(j: unknown) { out.json = j; return res; },
    setHeader() {}, end() { out.ended = true; return res; }, writeHead(s: number, h: Record<string, string>) { out.status = s; out.headers = h; },
    write(chunk: string) { out.body += chunk; return true; }, flushHeaders() {},
  };
  return { res, out, events: () => out.body.split('\n\n').filter(Boolean).map(l => JSON.parse(l.replace(/^data: /, ''))) };
}

function handler(stream: ReadableStream<Uint8Array>, recorded: unknown[][], learned: string[] = []) {
  let sent: Record<string, unknown> | undefined;
  const h = createChatHandler({
    authorize: async () => ({ ok: true, userId: 'u' }), apiKey: () => 'k', limited: () => false, budget: async () => null,
    memory: async () => '', notes: async () => '', learn: async (_u: string, m: string) => { learned.push(m); }, noteChat: async () => {}, defer: t => { void t; },
    record: async (...a: unknown[]) => { recorded.push(a); },
    request: async (_u: string, init: { body: string }) => { sent = JSON.parse(init.body); return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }); },
  } as never);
  return { h, sent: () => sent };
}

const body = (extra: Record<string, unknown> = {}) => ({ messages: [{ role: 'user', content: 'plan my evening' }], systemPrompt: 'Soma', model: 'sonnet', effort: 'medium', stream: true, ...extra });

test('a streamed reply is passed on as it arrives, without the thinking, and counted', async () => {
  const recorded: unknown[][] = [], learned: string[] = [];
  const { h, sent } = handler(anthropicStream(['{"reply":"Here', '’s your plan', '","blocks":[]}']), recorded, learned);
  const { res, out, events } = fakeRes();
  await h({ method: 'POST', headers: { authorization: 'Bearer t' }, body: body() }, res);
  expect(sent()).toMatchObject({ stream: true, model: 'claude-sonnet-5-5' });
  expect(out.headers['Content-Type']).toContain('text/event-stream');
  const ev = events();
  expect(ev.filter(e => e.t).map(e => e.t).join('')).toBe('{"reply":"Here’s your plan","blocks":[]}');
  expect(out.body).not.toContain('secret reasoning');
  expect(ev.at(-1)).toEqual({ done: true, stop_reason: 'end_turn' });
  expect(out.ended).toBe(true);
  // Counted like any reply: input and cache from the start, output from the end.
  expect(recorded).toHaveLength(1);
  expect(recorded[0][1]).toBe('reply');
  expect(recorded[0][3]).toMatchObject({ input_tokens: 1200, cache_read_input_tokens: 4000, output_tokens: 350 });
  expect(learned).toEqual(['plan my evening']);
});

test('a reply cut off by max tokens, or a dropped connection, ends in an error and is still counted', async () => {
  for (const [stream, code] of [
    [anthropicStream(['{"reply":"Long'], 'max_tokens'), 'response_incomplete'],
    [anthropicStream(['{"reply":"Hal', 'f'], 'end_turn', { breakAfter: 4 }), 'upstream_unavailable'],
  ] as const) {
    const recorded: unknown[][] = [], learned: string[] = [];
    const { h } = handler(stream, recorded, learned);
    const { res, events } = fakeRes();
    await h({ method: 'POST', headers: { authorization: 'Bearer t' }, body: body() }, res);
    expect(events().at(-1)).toEqual({ error: code });
    expect(recorded).toHaveLength(1);
    // Nothing is learned from a reply that never finished.
    expect(learned).toEqual([]);
  }
});

test('streaming is only for Soma\'s replies, not the cheap first pass', async () => {
  const { h } = handler(anthropicStream(['x']), []);
  const { res, out } = fakeRes();
  await h({ method: 'POST', headers: { authorization: 'Bearer t' }, body: body({ purpose: 'triage', model: undefined }) }, res);
  expect(out.status).toBe(400);
  expect(out.json).toEqual({ error: 'invalid_stream' });
});

test('the dashboard asks for a stream and shows the finished reply', async ({ page }) => {
  let streamed: unknown;
  await setup(page, () => ({ reply: 'unused' }));
  await page.route('**/api/chat', async route => {
    const b = route.request().postDataJSON() as Record<string, unknown>;
    if (b.purpose === 'triage') return route.fulfill({ json: { content: [{ type: 'text', text: '{"route":"ask"}' }] } });
    streamed = b.stream;
    const reply = JSON.stringify({ reply: 'You have Physics HW 5 left today.', blocks: [] });
    const parts = [reply.slice(0, 15), reply.slice(15, 30), reply.slice(30)];
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: `${parts.map(t => `data: ${JSON.stringify({ t })}\n\n`).join('')}data: {"done":true,"stop_reason":"end_turn"}\n\n` });
  });
  await ask(page, 'what is left today?');
  await expect(page.getByRole('log')).toContainText('You have Physics HW 5 left today.');
  expect(streamed).toBe(true);
});

test('a stream that fails part-way shows the error and keeps the message', async ({ page }) => {
  await setup(page, () => ({ reply: 'unused' }));
  await page.route('**/api/chat', async route => {
    const b = route.request().postDataJSON() as Record<string, unknown>;
    if (b.purpose === 'triage') return route.fulfill({ json: { content: [{ type: 'text', text: '{"route":"ask"}' }] } });
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: {"t":"{\\"reply\\":\\"Half"}\n\ndata: {"error":"response_incomplete"}\n\n` });
  });
  await ask(page, 'what is left today?');
  await expect(page.getByRole('log')).toContainText('cut short');
  await expect(page.getByLabel('What do you need to work on?')).toHaveValue('what is left today?');
});
