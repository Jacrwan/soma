import { supabase } from './supabase';
import { parseMemoryCommand, runMemoryCommand } from './aiMemory';
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

/** A split prompt: `stable` (instructions, documents) is cached between
 *  messages; `context` (the live plan) is sent fresh and never cached. */
export type SplitPrompt = { stable: string; context: string };

export async function sendMessage(
  messages: { role: 'user' | 'assistant'; content: string }[],
  systemPrompt: string | SplitPrompt,
  model?: 'sonnet',
  attachments?: Attachment[],
  responseFormat?: 'dashboard',
  /** Sonnet's thinking effort, and whether this is the cheap first pass that sorts a message.
   *  `onText` streams the reply: it's called with everything received so far. */
  options: { effort?: 'low' | 'medium'; purpose?: 'triage' | 'study'; conversationId?: string; onText?: (soFar: string) => void } = {},
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('auth_required');
  const last=messages[messages.length-1];
  const command=last?.role==='user' ? parseMemoryCommand(last.content) : null;
  if(command) {
    if(attachments?.length) throw new Error('Send memory commands without attachments.');
    const reply=await runMemoryCommand(command,token);
    const {data:{session:current}}=await supabase.auth.getSession();
    if(current?.user.id!==session.user.id) throw new Error('account_changed');
    return responseFormat==='dashboard' ? JSON.stringify({reply,blocks:[]}) : reply;
  }

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
    signal: AbortSignal.timeout(150_000),
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      messages: outMessages,
      ...(typeof systemPrompt === 'string' ? { systemPrompt } : { systemPrompt: systemPrompt.stable, context: systemPrompt.context }),
      ...(model ? { model } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
      ...(options.purpose ? { purpose: options.purpose } : {}),
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      ...(options.onText && model === 'sonnet' && !options.purpose ? { stream: true } : {}),
    }),
  }).catch(error => { if (error instanceof Error && ['TimeoutError','AbortError'].includes(error.name)) throw new Error('request_timeout'); throw error; });

  // A streamed reply when the server sent one; anything else (an error, or a
  // server that answered in one piece) is read as before.
  const streamed=res.ok && options.onText && (res.headers.get('content-type') ?? '').includes('text/event-stream');
  const text=streamed ? await readStream(res, options.onText!) : await readAIResponse(res);
  const {data:{session:current}}=await supabase.auth.getSession();
  if(current?.user.id!==session?.user.id)throw new Error('account_changed');
  return text;
}

/** The reply from /api/chat's stream (see relayStream in api/chat.ts). */
async function readStream(res: Response, onText: (soFar: string) => void): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '', text = '', finished = false;
  for (;;) {
    const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const line = buffer.slice(0, cut).trim(); buffer = buffer.slice(cut + 2);
      if (!line.startsWith('data:')) continue;
      let event: { t?: unknown; done?: unknown; error?: unknown };
      try { event = JSON.parse(line.slice(5)); } catch { continue; }
      if (typeof event.error === 'string') throw new Error(event.error);
      if (typeof event.t === 'string') { text += event.t; onText(text); }
      if (event.done === true) finished = true;
    }
  }
  // A stream that stopped without saying it finished was cut off.
  if (!finished) throw new Error(text ? 'response_incomplete' : 'upstream_unavailable');
  return text;
}
