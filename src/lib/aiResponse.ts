const knownErrors=new Set(['context_too_long','rate_limit','overloaded','subscription_unavailable','auth_service_unavailable','server_not_configured','request_timeout','response_incomplete','invalid_ai_response','upstream_unavailable','service_unavailable']);
export async function readAIResponse(res:Response):Promise<string>{
 if(res.status===401)throw new Error('auth_required');
 if(res.status===402)throw new Error('subscription_required');
 if(res.status===429)throw new Error('rate_limit');
 if(res.status===529)throw new Error('overloaded');
 const data=await res.json().catch(()=>null);
 if(!res.ok)throw new Error(knownErrors.has(data?.error) ? data.error : `api_error:${res.status}`);
 if(data?.stop_reason==='max_tokens')throw new Error('response_incomplete');
 const text=Array.isArray(data?.content) ? data.content.filter((b:{type?:string;text?:unknown})=>(b?.type===undefined || b.type==='text') && typeof b?.text==='string').map((b:{text:string})=>b.text).join('\n') : '';
 if(!text.trim())throw new Error('invalid_ai_response');
 return text;
}
export function aiErrorMessage(error:unknown):string{
 const code=error instanceof Error ? error.message : '';
 const messages:Record<string,string>={account_changed:'Your account changed while Soma was replying. Please send the request again.',auth_required:'Please sign in again to use Soma.',subscription_required:'AI access requires an active plan or trial. Check Settings → Subscription.',subscription_unavailable:'Soma could not check your subscription. Please retry; no payment change is needed.',auth_service_unavailable:'Sign-in verification is temporarily unavailable. Please retry.',rate_limit:'Too many requests. Wait a minute and try again.',overloaded:'Soma is busy right now. Please try again shortly.',context_too_long:'This conversation is too long. Try a shorter request or start a new chat.',request_timeout:'Soma took too long to reply. Nothing was applied; please retry.',response_incomplete:'Soma’s reply was cut short. Nothing was applied; ask for a smaller plan.',invalid_ai_response:'Soma returned an unreadable reply. Nothing was applied; please retry.',server_not_configured:'The AI service is not configured. Please contact support.',upstream_unavailable:'The AI provider is temporarily unavailable. Please retry.',service_unavailable:'Soma is temporarily unavailable. Please retry.'};
 return messages[code]??(code.startsWith('api_error:') ? 'Soma could not complete the request. Please retry.' : code || 'Could not reach Soma. Please retry.');
}
