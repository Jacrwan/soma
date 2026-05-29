/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: { sizeLimit: '10kb' } } };

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

// Only surface file types we can actually read as text.
const READABLE_MIME_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.spreadsheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/rtf',
];

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  const { googleToken, search } = req.body as { googleToken?: string; search?: string };
  if (!googleToken || typeof googleToken !== 'string') {
    return res.status(400).json({ error: 'Missing googleToken' });
  }

  // Build the Drive query. Always exclude trashed + non-readable types.
  const typeClause = `(${READABLE_MIME_TYPES.map(m => `mimeType='${m}'`).join(' or ')})`;
  let q = `trashed=false and ${typeClause}`;
  if (typeof search === 'string' && search.trim()) {
    // Escape single quotes per Drive query syntax
    const safe = search.trim().replace(/'/g, "\\'").slice(0, 100);
    q += ` and name contains '${safe}'`;
  }

  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: '25',
    spaces: 'drive',
    corpora: 'user',
  });

  try {
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      { headers: { Authorization: `Bearer ${googleToken}` } },
    );
    if (driveRes.status === 401) return res.status(401).json({ error: 'google_token_expired' });
    if (!driveRes.ok)            return res.status(502).json({ error: 'google_error' });

    const data = await driveRes.json() as { files?: any[] };
    const files = (data.files ?? []).map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
    }));

    return res.status(200).json({ files });
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }
}
