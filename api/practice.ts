/// <reference types="node" />
// The Epoch study game's AI (/game): the Study Hall, study kits and practice
// questions. The production twin of the game's dev middleware
// (game/server/practice-api.js), with the same URLs and shapes:
//
//   GET  /api/practice         -> { service:'epoch-practice', ready, model, signin:true, maxFileBytes }
//   POST /api/practice         -> { systemPrompt, messages:[{role:'user',content}], purpose:'practice' }
//                                 answers { content:[{type:'text',text}], stop_reason, model }
//   POST /api/practice/stream  -> { systemPrompt, material, ask, speed:'fast'|'best' }
//                                 streams the model's text (NDJSON lines) as plain text;
//                                 a failure part-way ends with a line {"__error":"code"}
//   POST /api/practice/source  -> { kind:'file', name, data(base64) } | { kind:'video', url }
//                                 answers { title, text, kind, cut } or { error }
//
// /api/practice/stream and /source reach this file through vercel.json rewrites
// (?op=stream|source).
//
// Access: every signed-in student, subscribed or not (decided for the Epoch beta,
// 2026-11-16). Each call still counts against the student's monthly AI budget
// (ai_usage) and a per-user rate limit, like Soma's own AI. Nothing is
// remembered or learned from what is sent here, and no content is logged.
import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
import { recordUsage, type Usage } from './_usage';
import { budgetStatus, type BudgetStatus } from './_budget';
import { readSource, SOURCE_MAX_BYTES, type TranscribeBlock } from './_epochSources';

export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };
// A long study guide streams from Opus for a couple of minutes.
export const maxDuration = 300;

// Same models as the dev middleware. Opus 5.5 at low effort writes the sets and
// answer keys (wrong keys teach wrong things); Haiku 5.5 maps a kit's topics.
export const MODEL = 'claude-opus-5-5';
export const FAST_MODEL = 'claude-haiku-5-5';
const MAX_SYSTEM = 6000, MAX_CONTENT = 70_000, MAX_MATERIAL = 60_000, MAX_ASK = 6000;
const PER_MINUTE = 20;

type Authorization = { ok: true; userId: string; unlimited?: true } | { ok: false; status: number; error: string };

function admin() {
  const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
}

/** Any signed-in Soma account; no subscription needed. The owner (DEVELOPER_EMAIL) has no budget limit. */
export async function authorizePlayer(token: string): Promise<Authorization> {
  const db = admin();
  if (!db) return { ok: false, status: 503, error: 'server_not_configured' };
  try {
    const { data: { user }, error } = await db.auth.getUser(token);
    if (error && (!error.status || error.status >= 500)) return { ok: false, status: 503, error: 'auth_service_unavailable' };
    if (error || !user) return { ok: false, status: 401, error: 'auth_required' };
    const dev = process.env.DEVELOPER_EMAIL;
    if (dev && user.email?.toLowerCase() === dev.trim().toLowerCase()) return { ok: true, userId: user.id, unlimited: true };
    return { ok: true, userId: user.id };
  } catch { return { ok: false, status: 503, error: 'auth_service_unavailable' }; }
}

async function budget(userId: string): Promise<BudgetStatus | null> {
  const db = admin();
  return db ? budgetStatus(db as never, userId) : null;
}

const hits = new Map<string, number[]>();
/** Per-instance burst guard, like /api/chat's. */
function rateLimited(userId: string) {
  const now = Date.now();
  for (const [key, times] of hits) if (!times.length || now - times[times.length - 1] >= 60_000) hits.delete(key);
  if (hits.size >= 10_000 && !hits.has(userId)) return true;
  const times = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= PER_MINUTE) return true;
  hits.set(userId, [...times, now]);
  return false;
}

const apiKey = () => process.env.EPOCH_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';

function anthropic(body: Record<string, unknown>, signal: AbortSignal, fallback: boolean) {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: {
      'x-api-key': apiKey(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
      // Opus: a declined request is re-run on a fallback model instead of failing (beta).
      ...(fallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
    },
    body: JSON.stringify(fallback ? { ...body, fallbacks: 'default' } : body),
  });
}

function upstreamError(status: number): { status: number; error: string } {
  if (status === 429) return { status: 429, error: 'rate_limit' };
  if (status === 529) return { status: 529, error: 'overloaded' };
  if (status === 401 || status === 403) return { status: 503, error: 'bad_key' };
  if (status === 413) return { status: 400, error: 'context_too_long' };
  return { status: 502, error: 'upstream_unavailable' };
}
const failureCode = (error: unknown) => (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'request_timeout' : 'upstream_unavailable');

type Reply = { status: number; body: Record<string, unknown> };

/** One non-streamed call to Opus. Returns { status, body } shaped like /api/chat's reply. */
async function ask(userId: string, system: string, content: unknown, maxTokens: number): Promise<Reply> {
  let response: Response;
  try {
    response = await anthropic({
      model: MODEL, max_tokens: maxTokens, output_config: { effort: 'low' }, system,
      messages: [{ role: 'user', content }],
    }, AbortSignal.timeout(240_000), true);
  } catch (error) {
    const code = failureCode(error);
    return { status: code === 'request_timeout' ? 504 : 503, body: { error: code } };
  }
  const data = await response.json().catch(() => null) as { error?: { message?: string }; content?: { type: string; text?: string }[]; stop_reason?: string; model?: string; usage?: Usage } | null;
  if (!response.ok) {
    console.error(JSON.stringify({ endpoint: '/api/practice', event: 'upstream_error', status: response.status }));
    if (response.status === 400) return { status: 400, body: { error: /too long|token|context/i.test(data?.error?.message ?? '') ? 'context_too_long' : 'unreadable_file' } };
    const e = upstreamError(response.status);
    return { status: e.status, body: { error: e.error } };
  }
  if (data?.usage) waitUntil(recordUsage(userId, 'reply', data.model ?? MODEL, data.usage).catch(() => {}));
  if (data?.stop_reason === 'refusal') return { status: 502, body: { error: 'refused' } };
  if (data?.stop_reason === 'max_tokens') return { status: 502, body: { error: 'response_incomplete' } };
  const text = data?.content?.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n') ?? '';
  if (!text.trim()) return { status: 502, body: { error: 'invalid_ai_response' } };
  return { status: 200, body: { content: [{ type: 'text', text }], stop_reason: data?.stop_reason, model: data?.model } };
}

/** Checks a /api/chat-shaped practice body. Returns { system, content } or null. */
export function cleanRequest(body: unknown): { system: string; content: string } | null {
  if (!body || typeof body !== 'object') return null;
  const { systemPrompt, messages, purpose } = body as Record<string, unknown>;
  if (purpose !== 'practice') return null;
  if (typeof systemPrompt !== 'string' || !systemPrompt.trim() || systemPrompt.length > MAX_SYSTEM) return null;
  if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.role !== 'user') return null;
  const content = messages[0].content;
  if (typeof content !== 'string' || !content.trim() || content.length > MAX_CONTENT) return null;
  return { system: systemPrompt, content };
}

/** Checks a kit stream body. Returns it cleaned, or null. */
export function cleanStream(body: unknown): { system: string; material: string; ask: string; fast: boolean } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.systemPrompt !== 'string' || !b.systemPrompt.trim() || b.systemPrompt.length > MAX_SYSTEM) return null;
  if (typeof b.material !== 'string' || !b.material.trim() || b.material.length > MAX_MATERIAL) return null;
  if (typeof b.ask !== 'string' || !b.ask.trim() || b.ask.length > MAX_ASK) return null;
  if (b.speed !== undefined && b.speed !== 'fast' && b.speed !== 'best') return null;
  return { system: b.systemPrompt, material: b.material, ask: b.ask, fast: b.speed === 'fast' };
}

/**
 * Streams one kit request: the material is the cached prefix, so a kit's later
 * requests (cards, questions, guide) start faster and cost less.
 */
async function stream(res: any, userId: string, input: NonNullable<ReturnType<typeof cleanStream>>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 280_000);
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  let response: Response;
  try {
    response = await anthropic({
      model: input.fast ? FAST_MODEL : MODEL,
      max_tokens: input.fast ? 8000 : 16000,
      output_config: { effort: 'low' },
      ...(input.fast ? { thinking: { type: 'disabled' } } : {}),
      system: input.system,
      stream: true,
      messages: [{ role: 'user', content: [
        { type: 'text', text: `<material>\n${input.material}\n</material>`, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: input.ask },
      ] }],
    }, controller.signal, !input.fast);
  } catch (error) {
    clearTimeout(timer);
    const code = failureCode(error);
    return res.status(code === 'request_timeout' ? 504 : 503).json({ error: code });
  }
  if (!response.ok || !response.body) {
    clearTimeout(timer);
    console.error(JSON.stringify({ endpoint: '/api/practice/stream', event: 'upstream_error', status: response.status }));
    const e = upstreamError(response.status);
    return res.status(e.status).json({ error: response.status === 400 ? 'context_too_long' : e.error });
  }
  let started = false;
  const begin = () => {
    if (started) return;
    started = true;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
  };
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', model = input.fast ? FAST_MODEL : MODEL, stop: string | undefined, usage: Usage = {}, failed = '', wrote = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
        const line = event.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let e: any; try { e = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (e.type === 'message_start') { model = e.message?.model ?? model; usage = { ...usage, ...(e.message?.usage ?? {}) }; }
        else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && typeof e.delta.text === 'string') {
          begin(); res.write(e.delta.text); wrote = wrote || !!e.delta.text.trim();
        } else if (e.type === 'message_delta') { stop = e.delta?.stop_reason ?? stop; if (e.usage) usage = { ...usage, ...e.usage }; }
        else if (e.type === 'error') failed = e.error?.type === 'overloaded_error' ? 'overloaded' : 'upstream_unavailable';
      }
    }
  } catch (error) {
    failed = controller.signal.aborted ? (res.destroyed ? 'cancelled' : 'request_timeout') : failureCode(error);
  }
  clearTimeout(timer);
  if (usage.input_tokens !== undefined || usage.output_tokens !== undefined) waitUntil(recordUsage(userId, 'reply', model, usage).catch(() => {}));
  if (!failed && stop === 'refusal') failed = 'refused';
  if (!failed && stop === 'max_tokens') failed = 'response_incomplete';
  if (!failed && !wrote) failed = 'invalid_ai_response';
  if (res.destroyed) return;
  if (!started) return res.status(failed === 'overloaded' ? 529 : 502).json({ error: failed || 'invalid_ai_response' });
  if (failed && failed !== 'cancelled') res.write(`\n{"__error":"${failed}"}\n`);
  res.end();
}

// Claude reads a photo or a scanned PDF and writes it out as plain notes.
const READ_SYSTEM = 'You turn a student\'s study material into plain-text notes. Write out all the text in it faithfully, in reading order, and describe any diagram, chart or table in a sentence or two. Use short headings where the material has them. No commentary, just the notes.';

function operation(req: any): '' | 'stream' | 'source' {
  const q = req.query?.op;
  const op = typeof q === 'string' ? q : (/^\/api\/practice\/(stream|source)\b/.exec(String(req.url || ''))?.[1] ?? '');
  return op === 'stream' || op === 'source' ? op : '';
}

export default async function handler(req: any, res: any) {
  const origin = req.headers.origin;
  if (origin === 'https://somastudy.app' || (process.env.NODE_ENV !== 'production' && origin === 'http://localhost:5173')) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const op = operation(req);
  // GET: lets the game know this endpoint exists, and that it needs a Soma sign-in.
  if (req.method === 'GET' && !op) {
    return res.status(200).json({ service: 'epoch-practice', ready: Boolean(apiKey() && process.env.VITE_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY), model: MODEL, signin: true, maxFileBytes: SOURCE_MAX_BYTES });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const header = req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'auth_required' });

  // Validate before any network call.
  const body = req.body;
  const kit = op === 'stream' ? cleanStream(body) : null;
  const plain = op === '' ? cleanRequest(body) : null;
  if ((op === 'stream' && !kit) || (op === '' && !plain)) return res.status(400).json({ error: 'invalid_request' });
  if (op === 'source' && (!body || typeof body !== 'object')) return res.status(400).json({ error: 'invalid_request' });

  try {
    if (!apiKey()) return res.status(503).json({ error: 'server_not_configured' });
    const auth = await authorizePlayer(token);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (rateLimited(auth.userId)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'rate_limit' }); }
    if (!auth.unlimited) {
      const b = await budget(auth.userId);
      if (b && b.used >= b.available) return res.status(402).json({ error: 'ai_budget_used', resetsAt: b.resetsAt, trial: b.trial });
    }
    if (kit) return await stream(res, auth.userId, kit);
    if (plain) {
      const out = await ask(auth.userId, plain.system, plain.content, 8000);
      return res.status(out.status).json(out.body);
    }
    const transcribe = async (block: TranscribeBlock) => {
      const out = await ask(auth.userId, READ_SYSTEM, [block, { type: 'text', text: 'Write this material out as notes.' }], 12000);
      if (out.status !== 200) return { error: String(out.body.error || 'unreadable_file') };
      return { text: String((out.body.content as { text: string }[])[0].text) };
    };
    try {
      const out = await readSource(body, transcribe);
      return res.status('error' in out ? (out.error === 'file_too_large' ? 413 : 400) : 200).json(out);
    } catch {
      return res.status(400).json({ error: 'unreadable_file' });
    }
  } catch (error) {
    if (res.headersSent) { try { res.end(); } catch { /* closed */ } return; }
    const code = failureCode(error);
    return res.status(code === 'request_timeout' ? 504 : 503).json({ error: code === 'request_timeout' ? code : 'service_unavailable' });
  }
}
