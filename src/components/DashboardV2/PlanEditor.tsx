import { useState } from 'react';
import { nextUnusedColor } from '../../lib/subjectColors';
import type { SubjectColor } from '../../types';
import styles from './DashboardV2.module.css';
export type PlanState = 'Planned' | 'Completed' | 'Partially completed' | 'Missed' | 'Proposal';
export type PlanBlock = { id:string | number; title:string; subject:string; time:string; minutes:number; color:string; state:PlanState; day:number; actualSeconds?:number; external?:boolean; manual?:boolean; subjectColor?:SubjectColor; /** Shown on a proposal card, e.g. which calendar event it overlaps. */ note?:string; /** A suggested change to an existing block rather than a new one. */ replaces?:string|number; changeKind?:'move'|'remove'|'update' };
export type EditorDraft = { block?:PlanBlock; start:string; end:string; day:number };
const colors:Record<string,string>={Biology:'green',Mathematics:'blue',Literature:'purple',Personal:'blue'};
const NEW_COURSE='__new_course__';
export const minuteValue = (s:string) => {const [h,m]=s.split(':').map(Number);return h*60+m;};
export type FocusLog = { id:string; date:string; minutes:number };
export default function PlanEditor({draft,blocks,onSave,onCancel,live=false,knownSubjects=[],usedColors=[],logs=[],onEditSession,onDeleteSession}:{live?:boolean;draft:EditorDraft;blocks:PlanBlock[];knownSubjects?:string[];usedColors?:SubjectColor[];logs?:FocusLog[];onSave:(block:PlanBlock)=>void | Promise<void>;onCancel:()=>void;onEditSession?:(sessionId:string,minutes:number)=>Promise<void>;onDeleteSession?:(sessionId:string)=>Promise<void>}) {
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
 const [logBusy,setLogBusy]=useState<string|null>(null);
 const [logError,setLogError]=useState('');
 const canEditLogs=!!onEditSession && !!onDeleteSession;
 const runLog=async(id:string,fn:()=>Promise<void>)=>{
  setLogBusy(id);setLogError('');
  try{await fn();setEditingLog(null);}
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
 {logs.length>0 && <section className={styles.focusLog} aria-label="Past focus sessions"><h3>Past sessions</h3><ul>{logs.slice(0,6).map(l=>{
  const day=new Date(`${l.date}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'});
  const busy=logBusy===l.id;
  if(canEditLogs && editingLog===l.id) return <li key={l.id} className={styles.logEditing}>
   <span>{day}</span>
   <input className={styles.logInput} type="number" min={0} max={1440} step={1} autoFocus aria-label={`Minutes studied on ${day}`} value={logMinutes} disabled={busy}
    onChange={e=>setLogMinutes(e.target.value)}
    onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setEditingLog(null);}}}/>
   <span className={styles.logUnit}>min</span>
   <button type="button" disabled={busy || logMinutes.trim()==='' || Number(logMinutes)<0 || Number(logMinutes)>1440} onClick={()=>{
    const next=Math.round(Number(logMinutes));
    if(next===l.minutes){setEditingLog(null);return;}
    void runLog(l.id,()=>onEditSession!(l.id,next));
   }}>{busy ? 'Saving…' : 'Save'}</button>
   <button type="button" disabled={busy} aria-label={`Cancel editing the session on ${day}`} onClick={()=>setEditingLog(null)}>Cancel</button>
  </li>;
  return <li key={l.id}>
   <span>{day}</span>
   <strong>{l.minutes} min</strong>
   {canEditLogs && <span className={styles.logActions}>
    <button type="button" disabled={busy} aria-label={`Edit the ${l.minutes} minute session on ${day}`} onClick={()=>{setLogError('');setLogMinutes(String(l.minutes));setEditingLog(l.id);}}>Edit</button>
    <button type="button" disabled={busy} aria-label={`Delete the ${l.minutes} minute session on ${day}`} onClick={()=>{
     if(!window.confirm(`Delete the ${l.minutes}-minute session from ${day}? This removes the study time for good.`))return;
     void runLog(l.id,()=>onDeleteSession!(l.id));
    }}>{busy ? '…' : 'Delete'}</button>
   </span>}
  </li>;
 })}</ul>{logError && <p role="alert" className={styles.editorNote}>{logError}</p>}{logs.length>6 && <small>{logs.length-6} earlier {logs.length-6===1 ? 'session' : 'sessions'} not shown.</small>}<small>{logs.reduce((n,l)=>n+l.minutes,0)} minutes recorded on this task.</small>{canEditLogs && <small>Slept with the timer running? Correct the minutes or delete the session.</small>}</section>}
 {error && <p role="alert">{error}</p>}
 <div className={styles.editorButtons}><button type="button" onClick={onCancel}>Cancel</button><button disabled={saving} type="submit">{saving ? "Saving…" : "Save block"}</button></div>
 </form></section>;
}
