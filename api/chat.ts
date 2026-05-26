/// <reference types="node" />

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const ALLOWED_ORIGINS = [
  'https://soma-omega-three.vercel.app',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173'] : []),
];

// Rate limit: 20 requests per IP per 60 seconds
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export default async function handler(req: any, res: any) {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? 'unknown';
  const authHeader = req.headers['authorization'] as string | undefined;
  const userId = authHeader?.startsWith('Bearer ') ? '[present]' : '[absent]';
  const logBase = { timestamp: new Date().toISOString(), method: req.method, endpoint: '/api/chat', userId, ip };
  console.log(JSON.stringify(logBase));

  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests' });
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
      console.error(JSON.stringify({ ...logBase, event: 'upstream_error', status: response.status }));
      return res.status(500).json({ error: 'AI request failed' });
    }
    res.json(data);
  } catch (err: any) {
    console.error(JSON.stringify({ ...logBase, event: 'error', message: err?.message }));
    res.status(500).json({ error: 'AI request failed' });
  }
}
