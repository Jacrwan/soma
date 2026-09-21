import { test, expect, type Page } from '@playwright/test';

// "remove" used to clear a block's time and keep the task, so it reappeared
// under Any time and nothing was actually removed — and on a task that was
// already unscheduled it wrote nothing at all while Soma reported success.
const account={id:'11111111-1111-4111-8111-111111111111',email:'s@e.com',aud:'authenticated',role:'authenticated',created_at:'2025-01-01T00:00:00Z',app_metadata:{},user_metadata:{}};
const key=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const off=(n:number)=>{const d=new Date();d.setDate(d.getDate()+n);return d;};
const at=(n:number,t:string)=>{const d=off(n);const [h,m]=t.split(':').map(Number);d.setHours(h,m,0,0);return d.toISOString();};
const TOM=key(off(1));

type Opts={scheduled?:boolean;logged?:boolean;twice?:boolean};
async function setup(page:Page,opts:Opts){
 const st={
  todos:[{id:'quiz',user_id:account.id,text:'Quiz 2 Study',subject_id:'cs',status:'nothing',date:TOM}] as Record<string,unknown>[],
  sessions:(opts.scheduled?[{id:'quiz-slot',user_id:account.id,todo_id:'quiz',date:TOM,start_time:at(1,'18:00'),end_time:at(1,'19:00')},
    ...(opts.twice?[{id:'quiz-slot-2',user_id:account.id,todo_id:'quiz',date:key(off(2)),start_time:at(2,'18:00'),end_time:at(2,'19:00')}]:[])]:[]) as Record<string,unknown>[],
  timers:(opts.logged?[{id:'log1',user_id:account.id,subject_id:'cs',subject_name:'CS 61A',task_text:'Quiz 2 Study',date:key(off(-1)),start_time:at(-1,'18:00'),duration_seconds:40*60}]:[]) as Record<string,unknown>[],
  deletes:[] as string[],
 };
 await page.addInitScript(a=>{localStorage.setItem('sb-soma-regression-auth-token',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:a}));},account);
 await page.route('https://soma-regression.supabase.co/**',route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop()!;
  if(url.pathname.includes('/auth/v1/'))return route.fulfill({json:account});
  if(table==='settings')return route.fulfill({json:{data:{onboardingCompleted:true,theme:'light'}}});
  if(req.method()==='DELETE'){
   const id=url.searchParams.get('id')?.slice(3);
   const taskFilter=url.searchParams.get('task_text')?.slice(3);
   st.deletes.push(`${table}:${id??taskFilter??'*'}`);
   if(table==='todos'){const gone=st.todos.filter(r=>r.id===id);st.todos=st.todos.filter(r=>r.id!==id);return route.fulfill({json:gone});}
   if(table==='todo_sessions'){const gone=st.sessions.filter(r=>r.id===id);st.sessions=st.sessions.filter(r=>r.id!==id);return route.fulfill({json:gone});}
   if(table==='timer_sessions'){st.timers=taskFilter?st.timers.filter(r=>r.task_text!==taskFilter):st.timers.filter(r=>r.id!==id);return route.fulfill({json:null});}
   return route.fulfill({json:null});
  }
  if(req.method()!=='GET')return route.fulfill({json:null});
  const rows=table==='subjects'?[{id:'cs',user_id:account.id,name:'CS 61A',color:'#ef5350',archived:false}]
   :table==='todos'?st.todos:table==='todo_sessions'?st.sessions:table==='timer_sessions'?st.timers:[];
  return route.fulfill({json:req.headers().accept?.includes('vnd.pgrst.object')?rows[0]??null:rows});
 });
 await page.route('**/api/stripe',r=>r.fulfill({json:{status:'active'}}));
 await page.route('**/api/google-calendar-events',r=>r.fulfill({json:{events:[],incomplete:false}}));
 const id=opts.scheduled?'quiz-slot':'quiz';
 await page.route('**/api/chat',r=>r.fulfill({json:{content:[{text:JSON.stringify({reply:'Removed it.',blocks:[],changes:[{action:'remove',id}]})}]}}));
 return st;
}
async function propose(page:Page){
 await page.goto('/dashboard');
 await page.getByLabel('What do you need to work on?').fill('remove the quiz 2 study block');
 await page.getByRole('button',{name:'Send to Soma'}).click();
 await expect(page.getByRole('log')).toContainText('Removed it.');
}
const planText=(page:Page)=>page.locator('[class*=agenda],[class*=single],[class*=concurrent]').first();

test('a scheduled block is deleted, not just unscheduled', async ({ page }) => {
 const st=await setup(page,{scheduled:true});
 await propose(page);
 await page.getByRole('button',{name:'Accept',exact:true}).click();
 await expect(planText(page)).not.toContainText('Quiz 2 Study');
 expect(st.todos).toHaveLength(0);
 expect(st.sessions).toHaveLength(0);
 expect(st.deletes).toContain('todo_sessions:quiz-slot');
 expect(st.deletes).toContain('todos:quiz');
});

test('an already-unscheduled block is deleted rather than silently doing nothing', async ({ page }) => {
 const st=await setup(page,{scheduled:false});
 await propose(page);
 await page.getByRole('button',{name:'Accept',exact:true}).click();
 await expect(planText(page)).not.toContainText('Quiz 2 Study');
 expect(st.todos).toHaveLength(0);
 expect(st.deletes).toContain('todos:quiz');
});

test('recorded study time is kept by default when a task is deleted', async ({ page }) => {
 const st=await setup(page,{scheduled:true,logged:true});
 await propose(page);
 await expect(page.getByText('Also delete 40 min of recorded study time')).toBeVisible();
 await page.getByRole('button',{name:'Accept',exact:true}).click();
 await expect(planText(page)).not.toContainText('Quiz 2 Study');
 expect(st.todos).toHaveLength(0);
 expect(st.timers).toHaveLength(1);                       // the 40 min survives
 expect(st.deletes.some(d=>d.startsWith('timer_sessions'))).toBe(false);
});

test('recorded study time is deleted too when that is chosen', async ({ page }) => {
 const st=await setup(page,{scheduled:true,logged:true});
 await propose(page);
 await page.getByRole('checkbox',{name:/Also delete the 40 minutes recorded/}).check();
 await page.getByRole('button',{name:'Accept',exact:true}).click();
 await expect(planText(page)).not.toContainText('Quiz 2 Study');
 expect(st.todos).toHaveLength(0);
 expect(st.timers).toHaveLength(0);
 expect(st.deletes.some(d=>d.startsWith('timer_sessions'))).toBe(true);
});

test('a task with no recorded time offers no choice about it', async ({ page }) => {
 await setup(page,{scheduled:true});
 await propose(page);
 await expect(page.getByText('Delete from plan')).toBeVisible();
 await expect(page.getByRole('checkbox',{name:/Also delete/})).toHaveCount(0);
});

test('deleting one block of a task scheduled twice keeps the other block', async ({ page }) => {
 // Deleting the task would silently take its other blocks with it; the student
 // asked for this block, not the whole task.
 const st=await setup(page,{scheduled:true,twice:true});
 await propose(page);
 await expect(page.getByText('the task keeps 1 other block')).toBeVisible();
 await page.getByRole('button',{name:'Accept',exact:true}).click();
 await expect.poll(()=>st.deletes).toContain('todo_sessions:quiz-slot');
 expect(st.todos).toHaveLength(1);                        // the task survives
 expect(st.sessions.map(s=>s.id)).toEqual(['quiz-slot-2']);
 expect(st.deletes.some(d=>d==='todos:quiz')).toBe(false);
});

test('a task scheduled twice offers no choice about recorded time', async ({ page }) => {
 // Nothing is being deleted for good, so there is nothing to ask about.
 await setup(page,{scheduled:true,twice:true,logged:true});
 await propose(page);
 await expect(page.getByText('the task keeps 1 other block')).toBeVisible();
 await expect(page.getByRole('checkbox',{name:/Also delete/})).toHaveCount(0);
});
