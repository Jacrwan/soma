import { supabase } from '../../lib/supabase';
import { storage } from '../../lib/storage';
import { fetchAggregatedEvents } from '../../lib/googleCalendarConnections';
import type { Subject, Todo, TodoSession, GoogleCalendarEvent } from '../../types';
import type { PlanBlock } from './PlanEditor';

export type LiveBlock = PlanBlock & { todoId?: string; sessionId?: string; subjectId?: string; legacyId?: string };
export type History = { id:string; subject_id:string; task_text:string; duration_seconds:number; date:string };
export type Snapshot = { blocks:LiveBlock[]; subjects:Subject[]; todos:Todo[]; sessions:TodoSession[]; history:History[]; calendarError:string };
export const localDate = (date:Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function dateAt(origin:Date,day:number) { const d=new Date(origin);d.setHours(0,0,0,0);d.setDate(d.getDate()+day);return d; }
const timeLabel = (d:Date) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
const utc = (s:string) => /Z$|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`;
const commitmentSubject = 'Personal commitments';
async function rows(table:string,userId:string) {
 const all:Record<string,unknown>[]=[];
 for(let offset=0;;offset+=1000){const {data,error}=await supabase.from(table).select('*').eq('user_id',userId).order('id').range(offset,offset+999);if(error)throw new Error(`Could not load ${table.replace(/_/g,' ')}. Please retry.`);all.push(...(data??[]));if(!data || data.length<1000)return all;}
}
function todoRow(r:Record<string,unknown>):Todo {return {id:String(r.id),text:String(r.text??''),status:r.status as Todo['status'],subjectId:r.subject_id as string|undefined,date:String(r.date??''),estimatedMinutes:r.estimated_minutes as number|undefined,dueDate:r.due_date as string|undefined,assignmentId:r.assignment_id as number|undefined,notes:r.notes as string|undefined,order:r.order as number|undefined};}
export async function readPlan(userId:string,origin:Date):Promise<Snapshot> {
 const calendar=fetchAggregatedEvents(dateAt(origin,0).toISOString(),dateAt(origin,7).toISOString(),true).then(events=>({events,error:''})).catch(()=>({events:[] as GoogleCalendarEvent[],error:'Calendar could not be fully loaded. Reconnect or retry before accepting AI schedules.'}));
 const [subjectRows,todoRows,sessionRows,historyRows,google]=await Promise.all([rows('subjects',userId),rows('todos',userId),rows('todo_sessions',userId),rows('timer_sessions',userId),calendar]);
 const subjects=subjectRows.map(r=>({id:String(r.id),name:String(r.name),color:r.color as Subject['color'],archived:!!r.archived,totalTimeToday:0}));
 const todos=todoRows.map(todoRow);
 const sessions:TodoSession[]=sessionRows.map(r=>({id:String(r.id),todoId:String(r.todo_id),date:String(r.date),startTime:r.start_time ? utc(String(r.start_time)) : undefined,endTime:r.end_time ? utc(String(r.end_time)) : undefined}));
 const history=historyRows as unknown as History[];
 const blocks:LiveBlock[]=[];
 const tones:Record<string,string>={'#ef5350':'red','#42a5f5':'blue','#66bb6a':'green','#ab47bc':'purple','#ffa726':'orange','#26c6da':'cyan','#ec407a':'pink','#8d6e63':'brown'};
 const color=(subjectId?:string)=>tones[subjects.find(s=>s.id===subjectId)?.color??'']??'blue';
 for(let day=0;day<7;day++){
  const date=localDate(dateAt(origin,day));
  const scheduled=sessions.filter(s=>s.date===date);
  const add=(todo:Todo,session?:TodoSession)=>{
   const subject=subjects.find(s=>s.id===todo.subjectId);
   const start=session?.startTime ? new Date(session.startTime) : null;
   const end=session?.endTime ? new Date(session.endTime) : null;
   const minutes=start && end ? Math.max(0,Math.round((end.getTime()-start.getTime())/60000)) : 0;
   const external=subject?.name===commitmentSubject;
   blocks.push({id:session?.id??todo.id,todoId:todo.id,sessionId:session?.id,subjectId:todo.subjectId,title:todo.text,subject:external ? 'Personal commitment' : subject?.name??'Personal',time:start && end ? `${timeLabel(start)}–${localDate(end)!==date ? '23:59' : timeLabel(end)}` : '',minutes,color:external ? 'neutral' : color(todo.subjectId),state:todo.status==='done' ? 'Completed' : todo.status==='in_progress' ? 'Partially completed' : 'Planned',day,external,manual:external});
  };
  for(const session of scheduled){const todo=todos.find(t=>t.id===session.todoId);if(todo)add(todo,session);}
  for(const todo of todos.filter(t=>t.date===date && !sessions.some(s=>s.todoId===t.id)))add(todo);
  for(const event of google.events){
   const start=new Date(event.start.dateTime??`${event.start.date}T00:00:00`);const end=new Date(event.end.dateTime??`${event.end.date}T00:00:00`);
   const dayStart=dateAt(origin,day),dayEnd=dateAt(origin,day+1);
   if(start>=dayEnd || end<=dayStart)continue;
   const from=start<dayStart ? '00:00' : timeLabel(start),to=end>=dayEnd ? '23:59' : timeLabel(end);
   blocks.push({id:`google:${event.source?.connectionId}:${event.source?.calendarId}:${event.id}:${day}`,title:event.summary??'Calendar commitment',subject:'Google Calendar · Read-only',time:`${from}–${to}`,minutes:Math.round((Math.min(+end,+dayEnd)-Math.max(+start,+dayStart))/60000),color:'neutral',state:'Planned',day,external:true});
  }
 }
 // Keep legacy Day View plans visible without counting timer-generated history as plans.
 for(const legacy of storage.getTimeBlocks().filter(b=>!b.timerSessionId)){
  const start=new Date(legacy.startTime),end=new Date(legacy.endTime);
  const day=Array.from({length:7},(_,i)=>i).find(i=>localDate(dateAt(origin,i))===localDate(start));
  if(day===undefined || blocks.some(b=>b.title===legacy.task && b.subjectId===legacy.subjectId && b.day===day))continue;
  blocks.push({id:`legacy:${legacy.id}`,legacyId:legacy.id,subjectId:legacy.subjectId,title:legacy.task||'Study session',subject:subjects.find(s=>s.id===legacy.subjectId)?.name??'Personal',time:`${timeLabel(start)}–${timeLabel(end)}`,minutes:Math.max(0,Math.round((+end-+start)/60000)),color:color(legacy.subjectId),state:'Planned',day});
 }
 // Old history has no task ID. Divide a title/subject/day bucket once across its blocks.
 for(const block of blocks.filter(b=>!b.external)){
  const peers=blocks.filter(b=>!b.external && b.day===block.day && b.title===block.title && b.subjectId===block.subjectId);
  const total=history.filter(h=>h.date===localDate(dateAt(origin,block.day)) && h.subject_id===block.subjectId && h.task_text===block.title).reduce((n,h)=>n+Math.max(0,h.duration_seconds||0),0);
  const weight=peers.reduce((n,b)=>n+b.minutes,0);
  block.actualSeconds=total*(weight ? block.minutes/weight : 1/peers.length);
 }
 // Preserve subject-level time when a task was renamed or history has no task text.
 for(let day=0;day<7;day++)for(const subject of subjects){
  const peers=blocks.filter(b=>!b.external && b.day===day && b.subjectId===subject.id);
  const unmatched=history.filter(h=>h.date===localDate(dateAt(origin,day)) && h.subject_id===subject.id && !peers.some(b=>b.title===h.task_text)).reduce((n,h)=>n+Math.max(0,h.duration_seconds||0),0);
  const weight=peers.reduce((n,b)=>n+b.minutes,0);
  for(const block of peers)block.actualSeconds=(block.actualSeconds??0)+unmatched*(weight ? block.minutes/weight : 1/peers.length);
 }
 return {blocks,subjects,todos,sessions,history,calendarError:google.error};
}
async function checkedWrite(table:string,payload:Record<string,unknown>) {const {error}=await supabase.from(table).upsert(payload);if(error)throw new Error(error.message);}
export async function savePlanBlock(userId:string,origin:Date,block:PlanBlock,snapshot:Snapshot) {
 const original=snapshot.blocks.find(b=>b.id===block.id);
 if(original?.external && !original.manual)throw new Error('Google Calendar commitments are read-only.');
 let subject=snapshot.subjects.find(s=>s.name.toLowerCase()===(block.external ? commitmentSubject : block.subject).toLowerCase());
 if(!subject){subject={id:crypto.randomUUID(),name:block.external ? commitmentSubject : block.subject,color:block.subjectColor ?? '#42a5f5',totalTimeToday:0};await checkedWrite('subjects',{id:subject.id,user_id:userId,name:subject.name,color:subject.color,archived:false});}
 const previous=snapshot.todos.find(t=>t.id===original?.todoId);
 const todo:Todo={...previous,id:previous?.id??crypto.randomUUID(),text:block.title,subjectId:subject.id,status:block.state==='Completed' ? 'done' : block.state==='Partially completed' ? 'in_progress' : 'nothing',date:previous?.date??localDate(dateAt(origin,block.day)),estimatedMinutes:previous?.estimatedMinutes??block.minutes};
 await storage.saveTodo(todo);
 try {
  if(!block.time && original?.sessionId){const {error}=await supabase.from('todo_sessions').delete().eq('id',original.sessionId).eq('user_id',userId);if(error)throw new Error(error.message);}
  if(block.time){const [start,end]=block.time.split('–');const date=localDate(dateAt(origin,block.day));const existing=snapshot.sessions.find(s=>s.id===original?.sessionId);const unchanged=existing && original?.time===block.time;await checkedWrite('todo_sessions',{id:original?.sessionId??crypto.randomUUID(),user_id:userId,todo_id:todo.id,date:unchanged ? existing.date : date,start_time:unchanged ? existing.startTime : new Date(`${date}T${start}:00`).toISOString(),end_time:unchanged ? existing.endTime : new Date(`${date}T${end}:00`).toISOString()});}
 }catch(error){
  if(!previous){const {error:cleanup}=await supabase.from('todos').delete().eq('id',todo.id).eq('user_id',userId);if(cleanup)throw new Error('The task saved, but its time did not. Open Day View to schedule it before trying again.');}
  else throw new Error('Task details saved, but the time change failed. Your previous schedule remains. Please retry.');
  throw error;
 }
 if(original?.legacyId)storage.setTimeBlocks(storage.getTimeBlocks().filter(b=>b.id!==original.legacyId));
 await Promise.all([storage.fetchAllTodos(),storage.loadSubjects()]);
 window.dispatchEvent(new Event('soma_todos_changed'));
}
