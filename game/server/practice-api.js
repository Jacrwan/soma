// Dev-only AI endpoint for the Study Hall: POST /api/practice.
//
// Standalone Epoch has no Soma sign-in and no Vercel functions, so in `vite`
// dev this plugin answers the Study Hall itself. It takes the same body the
// game sends to Soma's /api/chat ({ systemPrompt, messages, purpose:'practice' })
// and returns the same shape ({ content:[{type:'text',text}] }), so practice.js
// only changes the URL.
//
// Safety:
// - apply: 'serve' -> never part of `vite build` or `vite preview`; production
//   has no such route (Soma production keeps its signed-in /api/chat).
// - The key is read once on the server (process.env, then .env files) and is
//   never logged, echoed or sent to the browser.
// - Only loopback clients with a localhost Host (and Origin, when sent) are
//   served, so another device on the LAN or a web page cannot spend the key.
// - Request size, output size and rate are capped.
//
// POST /api/practice/source turns what the student brings into plain text for a
// study kit: a file (PDF, Word, PowerPoint, text, or a photo of notes) or a
// YouTube link (its captions). Scanned PDFs and photos are read by Claude.
import Anthropic from '@anthropic-ai/sdk';
import { readSource, SOURCE_MAX_BYTES } from './sources.js';
import { loadEnv } from 'vite';
import os from 'node:os';
import path from 'node:path';

// Opus 5.5 at low effort: wrong answer keys teach wrong things, so the set
// writer and the grader get the strongest current model; low effort keeps a
// set of 8 to a few seconds (measured in the Study Hall verification run).
const MODEL = 'claude-opus-5-5';
const MAX_SYSTEM = 6000, MAX_CONTENT = 70000, MAX_OUT = 8000, PER_MINUTE = 20;
const SOMA_DIR = path.join(os.homedir(), 'Desktop/soma/.claude/worktrees/gamify');

/** The key, from the environment or the first .env folder that has it. Never logged. */
function readKey(root, mode) {
  if (process.env.EPOCH_ANTHROPIC_API_KEY) return process.env.EPOCH_ANTHROPIC_API_KEY;
  for (const dir of [root, process.env.EPOCH_ENV_DIR, SOMA_DIR].filter(Boolean)) {
    try {
      const key = loadEnv(mode, dir, 'EPOCH_').EPOCH_ANTHROPIC_API_KEY;
      if (key) return key;
    } catch { /* folder missing */ }
  }
  return '';
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const isLocal = (req) => {
  const ip = req.socket?.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return false;
  if (!LOCAL_HOST.test(req.headers.host || '')) return false; // DNS rebinding
  const origin = req.headers.origin;
  if (origin) { try { if (!LOCAL_HOST.test(new URL(origin).host)) return false; } catch { return false; } }
  return true;
};

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too_large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

/** Checks a /api/chat-shaped body. Returns { system, content } or null. */
export function cleanRequest(body) {
  if (!body || typeof body !== 'object' || body.purpose !== 'practice') return null;
  const { systemPrompt, messages } = body;
  if (typeof systemPrompt !== 'string' || !systemPrompt.trim() || systemPrompt.length > MAX_SYSTEM) return null;
  if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.role !== 'user') return null;
  const content = messages[0].content;
  if (typeof content !== 'string' || !content.trim() || content.length > MAX_CONTENT) return null;
  return { system: systemPrompt, content };
}

export function epochPractice() {
  let client = null, ready = false;
  const recent = [];
  let logger = null;

  // One call to Claude. Returns { status, body } shaped like Soma's /api/chat.
  async function ask_(system, content, maxTokens = MAX_OUT) {
    try {
      const msg = await client.beta.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content }],
      });
      if (msg.stop_reason === 'refusal') return { status: 502, body: { error: 'refused' } };
      if (msg.stop_reason === 'max_tokens') return { status: 502, body: { error: 'response_incomplete' } };
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      if (!text.trim()) return { status: 502, body: { error: 'invalid_ai_response' } };
      return { status: 200, body: { content: [{ type: 'text', text }], stop_reason: msg.stop_reason, model: msg.model } };
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return { status: 429, body: { error: 'rate_limit' } };
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return { status: 503, body: { error: 'bad_key' } };
      if (err instanceof Anthropic.APIConnectionTimeoutError) return { status: 504, body: { error: 'request_timeout' } };
      if (err instanceof Anthropic.APIConnectionError) return { status: 503, body: { error: 'offline' } };
      if (err instanceof Anthropic.APIError && err.status === 529) return { status: 529, body: { error: 'overloaded' } };
      if (err instanceof Anthropic.BadRequestError) return { status: 400, body: { error: 'unreadable_file' } };
      // Status only: never the error body, which could echo request details.
      logger?.warn(`Study Hall AI: upstream error ${err?.status ?? err?.name ?? 'unknown'}`);
      return { status: 502, body: { error: 'upstream_unavailable' } };
    }
  }
  // Claude reads a photo or a scanned PDF and writes it out as plain notes.
  const READ_SYSTEM = 'You turn a student\'s study material into plain-text notes. Write out all the text in it faithfully, in reading order, and describe any diagram, chart or table in a sentence or two. Use short headings where the material has them. No commentary, just the notes.';
  async function transcribe(block) {
    const out = await ask_(READ_SYSTEM, [block, { type: 'text', text: 'Write this material out as notes.' }], 12000);
    if (out.status !== 200) return { error: out.body.error };
    return { text: out.body.content[0].text };
  }
  async function source(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    if (!client) return send(res, 503, { error: 'server_not_configured' });
    let body;
    try { body = JSON.parse(await readBody(req, Math.ceil(SOURCE_MAX_BYTES * 1.4) + 4000)); } catch (err) { return send(res, err?.message === 'too_large' ? 413 : 400, { error: err?.message === 'too_large' ? 'file_too_large' : 'invalid_request' }); }
    const now = Date.now();
    while (recent.length && recent[0] < now - 60_000) recent.shift();
    if (recent.length >= PER_MINUTE) return send(res, 429, { error: 'rate_limit' });
    recent.push(now);
    try {
      const out = await readSource(body, transcribe);
      return send(res, out.error ? 400 : 200, out);
    } catch {
      return send(res, 400, { error: 'unreadable_file' });
    }
  }
  return {
    name: 'epoch-practice-api',
    apply: 'serve',
    configResolved(config) {
      const key = readKey(config.root, config.mode);
      ready = Boolean(key);
      if (key) client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 90_000 });
      logger = config.logger;
      config.logger.info(`  Study Hall AI: ${ready ? `on (${MODEL}, /api/practice, localhost only)` : 'off (no EPOCH_ANTHROPIC_API_KEY found)'}`);
    },
    configureServer(server) {
      server.middlewares.use('/api/practice', async (req, res) => {
        if (!isLocal(req)) return send(res, 403, { error: 'local_only' });
        if ((req.url || '').startsWith('/source')) return source(req, res);
        // GET: lets the game know this endpoint exists (and whether it has a key).
        if (req.method === 'GET') return send(res, 200, { service: 'epoch-practice', ready, model: MODEL });
        if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
        if (!(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'invalid_request' });
        if (!client) return send(res, 503, { error: 'server_not_configured' });
        const now = Date.now();
        while (recent.length && recent[0] < now - 60_000) recent.shift();
        if (recent.length >= PER_MINUTE) return send(res, 429, { error: 'rate_limit' });
        let body;
        try { body = JSON.parse(await readBody(req, MAX_SYSTEM + MAX_CONTENT + 4000)); } catch { return send(res, 400, { error: 'invalid_request' }); }
        const ask = cleanRequest(body);
        if (!ask) return send(res, 400, { error: 'invalid_request' });
        recent.push(now);
        const out = await ask_(ask.system, ask.content);
        return send(res, out.status, out.body);
      });
    },
  };
}
