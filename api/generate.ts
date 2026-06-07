/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { GoogleTokenExpiredError, refreshGoogleToken } from './_googleAuth';

export const config = { api: { bodyParser: { sizeLimit: '200kb' } } };

const TRIAL_MS     = 21 * 86_400_000;
const EXTENSION_MS =  7 * 86_400_000;

function computeStatus(row: {
  status: string;
  trial_start: string | null;
  extension_start: string | null;
}): string {
  const now = Date.now();
  if (row.status === 'trialing' && row.trial_start) {
    return now > new Date(row.trial_start).getTime() + TRIAL_MS ? 'trial_expired' : 'trialing';
  }
  if (row.status === 'trial_extended' && row.extension_start) {
    return now > new Date(row.extension_start).getTime() + EXTENSION_MS ? 'trial_extension_expired' : 'trial_extended';
  }
  return row.status;
}

const ALLOWED_ORIGINS = [
  'https://somastudy.app',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173'] : []),
];

function applyCors(req: any, res: any): boolean {
  const origin = req.headers['origin'] as string | undefined;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

async function verifyUserAndSubscription(
  token: string,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) return { ok: false, status: 500, error: 'Server not configured' };

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return { ok: false, status: 401, error: 'Invalid token' };

  const devEmail = process.env.DEVELOPER_EMAIL;
  if (devEmail && user.email === devEmail) return { ok: true, userId: user.id };

  const { data: sub } = await admin
    .from('subscriptions')
    .select('status, trial_start, extension_start')
    .eq('user_id', user.id)
    .single();
  const status = sub ? computeStatus(sub) : 'free';
  const hasAccess = status === 'trialing' || status === 'trial_extended' || status === 'active';
  if (!hasAccess) return { ok: false, status: 402, error: 'subscription_required' };
  return { ok: true, userId: user.id };
}

interface SlideInput { title?: string; bullets?: string[] }

async function handleDocs(req: any, res: any, googleToken: string) {
  const { title, content } = req.body ?? {};

  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title required' });
  }
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content required' });
  }
  if (content.length > 50_000) {
    return res.status(400).json({ error: 'content too long' });
  }

  const createRes = await fetch('https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title.trim().slice(0, 100) }),
  });

  if (!createRes.ok) {
    if (createRes.status === 401) throw new GoogleTokenExpiredError();
    const googleError = await createRes.text().catch(() => '(could not read body)');
    const tokenPreview = googleToken ? googleToken.slice(0, 20) + '...' : '(empty)';
    console.error(JSON.stringify({ endpoint: '/api/generate', type: 'docs', event: 'create_failed', status: createRes.status, tokenPreview, googleError }));
    return res.status(502).json({ error: 'Failed to create document', googleStatus: createRes.status, tokenPreview, googleError });
  }

  const doc = await createRes.json();
  const documentId: string = (doc as any).documentId;

  const updateRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ insertText: { location: { index: 1 }, text: content } }],
      }),
    },
  );

  if (!updateRes.ok) {
    const googleError = await updateRes.text().catch(() => '(could not read body)');
    console.error(JSON.stringify({ endpoint: '/api/generate', type: 'docs', event: 'update_failed', status: updateRes.status, googleError }));
    return res.status(502).json({ error: 'Failed to write to document', googleStatus: updateRes.status, googleError });
  }

  return res.json({
    docId: documentId,
    docUrl: `https://docs.google.com/document/d/${documentId}/edit`,
  });
}

async function handleDocsUpdate(req: any, res: any, googleToken: string) {
  const { docId, content } = req.body ?? {};

  if (typeof docId !== 'string' || !docId.trim()) {
    return res.status(400).json({ error: 'docId required' });
  }
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content required' });
  }
  if (content.length > 50_000) {
    return res.status(400).json({ error: 'content too long' });
  }

  const gHeaders = { 'Authorization': `Bearer ${googleToken}`, 'Content-Type': 'application/json' };

  // Get the current document to find its length
  const getRes = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
    headers: { 'Authorization': `Bearer ${googleToken}` },
  });
  if (!getRes.ok) {
    if (getRes.status === 401) return res.status(401).json({ error: 'google_token_expired' });
    if (getRes.status === 404) return res.status(404).json({ error: 'Document not found' });
    return res.status(502).json({ error: 'Failed to read document', googleStatus: getRes.status });
  }
  const doc = await getRes.json() as { body?: { content?: { endIndex?: number }[] } };
  const segments = doc.body?.content ?? [];
  const endIndex = segments.length > 0 ? (segments[segments.length - 1].endIndex ?? 1) : 1;

  // Build requests: delete existing content (if any), then insert new content
  const requests: any[] = [];
  if (endIndex > 2) {
    requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
  }
  requests.push({ insertText: { location: { index: 1 }, text: content } });

  const updateRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
    { method: 'POST', headers: gHeaders, body: JSON.stringify({ requests }) },
  );

  if (!updateRes.ok) {
    const googleError = await updateRes.text().catch(() => '(could not read body)');
    console.error(JSON.stringify({ endpoint: '/api/generate', type: 'docs-update', event: 'update_failed', status: updateRes.status, googleError }));
    return res.status(502).json({ error: 'Failed to update document', googleStatus: updateRes.status });
  }

  return res.json({
    docId,
    docUrl: `https://docs.google.com/document/d/${docId}/edit`,
  });
}

async function handleSlides(req: any, res: any, googleToken: string) {
  const { title, slides } = req.body ?? {};

  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title required' });
  }
  if (!Array.isArray(slides) || slides.length === 0) {
    return res.status(400).json({ error: 'slides required' });
  }

  const deckTitle = title.trim().slice(0, 120);
  const contentSlides: SlideInput[] = slides.slice(0, 30);

  const gHeaders = {
    Authorization: `Bearer ${googleToken}`,
    'Content-Type': 'application/json',
  };

  const createRes = await fetch('https://slides.googleapis.com/v1/presentations', {
    method: 'POST',
    headers: gHeaders,
    body: JSON.stringify({ title: deckTitle }),
  });
  if (createRes.status === 401) throw new GoogleTokenExpiredError();
  if (!createRes.ok) {
    const googleError = await createRes.text().catch(() => '(could not read body)');
    console.error(JSON.stringify({ endpoint: '/api/generate', type: 'slides', event: 'create_failed', status: createRes.status, googleError }));
    return res.status(502).json({ error: 'create_failed', googleStatus: createRes.status, googleError });
  }

  const pres = await createRes.json() as { presentationId?: string; slides?: { objectId?: string }[] };
  const presentationId = pres.presentationId;
  if (!presentationId) return res.status(502).json({ error: 'create_failed' });
  const defaultSlideId = pres.slides?.[0]?.objectId;

  const requests: any[] = [];
  if (defaultSlideId) {
    requests.push({ deleteObject: { objectId: defaultSlideId } });
  }

  requests.push({
    createSlide: {
      objectId: 'sTitle',
      insertionIndex: 0,
      slideLayoutReference: { predefinedLayout: 'TITLE' },
      placeholderIdMappings: [
        { layoutPlaceholder: { type: 'CENTERED_TITLE' }, objectId: 'tTitle' },
      ],
    },
  });
  requests.push({ insertText: { objectId: 'tTitle', text: deckTitle } });

  contentSlides.forEach((slide, i) => {
    // Google Slides object IDs must be at least 5 characters.
    const slideId = `slide_${i}`;
    const titleId = `title_${i}`;
    const bodyId  = `body_${i}`;
    const slideTitle = (slide.title ?? `Slide ${i + 1}`).toString().slice(0, 200);
    const bullets = Array.isArray(slide.bullets)
      ? slide.bullets.map(b => b.toString().slice(0, 500)).filter(Boolean)
      : [];

    requests.push({
      createSlide: {
        objectId: slideId,
        insertionIndex: i + 1,
        slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: 'TITLE' }, objectId: titleId },
          { layoutPlaceholder: { type: 'BODY' }, objectId: bodyId },
        ],
      },
    });
    requests.push({ insertText: { objectId: titleId, text: slideTitle } });
    if (bullets.length > 0) {
      requests.push({ insertText: { objectId: bodyId, text: bullets.join('\n') } });
      requests.push({
        createParagraphBullets: {
          objectId: bodyId,
          textRange: { type: 'ALL' },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
        },
      });
    }
  });

  const updateRes = await fetch(
    `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`,
    { method: 'POST', headers: gHeaders, body: JSON.stringify({ requests }) },
  );
  if (!updateRes.ok) {
    const googleError = await updateRes.text().catch(() => '(could not read body)');
    console.error(JSON.stringify({ endpoint: '/api/generate', type: 'slides', event: 'update_failed', status: updateRes.status, googleError }));
    return res.status(502).json({
      error: 'populate_failed',
      googleStatus: updateRes.status,
      googleError,
      presentationUrl: `https://docs.google.com/presentation/d/${presentationId}/edit`,
    });
  }

  return res.json({
    presentationId,
    presentationUrl: `https://docs.google.com/presentation/d/${presentationId}/edit`,
  });
}

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] as string | undefined;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const authResult = await verifyUserAndSubscription(token);
  if (!authResult.ok) return res.status(authResult.status).json({ error: authResult.error });

  const { type, googleToken } = req.body ?? {};

  if (typeof googleToken !== 'string' || !googleToken) {
    return res.status(400).json({ error: 'googleToken required' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  async function dispatch(tok: string) {
    if (type === 'docs')        return await handleDocs(req, res, tok);
    if (type === 'docs-update') return await handleDocsUpdate(req, res, tok);
    if (type === 'slides')      return await handleSlides(req, res, tok);
    return res.status(400).json({ error: 'type must be "docs", "docs-update", or "slides"' });
  }

  try {
    await dispatch(googleToken);
  } catch (e) {
    if (e instanceof GoogleTokenExpiredError) {
      const newToken = await refreshGoogleToken(authResult.userId, admin, 'googleDriveToken');
      if (!newToken) return res.status(401).json({ error: 'google_token_expired' });
      try {
        await dispatch(newToken);
      } catch (e2) {
        if (e2 instanceof GoogleTokenExpiredError) return res.status(401).json({ error: 'google_token_expired' });
        console.error(JSON.stringify({ endpoint: '/api/generate', type, event: 'error', message: (e2 as any)?.message }));
        return res.status(500).json({ error: 'Internal server error' });
      }
    } else {
      console.error(JSON.stringify({ endpoint: '/api/generate', type, event: 'error', message: (e as any)?.message }));
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}
