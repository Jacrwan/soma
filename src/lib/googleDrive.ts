import { supabase } from './supabase';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

async function getSupabaseToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? '';
}

function mapStatusError(status: number, body: { error?: string }): Error {
  if (status === 401) {
    if (body.error === 'google_token_expired') return new Error('google_token_expired');
    return new Error('auth_required');
  }
  if (status === 403) return new Error('no_access');
  if (status === 404) return new Error('not_found');
  if (status === 415) return new Error('unsupported_type');
  return new Error('drive_error');
}

// List / search readable files in the user's Drive.
export async function listDriveFiles(
  googleToken: string,
  search?: string,
): Promise<DriveFile[]> {
  const token = await getSupabaseToken();
  const res = await fetch('/api/drive-list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ googleToken, search }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw mapStatusError(res.status, body);
  }
  const { files } = await res.json();
  return files as DriveFile[];
}

// Read a single Drive file's text content.
export async function readDriveFile(
  googleToken: string,
  fileId: string,
): Promise<{ title: string; content: string; mimeType: string }> {
  const token = await getSupabaseToken();
  const res = await fetch('/api/drive-read', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ fileId, googleToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw mapStatusError(res.status, body);
  }
  return res.json() as Promise<{ title: string; content: string; mimeType: string }>;
}

// Extract a Drive/Docs/Slides/Sheets file ID from any Google file URL.
export function extractDriveFileId(text: string): string | null {
  const patterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
    /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/,
    /docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/,
    /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
    /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function stripGoogleFileUrl(text: string): string {
  return text
    .replace(/https?:\/\/(?:drive|docs)\.google\.com\/[^\s]+/g, '')
    .trim();
}

// Friendly label for a Drive mimeType.
export function fileTypeLabel(mimeType: string): string {
  if (mimeType === 'application/vnd.google-apps.document') return 'Doc';
  if (mimeType === 'application/vnd.google-apps.presentation') return 'Slides';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'Sheet';
  if (mimeType === 'text/csv') return 'CSV';
  if (mimeType === 'text/markdown') return 'Markdown';
  if (mimeType.startsWith('text/')) return 'Text';
  return 'File';
}
