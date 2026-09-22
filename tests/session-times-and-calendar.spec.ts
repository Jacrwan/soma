import { test, expect, type Page } from '@playwright/test';

/**
 * Recorded study time, and where it shows up.
 *
 * The calendar used to draw study time from `soma_blocks` in localStorage,
 * which only the focus timer ever wrote. A session added by hand never
 * appeared there, and deleting one left the block behind as a ghost. It now
 * draws from timer_sessions, the synced table every path writes.
 *
 * The block editor also showed a session's length but not when it ran, and
 * could only take a length when adding one.
 */

const account={id:'11111111-1111-4111-8111-111111111111',email:'student@example.com',aud:'authenticated',role:'authenticated',created_at:'2025-01-01T00:00:00Z',app_metadata:{},user_metadata:{}};
const day=new Date();
const date=`${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
const iso=(time:string)=>new Date(`${date}T${time}:00`).toISOString();

async function setup(page:Page,{todos=[] as Record<string,unknown>[]}={}){
 const state={tables:{
  subjects:[{id:'biology',user_id:account.id,name:'Biology',color:'#66bb6a',archived:false}],
  todos:[{id:'review',user_id:account.id,text:'Cell review',subject_id:'biology',status:'nothing',date,estimated_minutes:45},...todos],
  todo_sessions:[{id:'review-slot',user_id:account.id,todo_id:'review',date,start_time:iso('09:00'),end_time:iso('09:45')}],
  // One recorded session, with the clock times the timer writes.
  timer_sessions:[
   {id:'real',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Cell review',date,start_time:iso('08:00'),end_time:iso('08:25'),duration_seconds:25*60},
  ] as Record<string,unknown>[],
  active_timer:[] as Record<string,unknown>[],
 } as Record<string,Record<string,unknown>[]>};

 await page.addInitScript(a=>{localStorage.setItem('sb-soma-regression-auth-token',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:a}));},account);
 await page.route('https://soma-regression.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop()!;
  if(url.pathname.includes('/auth/v1/'))return route.fulfill({json:account});
  if(table==='settings')return route.fulfill({json:{data:{onboardingCompleted:true,theme:'light'}}});
  if(req.method()==='GET'){
   let rows=state.tables[table]??[];
   for(const key of ['id','todo_id','date']){const f=url.searchParams.get(key);if(f?.startsWith('eq.'))rows=rows.filter(r=>String(r[key])===f.slice(3));}
   return route.fulfill({json:req.headers().accept?.includes('vnd.pgrst.object')?rows[0]??null:rows});
  }
  if(req.method()==='POST'){
   const row=req.postDataJSON();const items=Array.isArray(row)?row:[row];
   for(const item of items){const cur=state.tables[table]??[];state.tables[table]=[...cur.filter(r=>table==='active_timer'?r.user_id!==item.user_id:r.id!==item.id),item];}
  }else if(req.method()==='PATCH'){
   const id=url.searchParams.get('id')?.slice(3);const body=req.postDataJSON();
   state.tables[table]=(state.tables[table]??[]).map(r=>r.id===id?{...r,...body}:r);
  }else if(req.method()==='DELETE'){
   const id=url.searchParams.get('id')?.slice(3);
   state.tables[table]=id?(state.tables[table]??[]).filter(r=>r.id!==id):[];
  }
  return route.fulfill({json:null});
 });
 await page.route('**/api/stripe',r=>r.fulfill({json:{status:'active'}}));
 await page.route('**/api/google-calendar-events',r=>r.fulfill({json:{events:[],incomplete:false}}));
 await page.route('**/api/google-calendar-connections',r=>r.fulfill({json:{connections:[]}}));
 return state;
}

const openEditor=async(page:Page)=>{
 await page.goto('/dashboard');
 await page.getByRole('button',{name:'Edit plan',exact:true}).click();
 await page.getByRole('button',{name:'Edit: Cell review',exact:true}).click();
 await expect(page.getByLabel('Past focus sessions')).toBeVisible();
};
const logs=(page:Page)=>page.getByLabel('Past focus sessions');

/** The week view is where study blocks and the all-day row are drawn. */
const openWeek=async(page:Page)=>{
 await page.goto('/calendar');
 await page.getByRole('button',{name:'Week',exact:true}).click();
};

test('a past session shows the clock times it ran, not just its length',async({page})=>{
 await setup(page);
 await openEditor(page);
 await expect(logs(page)).toContainText('25 min');
 // 08:00–08:25, rendered in the account's 12-hour default.
 await expect(logs(page)).toContainText('8:00 AM');
 await expect(logs(page)).toContainText('8:25 AM');
});

test('a session can be added as a start and end time',async({page})=>{
 const state=await setup(page);
 await openEditor(page);

 await page.getByRole('button',{name:/Forgot to start the timer/}).click();
 await page.getByRole('button',{name:'Start and end',exact:true}).click();
 await page.getByLabel('Start',{exact:true}).fill('14:00');
 await page.getByLabel('End',{exact:true}).fill('15:30');
 await expect(page.getByText('90 minutes.')).toBeVisible();
 await page.getByRole('button',{name:'Add session',exact:true}).click();

 await expect.poll(()=>state.tables.timer_sessions.length).toBe(2);
 const added=state.tables.timer_sessions.find(r=>r.id!=='real')!;
 expect(added.duration_seconds).toBe(90*60);
 expect(new Date(String(added.start_time)).getHours()).toBe(14);
 expect(new Date(String(added.end_time)).getHours()).toBe(15);
});

test('an end time before the start is refused rather than saved',async({page})=>{
 const state=await setup(page);
 await openEditor(page);
 await page.getByRole('button',{name:/Forgot to start the timer/}).click();
 await page.getByRole('button',{name:'Start and end',exact:true}).click();
 await page.getByLabel('Start',{exact:true}).fill('15:00');
 await page.getByLabel('End',{exact:true}).fill('14:00');
 await expect(page.getByText('End time must be later than start time.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Add session',exact:true})).toBeDisabled();
 expect(state.tables.timer_sessions).toHaveLength(1);
});

test('adding by length still works',async({page})=>{
 const state=await setup(page);
 await openEditor(page);
 await page.getByRole('button',{name:/Forgot to start the timer/}).click();
 await page.getByRole('spinbutton',{name:'Minutes',exact:true}).fill('40');
 await page.getByRole('button',{name:'Add session',exact:true}).click();
 await expect.poll(()=>state.tables.timer_sessions.length).toBe(2);
 expect(state.tables.timer_sessions.find(r=>r.id!=='real')!.duration_seconds).toBe(40*60);
});

test('correcting the length moves the end, not just the number',async({page})=>{
 const state=await setup(page);
 await openEditor(page);
 await page.getByRole('button',{name:/Edit the 25 minute session/}).click();
 await page.getByRole('spinbutton',{name:/Minutes studied on/}).fill('50');
 await page.getByRole('button',{name:'Save',exact:true}).click();

 await expect.poll(()=>state.tables.timer_sessions[0].duration_seconds).toBe(50*60);
 // The bug: duration alone was written, leaving a session that claimed 50
 // minutes while still ending at 8:25 — so the calendar drew the old span.
 const row=state.tables.timer_sessions[0];
 expect(new Date(String(row.end_time)).getTime()-new Date(String(row.start_time)).getTime()).toBe(50*60*1000);
});

test('typing a new length shows the end time it lands on',async({page})=>{
 await setup(page);
 await openEditor(page);
 await page.getByRole('button',{name:/Edit the 25 minute session/}).click();

 // The session ran 8:00-8:25. The end follows the length as it is typed, so
 // the change is visible before it is saved.
 const row=page.getByLabel('Past focus sessions').getByRole('listitem').filter({hasText:'min'}).first();
 await expect(row).toContainText('8:00 AM – 8:25 AM');
 await page.getByRole('spinbutton',{name:/Minutes studied on/}).fill('50');
 await expect(row).toContainText('8:00 AM – 8:50 AM');
 await page.getByRole('spinbutton',{name:/Minutes studied on/}).fill('90');
 await expect(row).toContainText('8:00 AM – 9:30 AM');
});

test('a session can be corrected by when it ran',async({page})=>{
 const state=await setup(page);
 await openEditor(page);
 await page.getByRole('button',{name:/Edit the 25 minute session/}).click();
 await page.getByRole('button',{name:'Start and end',exact:true}).click();
 await page.getByLabel(/Start time on/).fill('10:00');
 await page.getByLabel(/End time on/).fill('11:15');
 await expect(page.getByText('75 minutes.')).toBeVisible();
 await page.getByRole('button',{name:'Save',exact:true}).click();

 await expect.poll(()=>state.tables.timer_sessions[0].duration_seconds).toBe(75*60);
 const row=state.tables.timer_sessions[0];
 expect(new Date(String(row.start_time)).getHours()).toBe(10);
 expect(new Date(String(row.end_time)).getHours()).toBe(11);
});

test('a correction reaches the calendar',async({page})=>{
 await setup(page);
 await openEditor(page);
 await page.getByRole('button',{name:/Edit the 25 minute session/}).click();
 await page.getByRole('button',{name:'Start and end',exact:true}).click();
 await page.getByLabel(/Start time on/).fill('10:00');
 await page.getByLabel(/End time on/).fill('11:15');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(logs(page)).toContainText('75 minutes recorded on this task.');

 await openWeek(page);
 const block=page.getByText('Biology').first();
 await expect(block).toBeVisible();
 // Moved to 10:00, so it no longer sits where the 8:00 session was drawn.
 const top=await block.evaluate(el=>el.getBoundingClientRect().top);
 const eight=await page.getByText('8 AM').first().evaluate(el=>el.getBoundingClientRect().top);
 expect(top).toBeGreaterThan(eight);
});

test('a session added by hand appears on the calendar',async({page})=>{
 await setup(page);
 await openEditor(page);
 await page.getByRole('button',{name:/Forgot to start the timer/}).click();
 await page.getByRole('button',{name:'Start and end',exact:true}).click();
 await page.getByLabel('Start',{exact:true}).fill('14:00');
 await page.getByLabel('End',{exact:true}).fill('15:30');
 await page.getByRole('button',{name:'Add session',exact:true}).click();
 await expect(logs(page)).toContainText('115 minutes recorded on this task.');

 // The bug: this never reached the calendar, which only drew timer blocks.
 await openWeek(page);
 await expect(page.getByText('Biology').first()).toBeVisible();
});

test('deleting a past session takes it off the calendar too',async({page})=>{
 const state=await setup(page);
 await openWeek(page);
 await expect(page.getByText('Biology').first()).toBeVisible();

 await openEditor(page);
 page.once('dialog',d=>void d.accept());
 await page.getByRole('button',{name:/Delete the 25 minute session/}).click();
 await expect.poll(()=>state.tables.timer_sessions.length).toBe(0);

 // The ghost: the block stayed drawn after its session was gone.
 await openWeek(page);
 await expect(page.getByText('Biology')).toHaveCount(0);
});

/**
 * Resuming a task writes another timer_sessions row but only extends the
 * existing block, so one block covers several sessions. Drawing each session
 * separately turned one afternoon of study into a stack of slivers.
 */
test('a task resumed through the day draws once, not once per session',async({page})=>{
 const state=await setup(page);
 state.tables.timer_sessions=[
  {id:'s1',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Cell review',date,start_time:iso('13:00'),end_time:iso('13:30'),duration_seconds:30*60},
  {id:'s2',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Cell review',date,start_time:iso('13:40'),end_time:iso('14:10'),duration_seconds:30*60},
  {id:'s3',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Cell review',date,start_time:iso('14:20'),end_time:iso('15:00'),duration_seconds:40*60},
 ];
 // The block the timer extended across all three, naming only the first.
 await page.addInitScript(({start,end})=>{
  localStorage.setItem('soma_blocks',JSON.stringify([
   {id:'block-1',subjectId:'biology',task:'Cell review',startTime:start,endTime:end,source:'manual',timerSessionId:'s1'},
  ]));
 },{start:iso('13:00'),end:iso('15:00')});

 await openWeek(page);
 await expect(page.getByText('Biology').first()).toBeVisible();
 await expect(page.getByText('Biology')).toHaveCount(1);
});

/**
 * The shape a real week actually has: a planned block, and the sessions that
 * were worked inside it. Drawing the block and each session separately is how
 * one afternoon became three crowded slivers.
 */
test('a block and the sessions worked inside it draw as one',async({page})=>{
 const state=await setup(page);
 state.tables.timer_sessions=[
  {id:'s1',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Cell review',date,start_time:iso('14:19'),end_time:iso('14:35'),duration_seconds:16*60},
  {id:'s2',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Cell review',date,start_time:iso('14:35'),end_time:iso('15:47'),duration_seconds:72*60},
 ];
 // The planned block covering them, carrying no session id of its own.
 await page.addInitScript(({start,end})=>{
  localStorage.setItem('soma_blocks',JSON.stringify([
   {id:'plan-1',subjectId:'biology',task:'Cell review',startTime:start,endTime:end,source:'manual'},
  ]));
 },{start:iso('14:12'),end:iso('16:00')});

 await openWeek(page);
 await expect(page.getByText('Biology').first()).toBeVisible();
 await expect(page.getByText('Biology')).toHaveCount(1);
});

test('two sittings on the same subject at different times stay separate',async({page})=>{
 const state=await setup(page);
 state.tables.timer_sessions=[
  {id:'afternoon',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Reading',date,start_time:iso('14:00'),end_time:iso('15:00'),duration_seconds:60*60},
  {id:'evening',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Homework',date,start_time:iso('19:47'),end_time:iso('22:00'),duration_seconds:133*60},
 ];
 await openWeek(page);
 await expect(page.getByText('Biology')).toHaveCount(2);
});

test('a failed session load leaves the calendar drawn, not emptied',async({page})=>{
 const state=await setup(page);
 await page.addInitScript(({start,end})=>{
  localStorage.setItem('soma_blocks',JSON.stringify([
   {id:'block-1',subjectId:'biology',task:'Cell review',startTime:start,endTime:end,source:'manual',timerSessionId:'real'},
  ]));
 },{start:iso('08:00'),end:iso('08:25')});
 // Suppressing a block because its session is missing must not happen when
 // the sessions simply could not be read.
 state.tables.timer_sessions=[];
 await page.route('https://soma-regression.supabase.co/rest/v1/timer_sessions**',r=>r.fulfill({status:500,json:{message:'unavailable'}}));

 await openWeek(page);
 await expect(page.getByText('Biology').first()).toBeVisible();
});

test('a deadline imported from a course site shows in the all-day row',async({page})=>{
 await setup(page,{todos:[
  {id:'lab3',user_id:account.id,text:'Lab 3',subject_id:'biology',status:'nothing',date,due_date:date},
 ]});
 await openWeek(page);
 // The chip itself, and again inside the panel it opens on hover.
 await expect(page.getByText('Lab 3').first()).toBeVisible();
 await expect(page.getByText('Lab 3')).toHaveCount(2);
});
