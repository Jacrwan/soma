import { test, expect, type Page } from '@playwright/test';

const account={id:'11111111-1111-4111-8111-111111111111',email:'student@example.com',aud:'authenticated',role:'authenticated',created_at:'2025-01-01T00:00:00Z',app_metadata:{},user_metadata:{}};
const day=new Date();
const date=`${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
const iso=(time:string)=>new Date(`${date}T${time}:00`).toISOString();

async function setup(page:Page){
 const state={patches:0,deletes:0,tables:{
  subjects:[{id:'biology',user_id:account.id,name:'Biology',color:'#66bb6a',archived:false}],
  todos:[{id:'review',user_id:account.id,text:'Cell review',subject_id:'biology',status:'nothing',date,estimated_minutes:45}],
  todo_sessions:[{id:'review-slot',user_id:account.id,todo_id:'review',date,start_time:iso('09:00'),end_time:iso('09:45')}],
  // The overnight mistake: 822 minutes on one task, plus a genuine short session.
  timer_sessions:[
   {id:'slept',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Cell review',date,start_time:iso('20:00'),duration_seconds:822*60},
   {id:'real',user_id:account.id,subject_id:'biology',subject_name:'Biology',task_text:'Cell review',date,start_time:iso('08:00'),duration_seconds:25*60},
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
   state.patches++;
   const id=url.searchParams.get('id')?.slice(3);const body=req.postDataJSON();
   state.tables[table]=(state.tables[table]??[]).map(r=>r.id===id?{...r,...body}:r);
  }else if(req.method()==='DELETE'){
   state.deletes++;
   const id=url.searchParams.get('id')?.slice(3);
   state.tables[table]=id?(state.tables[table]??[]).filter(r=>r.id!==id):[];
  }
  return route.fulfill({json:null});
 });
 await page.route('**/api/stripe',r=>r.fulfill({json:{status:'active'}}));
 await page.route('**/api/google-calendar-events',r=>r.fulfill({json:{events:[],incomplete:false}}));
 return state;
}

const openEditor=async(page:Page)=>{
 await page.goto('/dashboard');
 await page.getByRole('button',{name:'Edit plan',exact:true}).click();
 await page.getByRole('button',{name:'Edit: Cell review',exact:true}).click();
 await expect(page.getByLabel('Past focus sessions')).toBeVisible();
};
const logs=(page:Page)=>page.getByLabel('Past focus sessions');

test('a recorded session can be corrected to its real length',async({page})=>{
 const state=await setup(page);
 await openEditor(page);
 await expect(logs(page)).toContainText('847 minutes recorded on this task.');

 await page.getByRole('button',{name:/Edit the 822 minute session/}).click();
 const field=page.getByRole('spinbutton',{name:/Minutes studied on/});
 await expect(field).toHaveValue('822');
 await field.fill('90');
 await page.getByRole('button',{name:'Save',exact:true}).click();

 await expect(logs(page)).toContainText('115 minutes recorded on this task.');
 expect(state.patches).toBe(1);
 expect(state.tables.timer_sessions.find(r=>r.id==='slept')?.duration_seconds).toBe(90*60);
 // The genuine session is untouched.
 expect(state.tables.timer_sessions.find(r=>r.id==='real')?.duration_seconds).toBe(25*60);
});

test('a correction survives a reload',async({page})=>{
 await setup(page);
 await openEditor(page);
 await page.getByRole('button',{name:/Edit the 822 minute session/}).click();
 await page.getByRole('spinbutton',{name:/Minutes studied on/}).fill('90');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(logs(page)).toContainText('115 minutes recorded');

 await openEditor(page);
 await expect(logs(page)).toContainText('115 minutes recorded');
 await expect(logs(page)).toContainText('90 min');
});

test('a session can be deleted outright, and only that session',async({page})=>{
 const state=await setup(page);
 await openEditor(page);
 page.on('dialog',d=>d.accept());
 await page.getByRole('button',{name:/Delete the 822 minute session/}).click();

 await expect(logs(page)).toContainText('25 minutes recorded on this task.');
 expect(state.deletes).toBe(1);
 expect(state.tables.timer_sessions.map(r=>r.id)).toEqual(['real']);
});

test('declining the delete confirmation keeps the session',async({page})=>{
 const state=await setup(page);
 await openEditor(page);
 page.on('dialog',d=>d.dismiss());
 await page.getByRole('button',{name:/Delete the 822 minute session/}).click();

 await expect(logs(page)).toContainText('847 minutes recorded on this task.');
 expect(state.deletes).toBe(0);
 expect(state.tables.timer_sessions).toHaveLength(2);
});

test('cancelling an edit writes nothing',async({page})=>{
 const state=await setup(page);
 await openEditor(page);
 await page.getByRole('button',{name:/Edit the 822 minute session/}).click();
 await page.getByRole('spinbutton',{name:/Minutes studied on/}).fill('5');
 await page.getByRole('button',{name:/Cancel editing the session/}).click();

 await expect(logs(page)).toContainText('847 minutes recorded on this task.');
 expect(state.patches).toBe(0);
});

test('a failed correction surfaces an error instead of silently dropping it',async({page})=>{
 const state=await setup(page);
 await page.route('https://soma-regression.supabase.co/rest/v1/timer_sessions*',async route=>{
  if(route.request().method()==='PATCH')return route.fulfill({status:500,json:{message:'Database unavailable'}});
  return route.fallback();
 });
 await openEditor(page);
 await page.getByRole('button',{name:/Edit the 822 minute session/}).click();
 await page.getByRole('spinbutton',{name:/Minutes studied on/}).fill('90');
 await page.getByRole('button',{name:'Save',exact:true}).click();

 await expect(page.getByRole('alert')).toContainText('Database unavailable');
 await expect(logs(page)).toContainText('847 minutes recorded on this task.');
 expect(state.tables.timer_sessions.find(r=>r.id==='slept')?.duration_seconds).toBe(822*60);
});

test('correcting a session invalidates the Insights cache', async ({ page }) => {
 await setup(page);
 // Warm the cache, then leave Insights WITHOUT a reload — a full navigation would
 // drop the module-level cache and the test would pass no matter what.
 await page.goto('/insights');
 await expect(page.getByLabel('Insights summary')).toContainText('14h 7m');
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();

 await page.getByRole('button',{name:'Edit plan',exact:true}).click();
 await page.getByRole('button',{name:'Edit: Cell review',exact:true}).click();
 await expect(logs(page)).toBeVisible();
 await page.getByRole('button',{name:/Edit the 822 minute session/}).click();
 await page.getByRole('spinbutton',{name:/Minutes studied on/}).fill('90');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(logs(page)).toContainText('115 minutes recorded');

 await page.getByRole('button',{name:'Insights',exact:true}).click();
 await expect(page.getByLabel('Insights summary')).toContainText('1h 55m');
});

test('deleting a session invalidates the Insights cache', async ({ page }) => {
 await setup(page);
 await page.goto('/insights');
 await expect(page.getByLabel('Insights summary')).toContainText('14h 7m');
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();

 await page.getByRole('button',{name:'Edit plan',exact:true}).click();
 await page.getByRole('button',{name:'Edit: Cell review',exact:true}).click();
 await expect(logs(page)).toBeVisible();
 page.on('dialog',d=>d.accept());
 await page.getByRole('button',{name:/Delete the 822 minute session/}).click();
 await expect(logs(page)).toContainText('25 minutes recorded');

 await page.getByRole('button',{name:'Insights',exact:true}).click();
 await expect(page.getByLabel('Insights summary')).toContainText('25m');
});
