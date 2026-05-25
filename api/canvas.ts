/// <reference types="node" />

export default async function handler(req: any, res: any) {
  try {
    // Parse body — Vercel normally auto-parses JSON, but handle string fallback
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body ?? {};

    let token: string;
    let targetUrl: string;

    if (req.method === 'POST' && body.canvasUrl) {
      const { canvasUrl, token: bodyToken, endpoint } = body;
      if (!bodyToken) return res.status(401).json({ error: 'Missing token' });
      if (!canvasUrl || !endpoint) return res.status(400).json({ error: 'Missing canvasUrl or endpoint' });
      token = String(bodyToken);
      targetUrl = `${String(canvasUrl).replace(/\/$/, '')}${endpoint}`;
    } else {
      // Legacy: x-canvas-token header + url param
      token = req.headers['x-canvas-token'];
      targetUrl = req.query?.url ?? body.url;
      if (!token) return res.status(401).json({ error: 'Missing x-canvas-token header' });
      if (!targetUrl) return res.status(400).json({ error: 'Missing url parameter' });
    }

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
