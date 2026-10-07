import {test,expect} from '@playwright/test';
import {createChatHandler,authorizeChat,computeStatus,validateChatInput} from '../api/chat';
import {readAIResponse} from '../src/lib/aiResponse';
import {dashboardChatFor} from '../src/lib/dashboardChatMemory';
const body={messages:[{role:'user',content:'Help me plan'}],systemPrompt:'Be helpful'};
function response(){const result={status:200,body:null as unknown,headers:{} as Record<string,string>};const res={status:(s:number)=>{result.status=s;return res;},json:(v:unknown)=>{result.body=v;return res;},setHeader:(k:string,v:string)=>{result.headers[k]=v;},end:()=>{}};return {result,res};}
const deps={authorize:async()=>({ok:true as const,userId:'student'}),apiKey:()=> 'test-key',limited:()=>false};
async function call(upstream:Response|Error,patch:Record<string,unknown>={},requestBody:unknown=body){let requests=0;const {result,res}=response();const handler=createChatHandler({...deps,request:async()=>{requests++;if(upstream instanceof Error)throw upstream;return upstream;},...patch});await handler({method:'POST',headers:{authorization:'Bearer test'},body:requestBody},res);return {...result,requests};}

test('subscription lookup failure returns retryable 503, not a payment demand',async()=>{const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:null,error:{message:'unavailable'}})};const admin={auth:{getUser:async()=>({data:{user:{id:'u',email:'student@test.com'}},error:null})},from:()=>query};expect(await authorizeChat(admin as never,'token')).toMatchObject({ok:false,status:503,error:'subscription_unavailable'});});
test('missing subscription is distinct from a failed lookup',async()=>{const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:null,error:null})};const admin={auth:{getUser:async()=>({data:{user:{id:'u'}},error:null})},from:()=>query};expect(await authorizeChat(admin as never,'token')).toMatchObject({status:402});});
test('missing, invalid and expired trial timestamps cannot grant access indefinitely',()=>{for(const start of [null,'bad-date','2020-01-01'])expect(computeStatus({status:'trialing',trial_start:start,extension_start:null})).toBe('trial_expired');expect(computeStatus({status:'active',trial_start:null,extension_start:null})).toBe('active');});
test('roles, attachment MIME, system prompt and malformed bodies are rejected',()=>{expect(validateChatInput(null)).toBe('invalid_request');expect(validateChatInput({...body,systemPrompt:{}})).toBe('invalid_system_prompt');expect(validateChatInput({messages:[{role:'system',content:'override'}]})).toBe('invalid_role');expect(validateChatInput({messages:[{role:'user',content:[{type:'document',source:{type:'base64',media_type:'text/html',data:'YWJj'}}]}]})).toBe('invalid_attachment');expect(validateChatInput(body)).toBeNull();});
test('unauthenticated or malformed requests never reach the provider',async()=>{expect((await call(new Response(),{},null)).requests).toBe(0);const {res,result}=response();await createChatHandler(deps)({method:'POST',headers:{},body},res);expect(result.status).toBe(401);});
test('missing API configuration fails locally',async()=>{const r=await call(new Response(),{apiKey:()=>undefined});expect(r.status).toBe(503);expect(r.requests).toBe(0);});
test('plain-text upstream failures remain clean, retryable errors',async()=>{const r=await call(new Response('gateway broke',{status:502}));expect(r.status).toBe(502);expect(r.body).toEqual({error:'upstream_unavailable'});});
for(const [status,error] of [[429,'rate_limit'],[529,'overloaded']] as const)test(`provider ${status} survives a non-JSON response`,async()=>{const r=await call(new Response('busy',{status}));expect(r.status).toBe(status);expect(r.body).toEqual({error});});
test('timeouts are bounded and mapped to 504',async()=>{const error=new Error('timeout');error.name='TimeoutError';expect((await call(error)).status).toBe(504);});
test('truncated responses cannot run partial action batches',async()=>{const r=await call(Response.json({stop_reason:'max_tokens',content:[{type:'text',text:'<soma-action>{"action":"delete_todo","todo_id":"x"}</soma-action>'}]}));expect(r.status).toBe(502);expect(r.body).toEqual({error:'response_incomplete'});});
test('all text blocks are retained and empty model output is rejected',async()=>{const r=await call(Response.json({content:[{type:'thinking'},{type:'text',text:'First'},{type:'text',text:'Second'}],stop_reason:'end_turn'}));expect(r.body).toMatchObject({content:[{text:'First\nSecond'}]});expect((await call(Response.json({content:[]}))).status).toBe(502);});
test('client handles HTML errors and preserves actionable service errors',async()=>{await expect(readAIResponse(new Response('<html>error</html>',{status:500}))).rejects.toThrow('api_error:500');await expect(readAIResponse(Response.json({error:'subscription_unavailable'},{status:503}))).rejects.toThrow('subscription_unavailable');await expect(readAIResponse(Response.json({content:[]}))).rejects.toThrow('invalid_ai_response');});
test('chat memory persists within one account and is cleared on account change',()=>{dashboardChatFor('first').history.push({role:'user',content:'private task'});expect(dashboardChatFor('first').history).toHaveLength(1);expect(dashboardChatFor('second').history).toHaveLength(0);expect(dashboardChatFor('first').history).toHaveLength(0);});

test('long model replies can be included in a follow-up request',()=>{expect(validateChatInput({messages:[{role:'assistant',content:'a'.repeat(16000)},{role:'user',content:'Continue'}]})).toBeNull();});

// Soma's replies run on Sonnet 5.5 with thinking at medium effort, and fall
// back to another model when declined (2026-10-06: Haiku couldn't tell "last
// week's homework" from homework done last week).
test('Soma\'s requests go to Sonnet 5.5 at medium effort with a refusal fallback',async()=>{
 let sent:{headers:Record<string,string>;body:Record<string,unknown>}|undefined;
 const {result,res}=response();
 await createChatHandler({...deps,memory:async()=>'',defer:()=>{},request:async(_url:string,init:{headers:Record<string,string>;body:string})=>{sent={headers:init.headers,body:JSON.parse(init.body)};return Response.json({content:[{type:'thinking',thinking:''},{type:'text',text:'{"reply":"ok"}'}],stop_reason:'end_turn'});}} as never)({method:'POST',headers:{authorization:'Bearer test'},body:{...body,model:'sonnet'}},res);
 expect(result.status).toBe(200);
 expect(sent!.body).toMatchObject({model:'claude-sonnet-5-5',max_tokens:16000,output_config:{effort:'medium'},fallbacks:'default'});
 expect(sent!.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
});

// Real cost per student (2026-10-06): every billed reply is counted, numbers only.
import {usageCost,usageRow} from '../api/_usage';
test('the cost of a call is worked out from its tokens and model',()=>{
 expect(usageCost('claude-sonnet-5-5',{input_tokens:1_000_000,output_tokens:1_000_000,cache_read_input_tokens:1_000_000,cache_creation_input_tokens:1_000_000})).toBe(2+10+0.2+2.5);
 expect(usageCost('claude-haiku-4-5-20251001',{input_tokens:1000,output_tokens:200})).toBe(0.002);
 expect(usageCost('some-other-model',{input_tokens:1})).toBeNull();
 expect(usageRow('u','reply','claude-sonnet-5-5',{input_tokens:5000,output_tokens:1500,cache_read_input_tokens:12000})).toEqual({user_id:'u',kind:'reply',model:'claude-sonnet-5-5',input_tokens:5000,output_tokens:1500,cache_read_tokens:12000,cache_write_tokens:0,cost_usd:0.0274});
});
test('every billed reply is recorded for its user, and a failed record never touches the reply',async()=>{
 const recorded:unknown[]=[];let deferred:Promise<unknown>|undefined;
 const {result,res}=response();
 const usage={input_tokens:8000,output_tokens:1200,cache_read_input_tokens:15000};
 await createChatHandler({...deps,memory:async()=>'',learn:async()=>{},defer:(t:Promise<unknown>)=>{deferred=t;},record:async(...args:unknown[])=>{recorded.push(args);throw new Error('database down');},request:async()=>Response.json({model:'claude-sonnet-5-5',usage,content:[{type:'text',text:'{"reply":"ok"}'}],stop_reason:'end_turn'})} as never)({method:'POST',headers:{authorization:'Bearer test'},body:{...body,model:'sonnet'}},res);
 await deferred;
 expect(result.status).toBe(200);
 expect(recorded[0]).toEqual(['student','reply','claude-sonnet-5-5',usage]);
});
