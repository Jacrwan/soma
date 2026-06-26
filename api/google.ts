/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { extractText as extractPdfText } from 'unpdf';
import { GoogleTokenExpiredError, refreshGoogleToken } from './_googleAuth';

export const config = { api: { bodyParser: { sizeLimit: '20kb' } } };

const FILE_CHAR_LIMIT = 8_000;

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

// ── Helpers (carried over from drive.ts unchanged) ────────────────────────────

function extractDocText(doc: any): string {
  const parts: string[] = [];
  function visitContent(content: any[]) {
    for (const element of content ?? []) {
      if (element.paragraph?.elements) {
        for (const el of element.paragraph.elements) {
          if (el.textRun?.content) parts.push(el.textRun.content);
        }
      } else if (element.table) {
        for (const row of element.table.tableRows ?? []) {
          for (const cell of row.tableCells ?? []) visitContent(cell.content ?? []);
          parts.push('\n');
        }
      }
    }
  }
  visitContent(doc.body?.content ?? []);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
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

function exportFormatFor(mimeType: string): string | null {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':     return 'text/plain';
    case 'application/vnd.google-apps.presentation': return 'text/plain';
    case 'application/vnd.google-apps.spreadsheet':  return 'text/csv';
    default: return null;
  }
}

function fetchWithTimeout(url: string, init: RequestInit, ms = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

interface FileReadResult { content: string; truncated: boolean; error?: string; note?: string }

async function readFileContent(
  fileId: string, fileName: string, mimeType: string,
  gHeaders: { Authorization: string },
): Promise<FileReadResult | null> {
  if (mimeType === 'application/pdf') {
    try {
      const dlRes = await fetchWithTimeout(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
        { headers: gHeaders },
      );
      if (!dlRes.ok) return { content: '', truncated: false, error: 'pdf_download_failed' };
      const buffer = new Uint8Array(await dlRes.arrayBuffer());
      const { text } = await extractPdfText(buffer, { mergePages: true });
      let raw = text.replace(/\r\n/g, '\n').trim();
      const truncated = raw.length > FILE_CHAR_LIMIT;
      if (truncated) raw = raw.slice(0, FILE_CHAR_LIMIT);
      return { content: raw, truncated };
    } catch (err) {
      console.error(JSON.stringify({ event: 'fc_pdf_error', fileName, error: String(err) }));
      return { content: '', truncated: false, error: 'pdf_parse_failed' };
    }
  }

  let raw = '';
  if (mimeType === 'application/vnd.google-apps.document') {
    const docRes = await fetchWithTimeout(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}`, { headers: gHeaders },
    );
    if (!docRes.ok) return null;
    raw = extractDocText(await docRes.json());
  } else if (
    mimeType === 'application/vnd.google-apps.spreadsheet' ||
    mimeType === 'application/vnd.google-apps.presentation'
  ) {
    const exportMime = mimeType === 'application/vnd.google-apps.spreadsheet' ? 'text/csv' : 'text/plain';
    const expRes = await fetchWithTimeout(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`,
      { headers: gHeaders },
    );
    if (!expRes.ok) return null;
    raw = await expRes.text();
  } else if (mimeType.startsWith('text/') || mimeType === 'application/rtf') {
    const dlRes = await fetchWithTimeout(
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

// ── Drive sub-handlers ────────────────────────────────────────────────────────

async function handleDoc(body: any, res: any, googleToken: string) {
  const { docId } = body as { docId?: string };
  if (!docId || typeof docId !== 'string') return res.status(400).json({ error: 'Missing docId' });
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(docId)) return res.status(400).json({ error: 'Invalid docId' });

  const docRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`,
    { headers: { Authorization: `Bearer ${googleToken}` } },
  );
  if (docRes.status === 401) throw new GoogleTokenExpiredError();
  if (docRes.status === 403) return res.status(403).json({ error: 'no_access' });
  if (docRes.status === 404) return res.status(404).json({ error: 'not_found' });
  if (!docRes.ok)            return res.status(502).json({ error: 'google_error' });

  const doc = await docRes.json() as { title?: string };
  return res.status(200).json({ title: doc.title ?? 'Untitled', content: extractDocText(doc) });
}

async function handleFile(body: any, res: any, googleToken: string) {
  const { fileId } = body as { fileId?: string };
  if (!fileId || typeof fileId !== 'string') return res.status(400).json({ error: 'Missing fileId' });
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) return res.status(400).json({ error: 'Invalid fileId' });

  const gHeaders = { Authorization: `Bearer ${googleToken}` };
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType`,
    { headers: gHeaders },
  );
  if (metaRes.status === 401) throw new GoogleTokenExpiredError();
  if (metaRes.status === 403) return res.status(403).json({ error: 'no_access' });
  if (metaRes.status === 404) return res.status(404).json({ error: 'not_found' });
  if (!metaRes.ok)            return res.status(502).json({ error: 'google_error' });

  const meta = await metaRes.json() as { name?: string; mimeType?: string };
  const title = meta.name ?? 'Untitled';
  const mimeType = meta.mimeType ?? '';
  let content = '';

  const exportFormat = exportFormatFor(mimeType);
  if (exportFormat) {
    const expRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportFormat)}`,
      { headers: gHeaders },
    );
    if (expRes.status === 401) throw new GoogleTokenExpiredError();
    if (!expRes.ok) return res.status(502).json({ error: 'export_failed' });
    content = await expRes.text();
  } else if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/rtf') {
    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers: gHeaders },
    );
    if (dlRes.status === 401) throw new GoogleTokenExpiredError();
    if (!dlRes.ok) return res.status(502).json({ error: 'download_failed' });
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
      error: 'unsupported_type', title, mimeType,
      hint: `This file type can't be read as text yet. Open it in Google Docs/Slides first, then attach that.`,
    });
  }

  content = content.replace(/\r\n/g, '\n').trim();
  if (content.length > 100_000) content = content.slice(0, 100_000) + '\n\n[Truncated]';
  return res.status(200).json({ title, mimeType, content });
}

async function handleFolder(body: any, res: any, googleToken: string) {
  const { folderId, folderName: passedFolderName } = body as { folderId?: string; folderName?: string };
  if (!folderId || typeof folderId !== 'string') return res.status(400).json({ error: 'Missing folderId' });
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(folderId)) return res.status(400).json({ error: 'Invalid folderId' });

  const folderName = (passedFolderName && typeof passedFolderName === 'string') ? passedFolderName : 'Untitled folder';
  const gHeaders = { Authorization: `Bearer ${googleToken}` };
  const params = new URLSearchParams({ q: `'${folderId}' in parents and trashed=false`, fields: 'files(id,name,mimeType)', pageSize: '100' });
  const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: gHeaders });
  if (listRes.status === 401) throw new GoogleTokenExpiredError();
  if (listRes.status === 403) return res.status(403).json({ error: 'no_access' });
  if (!listRes.ok)            return res.status(502).json({ error: 'google_error' });

  const data = await listRes.json() as { files?: { id: string; name: string; mimeType: string }[] };
  return res.status(200).json({ folderName, files: data.files ?? [] });
}

async function handleFolderContents(body: any, res: any, admin: any, userId: string) {
  const { folderId } = body as { folderId?: string };
  if (!folderId || typeof folderId !== 'string') return res.status(400).json({ error: 'Missing folderId' });
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(folderId)) return res.status(400).json({ error: 'Invalid folderId' });

  const { data: settingsRow } = await admin.from('settings').select('data').eq('user_id', userId).single();
  const tok = (settingsRow?.data as Record<string, unknown> | null)?.googleDriveToken;
  if (!tok || typeof tok !== 'string') return res.status(400).json({ error: 'Google Drive not connected' });
  const googleToken = tok;

  const gHeaders = { Authorization: `Bearer ${googleToken}` };
  type FileEntry = { id: string; name: string; mimeType: string; content: string; truncated: boolean; error?: string; note?: string };
  const results: FileEntry[] = [];
  const HARD_CAP = 50;

  async function fetchFolderFiles(currentFolderId: string, pathPrefix: string): Promise<void> {
    if (results.length >= HARD_CAP) return;
    const params = new URLSearchParams({ q: `'${currentFolderId}' in parents and trashed=false`, fields: 'files(id,name,mimeType)', pageSize: '100' });
    const listRes = await fetchWithTimeout(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: gHeaders });
    if (!listRes.ok) return;
    const data = await listRes.json() as { files?: { id: string; name: string; mimeType: string }[] };
    for (const child of data.files ?? []) {
      if (results.length >= HARD_CAP) break;
      const displayName = pathPrefix ? `${pathPrefix} / ${child.name}` : child.name;
      if (child.mimeType === 'application/vnd.google-apps.folder') {
        await fetchFolderFiles(child.id, displayName);
      } else {
        try {
          const read = await readFileContent(child.id, displayName, child.mimeType, gHeaders);
          results.push(read !== null
            ? { id: child.id, name: displayName, mimeType: child.mimeType, content: read.content, truncated: read.truncated, ...(read.error ? { error: read.error, note: read.note } : {}) }
            : { id: child.id, name: displayName, mimeType: child.mimeType, content: '[Cannot extract text from this file type]', truncated: false });
        } catch (err: unknown) {
          const isTimeout = err instanceof Error && err.name === 'AbortError';
          results.push({ id: child.id, name: displayName, mimeType: child.mimeType, content: '', truncated: false, error: isTimeout ? 'timeout' : 'read_error' });
        }
      }
    }
  }

  const rootParams = new URLSearchParams({ q: `'${folderId}' in parents and trashed=false`, fields: 'files(id,name,mimeType)', pageSize: '100' });
  const rootListRes = await fetchWithTimeout(`https://www.googleapis.com/drive/v3/files?${rootParams}`, { headers: gHeaders });
  if (rootListRes.status === 401) throw new GoogleTokenExpiredError();
  if (rootListRes.status === 403) return res.status(403).json({ error: 'no_access' });
  if (!rootListRes.ok)            return res.status(502).json({ error: 'google_error' });

  const rootData = await rootListRes.json() as { files?: { id: string; name: string; mimeType: string }[] };
  for (const child of rootData.files ?? []) {
    if (results.length >= HARD_CAP) break;
    if (child.mimeType === 'application/vnd.google-apps.folder') {
      await fetchFolderFiles(child.id, child.name);
    } else {
      try {
        const read = await readFileContent(child.id, child.name, child.mimeType, gHeaders);
        results.push(read !== null
          ? { id: child.id, name: child.name, mimeType: child.mimeType, content: read.content, truncated: read.truncated, ...(read.error ? { error: read.error, note: read.note } : {}) }
          : { id: child.id, name: child.name, mimeType: child.mimeType, content: '[Cannot extract text from this file type]', truncated: false });
      } catch (err: unknown) {
        const isTimeout = err instanceof Error && err.name === 'AbortError';
        results.push({ id: child.id, name: child.name, mimeType: child.mimeType, content: '', truncated: false, error: isTimeout ? 'timeout' : 'read_error' });
      }
    }
  }

  return res.status(200).json({ files: results });
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] as string | undefined;
  const sbToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!sbToken) return res.status(401).json({ error: 'Unauthorized' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Server not configured' });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user }, error: authErr } = await admin.auth.getUser(sbToken);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });
  const userId = user.id;

  let body = req.body as Record<string, unknown> | string | undefined;
  if (typeof body === 'string') {
    try { body = JSON.parse(body) as Record<string, unknown>; } catch { body = {}; }
  }
  body = body ?? {};

  const action = typeof body.action === 'string' ? body.action : '';
  if (!action) return res.status(400).json({ error: 'action required' });

  // ── Refresh token (no googleToken needed) ─────────────────────────────────
  if (action === 'refresh-token') {
    const { tokenField } = body;
    if (tokenField !== 'googleDriveToken' && tokenField !== 'googleToken') {
      return res.status(400).json({ error: 'tokenField must be "googleDriveToken" or "googleToken"' });
    }
    const newToken = await refreshGoogleToken(userId, admin, tokenField as 'googleDriveToken' | 'googleToken');
    if (!newToken) return res.status(401).json({ error: 'refresh_failed' });
    return res.status(200).json({ accessToken: newToken });
  }

  // ── Drive actions (need googleToken or server-fetched token) ──────────────
  if (action === 'drive') {
    const type = typeof body.type === 'string' ? body.type : '';

    async function dispatch(tok: string) {
      if (type === 'doc')             return await handleDoc(body, res, tok);
      if (type === 'file')            return await handleFile(body, res, tok);
      if (type === 'folder')          return await handleFolder(body, res, tok);
      if (type === 'folder-contents') return await handleFolderContents(body, res, admin, userId);
      return res.status(400).json({ error: 'type must be "doc", "file", "folder", or "folder-contents"' });
    }

    // folder-contents fetches its token server-side
    if (type === 'folder-contents') {
      try {
        await dispatch('');
      } catch (e) {
        if (e instanceof GoogleTokenExpiredError) return res.status(401).json({ error: 'google_token_expired' });
        return res.status(500).json({ error: 'internal_error' });
      }
      return;
    }

    const { googleToken } = body as { googleToken?: string };
    if (!googleToken || typeof googleToken !== 'string') return res.status(400).json({ error: 'Missing googleToken' });

    try {
      await dispatch(googleToken);
    } catch (e) {
      if (e instanceof GoogleTokenExpiredError) {
        const newToken = await refreshGoogleToken(userId, admin, 'googleDriveToken');
        if (!newToken) return res.status(401).json({ error: 'google_token_expired' });
        try {
          await dispatch(newToken);
        } catch (e2) {
          if (e2 instanceof GoogleTokenExpiredError) return res.status(401).json({ error: 'google_token_expired' });
          throw e2;
        }
      } else {
        return res.status(500).json({ error: 'internal_error' });
      }
    }
    return;
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}
