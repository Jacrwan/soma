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

// Extract plain text from Google Docs API document structure
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(doc: any): string {
  const parts: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function visitContent(content: any[]) {
    for (const element of content ?? []) {
      if (element.paragraph?.elements) {
        for (const el of element.paragraph.elements) {
          if (el.textRun?.content) parts.push(el.textRun.content);
        }
      } else if (element.table) {
        for (const row of element.table.tableRows ?? []) {
          for (const cell of row.tableCells ?? []) {
            visitContent(cell.content ?? []);
          }
          parts.push('\n');
        }
      }
    }
  }

  visitContent(doc.body?.content ?? []);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth — require a valid Supabase session (no subscription check; reading is a utility)
  const authHeader = req.headers['authorization'] as string | undefined;
  const sbToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!sbToken) return res.status(401).json({ error: 'Unauthorized' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authErr } = await admin.auth.getUser(sbToken);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { docId, googleToken } = req.body as { docId?: string; googleToken?: string };
  if (!docId || typeof docId !== 'string' || !googleToken || typeof googleToken !== 'string') {
    return res.status(400).json({ error: 'Missing docId or googleToken' });
  }

  // Basic docId sanity check (alphanumeric + hyphens/underscores only)
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(docId)) {
    return res.status(400).json({ error: 'Invalid docId' });
  }

  try {
    const docRes = await fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`,
      { headers: { Authorization: `Bearer ${googleToken}` } },
    );

    if (docRes.status === 401) return res.status(401).json({ error: 'google_token_expired' });
    if (docRes.status === 403) return res.status(403).json({ error: 'no_access' });
    if (docRes.status === 404) return res.status(404).json({ error: 'not_found' });
    if (!docRes.ok)            return res.status(502).json({ error: 'google_error' });

    const doc = await docRes.json();
    const title: string = (doc.title as string | undefined) ?? 'Untitled';
    const content = extractText(doc);

    return res.status(200).json({ title, content });
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }
}
