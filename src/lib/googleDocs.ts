import { supabase } from './supabase';

export async function createGoogleDoc(
  googleDocsToken: string,
  title: string,
  content: string,
): Promise<{ docId: string; docUrl: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

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
