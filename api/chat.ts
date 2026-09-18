/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { loadMemoryContext } from './_memory';

export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };
export const maxDuration = 60;
type Authorization = { ok:true; userId:string } | { ok:false; status:number; error:string };
const TRIAL_MS=21*86_400_000, EXTENSION_MS=7*86_400_000;

export function computeStatus(row:{status:string;trial_start:string|null;extension_start:string|null},now=Date.now()):string {
 const start=row.status==='trial_extended' ? row.extension_start : row.trial_start;
 if(row.status==='trialing' || row.status==='trial_extended'){
  const timestamp=start ? Date.parse(start) : NaN;
  if(!Number.isFinite(timestamp) || now>=timestamp+(row.status==='trialing' ? TRIAL_MS : EXTENSION_MS))return 'trial_expired';
 }
 return row.status;
}

// Exported separately so database failures and entitlement decisions can be tested without network access.
export async function authorizeChat(admin:ReturnType<typeof createClient>,token:string,devEmail?:string):Promise<Authorization>{
 try {
  const {data:{user},error}=await admin.auth.getUser(token);
  if(error && (!error.status || error.status>=500))return {ok:false,status:503,error:'auth_service_unavailable'};
  if(error || !user)return {ok:false,status:401,error:'auth_required'};
  if(devEmail && user.email?.toLowerCase()===devEmail.trim().toLowerCase())return {ok:true,userId:user.id};
  const {data:sub,error:lookupError}=await admin.from('subscriptions').select('status, trial_start, extension_start').eq('user_id',user.id).maybeSingle();
  if(lookupError)return {ok:false,status:503,error:'subscription_unavailable'};
  const status=sub ? computeStatus(sub) : 'free';
  if(!['trialing','trial_extended','active'].includes(status))return {ok:false,status:402,error:'subscription_required'};
  return {ok:true,userId:user.id};
 }catch{return {ok:false,status:503,error:'auth_service_unavailable'};}
}
async function verifyUserAndSubscription(token:string):Promise<Authorization>{
 const url=process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url || !key)return {ok:false,status:503,error:'server_not_configured'};
 return authorizeChat(createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}}),token,process.env.DEVELOPER_EMAIL);
}

export function validateChatInput(body:unknown):string|null{
 if(!body || typeof body!=='object')return 'invalid_request';
 const {messages,systemPrompt,model}=body as Record<string,unknown>;
 if(systemPrompt!==undefined && typeof systemPrompt!=='string')return 'invalid_system_prompt';
 if(model!==undefined && model!=='sonnet')return 'invalid_model';
 if(!Array.isArray(messages) || !messages.length || messages.length>50)return 'invalid_messages';
 let chars=typeof systemPrompt==='string' ? systemPrompt.length : 0;
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

export function createChatHandler(deps:{authorize?:(token:string)=>Promise<Authorization>;request?:typeof fetch;apiKey?:()=>string|undefined;limited?:(id:string)=>boolean;memory?:(userId:string,query:string)=>Promise<string>}={}){
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
   const key=(deps.apiKey??(()=>process.env.ANTHROPIC_API_KEY))();
   if(!key)return res.status(503).json({error:'server_not_configured'});
   const {messages,systemPrompt,model}=req.body;
   const lastContent=messages[messages.length-1].content;
   const query=typeof lastContent==='string' ? lastContent : lastContent.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join(' ');
   const savedMemory=await (deps.memory??loadMemoryContext)(auth.userId,query);
   // Memory is ranked per request, so it changes nearly every call. It goes in
   // its own block after the cache breakpoint: prompt caching is a prefix match,
   // and folding it into the cached block would miss the cache on every message
   // and re-bill the full system prompt (documents included) each time.
   const system=[
    ...(systemPrompt ? [{type:'text' as const,text:systemPrompt,cache_control:{type:'ephemeral' as const}}] : []),
    ...(savedMemory ? [{type:'text' as const,text:savedMemory}] : []),
   ];
   const response=await (deps.request??fetch)('https://api.anthropic.com/v1/messages',{
    method:'POST',signal:AbortSignal.timeout(45_000),headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},
    body:JSON.stringify({model:model==='sonnet' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',max_tokens:4096,...(system.length ? {system} : {}),messages}),
   });
   if(response.status===429)return res.status(429).json({error:'rate_limit'});
   if(response.status===529)return res.status(529).json({error:'overloaded'});
   const data=await response.json().catch(()=>null) as {error?:{message?:string};content?:{type:string;text?:string}[];stop_reason?:string}|null;
   if(!response.ok){
    if(response.status===400 && /too long|token|context/i.test(data?.error?.message??''))return res.status(400).json({error:'context_too_long'});
    console.error(JSON.stringify({endpoint:'/api/chat',event:'upstream_error',status:response.status}));
    return res.status(502).json({error:'upstream_unavailable'});
   }
   if(data?.stop_reason==='max_tokens')return res.status(502).json({error:'response_incomplete'});
   const text=data?.content?.filter(b=>b.type==='text' && typeof b.text==='string').map(b=>b.text).join('\n');
   if(!text?.trim())return res.status(502).json({error:'invalid_ai_response'});
   return res.status(200).json({content:[{type:'text',text}],stop_reason:data?.stop_reason});
  }catch(error){
   const timedOut=error instanceof Error && ['TimeoutError','AbortError'].includes(error.name);
   return res.status(timedOut ? 504 : 503).json({error:timedOut ? 'request_timeout' : 'service_unavailable'});
  }
 };
}
export default createChatHandler();
