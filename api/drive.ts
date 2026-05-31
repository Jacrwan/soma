/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: { sizeLimit: '20kb' } } };

const FILE_CHAR_LIMIT = 8_000;
const MAX_FOLDER_FILES = 20;

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

// Extract plain text from Google Docs API document structure
function extractText(doc: any): string {
  const parts: string[] = [];

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

const MAX_CONTENT = 100_000;

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

function exportFormatFor(mimeType: string): string | null {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':     return 'text/plain';
    case 'application/vnd.google-apps.presentation': return 'text/plain';
    case 'application/vnd.google-apps.spreadsheet':  return 'text/csv';
    default: return null;
  }
}

async function handleDoc(req: any, res: any, googleToken: string) {
  const { docId } = req.body as { docId?: string };
  if (!docId || typeof docId !== 'string') {
    return res.status(400).json({ error: 'Missing docId' });
  }
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(docId)) {
    return res.status(400).json({ error: 'Invalid docId' });
  }

  const docRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`,
    { headers: { Authorization: `Bearer ${googleToken}` } },
  );

  if (docRes.status === 401) return res.status(401).json({ error: 'google_token_expired' });
  if (docRes.status === 403) return res.status(403).json({ error: 'no_access' });
  if (docRes.status === 404) return res.status(404).json({ error: 'not_found' });
  if (!docRes.ok)            return res.status(502).json({ error: 'google_error' });

  const doc = await docRes.json() as { title?: string };
  const title: string = doc.title ?? 'Untitled';
  const content = extractText(doc);

  return res.status(200).json({ title, content });
}

async function handleFolder(req: any, res: any, googleToken: string) {
  const { folderId, folderName: passedFolderName } = req.body as { folderId?: string; folderName?: string };
  if (!folderId || typeof folderId !== 'string') {
    return res.status(400).json({ error: 'Missing folderId' });
  }
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(folderId)) {
    return res.status(400).json({ error: 'Invalid folderId' });
  }

  const folderName: string = (passedFolderName && typeof passedFolderName === 'string')
    ? passedFolderName
    : 'Untitled folder';

  const gHeaders = { Authorization: `Bearer ${googleToken}` };

  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType)',
    pageSize: '100',
  });
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    { headers: gHeaders },
  );
  if (listRes.status === 401) return res.status(401).json({ error: 'google_token_expired' });
  if (listRes.status === 403) return res.status(403).json({ error: 'no_access' });
  if (!listRes.ok)            return res.status(502).json({ error: 'google_error' });

  const data = await listRes.json() as { files?: { id: string; name: string; mimeType: string }[] };
  return res.status(200).json({ folderName, files: data.files ?? [] });
}

async function handleFile(req: any, res: any, googleToken: string) {
  const { fileId } = req.body as { fileId?: string };
  if (!fileId || typeof fileId !== 'string') {
    return res.status(400).json({ error: 'Missing fileId' });
  }
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) {
    return res.status(400).json({ error: 'Invalid fileId' });
  }

  const gHeaders = { Authorization: `Bearer ${googleToken}` };

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
    const expRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportFormat)}`,
      { headers: gHeaders },
    );
    if (expRes.status === 401) return res.status(401).json({ error: 'google_token_expired' });
    if (!expRes.ok)            return res.status(502).json({ error: 'export_failed' });
    content = await expRes.text();
  } else if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/rtf') {
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
    return res.status(415).json({
      error: 'unsupported_type',
      title,
      mimeType,
      hint: `This file type can't be read as text yet. For PDFs or Word/PowerPoint files, open them in Google Docs/Slides first (File → Open with → Google Docs), then attach that.`,
    });
  }

  content = content.replace(/\r\n/g, '\n').trim();
  if (content.length > MAX_CONTENT) {
    content = content.slice(0, MAX_CONTENT) + '\n\n[Truncated — file is very long]';
  }

  return res.status(200).json({ title, mimeType, content });
}

// Returns { content, truncated } for supported types, null to skip unsupported.
async function readFileContent(
  fileId: string,
  mimeType: string,
  gHeaders: { Authorization: string },
): Promise<{ content: string; truncated: boolean } | null> {
  let raw = '';

  if (mimeType === 'application/vnd.google-apps.document') {
    const docRes = await fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}`,
      { headers: gHeaders },
    );
    if (!docRes.ok) return null;
    raw = extractText(await docRes.json());
  } else if (
    mimeType === 'application/vnd.google-apps.spreadsheet' ||
    mimeType === 'application/vnd.google-apps.presentation' ||
    mimeType === 'application/pdf'
  ) {
    const exportMime = mimeType === 'application/vnd.google-apps.spreadsheet' ? 'text/csv' : 'text/plain';
    const expRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`,
      { headers: gHeaders },
    );
    if (!expRes.ok) return null;
    raw = await expRes.text();
  } else if (mimeType.startsWith('text/') || mimeType === 'application/rtf') {
    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers: gHeaders },
    );
    if (!dlRes.ok) return null;
    raw = await dlRes.text();
  } else {
    return null;
  }

  raw = raw.replace(/\r\n/g, '\n').trim();
  const truncated = raw.length > FILE_CHAR_LIMIT;
  return { content: truncated ? raw.slice(0, FILE_CHAR_LIMIT) : raw, truncated };
}

async function handleFolderContents(req: any, res: any, googleToken: string) {
  const { folderId } = req.body as { folderId?: string };
  if (!folderId || typeof folderId !== 'string') {
    return res.status(400).json({ error: 'Missing folderId' });
  }
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(folderId)) {
    return res.status(400).json({ error: 'Invalid folderId' });
  }

  const gHeaders = { Authorization: `Bearer ${googleToken}` };

  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType)',
    pageSize: String(MAX_FOLDER_FILES),
  });
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    { headers: gHeaders },
  );
  if (listRes.status === 401) return res.status(401).json({ error: 'google_token_expired' });
  if (listRes.status === 403) return res.status(403).json({ error: 'no_access' });
  if (!listRes.ok)            return res.status(502).json({ error: 'google_error' });

  const data = await listRes.json() as { files?: { id: string; name: string; mimeType: string }[] };
  const listed = (data.files ?? []).slice(0, MAX_FOLDER_FILES);

  const results: { id: string; name: string; mimeType: string; content: string; truncated: boolean }[] = [];

  for (const file of listed) {
    const read = await readFileContent(file.id, file.mimeType, gHeaders);
    results.push({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      content: read?.content ?? '[Cannot extract text from this file type]',
      truncated: read?.truncated ?? false,
    });
  }

  return res.status(200).json({ files: results });
}

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

  const type = req.query?.type as string | undefined;

  let googleToken: string;

  if (type === 'folder-contents') {
    // Token fetched server-side from the user's persisted settings row.
    const { data: settingsRow } = await admin
      .from('settings')
      .select('data')
      .eq('user_id', user.id)
      .single();
    const token = (settingsRow?.data as Record<string, unknown> | null)?.googleDriveToken;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Google Drive not connected' });
    }
    googleToken = token;
  } else {
    const { googleToken: bodyToken } = req.body as { googleToken?: string };
    if (!bodyToken || typeof bodyToken !== 'string') {
      return res.status(400).json({ error: 'Missing googleToken' });
    }
    googleToken = bodyToken;
  }

  try {
    if (type === 'doc')             return await handleDoc(req, res, googleToken);
    if (type === 'file')            return await handleFile(req, res, googleToken);
    if (type === 'folder')          return await handleFolder(req, res, googleToken);
    if (type === 'folder-contents') return await handleFolderContents(req, res, googleToken);
    return res.status(400).json({ error: 'type query param must be "doc", "file", "folder", or "folder-contents"' });
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }
}
