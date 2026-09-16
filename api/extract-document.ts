/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { extractText as extractPdfText } from 'unpdf';
import { extractRawText as extractDocxText } from 'mammoth';
import { embedMany } from 'ai';
import { isRateLimited } from './_rateLimit';
import { chunkText } from './_chunking';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } }, maxDuration: 300 };

const BUCKET = 'documents';
// Documents at or under this size are stuffed directly into the chat system
// prompt (see AITab.tsx's buildDocumentsSection). Anything larger — a
// textbook, a long reading — gets chunked and embedded for retrieval instead,
// so it's fully searchable rather than silently cut off.
const RAG_THRESHOLD_CHARS = 20_000;
// Sanity cap so one degenerate file (e.g. a huge OCR dump) can't produce an
// unbounded number of chunks/embedding calls. ~650k tokens of source text.
const MAX_EXTRACT_CHARS = 2_600_000;
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';

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

function clean(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_EXTRACT_CHARS);
}

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

// Returns null for a file type we don't know how to extract text from.
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

async function chunkAndEmbed(
  admin: any,
  documentId: string,
  userId: string,
  text: string,
): Promise<void> {
  await admin.from('documents').update({ chunk_status: 'processing' }).eq('id', documentId);

  const pieces = chunkText(text);
  const { embeddings } = await embedMany({ model: EMBEDDING_MODEL, values: pieces });

  // Clear out any chunks from a previous extraction attempt so re-running
  // this doesn't leave stale/duplicate rows behind.
  await admin.from('document_chunks').delete().eq('document_id', documentId);

  const rows = pieces.map((content, i) => ({
    document_id: documentId,
    user_id: userId,
    chunk_index: i,
    content,
    embedding: embeddings[i],
  }));

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await admin.from('document_chunks').insert(rows.slice(i, i + BATCH));
    if (error) throw new Error(`chunk_insert_failed: ${error.message}`);
  }
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

    const text = clean(raw);
    if (!text) {
      await admin.from('documents').update({
        extraction_status: 'failed', extracted_text: null, extraction_error: 'empty_content',
      }).eq('id', documentId);
      return res.status(200).json({ status: 'failed' });
    }

    const needsRag = text.length > RAG_THRESHOLD_CHARS;

    if (needsRag) {
      try {
        await chunkAndEmbed(admin, documentId, doc.user_id as string, text);
        await admin.from('documents').update({
          extraction_status: 'done',
          extracted_text: text,
          extraction_error: null,
          needs_rag: true,
          chunk_status: 'done',
          chunk_error: null,
        }).eq('id', documentId);
        return res.status(200).json({ status: 'done', mode: 'rag', textLength: text.length });
      } catch (chunkErr: unknown) {
        const message = chunkErr instanceof Error ? chunkErr.message : String(chunkErr);
        console.error(JSON.stringify({ endpoint: '/api/extract-document', event: 'chunk_error', documentId, message }));
        // Extraction itself succeeded — the raw text is stored and the doc
        // page can still open the file — only the search index failed.
        await admin.from('documents').update({
          extraction_status: 'done',
          extracted_text: text,
          extraction_error: null,
          needs_rag: true,
          chunk_status: 'failed',
          chunk_error: message.slice(0, 300),
        }).eq('id', documentId);
        return res.status(200).json({ status: 'done', mode: 'rag_failed', textLength: text.length });
      }
    }

    await admin.from('documents').update({
      extraction_status: 'done',
      extracted_text: text,
      extraction_error: null,
      needs_rag: false,
      chunk_status: 'not_applicable',
    }).eq('id', documentId);
    return res.status(200).json({ status: 'done', mode: 'direct', textLength: text.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ endpoint: '/api/extract-document', event: 'error', documentId, message }));
    await admin.from('documents').update({
      extraction_status: 'failed', extracted_text: null, extraction_error: message.slice(0, 300),
    }).eq('id', documentId);
    return res.status(200).json({ status: 'failed' });
  }
}
