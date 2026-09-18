/** Explicit memory commands are handled by the API, never by model-generated actions. */
export type MemoryEntry = { key: string; content: string; category: 'preference' | 'goal' | 'fact'; updatedAt: string; expiresAt: string | null };
export type MemoryState = { revision: number; enabled: boolean; entries: MemoryEntry[] };
export type MemoryMutation = { action: 'remember'; key: string; content: string; category?: MemoryEntry['category']; expiresAt?: string | null } | { action:'forget'; key:string } | { action:'clear' } | { action:'set_enabled'; enabled:boolean };
export function parseMemoryCommand(text: string): MemoryMutation | 'list' | 'help' | null {
  const value=text.trim();
  if (/^\/memories$/i.test(value)) return 'list';
  const mode=value.match(/^\/memory\s+(on|off|clear)$/i);
  if(mode) return mode[1].toLowerCase()==='clear' ? {action:'clear'} : {action:'set_enabled',enabled:mode[1].toLowerCase()==='on'};
  const forget=value.match(/^\/forget\s+([a-z0-9][a-z0-9_-]{0,79})$/i);
  if(forget) return {action:'forget',key:forget[1].toLowerCase()};
  const remember=value.match(/^\/remember\s+([a-z0-9][a-z0-9_-]{0,79})\s*:\s*([\s\S]+)$/i);
  if(remember) return {action:'remember',key:remember[1].toLowerCase(),content:remember[2].trim()};
  return /^\/(?:memory|memories|remember|forget)\b/i.test(value) ? 'help' : null;
}
export async function requestMemory(token: string, action?: MemoryMutation): Promise<MemoryState> {
  const response=await fetch('/api/memory',{method:action ? 'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(action ? {body:JSON.stringify(action)}:{}),signal:AbortSignal.timeout(15000)}).catch(() => { throw new Error('The memory request was not confirmed. Check /memories before retrying.'); });
  const body=await response.json().catch(()=>null);
  if(!response.ok) {
    const messages:Record<string,string>={auth_required:'Sign in again to manage your memories.',memory_disabled:'Memory is paused. Send /memory on before saving a new memory.',memory_full:'Your memory is full. Forget a saved item before adding another.',memory_conflict:'Memory changed in another request. Please retry.',memory_unavailable:'Memory is not available right now. Please try again later.',rate_limit:'Too many memory requests. Please wait a minute.',invalid_memory:'Use a memory of 1–600 characters.',invalid_memory_key:'Use a short key with letters, numbers, hyphens or underscores.'};
    throw new Error(messages[body?.error]??'The memory request was not confirmed. Check /memories before retrying.');
  }
  return body as MemoryState;
}
export async function runMemoryCommand(command: Exclude<ReturnType<typeof parseMemoryCommand>, null>, token: string): Promise<string> {
  if(command==='help') return 'Use /remember study-time: I prefer studying in the morning. Reuse the same key to update it. Use /memories to view saved facts, /forget study-time to remove one, /memory off to pause recall, or /memory clear to erase all saved facts.';
  const state=await requestMemory(token,command==='list' ? undefined : command);
  if(command==='list') {
    // A saved fact must never become an executable AI action when displayed in chat.
    const safe=(value:string)=>value.replace(/</g,'‹').replace(/>/g,'›');
    return `${state.enabled ? 'Memory is on.' : 'Memory is paused.'}\n${state.entries.length ? state.entries.map(e=>`${e.key}: ${safe(e.content.slice(0,160))}${e.content.length>160 ? '…' : ''}`).join('\n') : 'No saved memories.'}`;
  }
  if(command.action==='remember') return `Saved memory: ${command.key}. You can update it using the same key.`;
  if(command.action==='forget') return `Memory removed: ${command.key}. This does not delete your chat history.`;
  if(command.action==='clear') return 'All saved memories were cleared. Your tasks and chat history were not deleted.';
  return state.enabled ? 'Memory is on.' : 'Memory is paused. Saved facts are retained but will not be supplied to Soma.';
}
