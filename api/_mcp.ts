/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { authorizeChat } from './chat';
import { isRateLimited } from './_rateLimit';
import { INSTRUCTIONS, TOOLS, ToolError, supabaseDb, type ConnectorDb } from './_connector';

/**
 * The Claude connector: a Model Context Protocol server over plain HTTP, so a
 * student can add Soma to Claude and have it read their plan and add to it
 * (the tools are in _connector.ts).
 *
 * It is served from an existing function (import-schedule.ts) because this
 * Vercel plan deploys twelve functions and Soma already has twelve. vercel.json
 * sends three public paths here:
 *   /api/mcp                                  the connector itself
 *   /.well-known/oauth-protected-resource     tells Claude where to sign in
 *   /.well-known/oauth-authorization-server   the same, for older clients
 *
 * Sign-in is Supabase's OAuth server: Claude sends the student to Soma's own
 * approval page (/oauth/consent) and comes back with a token for that student.
 * Every request is checked the way every other route checks one, and each tool
 * is limited to that student's rows.
 */

type Authorization = { ok: true; userId: string } | { ok: false; status: number; error: string };
type Deps = {
  authorize?: (token: string) => Promise<Authorization>;
  db?: () => ConnectorDb;
  limited?: (userId: string) => boolean;
  authServer?: () => string;
  fetchJson?: (url: string) => Promise<unknown>;
  now?: () => Date;
};

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_RESULT_CHARS = 100_000;

const hits = new Map<string, number[]>();
function limited(userId: string) {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter(t => now - t < 60_000);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > 120;
}

function defaultDb(): ConnectorDb {
  const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('server_not_configured');
  return supabaseDb(createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }));
}
const defaultAuthServer = () => `${(process.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')}/auth/v1`;

type AuthLike = { getUser(token: string): Promise<{ data: { user: { id: string; email?: string } | null }; error: { status?: number; code?: string } | null }> };

/**
 * Who a token belongs to, then whether they may use Soma's AI features: the
 * same two checks as /api/chat. Supabase's user endpoint is the judge, so a
 * connection the student has revoked stops working at once. A refused token
 * logs why (status and error code only, never the token); the first
 * connection failed with nothing in the logs to say where.
 */
export async function authorizeConnector(admin: { auth: unknown; from(table: string): unknown }, token: string, devEmail?: string): Promise<Authorization> {
  let user: { id: string; email?: string } | null = null;
  try {
    const asked = await (admin.auth as AuthLike).getUser(token);
    if (asked.error && (!asked.error.status || asked.error.status >= 500)) return { ok: false, status: 503, error: 'auth_service_unavailable' };
    user = asked.data?.user ?? null;
    if (!user) console.error(JSON.stringify({ event: 'connector_token_refused', status: asked.error?.status ?? null, code: asked.error?.code ?? null }));
  } catch {
    return { ok: false, status: 503, error: 'auth_service_unavailable' };
  }
  if (!user) return { ok: false, status: 401, error: 'auth_required' };
  const verified = user;
  return authorizeChat({ auth: { getUser: async () => ({ data: { user: verified }, error: null }) }, from: (table: string) => admin.from(table) } as never, token, devEmail);
}

async function defaultAuthorize(token: string): Promise<Authorization> {
  const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, status: 503, error: 'server_not_configured' };
  return authorizeConnector(createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }), token, process.env.DEVELOPER_EMAIL);
}

/** Where this request reached Soma, so the addresses handed to Claude match it. */
function origin(req: any): string {
  const raw = req.headers['x-forwarded-host'] ?? req.headers.host;
  const host = typeof raw === 'string' && /^[a-z0-9.-]+(:\d+)?$/i.test(raw) ? raw : 'somastudy.app';
  return `${/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https'}://${host}`;
}

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const toolText = (value: string, isError = false) => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) });

export function createConnectorHandler(deps: Deps = {}) {
  const authServer = deps.authServer ?? defaultAuthServer;

  /** Public: which sign-in server protects the connector (RFC 9728). */
  function resourceMetadata(req: any, res: any) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    return res.status(200).json({ resource: `${origin(req)}/api/mcp`, authorization_servers: [authServer()], bearer_methods_supported: ['header'], resource_name: 'Soma' });
  }

  /** Public: the sign-in server's own description, passed on for clients that look for it here. */
  async function serverMetadata(req: any, res: any) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    try {
      const base = new URL(authServer());
      const fetchJson = deps.fetchJson ?? (async (url: string) => {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error('unavailable');
        return response.json();
      });
      const metadata = await fetchJson(`${base.origin}/.well-known/oauth-authorization-server${base.pathname}`);
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).json(metadata);
    } catch {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ error: 'sign_in_unavailable' });
    }
  }

  async function callTool(params: unknown, auth: Authorization): Promise<unknown> {
    const { name, arguments: given } = (params ?? {}) as { name?: unknown; arguments?: unknown };
    const tool = TOOLS.find(t => t.name === name);
    if (!tool) return null;
    // A lapsed subscription still connects, so the student is told why
    // nothing works instead of seeing a broken connector.
    if (!auth.ok) return toolText(auth.error === 'subscription_required' ? 'This Soma account has no active subscription or trial. The student can start or renew one at somastudy.app, then try again.' : 'Soma is unavailable right now. Try again in a minute.', true);
    if ((deps.limited ?? limited)(auth.userId)) return toolText('Too many requests to Soma in the last minute. Wait a minute, then try again.', true);
    if (given !== undefined && (!given || typeof given !== 'object' || Array.isArray(given))) return toolText('arguments must be an object.', true);
    const args = (given ?? {}) as Record<string, unknown>;
    const unknown = Object.keys(args).filter(k => !(k in tool.inputSchema.properties));
    if (unknown.length) return toolText(`${tool.name} does not take ${unknown.map(k => `"${k}"`).join(', ')}.`, true);
    try {
      const result = JSON.stringify(await tool.run(args, { db: (deps.db ?? defaultDb)(), userId: auth.userId, now: (deps.now ?? (() => new Date()))() }));
      return toolText(result.length > MAX_RESULT_CHARS ? `${result.slice(0, MAX_RESULT_CHARS)}\n[Cut short: ask for a smaller range.]` : result);
    } catch (error) {
      if (error instanceof ToolError) return toolText(error.message, true);
      console.error(JSON.stringify({ event: 'connector_tool_failed', tool: tool.name }));
      return toolText('Soma could not do that just now. Try again in a minute.', true);
    }
  }

  async function answer(message: unknown, auth: Authorization): Promise<unknown> {
    const { jsonrpc, id, method, params } = (message && typeof message === 'object' ? message : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    if (jsonrpc !== '2.0' || typeof method !== 'string' || (id !== undefined && typeof id !== 'string' && typeof id !== 'number')) return rpcError(null, -32600, 'Invalid request');
    if (id === undefined) return undefined;   // a notification: nothing to send back
    const result = (value: unknown) => ({ jsonrpc: '2.0', id, result: value });
    if (method === 'initialize') {
      const asked = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      return result({
        protocolVersion: typeof asked === 'string' && PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1],
        capabilities: { tools: {} },
        serverInfo: { name: 'soma', title: 'Soma', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    }
    if (method === 'ping') return result({});
    if (method === 'tools/list') {
      return result({ tools: TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false } })) });
    }
    if (method === 'tools/call') {
      const called = await callTool(params, auth);
      return called ? result(called) : rpcError(id, -32602, 'Unknown tool');
    }
    return rpcError(id, -32601, 'Method not found');
  }

  async function mcp(req: any, res: any) {
    res.setHeader('Cache-Control', 'no-store');
    const challenge = (problem = '') => `Bearer resource_metadata="${origin(req)}/.well-known/oauth-protected-resource/api/mcp"${problem}`;
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    // The 401 comes before anything else: it is how Claude learns where to sign in.
    if (!token) { res.setHeader('WWW-Authenticate', challenge()); return res.status(401).json({ error: 'auth_required' }); }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
    // Claude's servers share addresses across everyone who uses it, so this
    // only stops a flood; the per-student limit is in callTool.
    if (isRateLimited(req, 'connector', { max: 600 })) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'rate_limit' }); }

    let auth: Authorization;
    try { auth = await (deps.authorize ?? defaultAuthorize)(token); }
    catch { auth = { ok: false, status: 503, error: 'auth_service_unavailable' }; }
    if (!auth.ok && auth.status === 401) { res.setHeader('WWW-Authenticate', challenge(', error="invalid_token"')); return res.status(401).json({ error: 'auth_required' }); }

    let body = req.body as unknown;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    const batch = Array.isArray(body);
    const messages = batch ? body as unknown[] : [body];
    if (!body || typeof body !== 'object' || !messages.length || messages.length > 20) return res.status(400).json(rpcError(null, -32600, 'Invalid request'));

    const replies: unknown[] = [];
    for (const message of messages) { const reply = await answer(message, auth); if (reply !== undefined) replies.push(reply); }
    if (!replies.length) return res.status(202).end();
    return res.status(200).json(batch ? replies : replies[0]);
  }

  return async (req: any, res: any) => {
    const route = req.query?.connector;
    if (route === 'resource') return resourceMetadata(req, res);
    if (route === 'server') return serverMetadata(req, res);
    return mcp(req, res);
  };
}
