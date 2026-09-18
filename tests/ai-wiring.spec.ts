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
 await page.route('**/api/chat',route=>{state.prompt=route.request().postDataJSON().systemPrompt;return route.fulfill({json:{content:[{type:'text',text:state.reply}],stop_reason:'end_turn'}});});
 return state;
}
async function ask(page:Page,text='Make a task list'){await page.getByPlaceholder('Message Soma…').fill(text);await page.getByRole('button',{name:'Send',exact:true}).click();}
test('older AI page appends accepted tasks and preserves unrelated records',async({page})=>{const state=await setup(page);await page.goto('/ai');await ask(page);await page.getByRole('button',{name:'Accept Todos',exact:true}).click();await expect.poll(()=>state.rows.todos.length).toBe(2);expect(state.rows.todos.some(t=>t.id==='original')).toBe(true);expect(state.deletes).toBe(0);});
test('older AI page displays failed task saves instead of confirmation',async({page})=>{const state=await setup(page);state.failTask=true;await page.goto('/ai');await ask(page);await page.getByRole('button',{name:'Accept Todos',exact:true}).click();await expect(page.getByText(/Could not add all tasks/)).toBeVisible();expect(state.rows.todos).toHaveLength(1);expect(state.deletes).toBe(0);});
test('older AI gets fresh task context on every request and executes checked actions',async({page})=>{const state=await setup(page);state.reply='<soma-action>{"action":"complete_todo","todo_id":"original"}</soma-action>';await page.goto('/ai');state.rows.todos[0].text='Changed outside this chat';await ask(page,'Complete my task');await expect(page.getByText('✓ Completed: "Changed outside this chat"',{exact:true})).toBeVisible();expect(state.prompt).toContain('Changed outside this chat');expect(state.rows.todos[0].status).toBe('done');});
test('dashboard chat and AI history do not transfer into a second account',async({page})=>{const state=await setup(page);state.reply=JSON.stringify({reply:'Private reply for first account',blocks:[]});await page.goto('/dashboard');await page.getByLabel('What do you need to work on?').fill('First account private message');await page.getByRole('button',{name:'Send to Soma',exact:true}).click();await expect(page.getByRole('log')).toContainText('Private reply for first account');state.user={...user,id:'22222222-2222-4222-8222-222222222222',email:'second@example.com'};
 await page.evaluate(async user=>{
  // @ts-expect-error Vite browser module.
  const {supabase}=await import('/src/lib/supabase.ts');const {data:{session}}=await supabase.auth.getSession();await supabase.auth._notifyAllSubscribers('SIGNED_IN',{...session,user});
 },state.user);
 await expect(page.getByRole('log')).not.toContainText('First account private message');await expect(page.getByRole('log')).not.toContainText('Private reply for first account');
});
