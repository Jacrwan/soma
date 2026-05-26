/// <reference types="node" />

const ALLOWED_ORIGINS = [
  'https://soma-omega-three.vercel.app',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173'] : []),
];

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
  const logBase = { timestamp: new Date().toISOString(), method: req.method, endpoint: '/api/canvas', ip };
  console.log(JSON.stringify(logBase));

  if (applyCors(req, res)) return;

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body ?? {};

    const { canvasUrl, token, endpoint } = body;

    if (!token || typeof token !== 'string' || token.trim() === '') {
      return res.status(401).json({ error: 'Missing or invalid token' });
    }

    if (!canvasUrl || !endpoint) {
      return res.status(400).json({ error: 'Missing canvasUrl or endpoint' });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(String(canvasUrl));
    } catch {
      return res.status(400).json({ error: 'Invalid canvasUrl' });
    }
    if (parsedUrl.protocol !== 'https:') {
      return res.status(400).json({ error: 'canvasUrl must use https' });
    }

    const targetUrl = `${parsedUrl.href.replace(/\/$/, '')}${endpoint}`;

    const upstream = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await upstream.json();
    const link = upstream.headers.get('Link');
    if (link) res.setHeader('Link', link);
    res.status(upstream.status).json(data);
  } catch (err: any) {
    console.error(JSON.stringify({ ...logBase, event: 'error', message: err?.message }));
    res.status(500).json({ error: 'Canvas request failed' });
  }
}
