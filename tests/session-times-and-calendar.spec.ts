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
/** Recorded study time on the week view; the plan's own blocks are drawn beside it. */
const recorded=(page:Page)=>page.locator('[data-source=recorded]');


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
 // 3 PM to 2 PM would be 23 hours: a typo, not an overnight session.
 await expect(page.getByText(/End time must be later than start time/)).toBeVisible();
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
 const block=recorded(page).first();
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
 await expect(recorded(page).first()).toBeVisible();
});

test('deleting a past session takes it off the calendar too',async({page})=>{
 const state=await setup(page);
 await openWeek(page);
 await expect(recorded(page).first()).toBeVisible();

 await openEditor(page);
 page.once('dialog',d=>void d.accept());
 await page.getByRole('button',{name:/Delete the 25 minute session/}).click();
 await expect.poll(()=>state.tables.timer_sessions.length).toBe(0);

 // The ghost: the block stayed drawn after its session was gone.
 await openWeek(page);
 await expect(recorded(page)).toHaveCount(0);
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
 await expect(recorded(page).first()).toBeVisible();
 await expect(recorded(page)).toHaveCount(1);
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
 await expect(recorded(page).first()).toBeVisible();
 await expect(recorded(page)).toHaveCount(1);
});

test('two sittings on the same subject at different times stay separate',async({page})=>{
 const state=await setup(page);
 state.tables.timer_sessions=[
  {id:'afternoon',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Reading',date,start_time:iso('14:00'),end_time:iso('15:00'),duration_seconds:60*60},
  {id:'evening',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Homework',date,start_time:iso('19:47'),end_time:iso('22:00'),duration_seconds:133*60},
 ];
 await openWeek(page);
 await expect(recorded(page)).toHaveCount(2);
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
 await expect(recorded(page).first()).toBeVisible();
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

// Reported: deleting a study block on the calendar left it drawn (now
// unclickable) and still listed under Past sessions. Delete only removed the
// calendar's local copy, not the recorded session behind it.
test('deleting study time on the calendar removes the session everywhere',async({page})=>{
 const state=await setup(page);
 // The timer's own local copy of the session, as the real app keeps.
 await page.addInitScript(({start,end})=>{localStorage.setItem('soma_blocks',JSON.stringify([{id:'copy',subjectId:'biology',task:'Cell review',startTime:start,endTime:end,source:'manual',timerSessionId:'real'}]));},{start:iso('08:00'),end:iso('08:25')});
 await openWeek(page);
 await recorded(page).first().click();
 await expect(page.getByRole('dialog')).toContainText('Studied');
 await expect(page.getByRole('dialog')).toContainText('25m');
 page.once('dialog',d=>void d.accept());
 await page.getByRole('button',{name:'Delete',exact:true}).click();
 await expect.poll(()=>state.tables.timer_sessions.length).toBe(0);
 await expect(recorded(page)).toHaveCount(0);

 await openEditor(page);
 await expect(logs(page)).toContainText('No study time recorded on this task yet.');
});

test('a block drawn only from recorded sessions can be opened and deleted',async({page})=>{
 const state=await setup(page);
 await openWeek(page);
 await recorded(page).first().click();
 page.once('dialog',d=>void d.accept());
 await page.getByRole('button',{name:'Delete',exact:true}).click();
 await expect.poll(()=>state.tables.timer_sessions.length).toBe(0);
});

// Reported: studying 10:36 PM to 1:41 AM showed as a 30-minute stub, nothing
// after midnight, and the details showed another block's times.
test('a session past midnight is drawn on both days, and its details show when it ran',async({page})=>{
 // Set before signing in, so the test session's expiry follows the same clock.
 await page.clock.install({time:new Date(`${date}T12:00:00`)});
 const state=await setup(page);
 const next=new Date(day);next.setDate(next.getDate()+1);
 const nextDate=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;
 state.tables.timer_sessions=[{id:'late',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Cell review',date,start_time:iso('22:36'),end_time:new Date(`${nextDate}T01:41:00`).toISOString(),duration_seconds:177*60}];
 await openWeek(page);
 const blocks=recorded(page);
 // Sunday 10:36 PM–midnight is about 84 minutes; Monday midnight–1:41 AM about 101.
 const heights=await blocks.evaluateAll(els=>els.map(e=>Math.round(e.getBoundingClientRect().height)));
 if(day.getDay()!==6){
  expect(heights).toHaveLength(2);
  for(const h of heights)expect(h).toBeGreaterThan(60);
 }
 await blocks.first().click();
 await expect(page.getByRole('dialog')).toContainText('10:36 PM');
 await expect(page.getByRole('dialog')).toContainText('1:41 AM');
 await expect(page.getByRole('dialog')).toContainText('2h 57m');
});

// The calendar shows past sessions only: a finished block from the plan
// appears; upcoming or unfinished planned blocks don't.
test('a finished past block from the plan shows on the calendar; upcoming ones do not',async({page})=>{
 // Set before signing in, so the test session's expiry follows the same clock.
 await page.clock.install({time:new Date(`${date}T12:00:00`)});
 const state=await setup(page);
 state.tables.todos.push(
  {id:'done-read',user_id:account.id,text:'Physics Reading: 4.6 - 4.9',subject_id:'biology',status:'done',date},
  {id:'later',user_id:account.id,text:'Later reading',subject_id:'biology',status:'nothing',date},
 );
 state.tables.todo_sessions.push(
  {id:'s-done',user_id:account.id,todo_id:'done-read',date,start_time:iso('10:40'),end_time:iso('11:45')},
  {id:'s-later',user_id:account.id,todo_id:'later',date,start_time:iso('15:00'),end_time:iso('16:00')},
 );
 await openWeek(page);
 const past=page.locator('[data-source=plan]',{hasText:'Physics Reading: 4.6 - 4.9'});
 await expect(past).toBeVisible();
 await expect(page.locator('[data-source=plan]',{hasText:'Later reading'})).toHaveCount(0);
 // Planned 9:00–9:45 but not done: not a past session.
 await expect(page.locator('[data-source=plan]',{hasText:'Cell review'})).toHaveCount(0);
 await past.click();
 await expect(page.getByRole('dialog')).toContainText('A finished session from your plan');
});

test('time recorded inside a finished block is that block, not a second one',async({page})=>{
 // Set before signing in, so the test session's expiry follows the same clock.
 await page.clock.install({time:new Date(`${date}T12:00:00`)});
 const state=await setup(page);
 state.tables.todos[0].status='done';
 // Studied 9:05–9:40 inside the finished 9:00–9:45 Cell review block.
 state.tables.timer_sessions=[{id:'inside',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Cell review',date,start_time:iso('09:05'),end_time:iso('09:40'),duration_seconds:35*60}];
 await openWeek(page);
 await expect(page.locator('[data-source=plan]',{hasText:'Cell review'})).toBeVisible();
 await expect(recorded(page)).toHaveCount(0);
});

// Reported: with a finished 10:30–11:45 PM block, the sessions around it
// (9:51 PM, and 10:36 PM running to 1:41 AM) vanished: recorded time that
// touched the block was hidden entirely. They're now one stretch.
test('a finished block and the sessions around it draw as one stretch, past midnight too',async({page})=>{
 // After the block ends, so it counts as a finished past session. Set before
 // signing in, so the test session's expiry follows the same clock.
 await page.clock.install({time:new Date(`${date}T23:50:00`)});
 const state=await setup(page);
 const next=new Date(day);next.setDate(next.getDate()+1);
 const nextDate=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;
 state.tables.todos.push({id:'read',user_id:account.id,text:'Physics reading: 4.2–4.6',subject_id:'biology',status:'done',date});
 state.tables.todo_sessions.push({id:'s-read',user_id:account.id,todo_id:'read',date,start_time:iso('22:30'),end_time:iso('23:45')});
 state.tables.timer_sessions=[
  {id:'early',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Physics reading: 4.2–4.6',date,start_time:iso('21:51'),end_time:iso('22:36'),duration_seconds:45*60},
  {id:'late',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Physics reading: 4.2–4.6',date,start_time:iso('22:36'),end_time:new Date(`${nextDate}T01:41:00`).toISOString(),duration_seconds:177*60},
 ];
 await openWeek(page);
 if(day.getDay()===6)return;   // the next day is in another week
 const parts=page.locator('[data-source=plan]',{hasText:'Physics reading: 4.2–4.6'});
 await expect(parts).toHaveCount(2);   // this evening, and after midnight
 await expect(recorded(page)).toHaveCount(0);
 const heights=await parts.evaluateAll(els=>els.map(e=>Math.round(e.getBoundingClientRect().height)));
 // 9:51 PM to midnight is 129 minutes; midnight to 1:41 AM is 101.
 expect(Math.max(...heights)).toBeGreaterThan(110);
 expect(Math.min(...heights)).toBeGreaterThan(85);
 await parts.first().dispatchEvent('click');
 await expect(page.getByRole('dialog')).toContainText('9:51 PM');
 await expect(page.getByRole('dialog')).toContainText('1:41 AM');
});

// Reported: adding a session from 11:25 PM to 12:35 AM said "End time must be
// later than start time". An end before the start is the next day.
test('a session can be added past midnight, ending the next day',async({page})=>{
 const state=await setup(page);
 await openEditor(page);
 await page.getByRole('button',{name:/Forgot to start the timer/}).click();
 await page.getByRole('button',{name:'Start and end',exact:true}).click();
 await page.getByLabel('Start',{exact:true}).fill('23:25');
 await page.getByLabel('End',{exact:true}).fill('00:35');
 await expect(page.getByText(/Ends 12:35 AM on .* · 70 minutes\./)).toBeVisible();
 await page.getByRole('button',{name:'Add session',exact:true}).click();
 await expect.poll(()=>state.tables.timer_sessions.length).toBe(2);
 const row=state.tables.timer_sessions.find(r=>r.id!=='real')!;
 expect(row.duration_seconds).toBe(70*60);
 expect(new Date(String(row.end_time)).getTime()-new Date(String(row.start_time)).getTime()).toBe(70*60000);
 expect(new Date(String(row.start_time)).getHours()).toBe(23);
});
