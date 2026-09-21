import { test, expect, type Page } from '@playwright/test';

// "add it as unscheduled" always came back as "One suggestion came back
// incomplete": start and end were both required, so a block with no time could
// not be proposed at all, and the prompt never mentioned the option existed.
const account={id:'11111111-1111-4111-8111-111111111111',email:'s@e.com',aud:'authenticated',role:'authenticated',created_at:'2025-01-01T00:00:00Z',app_metadata:{},user_metadata:{}};
const key=(d:Date)=>{const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;};
const TODAY=key(new Date());

async function setup(page:Page,reply:unknown){
 const st={todoWrites:[] as Record<string,unknown>[],sessionWrites:[] as Record<string,unknown>[]};
 await page.addInitScript(a=>{localStorage.setItem('sb-soma-regression-auth-token',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:a}));},account);
 await page.route('https://soma-regression.supabase.co/**',route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop()!;
  if(url.pathname.includes('/auth/v1/'))return route.fulfill({json:account});
  if(table==='settings')return route.fulfill({json:{data:{onboardingCompleted:true,theme:'light'}}});
  if(req.method()!=='GET'){
   const b=req.postDataJSON();
   if(table==='todos')st.todoWrites.push(...(Array.isArray(b)?b:[b]));
   if(table==='todo_sessions')st.sessionWrites.push(...(Array.isArray(b)?b:[b]));
   return route.fulfill({json:null});
  }
  const rows=table==='subjects'?[{id:'ruf',user_id:account.id,name:'Personal',color:'#ef5350',archived:false}]:[];
  return route.fulfill({json:req.headers().accept?.includes('vnd.pgrst.object')?rows[0]??null:rows});
 });
 await page.route('**/api/stripe',r=>r.fulfill({json:{status:'active'}}));
 await page.route('**/api/google-calendar-events',r=>r.fulfill({json:{events:[],incomplete:false}}));
 await page.route('**/api/chat',r=>r.fulfill({json:{content:[{text:JSON.stringify(reply)}]}}));
 return st;
}
async function ask(page:Page,text:string){
 await page.getByLabel('What do you need to work on?').fill(text);
 await page.getByRole('button',{name:'Send to Soma'}).click();
}

test('a block with no start or end is proposed as unscheduled', async ({ page }) => {
 const st=await setup(page,{reply:'Added it.',blocks:[{title:'RUF Fall Retreat signup',subject:'Personal',date:TODAY}]});
 await page.goto('/dashboard');
 await ask(page,'remind me to sign up for RUF Fall Retreat, no particular time');
 await expect(page.getByRole('log')).toContainText('Added it.');
 await expect(page.getByRole('log')).not.toContainText('came back incomplete');
 await expect(page.getByRole('log')).toContainText('Review the proposed blocks');

 await page.getByRole('button',{name:'Accept',exact:true}).click();
 await expect.poll(()=>st.todoWrites.length).toBeGreaterThan(0);
 expect(st.todoWrites[0].text).toBe('RUF Fall Retreat signup');
 // Unscheduled means no slot is written at all.
 expect(st.sessionWrites).toHaveLength(0);
});

test('a block given only a start is refused with a reason, not a shrug', async ({ page }) => {
 await setup(page,{reply:'Added it.',blocks:[{title:'Half a time',subject:'Personal',date:TODAY,start:'14:00'}]});
 await page.goto('/dashboard');
 await ask(page,'add something');
 await expect(page.getByRole('log')).toContainText('give both a start and an end');
 await expect(page.getByRole('log')).not.toContainText('came back incomplete');
});

test('a genuinely malformed block is still reported as incomplete', async ({ page }) => {
 await setup(page,{reply:'Added it.',blocks:[{subject:'Personal',date:TODAY,start:'14:00',end:'15:00'}]});
 await page.goto('/dashboard');
 await ask(page,'add something');
 await expect(page.getByRole('log')).toContainText('came back incomplete');
});
