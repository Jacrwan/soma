import { test, expect, type Page } from '@playwright/test';
const account={id:'11111111-1111-4111-8111-111111111111',email:'student@example.com',aud:'authenticated',role:'authenticated',created_at:'2025-01-01T00:00:00Z',app_metadata:{},user_metadata:{}};
const day=new Date();
const date=`${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
const iso=(time:string)=>new Date(`${date}T${time}:00`).toISOString();
async function setup(page:Page){
 const state={failTable:'',failReads:false,writes:0,prompt:'',calendarFail:false,tables:{
  subjects:[{id:'biology',user_id:account.id,name:'Biology',color:'#66bb6a',archived:false}],
  todos:[{id:'review',user_id:account.id,text:'Cell review',subject_id:'biology',status:'nothing',date,estimated_minutes:45},{id:'lab',user_id:account.id,text:'Lab report',subject_id:'biology',status:'nothing',date,estimated_minutes:30}],
  todo_sessions:[{id:'review-slot',user_id:account.id,todo_id:'review',date,start_time:iso('09:00'),end_time:iso('09:45')},{id:'lab-slot',user_id:account.id,todo_id:'lab',date,start_time:iso('16:00'),end_time:iso('16:30')}],
  timer_sessions:[] as Record<string,unknown>[],active_timer:[] as Record<string,unknown>[]
 } as Record<string,Record<string,unknown>[]>};
 await page.addInitScript(account=>{localStorage.setItem('sb-soma-regression-auth-token',JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:account}));},account);
 await page.route('https://soma-regression.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop()!;
  if(url.pathname.includes('/auth/v1/'))return route.fulfill({json:account});
  if(table==='settings')return route.fulfill({json:{data:{onboardingCompleted:true,theme:'light'}}});
  if(req.method()==='GET'){
   if(state.failReads && table==='todo_sessions')return route.fulfill({status:500,json:{message:'Unavailable'}});
   let rows=state.tables[table]??[];
   for(const key of ['id','todo_id','date']){const filter=url.searchParams.get(key);if(filter?.startsWith('eq.'))rows=rows.filter(r=>String(r[key])===filter.slice(3));}
   return route.fulfill({json:req.headers().accept?.includes('vnd.pgrst.object') ? rows[0]??null : rows});
  }
  // Counts writes to the user's plan only. The dashboard also mirrors the
  // conversation into a chat session, which is not plan data — the invariant
  // these tests protect is that a proposal changes nothing until accepted.
  if(table!=='chat_sessions')state.writes++;
  if(state.failTable===table)return route.fulfill({status:500,json:{message:'Database unavailable'}});
  if(req.method()==='POST'){
   const row=req.postDataJSON();const items=Array.isArray(row)?row:[row];
   for(const item of items){const current=state.tables[table]??[];state.tables[table]=[...current.filter(r=>table==='active_timer' ? r.user_id!==item.user_id : r.id!==item.id),item];}
  }else if(req.method()==='DELETE'){const id=url.searchParams.get('id')?.slice(3);state.tables[table]=id ? (state.tables[table]??[]).filter(r=>r.id!==id) : [];}
  return route.fulfill({json:null});
 });
 await page.route('**/api/stripe',route=>route.fulfill({json:{status:'active'}}));
 await page.route('**/api/google-calendar-events',route=>route.fulfill({json:{events:[],incomplete:state.calendarFail}}));
 await page.route('**/api/chat',route=>{state.prompt=route.request().postDataJSON().systemPrompt;return route.fulfill({json:{content:[{text:JSON.stringify({reply:'Here is a proposed study session.',blocks:[{title:'New revision',subject:'Biology',start:'12:00',end:'12:30'}]})}]}});});
 return state;
}

test('live progress, completion and undo persist across reload',async({page})=>{
 const state=await setup(page);await page.goto('/dashboard');
 await expect(page.getByLabel('Day progress')).toContainText('75 min planned');
 await expect(page.getByText('Sample data')).toHaveCount(0);
 await page.getByRole('button',{name:'Complete: Cell review',exact:true}).click();
 await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','60');
 expect(state.tables.todos.find(t=>t.id==='review')?.status).toBe('done');
 await page.reload();await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','60');
 await page.getByRole('button',{name:'Edit plan',exact:true}).click();await page.getByRole('button',{name:'Edit: Cell review',exact:true}).click();
 await page.getByLabel('Status',{exact:true}).selectOption('Planned');await page.getByRole('button',{name:'Save block',exact:true}).click();
 await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','0');
 await page.reload();await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','0');
});

test('manual overlapping block persists with subject and revised allocation',async({page})=>{
 const state=await setup(page);await page.goto('/dashboard');await page.getByRole('button',{name:'Edit plan',exact:true}).click();await page.getByRole('button',{name:'+ Add block',exact:true}).click();
 await page.getByLabel('Title',{exact:true}).fill('Extra revision');await page.getByLabel('Subject',{exact:true}).selectOption('Biology');await page.getByLabel('Start time',{exact:true}).fill('09:15');await page.getByLabel('End time',{exact:true}).fill('09:45');
 await expect(page.getByText('Overlaps Cell review.')).toBeVisible();await page.getByRole('button',{name:'Save block',exact:true}).click();
 await expect(page.getByLabel('Day progress')).toContainText('105 min planned');expect(state.tables.todo_sessions).toHaveLength(3);
 await page.reload();await expect(page.getByRole('heading',{name:'Extra revision',exact:true})).toBeVisible();
});

test('failed session save compensates new task and leaves editor retryable',async({page})=>{
 const state=await setup(page);await page.goto('/dashboard');await page.getByRole('button',{name:'Edit plan',exact:true}).click();await page.getByRole('button',{name:'+ Add block',exact:true}).click();
 await page.getByLabel('Title',{exact:true}).fill('Failed block');await page.getByLabel('Subject',{exact:true}).selectOption('Biology');state.failTable='todo_sessions';await page.getByRole('button',{name:'Save block',exact:true}).click();
 await expect(page.getByLabel('Block editor').getByRole('alert')).toContainText('Database unavailable');expect(state.tables.todos).toHaveLength(2);expect(state.tables.todo_sessions).toHaveLength(2);
 state.failTable='';await page.getByRole('button',{name:'Save block',exact:true}).click();await expect(page.getByRole('heading',{name:'Failed block',exact:true})).toBeVisible();
});

test('AI receives fresh data, proposes without writing and saves only on acceptance',async({page})=>{
 const state=await setup(page);await page.goto('/dashboard');await expect(page.getByLabel('Day progress')).toBeVisible();
 await page.getByLabel('Next seven days').getByRole('button').nth(1).click();const before=state.writes;
 await page.getByLabel('What do you need to work on?').fill('Schedule biology revision tomorrow');await page.getByRole('button',{name:'Send to Soma',exact:true}).click();
 await expect(page.getByRole('button',{name:'Accept',exact:true})).toBeVisible();expect(state.prompt).toContain('Cell review');expect(state.writes).toBe(before);
 await page.getByRole('button',{name:'Accept',exact:true}).click();await expect(page.getByRole('button',{name:'Accept',exact:true})).toHaveCount(0);expect(state.tables.todos.some(t=>t.text==='New revision')).toBe(true);
});

test('stale AI acceptance rechecks calendar and blocks conflicting saves',async({page})=>{
 const state=await setup(page);await page.goto('/dashboard');await page.getByLabel('Next seven days').getByRole('button').nth(1).click();await page.getByLabel('What do you need to work on?').fill('Plan revision');await page.getByRole('button',{name:'Send to Soma',exact:true}).click();await expect(page.getByRole('button',{name:'Accept',exact:true})).toBeVisible();
 state.calendarFail=true;const before=state.writes;await page.getByRole('button',{name:'Accept',exact:true}).click();await expect(page.getByRole('alert').first()).toContainText('Calendar could not be fully loaded');expect(state.writes).toBe(before);
});

test('focus save failure keeps paused timer for retry without duplicate history',async({page})=>{
 const state=await setup(page);await page.goto('/dashboard');await page.getByRole('button',{name:'Start focus: Cell review',exact:true}).click();await expect(page.getByLabel('Focus timer')).toContainText('Cell review');state.failTable='timer_sessions';await page.getByRole('button',{name:'Stop & save',exact:true}).click();await expect(page.getByLabel('Focus timer').getByRole('alert')).toContainText('press Stop to retry');expect(state.tables.timer_sessions).toHaveLength(0);
 state.failTable='';await page.getByRole('button',{name:'Stop & save',exact:true}).click();await expect(page.getByLabel('Focus timer')).toContainText('Ready when you are');expect(state.tables.timer_sessions).toHaveLength(1);expect(state.tables.todo_sessions[0].start_time).toBe(iso('09:00'));
});

test('load failures never show an empty account and mobile has no horizontal overflow',async({page})=>{
 const state=await setup(page);state.failReads=true;await page.goto('/dashboard');await expect(page.getByRole('alert')).toContainText('Could not load todo sessions');state.failReads=false;await page.getByRole('button',{name:'Retry dashboard'}).click();await expect(page.getByLabel('Day progress')).toBeVisible();await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'/tmp/soma-live-mobile.png',fullPage:true});
});

test('desktop integrated dashboard uses text branding and live plan',async({page})=>{
 await setup(page);await page.setViewportSize({width:1440,height:900});await page.goto('/dashboard');await expect(page.getByLabel('Day progress')).toBeVisible();await expect(page.getByText('study with intention',{exact:true})).toBeVisible();await page.screenshot({path:'/tmp/soma-live-desktop.png',fullPage:true});
});

test('reopening an unscheduled task does not create a time slot',async({page})=>{
 const state=await setup(page);state.tables.todos.push({id:'unscheduled',user_id:account.id,text:'Email professor',subject_id:'biology',status:'done',date});await page.goto('/dashboard');await page.getByRole('button',{name:'Edit plan',exact:true}).click();await page.getByRole('button',{name:'Edit: Email professor',exact:true}).click();await expect(page.getByRole('checkbox',{name:'Schedule a time'})).not.toBeChecked();await page.getByLabel('Status',{exact:true}).selectOption('Planned');await page.getByRole('button',{name:'Save block',exact:true}).click();await expect(page.getByLabel('Block editor')).toHaveCount(0);expect(state.tables.todo_sessions).toHaveLength(2);expect(state.tables.todos.find(t=>t.id==='unscheduled')?.status).toBe('nothing');
});

test('recovered timer retries after history saved but active-record deletion failed',async({page})=>{
 const state=await setup(page);await page.goto('/dashboard');await page.getByRole('button',{name:'Start focus: Cell review',exact:true}).click();await expect(page.getByLabel('Focus timer')).toContainText('Cell review');
 // Fail only cleanup after the history write, as with a lost network response.
 await page.route('**/rest/v1/active_timer?**',async route=>{if(route.request().method()==='DELETE')return route.fulfill({status:500,json:{message:'Cleanup unavailable'}});return route.fallback();});
 await page.getByRole('button',{name:'Stop & save',exact:true}).click();await expect(page.getByLabel('Focus timer').getByRole('alert')).toBeVisible();expect(state.tables.timer_sessions).toHaveLength(1);const id=state.tables.timer_sessions[0].id;
 await page.unroute('**/rest/v1/active_timer?**');await page.reload();await expect(page.getByRole('button',{name:'Stop & save',exact:true})).toBeVisible();await page.getByRole('button',{name:'Stop & save',exact:true}).click();await expect(page.getByLabel('Focus timer')).toContainText('Ready when you are');expect(state.tables.timer_sessions).toHaveLength(1);expect(state.tables.timer_sessions[0].id).toBe(id);
});

test('malformed AI output never writes a task',async({page})=>{
 const state=await setup(page);await page.route('**/api/chat',route=>route.fulfill({json:{content:[{text:'not valid JSON'}]}}));await page.goto('/dashboard');await expect(page.getByLabel('Day progress')).toBeVisible();const before=state.writes;await page.getByLabel('What do you need to work on?').fill('Plan revision');await page.getByRole('button',{name:'Send to Soma',exact:true}).click();await expect(page.getByRole('log')).toContainText('Nothing was saved');expect(state.writes).toBe(before);
});

test('live dashboard requires authentication',async({page})=>{
 await page.route('https://soma-regression.supabase.co/**',route=>route.fulfill({json:null}));await page.goto('/dashboard');await expect(page).toHaveURL(/\/login$/);await expect(page.getByLabel('Day progress')).toHaveCount(0);
});
