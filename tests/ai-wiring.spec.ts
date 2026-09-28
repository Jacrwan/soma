import {test,expect,type Page} from '@playwright/test';
const user={id:'11111111-1111-4111-8111-111111111111',email:'student@example.com',aud:'authenticated',role:'authenticated',created_at:'2025-01-01T00:00:00Z',app_metadata:{},user_metadata:{}};
const now=new Date();const date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
async function setup(page:Page){
 const state={user:{...user},reply:'<todos>[{"text":"New revision","subjectId":"biology"}]</todos>',prompt:'',failTask:false,deletes:0,rows:{subjects:[{id:'biology',user_id:user.id,name:'Biology',color:'#66bb6a'}],todos:[{id:'original',user_id:user.id,text:'Existing task',status:'nothing',date,subject_id:'biology'}],todo_sessions:[],timer_sessions:[],chat_sessions:[],documents:[]} as Record<string,Record<string,unknown>[]>};
 await page.addInitScript(user=>localStorage.setItem('sb-soma-regression-auth-token',JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user})),user);
 await page.route('https://soma-regression.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop()!;
  if(url.pathname.includes('/auth/'))return route.fulfill({json:state.user});
  if(table==='settings')return route.fulfill({json:{data:{onboardingCompleted:true,theme:'light'}}});
  if(req.method()==='POST'){
   if(table==='todos' && state.failTask)return route.fulfill({status:500,json:{message:'Task database unavailable'}});
   const body=req.postDataJSON();const rows=Array.isArray(body)?body:[body];for(const row of rows)state.rows[table]=[...(state.rows[table]??[]).filter(r=>r.id!==row.id),row];return route.fulfill({json:null});
  }
  if(req.method()==='DELETE'){state.deletes++;const id=url.searchParams.get('id')?.slice(3);const removed=(state.rows[table]??[]).filter(r=>r.id===id);state.rows[table]=(state.rows[table]??[]).filter(r=>r.id!==id);return route.fulfill({json:removed});}
  let rows=state.rows[table]??[];for(const key of ['user_id','id','todo_id','date']){const value=url.searchParams.get(key);if(value?.startsWith('eq.'))rows=rows.filter(r=>r[key]===value.slice(3));}
  return route.fulfill({json:req.headers().accept?.includes('vnd.pgrst.object') ? rows[0]??null : rows});
 });
 await page.route('**/api/stripe',route=>route.fulfill({json:{status:'active'}}));
 await page.route('**/api/google-calendar-events',route=>route.fulfill({json:{events:[],incomplete:false}}));
 await page.route('**/api/chat',route=>{state.prompt=(b=>`${b.systemPrompt}\n${b.context??""}`)(route.request().postDataJSON());return route.fulfill({json:{content:[{type:'text',text:state.reply}],stop_reason:'end_turn'}});});
 return state;
}
async function ask(page:Page,text='Make a task list'){await page.getByPlaceholder('Message Soma…').fill(text);await page.getByRole('button',{name:'Send',exact:true}).click();}
test('AI page proposes tasks and saves them only when accepted, keeping unrelated records',async({page})=>{const state=await setup(page);state.reply=JSON.stringify({reply:'Added a revision task.',blocks:[{title:'New revision',subject:'Biology',date,minutes:40,anytime:true}]});await page.goto('/ai');await ask(page);await expect(page.getByRole('button',{name:'Accept: New revision'})).toBeVisible();expect(state.rows.todos).toHaveLength(1);await page.getByRole('button',{name:'Accept: New revision'}).click();await expect.poll(()=>state.rows.todos.length).toBe(2);await expect(page.getByText('Added',{exact:true})).toBeVisible();const added=state.rows.todos.find(t=>t.text==='New revision');expect(added?.estimated_minutes).toBe(40);expect(state.rows.todos.some(t=>t.id==='original')).toBe(true);expect(state.deletes).toBe(0);});
test('AI page shows a failed save instead of confirming it',async({page})=>{const state=await setup(page);state.failTask=true;state.reply=JSON.stringify({reply:'Added a revision task.',blocks:[{title:'New revision',subject:'Biology',date}]});await page.goto('/ai');await ask(page);await page.getByRole('button',{name:'Accept: New revision'}).click();await expect(page.getByRole('alert')).toContainText('New revision');await expect(page.getByRole('button',{name:'Accept: New revision'})).toBeVisible();expect(state.rows.todos).toHaveLength(1);expect(state.deletes).toBe(0);});
test('AI page gets fresh task context on every request and proposes checked changes',async({page})=>{const state=await setup(page);state.reply=JSON.stringify({reply:'Nice work.',changes:[{action:'complete',id:'original'}]});await page.goto('/ai');state.rows.todos[0].text='Changed outside this chat';await ask(page,'I finished my task');await expect(page.getByRole('button',{name:'Accept: Changed outside this chat'})).toBeVisible();expect(state.prompt).toContain('Changed outside this chat');expect(state.rows.todos[0].status).toBe('nothing');await page.getByRole('button',{name:'Accept: Changed outside this chat'}).click();await expect.poll(()=>state.rows.todos[0].status).toBe('done');});
test('a proposal made on the AI page can be accepted from the dashboard',async({page})=>{const state=await setup(page);state.reply=JSON.stringify({reply:'Added it.',blocks:[{title:'New revision',subject:'Biology',date,minutes:30,anytime:true}]});await page.goto('/ai');await ask(page);await expect(page.getByRole('button',{name:'Accept: New revision'})).toBeVisible();await page.getByRole('link',{name:'Dashboard'}).or(page.getByRole('button',{name:'Dashboard'})).first().click();await expect(page.getByRole('heading',{name:'New revision',exact:true})).toBeVisible();await page.getByRole('button',{name:'Accept',exact:true}).click();await expect.poll(()=>state.rows.todos.length).toBe(2);await page.getByRole('button',{name:'AI'}).first().click();await expect(page.getByText('Added',{exact:true})).toBeVisible();});
test('dashboard chat and AI history do not transfer into a second account',async({page})=>{const state=await setup(page);state.reply=JSON.stringify({reply:'Private reply for first account',blocks:[]});await page.goto('/dashboard');await page.getByLabel('What do you need to work on?').fill('First account private message');await page.getByRole('button',{name:'Send to Soma',exact:true}).click();await expect(page.getByRole('log')).toContainText('Private reply for first account');state.user={...user,id:'22222222-2222-4222-8222-222222222222',email:'second@example.com'};
 await page.evaluate(async user=>{
  // @ts-expect-error Vite browser module.
  const {supabase}=await import('/src/lib/supabase.ts');const {data:{session}}=await supabase.auth.getSession();await supabase.auth._notifyAllSubscribers('SIGNED_IN',{...session,user});
 },state.user);
 await expect(page.getByRole('log')).not.toContainText('First account private message');await expect(page.getByRole('log')).not.toContainText('Private reply for first account');
});
for(const surface of ['dashboard','ai'])test(`${surface} saves and lists memory without model calls or task writes`,async({page})=>{
 const state=await setup(page);let entries:{key:string;content:string}[]=[],requests=0,modelCalls=0;
 await page.route('**/api/chat',route=>{modelCalls++;return route.fulfill({status:500,json:{error:'should_not_call_model'}});});
 await page.route('**/api/memory',route=>{requests++;expect(route.request().headers().authorization).toBe('Bearer test-token');if(route.request().method()==='POST'){const body=route.request().postDataJSON();entries=[{key:body.key,content:body.content}];}return route.fulfill({json:{revision:requests,enabled:true,entries}});});
 await page.goto(`/${surface}`);
 const send=async(text:string)=>{if(surface==='ai')await ask(page,text);else{await page.getByLabel('What do you need to work on?').fill(text);await page.getByRole('button',{name:'Send to Soma',exact:true}).click();}};
 await send('/remember study-time: Morning study works best');await expect(page.getByText('Saved memory: study-time. You can update it using the same key.',{exact:true})).toBeVisible();
 await page.reload();await send('/memories');await expect(page.getByText(/^Memory is on\.\s*study-time: Morning study works best$/)).toBeVisible();expect(modelCalls).toBe(0);expect(state.rows.todos).toHaveLength(1);expect(state.deletes).toBe(0);
});

test('Soma is told how long this student really takes, to size new work',async({page})=>{
 const state=await setup(page);state.reply=JSON.stringify({reply:'ok',blocks:[]});
 state.rows.todos.push({id:'lab',user_id:user.id,text:'Lab report 2',status:'done',date,subject_id:'biology',estimated_minutes:60});
 state.rows.timer_sessions.push(
  {id:'t1',user_id:user.id,subject_id:'biology',subject_name:'Biology',task_text:'Lab report 2',date,start_time:`${date}T14:00:00Z`,end_time:`${date}T15:00:00Z`,duration_seconds:3600},
  {id:'t2',user_id:user.id,subject_id:'biology',subject_name:'Biology',task_text:'Lab report 2',date,start_time:`${date}T16:00:00Z`,end_time:`${date}T16:30:00Z`,duration_seconds:1800},
 );
 await page.goto('/ai');await ask(page,'I need to write a lab report');await expect(page.getByText('ok',{exact:true})).toBeVisible();
 const ctx=JSON.parse(state.prompt.match(/CONTEXT[^:]*: (\{[^\n]*\})/)![1]);
 expect(ctx.history.tasks).toContainEqual({title:'Lab report 2',s:'Biology',did:90,est:60});
 expect(ctx.history.subjects[0]).toMatchObject({s:'Biology',avgSession:45});
 expect(state.prompt).toContain('ESTIMATING');
});

test('Soma only schedules inside the study hours set in Settings',async({page})=>{
 const state=await setup(page);
 const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
 const d=`${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;
 state.reply=JSON.stringify({reply:'Early start.',blocks:[{title:'Dawn review',subject:'Biology',date:d,start:'06:00',end:'07:00'}]});
 await page.goto('/ai');await ask(page,'plan an early review tomorrow');
 await expect(page.getByText(/outside your study hours \(8:00 AM–11:00 PM\)/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Accept: Dawn review'})).toHaveCount(0);
 const ctx=JSON.parse(state.prompt.match(/CONTEXT[^:]*: (\{[^\n]*\})/)![1]);
 expect(ctx.free[1].slots).toEqual(['08:00–23:00']);
});
