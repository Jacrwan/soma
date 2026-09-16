/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { extractText as extractPdfText } from 'unpdf';
import { extractRawText as extractDocxText } from 'mammoth';
import { isRateLimited } from './_rateLimit';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

const BUCKET = 'documents';
const TEXT_CHAR_LIMIT = 20_000;

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

function truncate(text: string): { text: string; truncated: boolean } {
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (cleaned.length <= TEXT_CHAR_LIMIT) return { text: cleaned, truncated: false };
  return { text: cleaned.slice(0, TEXT_CHAR_LIMIT), truncated: true };
}

// Returns null for a file type we don't know how to extract text from.
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function extract(fileType: string, bytes: Uint8Array): Promise<string | null> {
  if (fileType === 'application/pdf') {
    const { text } = await extractPdfText(bytes, { mergePages: true });
    return text;
  }
  if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const { value } = await extractDocxText({ buffer: Buffer.from(bytes) });
    return value;
  }
  if (fileType === 'text/plain') {
    return Buffer.from(bytes).toString('utf-8');
  }
  if (fileType === 'text/html') {
    return htmlToText(Buffer.from(bytes).toString('utf-8'));
  }
  return null;
}

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (isRateLimited(req, 'extract-document', { windowMs: 60_000, max: 20 })) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const authHeader = req.headers['authorization'] as string | undefined;
  const sbToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!sbToken) return res.status(401).json({ error: 'Unauthorized' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Server not configured' });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user }, error: authErr } = await admin.auth.getUser(sbToken);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { documentId } = (req.body ?? {}) as { documentId?: string };
  if (!documentId || typeof documentId !== 'string') {
    return res.status(400).json({ error: 'documentId required' });
  }

  const { data: doc, error: docErr } = await admin
    .from('documents')
    .select('id, user_id, storage_path, file_type')
    .eq('id', documentId)
    .single();
  if (docErr || !doc) return res.status(404).json({ error: 'not_found' });
  if (doc.user_id !== user.id) return res.status(403).json({ error: 'forbidden' });

  await admin.from('documents').update({ extraction_status: 'processing' }).eq('id', documentId);

  try {
    const { data: fileData, error: dlErr } = await admin.storage.from(BUCKET).download(doc.storage_path);
    if (dlErr || !fileData) throw new Error(dlErr?.message ?? 'download_failed');
    const bytes = new Uint8Array(await fileData.arrayBuffer());

    const raw = await extract(doc.file_type, bytes);
    if (raw === null) {
      await admin.from('documents').update({
        extraction_status: 'unsupported', extracted_text: null, extraction_error: null,
      }).eq('id', documentId);
      return res.status(200).json({ status: 'unsupported' });
    }

    const { text, truncated } = truncate(raw);
    if (!text) {
      await admin.from('documents').update({
        extraction_status: 'failed', extracted_text: null, extraction_error: 'empty_content',
      }).eq('id', documentId);
      return res.status(200).json({ status: 'failed' });
    }

    await admin.from('documents').update({
      extraction_status: 'done',
      extracted_text: truncated ? `${text}\n\n[Truncated]` : text,
      extraction_error: null,
    }).eq('id', documentId);
    return res.status(200).json({ status: 'done', textLength: text.length, truncated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ endpoint: '/api/extract-document', event: 'error', documentId, message }));
    await admin.from('documents').update({
      extraction_status: 'failed', extracted_text: null, extraction_error: message.slice(0, 300),
    }).eq('id', documentId);
    return res.status(200).json({ status: 'failed' });
  }
}
