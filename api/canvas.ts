/// <reference types="node" />

export default async function handler(req: any, res: any) {
  console.log('canvas handler called', req.method);
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body ?? {};

    const { canvasUrl, token, endpoint } = body;

    if (!token) return res.status(401).json({ error: 'Missing token' });
    if (!canvasUrl || !endpoint) return res.status(400).json({ error: 'Missing canvasUrl or endpoint' });

    const targetUrl = `${String(canvasUrl).replace(/\/$/, '')}${endpoint}`;

    const upstream = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await upstream.json();
    const link = upstream.headers.get('Link');
    if (link) res.setHeader('Link', link);
    res.status(upstream.status).json(data);
  } catch (err: any) {
    console.error('[api/canvas] error:', err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
}
