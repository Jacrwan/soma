import { useState } from 'react';
import { nextUnusedColor } from '../../lib/subjectColors';
import { formatClock, useTimeFormat } from '../../lib/timeFormat';
import type { SubjectColor } from '../../types';
import styles from './DashboardV2.module.css';
export type PlanState = 'Planned' | 'Completed' | 'Partially completed' | 'Missed' | 'Proposal';
export type PlanBlock = { id:string | number; title:string; subject:string; time:string; minutes:number; color:string; state:PlanState; day:number; actualSeconds?:number; external?:boolean; manual?:boolean; subjectColor?:SubjectColor; /** Shown on a proposal card, e.g. which calendar event it overlaps. */ note?:string; /** A suggested change to an existing block rather than a new one. */ replaces?:string|number; changeKind?:'move'|'remove'|'update'; /** Total study time recorded against this task, shown before a delete is accepted. */ loggedMinutes?:number; /** Set on a delete proposal when the student also wants the recorded time gone. */ deleteLoggedTime?:boolean };
export type EditorDraft = { block?:PlanBlock; start:string; end:string; day:number };
const colors:Record<string,string>={Biology:'green',Mathematics:'blue',Literature:'purple',Personal:'blue'};
const NEW_COURSE='__new_course__';
export const minuteValue = (s:string) => {const [h,m]=s.split(':').map(Number);return h*60+m;};
/** Evaluated per render: a module-level constant would go stale past midnight. */
const todayLocal=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const clockOf=(iso:string)=>{const d=new Date(iso);return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;};
/** "9:05 AM – 9:50 AM", or nothing when the row never recorded its clock times. */
const sessionRange=(log:{start?:string;end?:string},format:'12h'|'24h')=>
 log.start && log.end ? `${formatClock(clockOf(log.start),format)} – ${formatClock(clockOf(log.end),format)}` : '';
/** `start`/`end` are ISO instants when the session recorded them; older rows
 *  and some imports have only a duration, so both are optional. */
export type FocusLog = { id:string; date:string; minutes:number; start?:string; end?:string };
export default function PlanEditor({draft,blocks,onSave,onCancel,live=false,knownSubjects=[],usedColors=[],logs=[],onEditSession,onDeleteSession,onAddSession}:{live?:boolean;draft:EditorDraft;blocks:PlanBlock[];knownSubjects?:string[];usedColors?:SubjectColor[];logs?:FocusLog[];onSave:(block:PlanBlock)=>void | Promise<void>;onCancel:()=>void;onEditSession?:(sessionId:string,minutes:number,startTime?:string)=>Promise<void>;onDeleteSession?:(sessionId:string)=>Promise<void>;onAddSession?:(date:string,minutes:number,startTime?:string)=>Promise<void>}) {
 const timeFormat=useTimeFormat();
 const [title,setTitle]=useState(draft.block?.title ?? '');
 const [subject,setSubject]=useState(draft.block?.external ? 'Personal' : draft.block?.subject ?? 'Personal');
 const [type,setType]=useState(draft.block?.external ? 'commitment' : 'study');
 const [start,setStart]=useState(draft.start);
 const [end,setEnd]=useState(draft.end);
 const [state,setState]=useState<PlanState>(draft.block?.state ?? 'Planned');
 const [error,setError]=useState('');
 const [saving,setSaving]=useState(false);
 const [scheduled,setScheduled]=useState(!draft.block || !!draft.block.time);
 const [newCourse,setNewCourse]=useState('');
 const [creatingCourse,setCreatingCourse]=useState(false);
 // Which past session is open for correction, and the value being typed into it.
 const [editingLog,setEditingLog]=useState<string|null>(null);
 const [logMinutes,setLogMinutes]=useState('');
 // A session can be corrected the way it is remembered: how long it ran, or
 // when it ran.
 const [logMode,setLogMode]=useState<'minutes'|'range'>('minutes');
 const [logStart,setLogStart]=useState('');
 const [logEnd,setLogEnd]=useState('');
 const logRangeMinutes=logStart && logEnd ? minuteValue(logEnd)-minuteValue(logStart) : 0;
 const logLength=logMode==='range' ? logRangeMinutes : Math.round(Number(logMinutes));
 const logValid=logLength>=1 && logLength<=1440 &&
  (logMode==='range' ? !!logStart && !!logEnd : logMinutes.trim()!=='');
 const [logBusy,setLogBusy]=useState<string|null>(null);
 const [logError,setLogError]=useState('');
 const canEditLogs=!!onEditSession && !!onDeleteSession;
 // Adding a session covers the case the timer was never started at all.
 const [adding,setAdding]=useState(false);
 const [addDate,setAddDate]=useState(todayLocal);
 const [addMinutes,setAddMinutes]=useState('');
 // Some sessions are remembered as "about 45 minutes", others as "2 till 3".
 const [addMode,setAddMode]=useState<'minutes'|'range'>('minutes');
 const [addStart,setAddStart]=useState('');
 const [addEnd,setAddEnd]=useState('');
 const rangeMinutes=addStart && addEnd ? minuteValue(addEnd)-minuteValue(addStart) : 0;
 const addLength=addMode==='range' ? rangeMinutes : Math.round(Number(addMinutes));
 const addValid=!!addDate && addLength>=1 && addLength<=1440 &&
  (addMode==='range' ? !!addStart && !!addEnd : addMinutes.trim()!=='');
 const runLog=async(id:string,fn:()=>Promise<void>)=>{
  setLogBusy(id);setLogError('');
  try{await fn();if(id!=='add')setEditingLog(null);}
  catch(err){setLogError(err instanceof Error ? err.message : 'Could not update that session.');}
  finally{setLogBusy(null);}
 };
 // The course a block already belongs to must stay selectable even when it has
 // been archived, otherwise opening the editor would silently reassign the task.
 const courseOptions=Array.from(new Set([
  ...(draft.block && !draft.block.external ? [draft.block.subject] : []),
  ...knownSubjects,
  'Personal',
 ].filter(Boolean)));
 const chosenSubject=creatingCourse ? newCourse.trim() : subject;
 const isNewSubject=type==='study' && !!chosenSubject && !courseOptions.some(n=>n.toLowerCase()===chosenSubject.toLowerCase());
 const hasTime=!live || scheduled || type==='commitment';
 const collisions=blocks.filter(b=>b.day===draft.day && b.id!==draft.block?.id && b.time && start && end && minuteValue(b.time.split('–')[0])<minuteValue(end) && minuteValue(b.time.split('–')[1])>minuteValue(start));
 return <section className={styles.editor} aria-label="Block editor"><div className={styles.sectionHeading}><h2>{draft.block ? 'Edit block' : 'Add a block'}</h2><button onClick={onCancel} aria-label="Close block editor">Close</button></div><p className={styles.description}>{live ? 'Title, subject, and completion apply to the task and all of its scheduled sessions. Times apply only to this block.' : 'Changes update your plan and subject progress.'}</p><form onSubmit={async e=>{e.preventDefault();if(saving)return;if(!title.trim() || !chosenSubject){setError(creatingCourse && !newCourse.trim() ? 'Name the new course.' : 'Enter a title and subject.');return;}if(hasTime && (!start || !end || minuteValue(end)<=minuteValue(start))){setError('End time must be later than start time.');return;}setSaving(true);setError('');try {await onSave({...draft.block,id:draft.block?.id ?? Date.now(),title:title.trim(),subject:type==='commitment' ? 'Personal commitment' : chosenSubject,time:hasTime ? `${start}–${end}` : '',minutes:hasTime ? minuteValue(end)-minuteValue(start) : 0,color:type==='commitment' ? 'neutral' : colors[chosenSubject] ?? 'blue',subjectColor:isNewSubject ? nextUnusedColor(usedColors.map(color=>({color}))) : undefined,state:type==='commitment' ? 'Planned' : state,day:draft.day,external:type==='commitment',manual:true});}catch(err){setError(err instanceof Error ? err.message : 'Could not save. Please try again.');}finally{setSaving(false);}}}>
 <label>Title<input autoFocus required maxLength={150} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <div className={styles.editorFields}><label>Type<select aria-label="Type" value={type} onChange={e=>setType(e.target.value)}><option value="study">Study session</option><option value="commitment">Personal commitment</option></select></label><label>Subject<select aria-label="Subject" disabled={type==='commitment'} value={creatingCourse ? NEW_COURSE : subject} onChange={e=>{if(e.target.value===NEW_COURSE){setCreatingCourse(true);}else{setCreatingCourse(false);setSubject(e.target.value);}}}>{courseOptions.map(s=><option key={s} value={s}>{s}</option>)}<option value={NEW_COURSE}>+ New course…</option></select></label></div>
 {creatingCourse && <><label>New course name<input aria-label="New course name" autoFocus maxLength={80} value={newCourse} onChange={e=>setNewCourse(e.target.value)} placeholder="e.g. World History"/></label><p className={styles.editorNote}>Pick its colour in Settings → Courses.</p></>}
 {live && type==='study' && <label><span><input type="checkbox" checked={scheduled} onChange={e=>setScheduled(e.target.checked)}/> Schedule a time</span></label>}
 {hasTime && <div className={styles.editorFields}><label>Start time<input type="time" required value={start} onChange={e=>setStart(e.target.value)}/></label><label>End time<input type="time" required value={end} onChange={e=>setEnd(e.target.value)}/></label></div>}
 {type==='study' && <label>Status<select aria-label="Status" value={state} onChange={e=>setState(e.target.value as PlanState)}><option value="Planned">Incomplete</option><option value="Completed">Completed</option><option value="Partially completed">Partially completed</option>{!live && <option value="Missed">Missed</option>}{state==='Proposal' && <option value="Proposal">Proposal</option>}</select></label>}
 {draft.block?.actualSeconds ? <p className={styles.editorNote}>{Math.round(draft.block.actualSeconds/60)} minutes worked will be kept. Marking incomplete removes completion credit, not actual study time.</p> : null}
 {hasTime && collisions.length>0 && <p className={styles.overlapNotice}>Overlaps {collisions.map(b=>b.title).join(', ')}. You can save it alongside these blocks.</p>}
 {(logs.length>0 || (live && !!onAddSession)) && <section className={styles.focusLog} aria-label="Past focus sessions"><h3>Past sessions</h3><ul>{logs.slice(0,6).map(l=>{
  const day=new Date(`${l.date}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'});
  const busy=logBusy===l.id;
  if(canEditLogs && editingLog===l.id) return <li key={l.id} className={styles.logEditingBox}>
   <div className={styles.logEditingHead}><span>{day}</span>
    <div className={styles.logAddMode} role="group" aria-label="How to correct the session">
     <button type="button" aria-pressed={logMode==='minutes'} onClick={()=>setLogMode('minutes')}>Length</button>
     <button type="button" aria-pressed={logMode==='range'} onClick={()=>setLogMode('range')}>Start and end</button>
    </div>
   </div>
   {logMode==='minutes'
    ? <div className={styles.logEditing}>
      <input className={styles.logInput} type="number" min={0} max={1440} step={1} autoFocus aria-label={`Minutes studied on ${day}`} value={logMinutes} disabled={busy}
       onChange={e=>setLogMinutes(e.target.value)}
       onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setEditingLog(null);}}}/>
      <span className={styles.logUnit}>min</span>
     </div>
    : <div className={styles.logEditing}>
      <label>Start<input type="time" autoFocus aria-label={`Start time on ${day}`} value={logStart} disabled={busy} onChange={e=>setLogStart(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setEditingLog(null);}}}/></label>
      <label>End<input type="time" aria-label={`End time on ${day}`} value={logEnd} disabled={busy} onChange={e=>setLogEnd(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setEditingLog(null);}}}/></label>
     </div>}
   {logMode==='range' && logStart && logEnd && logRangeMinutes<=0 && <p className={styles.editorNote}>End time must be later than start time.</p>}
   {logMode==='range' && logRangeMinutes>0 && <p className={styles.editorNote}>{logRangeMinutes} minutes.</p>}
   <div className={styles.logAddButtons}>
    <button type="button" disabled={busy || !logValid} onClick={()=>{
     if(logMode==='minutes' && logLength===l.minutes){setEditingLog(null);return;}
     void runLog(l.id,()=>onEditSession!(l.id,logLength,logMode==='range' ? logStart : undefined));
    }}>{busy ? 'Saving…' : 'Save'}</button>
    <button type="button" disabled={busy} aria-label={`Cancel editing the session on ${day}`} onClick={()=>setEditingLog(null)}>Cancel</button>
   </div>
  </li>;
  const range=sessionRange(l,timeFormat);
  return <li key={l.id}>
   <span>{day}</span>
   {range && <span className={styles.logRange}>{range}</span>}
   <strong>{l.minutes} min</strong>
   {canEditLogs && <span className={styles.logActions}>
    <button type="button" disabled={busy} aria-label={`Edit the ${l.minutes} minute session on ${day}`} onClick={()=>{
     setLogError('');setLogMinutes(String(l.minutes));
     setLogStart(l.start ? clockOf(l.start) : '');setLogEnd(l.end ? clockOf(l.end) : '');
     setLogMode('minutes');setEditingLog(l.id);
    }}>Edit</button>
    <button type="button" disabled={busy} aria-label={`Delete the ${l.minutes} minute session on ${day}`} onClick={()=>{
     if(!window.confirm(`Delete the ${l.minutes}-minute session from ${day}? This removes the study time for good.`))return;
     void runLog(l.id,()=>onDeleteSession!(l.id));
    }}>{busy ? '…' : 'Delete'}</button>
   </span>}
  </li>;
 })}</ul>{logError && <p role="alert" className={styles.editorNote}>{logError}</p>}{logs.length>6 && <small>{logs.length-6} earlier {logs.length-6===1 ? 'session' : 'sessions'} not shown.</small>}{logs.length>0 && <><small>{logs.reduce((n,l)=>n+l.minutes,0)} minutes recorded on this task.</small>{canEditLogs && <small>Slept with the timer running? Correct the minutes or delete the session.</small>}</>}{logs.length===0 && <small>No study time recorded on this task yet.</small>}{onAddSession && (adding ? <div className={styles.logAdd}>
  <label>Date<input type="date" max={todayLocal()} value={addDate} onChange={e=>setAddDate(e.target.value)}/></label>
  <div className={styles.logAddMode} role="group" aria-label="How to enter the session">
   <button type="button" aria-pressed={addMode==='minutes'} onClick={()=>setAddMode('minutes')}>Length</button>
   <button type="button" aria-pressed={addMode==='range'} onClick={()=>setAddMode('range')}>Start and end</button>
  </div>
  {addMode==='minutes'
   ? <label>Minutes<input type="number" min={1} max={1440} step={1} autoFocus value={addMinutes} placeholder="45" onChange={e=>setAddMinutes(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setAdding(false);}}}/></label>
   : <>
     <label>Start<input type="time" autoFocus value={addStart} onChange={e=>setAddStart(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setAdding(false);}}}/></label>
     <label>End<input type="time" value={addEnd} onChange={e=>setAddEnd(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setAdding(false);}}}/></label>
     {addStart && addEnd && rangeMinutes<=0 && <p className={styles.editorNote}>End time must be later than start time.</p>}
     {rangeMinutes>0 && <p className={styles.editorNote}>{rangeMinutes} minutes.</p>}
    </>}
  <div className={styles.logAddButtons}>
   <button type="button" disabled={logBusy==='add' || !addValid} onClick={()=>void runLog('add',async()=>{
    await onAddSession(addDate,addLength,addMode==='range' ? addStart : undefined);
    setAdding(false);setAddMinutes('');setAddStart('');setAddEnd('');
   })}>{logBusy==='add' ? 'Adding…' : 'Add session'}</button>
   <button type="button" disabled={logBusy==='add'} aria-label="Cancel adding a session" onClick={()=>setAdding(false)}>Cancel</button>
  </div>
 </div> : <button type="button" className={styles.logAddOpen} onClick={()=>{setLogError('');setAdding(true);setAddDate(todayLocal());setAddMinutes('');setAddStart('');setAddEnd('');}}>Forgot to start the timer? Add a session</button>)}</section>}
 {error && <p role="alert">{error}</p>}
 <div className={styles.editorButtons}><button type="button" onClick={onCancel}>Cancel</button><button disabled={saving} type="submit">{saving ? "Saving…" : "Save block"}</button></div>
 </form></section>;
}
