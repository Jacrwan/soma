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

// Read a Drive file's text content (called after the user picks via Google Picker).
export async function readDriveFile(
  googleToken: string,
  fileId: string,
): Promise<{ title: string; content: string; mimeType: string }> {
  const token = await getSupabaseToken();
  const res = await fetch('/api/drive?type=file', {
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


export interface FolderFile {
  id: string;
  name: string;
  mimeType: string;
}

export async function listFolderFiles(
  googleToken: string,
  folderId: string,
  folderName?: string,
): Promise<{ folderName: string; files: FolderFile[] }> {
  const token = await getSupabaseToken();
  const res = await fetch('/api/drive?type=folder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ folderId, folderName, googleToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw mapStatusError(res.status, body);
  }
  return res.json() as Promise<{ folderName: string; files: FolderFile[] }>;
}

export interface FolderContentFile {
  id: string;
  name: string;
  mimeType: string;
  content: string;
  truncated: boolean;
  error?: string;
  note?: string;
}

// No googleToken in the body — the server fetches it from the user's settings row.
export async function readFolderContents(
  folderId: string,
): Promise<{ files: FolderContentFile[] }> {
  const token = await getSupabaseToken();
  const res = await fetch('/api/drive?type=folder-contents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ folderId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw mapStatusError(res.status, body);
  }
  return res.json() as Promise<{ files: FolderContentFile[] }>;
}

const FOLDER_CONTENTS_CACHE_KEY = 'soma_folder_contents_cache';
const FOLDER_CONTENTS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface FolderContentsCache {
  folderId: string;
  section: string;
  timestamp: number;
}

export function clearFolderContentsCache(): void {
  localStorage.removeItem(FOLDER_CONTENTS_CACHE_KEY);
}

export function getFolderContentsCacheTs(): number {
  try {
    const raw = localStorage.getItem(FOLDER_CONTENTS_CACHE_KEY);
    if (!raw) return 0;
    return (JSON.parse(raw) as FolderContentsCache).timestamp ?? 0;
  } catch { return 0; }
}

// Synchronous — reads the cached section string for use inside buildSystemPrompt().
export function readCachedFolderSection(): string {
  try {
    const raw = localStorage.getItem(FOLDER_CONTENTS_CACHE_KEY);
    if (!raw) return '';
    const cached = JSON.parse(raw) as FolderContentsCache;
    if (Date.now() - cached.timestamp > FOLDER_CONTENTS_CACHE_TTL) return '';
    return cached.section;
  } catch { return ''; }
}

async function fetchAndCacheFolderSection(folderId: string, folderName: string): Promise<string> {
  const result = await readFolderContents(folderId);
  const PROMPT_FILE_LIMIT = 6_000;
  const fileLines = result.files
    .filter(f => f.content && !f.error && f.content !== '[Cannot extract text from this file type]')
    .map(f => {
      const content = f.content.length > PROMPT_FILE_LIMIT
        ? f.content.slice(0, PROMPT_FILE_LIMIT) + '...'
        : f.content;
      return `- ${f.name}:\n${content}`;
    })
    .join('\n\n');

  if (!fileLines) return '';

  const section = `Study Folder: ${folderName}\n${fileLines}`;
  const entry: FolderContentsCache = { folderId, section, timestamp: Date.now() };
  localStorage.setItem(FOLDER_CONTENTS_CACHE_KEY, JSON.stringify(entry));
  return section;
}

// Async — returns cached content immediately if fresh, else fetches and caches.
// When cache is fresh, also triggers a background refetch so the next message gets updated content.
export async function getFolderContentsForPrompt(): Promise<string> {
  const folderRaw = localStorage.getItem('soma_study_folder');
  if (!folderRaw) return '';

  let folder: { folderId: string; folderName: string };
  try { folder = JSON.parse(folderRaw); } catch { return ''; }
  if (!folder?.folderId) return '';

  try {
    const cacheRaw = localStorage.getItem(FOLDER_CONTENTS_CACHE_KEY);
    if (cacheRaw) {
      const cached = JSON.parse(cacheRaw) as FolderContentsCache;
      if (cached.folderId === folder.folderId && Date.now() - cached.timestamp <= FOLDER_CONTENTS_CACHE_TTL) {
        // Cache is fresh — return immediately and revalidate in the background.
        fetchAndCacheFolderSection(folder.folderId, folder.folderName).catch(() => {});
        return cached.section;
      }
    }
  } catch { /* ignore */ }

  // Cache is missing or expired — fetch synchronously so this message gets fresh content.
  try {
    return await fetchAndCacheFolderSection(folder.folderId, folder.folderName);
  } catch {
    return '';
  }
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
