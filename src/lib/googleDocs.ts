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

  const res = await fetch('/api/drive?type=doc', {
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

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ type: 'docs', googleToken: googleDocsToken, title, content }),
  });

  if (res.status === 401) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    if (body.error === 'google_token_expired') throw new Error('google_token_expired');
    throw new Error('auth_required');
  }
  if (res.status === 402) throw new Error('subscription_required');
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; googleStatus?: number };
    if (body.googleStatus === 401) throw new Error('google_token_expired');
    throw new Error(body.error || 'docs_error');
  }

  return res.json();
}

export async function updateGoogleDoc(
  googleDocsToken: string,
  docId: string,
  content: string,
): Promise<{ docId: string; docUrl: string }> {
  const token = await getSupabaseToken();

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ type: 'docs-update', googleToken: googleDocsToken, docId, content }),
  });

  if (res.status === 401) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    if (body.error === 'google_token_expired') throw new Error('google_token_expired');
    throw new Error('auth_required');
  }
  if (res.status === 402) throw new Error('subscription_required');
  if (res.status === 404) throw new Error('not_found');
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; googleStatus?: number };
    if (body.googleStatus === 401) throw new Error('google_token_expired');
    throw new Error(body.error || 'docs_error');
  }

  return res.json();
}

export interface SlideSpec { title: string; bullets: string[] }

export async function createGoogleSlides(
  googleToken: string,
  title: string,
  slides: SlideSpec[],
): Promise<{ presentationId: string; presentationUrl: string }> {
  const token = await getSupabaseToken();

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ type: 'slides', googleToken, title, slides }),
  });

  if (res.status === 401) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    if (body.error === 'google_token_expired') throw new Error('google_token_expired');
    throw new Error('auth_required');
  }
  if (res.status === 402) throw new Error('subscription_required');
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; presentationUrl?: string; googleStatus?: number };
    if (body.presentationUrl) {
      const e = new Error('populate_failed') as Error & { presentationUrl?: string };
      e.presentationUrl = body.presentationUrl;
      throw e;
    }
    if (body.googleStatus === 401) throw new Error('google_token_expired');
    throw new Error(body.error || 'slides_error');
  }

  return res.json();
}
