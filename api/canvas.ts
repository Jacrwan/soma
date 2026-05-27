/// <reference types="node" />
import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { isRateLimited } from './_rateLimit';

const ALLOWED_ORIGINS = [
  'https://somastudy.app',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173'] : []),
];

function isPrivateIp(address: string): boolean {
  const ipType = net.isIP(address);
  if (ipType === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 ||
      a === 192 && b === 168 ||
      a === 100 && b >= 64 && b <= 127 ||
      a >= 224
    );
  }
  if (ipType === 6) {
    const lower = address.toLowerCase();
    return (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb') ||
      lower.startsWith('::ffff:10.') ||
      lower.startsWith('::ffff:127.') ||
      lower.startsWith('::ffff:192.168.')
    );
  }
  return true;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  );
}

async function isPublicCanvasHost(hostname: string): Promise<boolean> {
  if (isBlockedHostname(hostname)) return false;
  if (net.isIP(hostname)) return !isPrivateIp(hostname);

  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    return records.length > 0 && records.every((record: { address: string }) => !isPrivateIp(record.address));
  } catch {
    return false;
  }
}

function applyCors(req: any, res: any): boolean {
  const origin = req.headers['origin'] as string | undefined;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (isRateLimited(req, 'canvas', { max: 60, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  // ── Supabase auth gate ────────────────────────────────────────────────────
  const authHeader = req.headers['authorization'] as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }
  const supabaseToken = authHeader.slice(7);

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authErr } = await admin.auth.getUser(supabaseToken);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // ── Parse and validate body ───────────────────────────────────────────────
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body ?? {};

  const { canvasUrl, token, endpoint } = body;

  if (!token || typeof token !== 'string' || token.trim() === '') {
    return res.status(400).json({ error: 'Missing or invalid token' });
  }
  if (!canvasUrl || !endpoint) {
    return res.status(400).json({ error: 'Missing canvasUrl or endpoint' });
  }

  // ── SSRF protection: only allow public HTTPS Canvas hosts ────────────────
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(String(canvasUrl));
  } catch {
    return res.status(400).json({ error: 'Invalid canvasUrl' });
  }
  if (parsedUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'canvasUrl must use https' });
  }
  if (!await isPublicCanvasHost(parsedUrl.hostname)) {
    return res.status(400).json({ error: 'canvasUrl must be a public HTTPS Canvas domain' });
  }

  // ── Endpoint path validation ──────────────────────────────────────────────
  const ep = String(endpoint);
  if (!ep.startsWith('/api/v1/')) {
    return res.status(400).json({ error: 'endpoint must be a Canvas API v1 path' });
  }

  try {
    const targetUrl = `${parsedUrl.origin}${ep}`;
    console.log('[canvas proxy] →', targetUrl);

    const upstream = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log('[canvas proxy] ←', upstream.status, upstream.statusText, targetUrl);

    const responseText = await upstream.text();
    if (!upstream.ok) {
      console.error('[canvas proxy] error body:', responseText.slice(0, 500));
    }

    let data: unknown;
    try { data = JSON.parse(responseText); } catch { data = { raw: responseText }; }

    const link = upstream.headers.get('Link');
    if (link) res.setHeader('Link', link);
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error('[canvas proxy] fetch threw:', err);
    res.status(500).json({ error: 'Canvas request failed' });
  }
}
