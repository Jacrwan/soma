/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: { sizeLimit: '20kb' } } };

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
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

const MAX_CONTENT = 100_000; // chars returned to client

// Strip HTML to readable plain text (used for HTML exports / text fallbacks)
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Map a Google Workspace mimeType to the best export format we can read.
function exportFormatFor(mimeType: string): string | null {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':     return 'text/plain';
    case 'application/vnd.google-apps.presentation': return 'text/plain';
    case 'application/vnd.google-apps.spreadsheet':  return 'text/csv';
    default: return null;
  }
}

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth — require a valid Supabase session (no subscription gate; reading is a utility)
  const authHeader = req.headers['authorization'] as string | undefined;
  const sbToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!sbToken) return res.status(401).json({ error: 'Unauthorized' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Server not configured' });

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authErr } = await admin.auth.getUser(sbToken);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { fileId, googleToken } = req.body as { fileId?: string; googleToken?: string };
  if (!fileId || typeof fileId !== 'string' || !googleToken || typeof googleToken !== 'string') {
    return res.status(400).json({ error: 'Missing fileId or googleToken' });
  }
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) {
    return res.status(400).json({ error: 'Invalid fileId' });
  }

  const gHeaders = { Authorization: `Bearer ${googleToken}` };

  try {
    // 1. Get metadata to learn the file's name + mimeType
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType`,
      { headers: gHeaders },
    );
    if (metaRes.status === 401) return res.status(401).json({ error: 'google_token_expired' });
    if (metaRes.status === 403) return res.status(403).json({ error: 'no_access' });
    if (metaRes.status === 404) return res.status(404).json({ error: 'not_found' });
    if (!metaRes.ok)            return res.status(502).json({ error: 'google_error' });

    const meta = await metaRes.json() as { name?: string; mimeType?: string };
    const title: string = meta.name ?? 'Untitled';
    const mimeType: string = meta.mimeType ?? '';

    let content = '';

    const exportFormat = exportFormatFor(mimeType);
    if (exportFormat) {
      // Google-native file → export
      const expRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportFormat)}`,
        { headers: gHeaders },
      );
      if (expRes.status === 401) return res.status(401).json({ error: 'google_token_expired' });
      if (!expRes.ok)            return res.status(502).json({ error: 'export_failed' });
      content = await expRes.text();
    } else if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/rtf') {
      // Plain text / markdown / csv / json → download directly
      const dlRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
        { headers: gHeaders },
      );
      if (dlRes.status === 401) return res.status(401).json({ error: 'google_token_expired' });
      if (!dlRes.ok)            return res.status(502).json({ error: 'download_failed' });
      content = await dlRes.text();
    } else if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
      const dlRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
        { headers: gHeaders },
      );
      if (!dlRes.ok) return res.status(502).json({ error: 'download_failed' });
      content = htmlToText(await dlRes.text());
    } else {
      // Binary formats we can't extract text from without extra deps (PDF, docx, pptx, images)
      return res.status(415).json({
        error: 'unsupported_type',
        title,
        mimeType,
        hint: 'This file type can’t be read as text yet. For PDFs or Word/PowerPoint files, open them in Google Docs/Slides first (File → Open with → Google Docs), then attach that.',
      });
    }

    content = content.replace(/\r\n/g, '\n').trim();
    if (content.length > MAX_CONTENT) {
      content = content.slice(0, MAX_CONTENT) + '\n\n[Truncated — file is very long]';
    }

    return res.status(200).json({ title, mimeType, content });
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }
}
