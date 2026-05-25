export default async function handler(req: any, res: any) {
  let token: string;
  let targetUrl: string;

  if (req.method === 'POST' && req.body?.canvasUrl) {
    const { canvasUrl, token: bodyToken, endpoint } = req.body;
    if (!bodyToken) return res.status(401).json({ error: 'Missing token' });
    if (!canvasUrl || !endpoint) return res.status(400).json({ error: 'Missing canvasUrl or endpoint' });
    token = bodyToken;
    targetUrl = `${canvasUrl.replace(/\/$/, '')}${endpoint}`;
  } else {
    token = req.headers['x-canvas-token'] as string;
    targetUrl = (req.query?.url ?? req.body?.url) as string;
    if (!token) return res.status(401).json({ error: 'Missing x-canvas-token header' });
    if (!targetUrl) return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await upstream.json();
    const link = upstream.headers.get('Link');
    if (link) res.setHeader('Link', link);
    res.status(upstream.status).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
