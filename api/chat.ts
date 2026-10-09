/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { loadMemoryContext, learnFromMessage } from './_memory';
import { waitUntil } from '@vercel/functions';
import { EXTENSION_MS, trialLengthMs } from './_trial';
import { recordUsage, type Usage } from './_usage';
import { budgetStatus, type BudgetStatus } from './_budget';
import { loadConversationNotes, noteFromChat, isConversationId } from './_notes';

export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };
// Sonnet thinks before it answers; a whole day's plan can take over a minute.
export const maxDuration = 150;
type Authorization = { ok:true; userId:string; unlimited?:true } | { ok:false; status:number; error:string };

export function computeStatus(row:{status:string;trial_start:string|null;extension_start:string|null},now=Date.now()):string {
 const start=row.status==='trial_extended' ? row.extension_start : row.trial_start;
 if(row.status==='trialing' || row.status==='trial_extended'){
  const timestamp=start ? Date.parse(start) : NaN;
  if(!Number.isFinite(timestamp) || now>=timestamp+(row.status==='trialing' ? trialLengthMs(row.trial_start) : EXTENSION_MS))return 'trial_expired';
 }
 return row.status;
}

// Exported separately so database failures and entitlement decisions can be tested without network access.
export async function authorizeChat(admin:ReturnType<typeof createClient>,token:string,devEmail?:string):Promise<Authorization>{
 try {
  const {data:{user},error}=await admin.auth.getUser(token);
  if(error && (!error.status || error.status>=500))return {ok:false,status:503,error:'auth_service_unavailable'};
  if(error || !user)return {ok:false,status:401,error:'auth_required'};
  if(devEmail && user.email?.toLowerCase()===devEmail.trim().toLowerCase())return {ok:true,userId:user.id,unlimited:true};
  const {data:sub,error:lookupError}=await admin.from('subscriptions').select('status, trial_start, extension_start').eq('user_id',user.id).maybeSingle();
  if(lookupError)return {ok:false,status:503,error:'subscription_unavailable'};
  const status=sub ? computeStatus(sub) : 'free';
  if(!['trialing','trial_extended','active'].includes(status))return {ok:false,status:402,error:'subscription_required'};
  return {ok:true,userId:user.id};
 }catch{return {ok:false,status:503,error:'auth_service_unavailable'};}
}
export async function verifyUserAndSubscription(token:string):Promise<Authorization>{
 const url=process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url || !key)return {ok:false,status:503,error:'server_not_configured'};
 return authorizeChat(createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}}),token,process.env.DEVELOPER_EMAIL);
}

async function defaultBudget(userId:string):Promise<BudgetStatus|null>{
 const url=process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url || !key)return null;
 return budgetStatus(createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}}) as never,userId);
}

export function validateChatInput(body:unknown):string|null{
 if(!body || typeof body!=='object')return 'invalid_request';
 const {messages,systemPrompt,context,model,effort,purpose,conversationId}=body as Record<string,unknown>;
 if(systemPrompt!==undefined && typeof systemPrompt!=='string')return 'invalid_system_prompt';
 if(context!==undefined && typeof context!=='string')return 'invalid_context';
 if(model!==undefined && model!=='sonnet')return 'invalid_model';
 if(effort!==undefined && effort!=='low' && effort!=='medium')return 'invalid_effort';
 if(purpose!==undefined && purpose!=='triage')return 'invalid_purpose';
 if(conversationId!==undefined && !isConversationId(conversationId))return 'invalid_conversation';
 if(!Array.isArray(messages) || !messages.length || messages.length>50)return 'invalid_messages';
 let chars=(typeof systemPrompt==='string' ? systemPrompt.length : 0)+(typeof context==='string' ? context.length : 0);
 for(const msg of messages){
  if(!msg || !['user','assistant'].includes(msg.role))return 'invalid_role';
  if(typeof msg.content==='string'){
   if(!msg.content.trim() || msg.content.length>(msg.role==='assistant' ? 32_000 : 10_000))return 'invalid_message_content';
   chars+=msg.content.length;continue;
  }
  if(!Array.isArray(msg.content) || !msg.content.length || msg.content.length>8)return 'invalid_message_content';
  for(const block of msg.content){
   if(block?.type==='text'){
    if(typeof block.text!=='string' || !block.text.trim() || block.text.length>10_000)return 'invalid_text_block';
    chars+=block.text.length;
   }else if(block?.type==='image' || block?.type==='document'){
    const src=block.source,types=block.type==='image' ? ['image/jpeg','image/png','image/gif','image/webp'] : ['application/pdf'];
    if(msg.role!=='user' || !src || src.type!=='base64' || !types.includes(src.media_type) || typeof src.data!=='string' || !src.data.length || src.data.length>6_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(src.data))return 'invalid_attachment';
   }else return 'unsupported_content_block';
  }
 }
 if(messages[messages.length-1].role!=='user')return 'last_message_must_be_user';
 return chars>600_000 ? 'context_too_long' : null;
}

const hits=new Map<string,number[]>();
function rateLimited(userId:string){
 const now=Date.now();
 // This is a per-instance burst guard; provider/account quotas are still required across instances.
 for(const [key,times] of hits)if(!times.length || now-times[times.length-1]>=60_000)hits.delete(key);
 if(hits.size>=10_000 && !hits.has(userId))return true;
 const times=(hits.get(userId)??[]).filter(t=>now-t<60_000);
 if(times.length>=20)return true;
 hits.set(userId,[...times,now]);return false;
}

export function createChatHandler(deps:{authorize?:(token:string)=>Promise<Authorization>;request?:typeof fetch;apiKey?:()=>string|undefined;limited?:(id:string)=>boolean;memory?:(userId:string,query:string)=>Promise<string>;learn?:(userId:string,message:string,assistantContext:string,apiKey:string)=>Promise<void>;defer?:(task:Promise<unknown>)=>void;record?:(userId:string,kind:'reply'|'triage',model:string,usage:Usage)=>Promise<void>;budget?:(userId:string)=>Promise<BudgetStatus|null>;notes?:(userId:string,query:string,conversationId?:string)=>Promise<string>;noteChat?:(userId:string,conversationId:string,message:string,reply:string,apiKey:string)=>Promise<void>}={}){
 return async function handler(req:any,res:any){
  const origin=req.headers.origin;
  if(origin==='https://somastudy.app' || (process.env.NODE_ENV!=='production' && origin==='http://localhost:5173'))res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
  const header=req.headers.authorization;
  const token=typeof header==='string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if(!token)return res.status(401).json({error:'auth_required'});
  const invalid=validateChatInput(req.body);
  if(invalid)return res.status(400).json({error:invalid});
  try {
   const auth=await (deps.authorize??verifyUserAndSubscription)(token);
   if(!auth.ok)return res.status(auth.status).json({error:auth.error});
   if((deps.limited??rateLimited)(auth.userId)){res.setHeader('Retry-After','60');return res.status(429).json({error:'rate_limit'});}
   // Each plan includes a monthly AI budget; past it, Soma pauses until the
   // reset or a top-up. The owner's account (DEVELOPER_EMAIL) has no limit.
   if(!auth.unlimited){
    const budget=await (deps.budget??defaultBudget)(auth.userId);
    if(budget && budget.used>=budget.available)return res.status(402).json({error:'ai_budget_used',resetsAt:budget.resetsAt,trial:budget.trial});
   }
   const key=(deps.apiKey??(()=>process.env.ANTHROPIC_API_KEY))();
   if(!key)return res.status(503).json({error:'server_not_configured'});
   const {messages,systemPrompt,context,model,effort,purpose,conversationId}=req.body;
   // The first pass that sorts a message (and answers small talk) needs no
   // memory, and learning from the message is left to the reply proper.
   const triage=purpose==='triage';
   const lastContent=messages[messages.length-1].content;
   const query=typeof lastContent==='string' ? lastContent : lastContent.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join(' ');
   const savedMemory=triage ? '' : await (deps.memory??loadMemoryContext)(auth.userId,query);
   // Notes from earlier chats, only when they match what is being asked.
   const notes=triage ? '' : await (deps.notes??loadConversationNotes)(auth.userId,query,conversationId);
   // Prompt caching is a prefix match. systemPrompt (instructions, documents)
   // stays the same between messages, and so do the earlier turns of the chat;
   // the live plan (context) and memory (ranked per request) change every call.
   // They used to sit in the system prompt, ahead of the chat, so the chat was
   // re-billed in full every message. Now they ride on the newest message, after
   // a cache breakpoint on the turn before it, and the whole chat is read from
   // cache at a tenth of the price.
   const system=systemPrompt ? [{type:'text' as const,text:systemPrompt,cache_control:{type:'ephemeral' as const}}] : [];
   const live=[context,savedMemory,notes].filter((x):x is string=>typeof x==='string' && !!x.trim()).join('\n\n');
   const blocks=(content:unknown)=>typeof content==='string' ? [{type:'text',text:content}] : content as Record<string,unknown>[];
   const sent=messages.map((m:{role:string;content:unknown},i:number)=>{
    if(i===messages.length-1)return live ? {role:m.role,content:[{type:'text',text:live},...blocks(m.content)]} : m;
    if(i===messages.length-2){const b=blocks(m.content);return {role:m.role,content:b.map((x,j)=>j===b.length-1 ? {...x,cache_control:{type:'ephemeral'}} : x)};}
    return m;
   });
   // Soma's replies use Sonnet 5.5, thinking at medium effort: Haiku answered
   // "last week's homework" with the homework done last week. A declined
   // request falls back to another model rather than failing (beta).
   const sonnet=model==='sonnet';
   const response=await (deps.request??fetch)('https://api.anthropic.com/v1/messages',{
    method:'POST',signal:AbortSignal.timeout(140_000),headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json',...(sonnet ? {'anthropic-beta':'server-side-fallback-2026-07-01'} : {})},
    body:JSON.stringify({model:sonnet ? 'claude-sonnet-5-5' : 'claude-haiku-4-5-20251001',max_tokens:sonnet ? 16000 : 8192,...(sonnet ? {output_config:{effort:effort==='low' ? 'low' : 'medium'},fallbacks:'default'} : {}),...(system.length ? {system} : {}),messages:sent}),
   });
   if(response.status===429)return res.status(429).json({error:'rate_limit'});
   if(response.status===529)return res.status(529).json({error:'overloaded'});
   const data=await response.json().catch(()=>null) as {error?:{message?:string};content?:{type:string;text?:string}[];stop_reason?:string;model?:string;usage?:Usage}|null;
   if(!response.ok){
    if(response.status===400 && /too long|token|context/i.test(data?.error?.message??''))return res.status(400).json({error:'context_too_long'});
    console.error(JSON.stringify({endpoint:'/api/chat',event:'upstream_error',status:response.status}));
    return res.status(502).json({error:'upstream_unavailable'});
   }
   // Every billed reply is counted, including ones that fail below.
   if(data?.usage)(deps.defer??waitUntil)((deps.record??recordUsage)(auth.userId,triage ? 'triage' : 'reply',data.model ?? (sonnet ? 'claude-sonnet-5-5' : 'claude-haiku-4-5'),data.usage).catch(()=>{}));
   if(data?.stop_reason==='max_tokens')return res.status(502).json({error:'response_incomplete'});
   const text=data?.content?.filter(b=>b.type==='text' && typeof b.text==='string').map(b=>b.text).join('\n');
   if(!text?.trim())return res.status(502).json({error:'invalid_ai_response'});
   // Learn from what the student said, after the reply is on its way. A failure
   // here must never affect the conversation, so it is detached and swallowed.
   const previous=messages.length>1 ? messages[messages.length-2] : null;
   const assistantContext=previous?.role==='assistant' ? (typeof previous.content==='string' ? previous.content : previous.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join(' ')) : '';
   if(!triage)(deps.defer??waitUntil)((deps.learn??learnFromMessage)(auth.userId,query,assistantContext,key).catch(()=>{}));
   // This conversation's note, updated with what was just said.
   if(!triage && isConversationId(conversationId))(deps.defer??waitUntil)((deps.noteChat??noteFromChat)(auth.userId,conversationId,query,text,key).catch(()=>{}));
   return res.status(200).json({content:[{type:'text',text}],stop_reason:data?.stop_reason});
  }catch(error){
   const timedOut=error instanceof Error && ['TimeoutError','AbortError'].includes(error.name);
   return res.status(timedOut ? 504 : 503).json({error:timedOut ? 'request_timeout' : 'service_unavailable'});
  }
 };
}
export default createChatHandler();
