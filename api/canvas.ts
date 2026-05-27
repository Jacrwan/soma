/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { isRateLimited } from './_rateLimit';

const ALLOWED_ORIGINS = [
  'https://somastudy.app',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173'] : []),
];

// Only allow requests to real Canvas LMS hosts.
function isAllowedCanvasHost(hostname: string): boolean {
  return (
    hostname.endsWith('.instructure.com') ||
    hostname === 'instructure.com'
  );
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

  // ── SSRF protection: only allow real Canvas LMS hosts ────────────────────
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(String(canvasUrl));
  } catch {
    return res.status(400).json({ error: 'Invalid canvasUrl' });
  }
  if (parsedUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'canvasUrl must use https' });
  }
  if (!isAllowedCanvasHost(parsedUrl.hostname)) {
    return res.status(400).json({ error: 'canvasUrl must be an Instructure/Canvas domain' });
  }

  // ── Endpoint path validation ──────────────────────────────────────────────
  const ep = String(endpoint);
  if (!ep.startsWith('/')) {
    return res.status(400).json({ error: 'endpoint must start with /' });
  }

  try {
    const targetUrl = `${parsedUrl.origin}${ep}`;
    const upstream = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await upstream.json();
    const link = upstream.headers.get('Link');
    if (link) res.setHeader('Link', link);
    res.status(upstream.status).json(data);
  } catch {
    res.status(500).json({ error: 'Canvas request failed' });
  }
}
