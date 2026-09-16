/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { embed } from 'ai';
import { isRateLimited } from './_rateLimit';

export const config = { api: { bodyParser: { sizeLimit: '10kb' } } };

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
// Below this cosine similarity, a chunk isn't worth showing the AI — better
// to say nothing than to inject a near-random passage as if it were relevant.
const MIN_SIMILARITY = 0.3;

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

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (isRateLimited(req, 'search-documents', { windowMs: 60_000, max: 60 })) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const authHeader = req.headers['authorization'] as string | undefined;
  const sbToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!sbToken) return res.status(401).json({ error: 'Unauthorized' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Server not configured' });

  const admin: any = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user }, error: authErr } = await admin.auth.getUser(sbToken);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { query, matchCount } = (req.body ?? {}) as { query?: string; matchCount?: number };
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'query required' });
  }
  const count = Math.min(Math.max(Number(matchCount) || 8, 1), 20);

  try {
    const { embedding } = await embed({ model: EMBEDDING_MODEL, value: query.slice(0, 4_000) });

    const { data, error } = await admin.rpc('match_document_chunks', {
      query_embedding: embedding,
      match_user_id: user.id,
      match_count: count,
    });
    if (error) throw new Error(error.message);

    const matches = ((data ?? []) as Array<{ document_id: string; chunk_index: number; content: string; similarity: number }>)
      .filter(row => row.similarity >= MIN_SIMILARITY)
      .map(row => ({
        documentId: row.document_id,
        chunkIndex: row.chunk_index,
        content: row.content,
        similarity: row.similarity,
      }));

    return res.status(200).json({ matches });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ endpoint: '/api/search-documents', event: 'error', message }));
    return res.status(500).json({ error: 'search_failed' });
  }
}
