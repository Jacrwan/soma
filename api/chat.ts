/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const TRIAL_MS     = 21 * 86_400_000;
const EXTENSION_MS =  7 * 86_400_000;

function computeStatus(row: {
  status: string;
  trial_start: string | null;
  extension_start: string | null;
}): string {
  const now = Date.now();
  if (row.status === 'trialing' && row.trial_start) {
    return now > new Date(row.trial_start).getTime() + TRIAL_MS
      ? 'trial_expired'
      : 'trialing';
  }
  if (row.status === 'trial_extended' && row.extension_start) {
    return now > new Date(row.extension_start).getTime() + EXTENSION_MS
      ? 'trial_extension_expired'
      : 'trial_extended';
  }
  return row.status;
}

const ALLOWED_ORIGINS = [
  'https://somastudy.app',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173'] : []),
];

const rateLimitMap = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const max = 20;
  const timestamps = (rateLimitMap.get(ip) ?? []).filter(t => now - t < windowMs);
  if (timestamps.length >= max) return true;
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  return false;
}

function applyCors(req: any, res: any): boolean {
  const origin = req.headers['origin'] as string | undefined;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

async function verifyUserAndSubscription(
  token: string,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, status: 500, error: 'Server not configured' };
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return { ok: false, status: 401, error: 'Invalid token' };

  const devEmail = process.env.DEVELOPER_EMAIL;
  if (devEmail && user.email === devEmail) {
    return { ok: true, userId: user.id };
  }

  const { data: sub } = await admin
    .from('subscriptions')
    .select('status, trial_start, extension_start')
    .eq('user_id', user.id)
    .single();

  const status = sub ? computeStatus(sub) : 'free';
  const hasAccess = status === 'trialing' || status === 'trial_extended' || status === 'active';
  if (!hasAccess) {
    return { ok: false, status: 402, error: 'subscription_required' };
  }

  return { ok: true, userId: user.id };
}

export default async function handler(req: any, res: any) {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? 'unknown';
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), method: req.method, endpoint: '/api/chat' }));

  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const authHeader = req.headers['authorization'] as string | undefined;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const authResult = await verifyUserAndSubscription(token);
  if (!authResult.ok) {
    return res.status(authResult.status).json({ error: authResult.error });
  }

  const { messages, systemPrompt } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  }
  if (messages.length > 50) {
    return res.status(400).json({ error: 'Too many messages (max 50)' });
  }
  for (const msg of messages) {
    if (typeof msg?.role !== 'string' || typeof msg?.content !== 'string') {
      return res.status(400).json({ error: 'Each message must have role and content strings' });
    }
    if (msg.content.length > 10_000) {
      return res.status(400).json({ error: 'Message content too long (max 10000 chars)' });
    }
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: [{ type: 'text', text: systemPrompt ?? '', cache_control: { type: 'ephemeral' } }],
        messages,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(JSON.stringify({ endpoint: '/api/chat', event: 'upstream_error', status: response.status }));
      return res.status(500).json({ error: 'AI request failed' });
    }
    res.json(data);
  } catch (err: any) {
    console.error(JSON.stringify({ endpoint: '/api/chat', event: 'error', message: err?.message }));
    res.status(500).json({ error: 'AI request failed' });
  }
}
