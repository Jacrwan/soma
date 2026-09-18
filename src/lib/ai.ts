import { supabase } from './supabase';
import { readAIResponse } from './aiResponse';
import type { Attachment } from './uploads';

type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } };

function attachmentBlock(a: Attachment): Block {
  const source = { type: 'base64' as const, media_type: a.mediaType, data: a.base64 };
  return a.kind === 'pdf' ? { type: 'document', source } : { type: 'image', source };
}

export async function sendMessage(
  messages: { role: 'user' | 'assistant'; content: string }[],
  systemPrompt: string,
  model?: 'sonnet',
  attachments?: Attachment[],
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('auth_required');

  // Attach uploaded files (images/PDFs) to the final user turn as content blocks.
  let outMessages: unknown[] = messages;
  if (attachments && attachments.length > 0) {
    const lastUserIdx = messages.map(m => m.role).lastIndexOf('user');
    outMessages = messages.map((m, i) => {
      if (i !== lastUserIdx) return m;
      const blocks: Block[] = [{ type: 'text', text: m.content }, ...attachments.map(attachmentBlock)];
      return { role: m.role, content: blocks };
    });
  }

  const res = await fetch('/api/chat', {
    signal: AbortSignal.timeout(55_000),
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages: outMessages, systemPrompt, ...(model ? { model } : {}) }),
  }).catch(error => { if (error instanceof Error && ['TimeoutError','AbortError'].includes(error.name)) throw new Error('request_timeout'); throw error; });

  const text=await readAIResponse(res);
  const {data:{session:current}}=await supabase.auth.getSession();
  if(current?.user.id!==session?.user.id)throw new Error('account_changed');
  return text;
}
