import { supabase } from './supabase';

export async function sendMessage(
  messages: { role: 'user' | 'assistant'; content: string }[],
  systemPrompt: string,
  model?: 'sonnet',
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, systemPrompt, ...(model ? { model } : {}) }),
  });

  if (res.status === 401) throw new Error('auth_required');
  if (res.status === 402) throw new Error('subscription_required');

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chat error: ${res.status}: ${body}`);
  }
  const data = await res.json() as { content: { text: string }[] };
  return data.content[0].text;
}
