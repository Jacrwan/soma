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

test('a deadline imported from a course site shows in the all-day row',async({page})=>{
 await setup(page,{todos:[
  {id:'lab3',user_id:account.id,text:'Lab 3',subject_id:'biology',status:'nothing',date,due_date:date},
 ]});
 await openWeek(page);
 // The chip itself, and again inside the panel it opens on hover.
 await expect(page.getByText('Lab 3').first()).toBeVisible();
 await expect(page.getByText('Lab 3')).toHaveCount(2);
});
