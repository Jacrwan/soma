import { supabase } from './supabase';

async function getSupabaseToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? '';
}

export async function readGoogleDoc(
  googleDocsToken: string,
  docId: string,
): Promise<{ title: string; content: string }> {
  const token = await getSupabaseToken();

  const res = await fetch('/api/docs-read', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ docId, googleToken: googleDocsToken }),
  });

  if (res.status === 401) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    if (body.error === 'google_token_expired') throw new Error('google_token_expired');
    throw new Error('auth_required');
  }
  if (res.status === 403) throw new Error('no_access');
  if (res.status === 404) throw new Error('not_found');
  if (!res.ok) throw new Error('docs_error');

  return res.json() as Promise<{ title: string; content: string }>;
}

export async function createGoogleDoc(
  googleDocsToken: string,
  title: string,
  content: string,
): Promise<{ docId: string; docUrl: string }> {
  const token = await getSupabaseToken();

  const res = await fetch('/api/docs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ googleToken: googleDocsToken, title, content }),
  });

  if (res.status === 401) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    if (body.error === 'google_token_expired') throw new Error('google_token_expired');
    throw new Error('auth_required');
  }
  if (res.status === 402) throw new Error('subscription_required');
  if (!res.ok) throw new Error('docs_error');

  return res.json();
}
