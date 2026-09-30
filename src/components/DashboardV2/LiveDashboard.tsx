import { useCallback, useEffect, useRef, useState } from 'react';
import DashboardV2 from './DashboardV2';
import { dateAt, localDate, readPlan, savePlanBlock, utcIso, type Snapshot } from './liveData';
import type { PlanBlock, PlanState } from './PlanEditor';
import { useTimerContext } from '../../contexts/TimerContext';
import { storage } from '../../lib/storage';
import { formatClockRange } from '../../lib/timeFormat';
import { listDocuments } from '../../lib/documents';
import { askSoma, applyProposal, applyAll, dismissProposal } from '../../lib/assistant';
import { useProposals } from '../../lib/proposalStore';
import { coveredBy, finishThrough, markDone, rangeLabel, renameLoggedTime, retitle } from '../../lib/courseItems';
import { SkeletonBlock, SkeletonPage } from '../UI/Skeleton';
import styles from './DashboardV2.module.css';

import { dashboardChatFor, type DashboardChatMemory } from '../../lib/dashboardChatMemory';

async function mirrorToChatSession(memory:DashboardChatMemory) {
 if(!memory.display.length)return;
 const firstUser=memory.display.find(m=>m.role==='user')?.content??'Dashboard chat';
 await storage.upsertChatSession({id:memory.id,date:localDate(new Date(memory.createdAt)),title:firstUser.slice(0,60),messages:memory.display.map((m,i)=>({id:`${memory.id}-${i}`,role:m.role,content:m.content})),createdAt:memory.createdAt},memory.userId);
}

/**
 * The dashboard while its plan loads. It mirrors the real layout — progress
 * rail, week strip, agenda, and the right column's chat and focus panels — so
 * the page settles into place rather than snapping from a line of text to a
 * full screen.
 */
function DashboardSkeleton() {
  return (
    <div className={`${styles.page} ${styles.live}`}>
      <main className={styles.main}>
        <SkeletonPage label="Loading your plan…">
          <header className={styles.header}>
            <div>
              <SkeletonBlock width={128} height={10}/>
              <div style={{height:10}}/>
              <SkeletonBlock width={270} height={25}/>
            </div>
            <SkeletonBlock width={94} height={14}/>
          </header>

          <div className={styles.columns}>
            <div className={styles.planColumn}>
              <section className={styles.progress}>
                <SkeletonBlock width={240} height={12}/>
                <div className={styles.rail} style={{gap:5}}>
                  {[3,2,2,1].map((flex,i)=>(
                    <span key={i} style={{flexGrow:flex}}><SkeletonBlock height={8} borderRadius={3}/></span>
                  ))}
                </div>
                <div style={{display:'flex',gap:14,marginTop:12,flexWrap:'wrap'}}>
                  {[96,108,84].map((w,i)=><SkeletonBlock key={i} width={w} height={11}/>)}
                </div>
              </section>

              <div className={styles.week}>
                {Array.from({length:7},(_,i)=>(
                  <div key={i} style={{display:'flex',flexDirection:'column',gap:6,padding:'12px 3px',alignItems:'center'}}>
                    <SkeletonBlock width={26} height={10}/>
                    <SkeletonBlock width={20} height={18}/>
                    <SkeletonBlock width={38} height={9}/>
                  </div>
                ))}
              </div>

              <section className={styles.section}>
                <SkeletonBlock width={132} height={17}/>
                <div style={{height:18}}/>
                <div className={styles.agenda}>
                  {[0,1,2,3].map(i=>(
                    <div key={i} className={`${styles.block} ${styles.neutral}`}>
                      <div className={styles.blockTime}>
                        <SkeletonBlock width={66} height={11}/>
                        <div style={{height:7}}/>
                        <SkeletonBlock width={42} height={10}/>
                      </div>
                      <div className={styles.blockBody}>
                        <SkeletonBlock width={72} height={10}/>
                        <div style={{height:6}}/>
                        <SkeletonBlock width={`${[64,78,52,70][i]}%`} height={13}/>
                        <div style={{height:6}}/>
                        <SkeletonBlock width={58} height={10}/>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <aside className={styles.right}>
              <section className={styles.chat}>
                <SkeletonBlock width={90} height={17}/>
                <div style={{height:16}}/>
                {[86,64,78].map((w,i)=>(
                  <div key={i} style={{marginBottom:10}}><SkeletonBlock width={`${w}%`} height={34} borderRadius={9}/></div>
                ))}
              </section>
              <section className={styles.focus}>
                <SkeletonBlock width={62} height={17}/>
                <div style={{height:14}}/>
                <SkeletonBlock width={112} height={11}/>
                <div style={{height:8}}/>
                <SkeletonBlock width={160} height={14}/>
                <div style={{height:20}}/>
                <SkeletonBlock width={148} height={44}/>
              </section>
            </aside>
          </div>
        </SkeletonPage>
      </main>
    </div>
  );
}

export default function LiveDashboard({userId}:{userId:string}) {
 const [origin]=useState(()=>dateAt(new Date(),0));
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 // Shared with the AI page, so a proposal made there shows up here too.
 const proposals=useProposals(userId);
 // Which week is on screen, in days from today: 0 is this week, -7 last week.
 const [rangeStart,setRangeStart]=useState(0);
 const rangeRef=useRef(0);rangeRef.current=rangeStart;
 const timer=useTimerContext();
 const generation=useRef(0),mounted=useRef(true),writing=useRef(false);
 const memory=dashboardChatFor(userId);
 const conversation=useRef(memory.history);
 const reload=useCallback(async()=>{const gen=++generation.current;const data=await readPlan(userId,origin,rangeRef.current,7);if(mounted.current && gen===generation.current)setSnapshot(data);return data;},[userId,origin]);
 useEffect(()=>{void reload().catch(e=>setError(e.message));},[rangeStart,reload]);
 // Warm the documents cache so Ask Soma can answer from uploaded files even if
 // the user never opens the Documents page this session.
 useEffect(()=>{void listDocuments().catch(()=>{});},[]);
 useEffect(()=>{mounted.current=true;void reload().catch(e=>setError(e.message));const refresh=()=>{if(!writing.current)void reload().catch(e=>setError(e.message));};window.addEventListener('focus',refresh);window.addEventListener('soma_timer_stopped',refresh);
 // Recorded time added, corrected or deleted anywhere (e.g. the Calendar) shows here too.
 window.addEventListener('soma_insights_changed',refresh);
 return()=>{mounted.current=false;window.removeEventListener('focus',refresh);window.removeEventListener('soma_timer_stopped',refresh);window.removeEventListener('soma_insights_changed',refresh);};},[reload]);
 async function save(block:PlanBlock,proposal=false){
  if(writing.current)throw new Error('Please wait for the current save to finish.');
  writing.current=true;setBusy(true);setError('');
  try {
   if(proposal){
    await applyProposal(userId,origin,block);
    try{await reload();}catch{throw new Error('Your change saved, but refreshing failed. Refresh the page before making another change.');}
    return;
   }
   const fresh=await readPlan(userId,origin,rangeRef.current,7);
   if(snapshot?.blocks.some(b=>b.id===block.id) && !fresh.blocks.some(b=>b.id===block.id))throw new Error('This block changed elsewhere. Refresh and try again.');
   await savePlanBlock(userId,origin,block,fresh);
   try{await reload();}catch{throw new Error('Your change saved, but refreshing failed. Refresh the page before making another change.');}
  }catch(e){setError(e instanceof Error ? e.message : 'Could not save. Please retry.');throw e;}
  finally{writing.current=false;setBusy(false);}
 }
 async function change(id:string|number,state:PlanState,opts?:{deleteLoggedTime?:boolean}){
  const proposal=proposals.find(b=>b.id===id);
  if(proposal){await save({...proposal,state,...opts},true);return;}
  const block=snapshot?.blocks.find(b=>b.id===id);
  if(!block)throw new Error('Refresh to load this block.');
  if(!block.todoId){await save({...block,state});return;}
  if(writing.current)throw new Error('Please wait for the current save to finish.');
  writing.current=true;setBusy(true);setError('');
  try{const fresh=await readPlan(userId,origin,rangeRef.current,7);const todo=fresh.todos.find(t=>t.id===block.todoId);if(!todo)throw new Error('This task no longer exists. Refresh your plan.');await storage.saveTodo({...todo,status:state==='Completed' ? 'done' : state==='Partially completed' ? 'in_progress' : 'nothing'});
  // Checking a block off is what marks its sections read; unchecking takes that back.
  const covered=coveredBy(fresh.items,todo.id);
  if(state==='Completed')await markDone(userId,covered.filter(i=>!i.doneAt).map(i=>i.id));
  else if(todo.status==='done')await markDone(userId,covered.filter(i=>i.doneAt).map(i=>i.id),false);
  await storage.fetchAllTodos();await reload();}
  catch(e){setError(e instanceof Error ? e.message : 'Could not save completion.');throw e;}finally{writing.current=false;setBusy(false);}
 }
 /** Read part of a block: its sections through `itemId` are done and the block
  *  is renamed to what was actually read; the rest goes back to open. */
 async function stoppedAt(id:string|number,itemId:string){
  const block=snapshot?.blocks.find(b=>b.id===id);
  if(!block?.todoId)throw new Error('Refresh to load this block.');
  if(writing.current)throw new Error('Please wait for the current save to finish.');
  writing.current=true;setBusy(true);setError('');
  try{
   const fresh=await readPlan(userId,origin,rangeRef.current,7);
   const todo=fresh.todos.find(t=>t.id===block.todoId);
   if(!todo)throw new Error('This task no longer exists. Refresh your plan.');
   const covered=coveredBy(fresh.items,todo.id);
   const {done}=await finishThrough(userId,fresh.items,todo.id,itemId);
   const text=retitle(todo.text,rangeLabel(covered),rangeLabel(done));
   if(todo.subjectId)await renameLoggedTime(userId,todo.subjectId,todo.text,text);
   await storage.saveTodo({...todo,text,status:'done'});
   await storage.fetchAllTodos();await reload();
  }catch(e){setError(e instanceof Error ? e.message : 'Could not save your progress.');throw e;}
  finally{writing.current=false;setBusy(false);}
 }
 async function propose(text:string,day:number){
  if(writing.current)throw new Error('Please wait for your plan to finish saving.');
  const result=await askSoma({userId,origin,text,history:conversation.current,selectedDay:day,activeBlockId:active?.id});
  conversation.current=result.history;
  memory.history=result.history;
  memory.display.push({role:'user',content:text},{role:'assistant',content:result.display});
  await mirrorToChatSession(memory).catch(()=>setError('Your reply is available here, but chat history could not be saved. Keep this page open.'));
  // Proposals live in this week; bring it back on screen if another is showing.
  if(result.proposedCount && rangeRef.current!==0)setRangeStart(0);
  return {reply:result.display,day:result.showDay};
 }
 if(!snapshot)return error
  ? <div className={styles.loading}><p role="alert">{error}</p><button onClick={()=>{setError('');void reload().catch(e=>setError(e.message));}}>Retry dashboard</button></div>
  : <DashboardSkeleton/>;
 const active=snapshot.blocks.find(b=>!b.external && b.subjectId===timer.activeSession?.subject.id && b.title===timer.activeSession?.task && localDate(dateAt(origin,b.day))===localDate(new Date(timer.activeSession.sessionStartTimeISO)));
 const weekdayName=(d:number)=>dateAt(origin,d).toLocaleDateString('en-US',{weekday:'long'});
 const pendingChange=new Map(proposals.filter(p=>p.replaces!==undefined).map(p=>[p.replaces,p]));
 const blocks=snapshot.blocks.map(b=>{
  const withTime=b.id===active?.id ? {...b,actualSeconds:(b.actualSeconds??0)+timer.elapsed} : b;
  const c=pendingChange.get(b.id);
  const retimed=c && (c.time!==b.time || c.day!==b.day);
  return c ? {...withTime,note:c.changeKind==='remove' ? 'Soma suggests deleting this' : c.changeKind==='complete' ? 'Soma suggests marking this done' : c.changeKind==='progress' ? `Soma suggests: ${c.note}` : [c.title!==b.title ? `Soma suggests renaming this to "${c.title}"` : '',retimed ? `${c.title!==b.title ? 'and' : 'Soma suggests'} moving this to ${formatClockRange(c.time)}${c.day!==b.day ? ` ${weekdayName(c.day)}` : ''}` : ''].filter(Boolean).join(' ')} : withTime;
 });
 async function acceptAll(){
  const failed=await applyAll(userId,origin,undefined,b=>save(b,true));
  // Say which change and why, not just a count.
  if(failed.length)setError(`The rest were saved, but not ${failed.map(f=>`"${f.title}" (${f.reason.replace(/\.$/,'')})`).join(', ')}.`);
  else setError('');
 }
 const pulseDays=Array.from({length:7},(_,i)=>snapshot.history.filter(h=>h.date===localDate(dateAt(origin,i-6))).reduce((n,h)=>n+Math.max(0,h.duration_seconds||0),0));
 return <><div className={styles.liveNotice} aria-live="polite">{error && <p role="alert">{error} <button disabled={busy} onClick={()=>{setError('');void reload().catch(e=>setError(e.message));}}>Refresh plan</button></p>}{snapshot.calendarError && <p role="alert">{snapshot.calendarError}</p>}{busy && <span>Saving your plan…</span>}</div><DashboardV2 runtime={{initialConversation:memory.ui,onConversationChange:items=>{memory.ui=items;},blocks:[...blocks,...proposals],activeId:active?.id??null,timerActive:!!timer.activeSession,onSave:b=>save(b,b.state==='Proposal'),onState:change,onDismiss:id=>dismissProposal(userId,id),onStoppedAt:stoppedAt,onAcceptAll:acceptAll,rangeStart,onRange:setRangeStart,onPropose:propose,onFocus:b=>{const live=snapshot.blocks.find(x=>x.id===b.id);const subject=snapshot.subjects.find(s=>s.id===live?.subjectId);if(subject)timer.startSession(subject,b.title,0);else setError('Choose a subject with Edit plan before starting focus.');},pulseSeconds:pulseDays.reduce((a,b)=>a+b,0),pulseDays,subjectNames:snapshot.subjects.filter(s=>!s.archived).map(s=>s.name),usedColors:snapshot.subjects.map(s=>s.color),onEditSession:async(sessionId,minutes,startTime)=>{
 const row=snapshot.history.find(h=>h.id===sessionId);
 if(!row)throw new Error('That session is no longer there. Refresh and try again.');
 // Keep where it started unless the correction moved it, then let the length
 // decide the end, so start, end and duration always agree.
 const was=row.start_time ? new Date(utcIso(row.start_time)) : new Date(`${row.date}T12:00:00`);
 const clock=/^([01]\d|2[0-3]):[0-5]\d$/;
 const start=clock.test(startTime??'')
  ? new Date(`${row.date}T${startTime}:00`)
  : was;
 writing.current=true;
 try{
  await storage.updateTimerSession(sessionId,{startTime:start.toISOString(),endTime:new Date(start.getTime()+minutes*60000).toISOString(),durationSeconds:minutes*60});
  await reload();
 }finally{writing.current=false;}
},onDeleteSession:async(sessionId)=>{writing.current=true;try{await storage.deleteTimerSession(sessionId);await reload();}finally{writing.current=false;}},onAddSession:async(target,date,minutes,startTime)=>{
 const live=snapshot.blocks.find(x=>x.id===target.id);
 if(!live?.subjectId)throw new Error('Give this task a subject before adding study time.');
 const subject=snapshot.subjects.find(sn=>sn.id===live.subjectId);
 // A clock time the student typed wins. Otherwise sit the entry at the block's
 // planned start so it lands in the right part of Peak study hours; noon is the
 // fallback for an unscheduled task.
 const clock=/^([01]\d|2[0-3]):[0-5]\d$/;
 const [planned]=live.time ? live.time.split('\u2013') : [];
 const at=clock.test(startTime??'') ? startTime! : clock.test(planned??'') ? planned : '12:00';
 const start=new Date(`${date}T${at}:00`);
 writing.current=true;
 try{
  await storage.saveTimerSession({id:crypto.randomUUID(),subjectId:live.subjectId,task:live.title,startTime:start.toISOString(),endTime:new Date(start.getTime()+minutes*60000).toISOString(),durationSeconds:minutes*60},subject?.name??live.subject);
  await reload();
 }finally{writing.current=false;}
},logsFor:(b)=>{const live=snapshot.blocks.find(x=>x.id===b.id);if(!live)return [];return snapshot.history.filter(h=>h.subject_id===live.subjectId && h.task_text===live.title && (h.duration_seconds||0)>0).map(h=>({id:h.id,date:h.date,minutes:Math.round((h.duration_seconds||0)/60),start:h.start_time?utcIso(h.start_time):undefined,end:h.end_time?utcIso(h.end_time):undefined}))
 // Newest first by when each session started; the date alone left same-day sessions in any order.
 .sort((a,c)=>new Date(c.start??`${c.date}T12:00:00`).getTime()-new Date(a.start??`${a.date}T12:00:00`).getTime());},focus:<section className={styles.focus} aria-label="Focus timer"><h2>Focus</h2><p className={styles.description}>{timer.activeSession?.subject.name??'One thing at a time.'}</p><h3>{timer.activeSession?.task??'Ready when you are'}</h3><div className={styles.timer}>{String(Math.floor(timer.elapsed/60)).padStart(2,'0')}<span>:</span>{String(timer.elapsed%60).padStart(2,'0')}</div>{timer.activeSession ? <div className={styles.focusActions}><button disabled={timer.saving || timer.savePending} onClick={()=>timer.isPaused ? timer.resumeSession() : timer.pauseSession()}>{timer.isPaused ? 'Resume' : 'Pause'}</button><button disabled={timer.saving} onClick={()=>void timer.stopSession()}>{timer.saving ? 'Saving…' : 'Stop & save'}</button></div> : <p className={styles.description}>Choose Focus on a study block to begin.</p>}{timer.error && <p role="alert">{timer.error}</p>}<small>Actual work is tracked separately from your plan. Complete the task when it is finished.</small></section>}}/></>;
}
