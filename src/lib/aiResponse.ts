const knownErrors=new Set(['context_too_long','rate_limit','overloaded','subscription_unavailable','auth_service_unavailable','server_not_configured','request_timeout','response_incomplete','invalid_ai_response','upstream_unavailable','service_unavailable']);
export async function readAIResponse(res:Response):Promise<string>{
 if(res.status===401)throw new Error('auth_required');
 // 402 is either no plan at all or this month's Soma used up.
 if(res.status===402){const body=await res.json().catch(()=>null);throw new Error(body?.error==='ai_budget_used' ? 'ai_budget_used' : 'subscription_required');}
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
 const messages:Record<string,string>={ai_budget_used:'You’ve used your Soma for now. The bar under the chat box shows when it resets, and you can add more there.',account_changed:'Your account changed while Soma was replying. Please send the request again.',auth_required:'Please sign in again to use Soma.',subscription_required:'AI access requires an active plan or trial. Check Settings → Subscription.',subscription_unavailable:'Soma could not check your subscription. Please retry; no payment change is needed.',auth_service_unavailable:'Sign-in verification is temporarily unavailable. Please retry.',rate_limit:'Too many requests. Wait a minute and try again.',overloaded:'Soma is busy right now. Please try again shortly.',context_too_long:'This conversation is too long. Try a shorter request or start a new chat.',request_timeout:'Soma took too long to reply. Nothing was applied; please retry.',response_incomplete:'Soma’s reply was cut short. Nothing was applied; ask for a smaller plan.',invalid_ai_response:'Soma returned an unreadable reply. Nothing was applied; please retry.',server_not_configured:'The AI service is not configured. Please contact support.',upstream_unavailable:'The AI provider is temporarily unavailable. Please retry.',service_unavailable:'Soma is temporarily unavailable. Please retry.'};
 return messages[code]??(code.startsWith('api_error:') ? 'Soma could not complete the request. Please retry.' : code || 'Could not reach Soma. Please retry.');
}

/**
 * The "reply" field of a JSON answer that is still arriving, decoded as far
 * as it goes: '{"reply":"Here\\u2019s the pl' is "Here’s the pl". Empty until
 * the field starts.
 */
export function partialReply(raw: string): string {
  const m = /"reply"\s*:\s*"/.exec(raw);
  if (!m) return '';
  let out = '';
  for (let i = m.index + m[0].length; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') break;
    if (c !== '\\') { out += c; continue; }
    const n = raw[i + 1];
    if (n === undefined) break;
    if (n === 'u') {
      const hex = raw.slice(i + 2, i + 6);
      if (!/^[0-9a-f]{4}$/i.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16)); i += 5; continue;
    }
    out += ({ n: '\n', t: '\t', r: '', b: '', f: '' } as Record<string, string>)[n] ?? n;
    i++;
  }
  return out;
}
