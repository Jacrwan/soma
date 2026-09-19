import { Fragment, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { Check, Play, Pause, ArrowUpRight, CalendarDays, Mic, Square, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSpeechInput } from '../../lib/useSpeechInput';
import { progressSegments, overlapGroups, clockLabel } from './progress';
import PlanEditor, { type PlanState, type PlanBlock, type EditorDraft } from './PlanEditor';
import { formatClock, formatClockRange, formatClockWithSeconds, useTimeFormat } from '../../lib/timeFormat';
import type { SubjectColor } from '../../types';
import styles from './DashboardV2.module.css';
import { aiErrorMessage } from '../../lib/aiResponse';

type State = PlanState;

type Block = PlanBlock;
const initial: Block[] = [
  { id: 1, title: 'Cell structure review', subject: 'Biology', time: '09:00–09:45', minutes: 45, color: 'green', state: 'Completed', actualSeconds: 25*60, day: 0 },
  { id: 2, title: 'Calculus lecture', subject: 'Google Calendar · Read-only', time: '10:00–11:00', minutes: 60, color: 'neutral', state: 'Planned', day: 0, external: true },
  { id: 3, title: 'Problem set 04', subject: 'Mathematics', time: '13:00–14:00', minutes: 60, color: 'blue', state: 'Planned', day: 0 },
  { id: 4, title: 'Read & annotate chapter 6', subject: 'Literature', time: '14:30–15:15', minutes: 45, color: 'purple', state: 'Partially completed', actualSeconds: 18*60, day: 0 },
  { id: 5, title: 'Lab report outline', subject: 'Biology', time: '16:00–16:30', minutes: 30, color: 'green', state: 'Missed', day: 0 },
  { id: 7, title: 'Office hours', subject: 'Google Calendar · Read-only', time: '13:15–13:45', minutes: 30, color: 'neutral', state: 'Planned', day: 0, external: true },
  { id: 8, title: 'Email professor', subject: 'Personal', time: '', minutes: 0, color: 'blue', state: 'Completed', day: 2 },
  { id: 9, title: 'Organize notes', subject: 'Personal', time: '', minutes: 0, color: 'purple', state: 'Planned', day: 2 },
  { id: 6, title: 'Practice derivatives', subject: 'Mathematics', time: '13:00–14:00', minutes: 60, color: 'blue', state: 'Planned', day: 1 },
];
export interface DashboardRuntime {
 initialConversation: {role:string;text:string}[]; onConversationChange:(items:{role:string;text:string}[])=>void;
 blocks: Block[]; focus: ReactNode; activeId: string | number | null; timerActive: boolean;
 onSave: (block: Block) => Promise<void>;
 onState: (id: string | number, state: State) => Promise<void>;
 onDismiss: (id: string | number) => void;
 /** Apply every pending suggestion in one go. */
 onAcceptAll?: () => Promise<void>;
 onFocus: (block: Block) => void;
 /** The reply, plus the day to show when the proposals landed on another day. */
 onPropose: (text: string, day: number) => Promise<{ reply: string; day?: number }>;
 pulseSeconds: number; pulseDays: number[];
 subjectNames: string[]; usedColors: SubjectColor[];
 /** First day on screen, in days from today (negative = the past), and a way to move it. */
 rangeStart?: number; onRange?: (start: number) => void;
 /** Recorded focus sessions for a block, newest first. */
 logsFor: (block: Block) => { date: string; minutes: number }[];
}
export default function DashboardV2({runtime}:{runtime?:DashboardRuntime}) {
  const timeFormat = useTimeFormat();
  // Keep the newest message in view as the conversation scrolls inside its panel.
  const logRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [origin] = useState(() => new Date());
  const [day, setDay] = useState(0);
  const rangeStart = runtime?.rangeStart ?? 0;
  // Step a week at a time; land on today when coming back to this week.
  function showRange(start: number) { runtime?.onRange?.(start); setDay(start===0 ? 0 : start); setEditor(null); setEditing(false); }
  const [demoBlocks, setBlocks] = useState(initial);
  const blocks = runtime?.blocks ?? demoBlocks;
  const [demoActive, setActive] = useState<string | number | null>(null);
  const active = runtime ? runtime.activeId : demoActive;
  const [started, setStarted] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [tracking, setTracking] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [conversation, setConversation] = useState<{role: string; text: string}[]>(() => runtime?.initialConversation ?? []);
  useEffect(() => { runtime?.onConversationChange(conversation); }, [conversation, runtime]);
  const [draft, setDraft] = useState('');
  const voice = useSpeechInput(setDraft);
  const [message, setMessage] = useState('');
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [conversation, message]);
  const [editing,setEditing]=useState(false);
  const [editor,setEditor]=useState<EditorDraft | null>(null);
  useEffect(() => { document.title = runtime ? 'Dashboard | Soma' : 'Dashboard preview | Soma'; const id = window.setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  const date = new Date(origin); date.setDate(date.getDate() + day);
  const visible = blocks.filter(b => b.day === day).sort((a,b) => a.time.localeCompare(b.time));
  const groups = overlapGroups(visible);
  const unscheduled = visible.filter(b=>!b.time);
  const study = visible.filter(b => !b.external && b.state !== 'Proposal');
  const plannedMinutes = study.reduce((sum,b)=>sum+b.minutes,0);
  const current = blocks.find(b => b.id === active);
  const seconds = elapsed + (started === null ? 0 : Math.max(0, Math.floor((now.getTime() - started) / 1000)));
  const progressItems = study.map(b=>({...b, actualSeconds:(b.actualSeconds ?? 0)+(active===b.id ? seconds : 0)}));
  const segments = progressSegments(progressItems);
  const progress = segments.reduce((sum,s)=>sum+s.weight*s.fill,0)/(segments[0]?.total || 1);
  async function update(id: string | number, state: State) { if(runtime){try{await runtime.onState(id,state);setMessage('Plan saved.');}catch(err){setMessage(err instanceof Error ? err.message : 'Could not save.');}return;} setBlocks(bs => bs.map(b => b.id === id ? { ...b, state } : b)); }
  function start(id: string | number) { if(runtime){const block=blocks.find(b=>b.id===id);if(block)runtime.onFocus(block);return;} if (active !== null && active !== id) return; setActive(id); setStarted(Date.now()); setNow(new Date()); setStopping(false); }
  function pause() { setElapsed(seconds); setStarted(null); }
  function finish(state: State) { if (active !== null) setBlocks(bs=>bs.map(b=>b.id===active ? {...b,state,actualSeconds:(b.actualSeconds ?? 0)+seconds} : b)); setActive(null); setStarted(null); setElapsed(0); setStopping(false); setMessage(state === 'Completed' ? 'Study block completed in this demo.' : 'Progress kept in this demo. Planned times stayed the same.'); }
  // One card for both the timed agenda and the unscheduled list.
  function blockCard(b: Block) {
    return <article key={b.id} data-kind={b.external ? 'event' : 'study'} className={`${styles.block} ${styles[b.color]} ${b.state==='Proposal' ? styles.proposal : ''}`}><div className={styles.blockTime}>{formatClockRange(b.time,timeFormat) || 'Any time'}<span>{b.minutes ? `${b.minutes} min` : 'Unscheduled'}</span></div>{canEdit(b) ? <button type="button" className={styles.blockBody} aria-label={`Edit: ${b.title}`} onClick={()=>openEditor(b)}><span className={styles.subject}>{b.subject}</span><h3>{b.title}</h3><span className={styles.state}>{b.external ? 'Personal commitment' : active===b.id ? (started ? 'In progress' : 'Paused') : b.state}{b.note && ` · ${b.note}`}{b.state==='Completed' && <Check size={13}/>}</span></button> : <div className={styles.blockBody}><span className={styles.subject}>{b.subject}</span><h3>{b.title}</h3><span className={styles.state}>{b.external ? (b.manual ? 'Personal commitment' : 'Read-only commitment') : active===b.id ? (started ? 'In progress' : 'Paused') : b.state}{b.note && ` · ${b.note}`}{b.state==='Completed' && <Check size={13}/>}</span></div>}{!b.external && <div className={styles.actions}>{b.state==='Proposal' ? <><button onClick={()=>update(b.id,'Planned')}>Accept</button><button onClick={()=>runtime ? runtime.onDismiss(b.id) : setBlocks(bs=>bs.filter(x=>x.id!==b.id))}>Dismiss</button></> : b.state==='Completed' ? <Check size={18}/> : <>{tracking && day>=0 && <button disabled={runtime ? runtime.timerActive : active!==null} aria-label={`Start focus: ${b.title}`} onClick={()=>start(b.id)}><Play size={13}/> Focus</button>}<button disabled={active===b.id} aria-label={`Complete: ${b.title}`} onClick={()=>update(b.id,'Completed')}><Check size={14}/></button></>}</div>}</article>;
  }

  function canEdit(block: Block) {
    return (!block.external || !!block.manual) && block.state !== 'Proposal' && active !== block.id;
  }

  function openEditor(block?: Block, start='12:00', end='12:30') {
    setEditor({block,start:block?.time.split('–')[0] || start,end:block?.time.split('–')[1] || end,day});
  }
  async function saveBlock(block:Block) {
    if(runtime){await runtime.onSave(block);setEditor(null);setMessage('Plan saved.');return;}
    setBlocks(bs=>bs.some(b=>b.id===block.id) ? bs.map(b=>b.id===block.id ? block : b) : [...bs,block]);
    setEditor(null);setMessage('Plan updated in this demo. Progress and planning context are up to date.');
  }
  function gapBox(start:number,end:number) {
    return <button className={styles.editGap} onClick={()=>openEditor(undefined,clockLabel(start),clockLabel(end))} aria-label={`Add block in gap ${formatClock(clockLabel(start))}–${formatClock(clockLabel(end))}`}><span>{formatClock(clockLabel(start))}–{formatClock(clockLabel(end))}</span><strong>+ Add in this free time</strong></button>;
  }
  async function propose() {
    if (!draft.trim()) return;
    if(runtime){const text=draft.trim();setDraft('');setConversation(items=>[...items,{role:'You',text}]);setMessage('Soma is thinking…');try{const result=await runtime.onPropose(text,day);setConversation(items=>[...items,{role:'Soma',text:result.reply}]);if(result.day!==undefined && result.day!==day){setDay(result.day);setEditor(null);}setMessage('');}catch(err){setMessage(aiErrorMessage(err));setDraft(text);}return;}
    let slot=9*60;
    for(const group of groups){if(group.end<=slot)continue;if(group.start-slot>=30)break;slot=Math.max(slot,group.end);}
    if(slot+30>24*60){setConversation(items=>[...items,{role:'You',text:draft.trim()},{role:'Soma',text:'Your current plan has no free 30-minute slot after 09:00. Edit a block or choose another day.'}]);setDraft('');return;}
    const slotTime=`${clockLabel(slot)}–${clockLabel(slot+30)}`;
    setBlocks(bs => [...bs, { id: Date.now(), title: draft.trim(), subject: 'Personal', time: slotTime, minutes: 30, color: 'blue', state: 'Proposal', day }]);
    setConversation(items => [...items, {role:'You',text:draft.trim()}, {role:'Soma',text:`I’ve made an example 30-minute block at ${formatClockRange(slotTime,timeFormat)}, using your current plan of ${visible.length} blocks (${plannedMinutes} study minutes). You can accept or dismiss it. This demo finds a free slot in your visible plan; real AI and calendar sync are not connected.`}]);
    setDraft(''); setMessage('Example proposal ready for review.');
  }
  return <div className={`${styles.page} ${runtime ? styles.live : ""}`} data-time-format={timeFormat} data-theme={runtime ? undefined : "light"}>
    {!runtime && <aside className={styles.sidebar}><a className={styles.brand} href="/dashboard">soma<span>study with intention</span></a><nav aria-label="Preview navigation"><span className={styles.selected}><CalendarDays size={17}/> Dashboard</span><a href="/calendar">Calendar <ArrowUpRight size={15}/></a><a href="/insights">Insights <ArrowUpRight size={15}/></a><a href="/ai">Ask Soma <ArrowUpRight size={15}/></a></nav><p className={styles.sideNote}>A little structure.<br/>Room to focus.</p></aside>}
    <main className={styles.main}>
      {!runtime && <div className={styles.preview}><span>Dashboard preview · Sample data · Resets on refresh</span></div>}
      <header className={styles.header}><div><p className={styles.eyebrow}>YOUR DAY, AT A GLANCE</p><h1>{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h1></div><time className={styles.clock} dateTime={now.toISOString()}>{formatClockWithSeconds(now, timeFormat)}</time></header>
      <div className={styles.columns}><div className={styles.planColumn}>
      <section aria-label="Day progress" className={styles.progress}><div><strong>{plannedMinutes ? `${plannedMinutes} min planned across your subjects` : 'Your assignments by subject'}</strong><span>{day === 0 ? 'Today' : date.toLocaleDateString(undefined, {month:'short',day:'numeric'})}</span></div><div className={styles.rail} role="progressbar" aria-label="Study progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress*100)} aria-valuetext={`${Math.round(progress*100)}% of your plan covered. Each subject combines its assignments.`}>{segments.map(segment => <span key={segment.subject} data-testid={`progress-${segment.subject}`} title={`${segment.subject}: ${Math.round(segment.actual)} min worked; ${segment.planned} min planned. ${Math.round(segment.fill*100)}% covered, including credit for finished assignments.`} className={`${styles.segment} ${styles[segment.color]} ${segment.fill===1 ? styles.fullSegment : ''}`} style={{ flexGrow:segment.weight, '--fill': `${segment.fill*100}%` } as CSSProperties}><span className={styles.segmentFill}/></span>)}</div><div className={styles.subjectLegend}>{segments.map(segment=><span key={segment.subject} className={styles[segment.color]}><i/>{segment.subject} <strong>{segment.hasSchedule ? `${segment.planned} min` : `${segment.count} assignments`}</strong>{segment.weight>segment.planned && segment.hasSchedule && <em>+{Math.round(segment.weight-segment.planned)}m</em>}</span>)}</div></section>
      <div className={styles.weekNav}>{runtime?.onRange && <button className={styles.weekStep} aria-label="Earlier week" title="Earlier week" onClick={()=>showRange(rangeStart-7)}><ChevronLeft size={16}/></button>}<div className={styles.week} aria-label={rangeStart===0 ? "Next seven days" : "Seven days shown"}>{Array.from({length:7},(_,k) => { const i = rangeStart+k; const d = new Date(origin); d.setDate(d.getDate()+i); const n = blocks.filter(b=>b.day===i && !b.external).length; return <button key={i} aria-pressed={day===i} onClick={()=>{setDay(i);setEditor(null);}}><span>{i===0 ? 'Today' : d.toLocaleDateString(undefined,{weekday:'short'})}</span><strong>{d.getDate()}</strong><small>{n ? `${n} ${n===1 ? 'block' : 'blocks'}` : i<0 ? 'Nothing logged' : 'Open day'}</small></button>; })}</div>{runtime?.onRange && <button className={styles.weekStep} aria-label="Later week" title="Later week" onClick={()=>showRange(rangeStart+7)}><ChevronRight size={16}/></button>}</div>{rangeStart!==0 && <p className={styles.rangeLabel}><span>{(()=>{const a=new Date(origin);a.setDate(a.getDate()+rangeStart);const b=new Date(origin);b.setDate(b.getDate()+rangeStart+6);return `${a.toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${b.toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;})()}</span><button className={styles.backToToday} onClick={()=>showRange(0)}>Back to this week</button></p>}
      <section className={styles.section}><div className={styles.sectionHeading}><h2>{day===0 ? 'Today’s plan' : day<0 ? `${date.toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'})}` : 'Your plan'}</h2><div className={styles.planTools}>{runtime?.onAcceptAll && blocks.some(b=>b.state==='Proposal') && !editing && <button className={styles.acceptAll} onClick={()=>void runtime.onAcceptAll?.()}>Accept all ({blocks.filter(b=>b.state==='Proposal').length})</button>}{editing && <button onClick={()=>openEditor()}>+ Add block</button>}<button aria-pressed={editing} onClick={()=>{setEditing(!editing);setEditor(null);}}>{editing ? 'Done editing' : 'Edit plan'}</button></div></div><p className={styles.description}>A place for your work, and space between it.</p>
      <div className={styles.agenda}>
      {unscheduled.length>0 && <div className={styles.unscheduledGroup}><p className={styles.unscheduledLabel}>Any time today</p><div className={styles.single}>{unscheduled.map(b=>blockCard(b))}</div></div>}
      {editing && groups.length>0 && groups[0].start>0 && gapBox(0,groups[0].start)}{visible.length===0 && <p className={styles.empty}>{day<0 ? 'Nothing was planned for this day.' : 'Nothing planned yet. Add a block or tell Soma what you need to do.'}</p>}{groups.map((group,index)=>{const previous=groups[index-1];const gap=previous ? group.start-previous.end : 0;return <Fragment key={group.items[0].id}>{gap>0 && (editing ? gapBox(previous.end,group.start) : <div className={styles.gap}><span>{formatClock(clockLabel(previous.end),timeFormat)}–{formatClock(clockLabel(group.start),timeFormat)}</span><strong>{gap>=60 ? `${Math.floor(gap/60)}h${gap%60 ? ` ${gap%60}m` : ''}` : `${gap} min`} open</strong><i/></div>)}<div className={group.items.length>1 ? styles.concurrent : styles.single} aria-label={group.items.length>1 ? 'Overlapping commitments' : undefined}>{group.items.map(b=>blockCard(b))}</div></Fragment>})}{editing && groups.length>0 && groups[groups.length-1].end<1439 && gapBox(groups[groups.length-1].end,1439)}{editing && groups.length===0 && gapBox(9*60,17*60)}</div></section>
</div><aside className={styles.right}>{editor ? <PlanEditor key={`${editor.block?.id ?? "new"}-${editor.start}-${editor.end}-${editor.day}`} draft={editor} blocks={blocks} live={!!runtime} knownSubjects={runtime ? runtime.subjectNames : Array.from(new Set(blocks.filter(b=>!b.external).map(b=>b.subject)))} usedColors={runtime?.usedColors ?? []} logs={editor.block && runtime ? runtime.logsFor(editor.block) : []} onSave={saveBlock} onCancel={()=>setEditor(null)}/> : <section className={styles.chat} aria-label="Ask Soma chat"><div className={styles.sectionHeading}><h2>Ask Soma</h2><span>Planning companion</span></div><div ref={logRef} className={styles.conversation} role="log" aria-label="Conversation"><div className={styles.somaMessage}><strong>Soma</strong><p>What’s on your mind? Drop your assignments, deadlines, and everything you’re trying to get done here.</p></div>{conversation.map((item,i)=><div key={i} className={item.role==='You' ? styles.userMessage : styles.somaMessage}><strong>{item.role}</strong><p>{item.text}</p></div>)}</div><form onSubmit={e=>{e.preventDefault();voice.stop();propose();}}><label className={styles.srOnly} htmlFor="thought">What do you need to work on?</label><textarea id="thought" value={draft} onChange={e=>setDraft(e.target.value)} placeholder="I have a lab report, a quiz Friday, and…" maxLength={1000}/><div className={styles.formFooter}><small>{voice.listening ? 'Listening… tap stop when you\'re done' : runtime ? "Proposals need your approval" : "Demo chat · AI not connected"}</small><span className={styles.composerActions}>{voice.supported && <button type="button" className={`${styles.micButton}${voice.listening ? ` ${styles.micOn}` : ''}`} aria-pressed={voice.listening} aria-label={voice.listening ? 'Stop dictation' : 'Dictate'} title={voice.listening ? 'Stop dictation' : 'Dictate'} onClick={()=>voice.listening ? voice.stop() : voice.start(draft)}>{voice.listening ? <Square size={12}/> : <Mic size={14}/>}</button>}<button disabled={!draft.trim() || message==='Soma is thinking…'} type="submit" aria-label="Send to Soma">Send <ArrowUpRight size={14}/></button></span></div>{voice.error && <p role="alert" className={styles.message}>{voice.error}</p>}</form><p role="status" className={styles.message}>{message}</p></section>}{runtime ? runtime.focus : <section className={styles.focus}><div className={styles.sectionHeading}><h2>Focus</h2><label className={styles.toggle}><input type="checkbox" checked={tracking} disabled={active!==null} onChange={e=>setTracking(e.target.checked)}/> Track time</label></div>{tracking ? <><p className={styles.description}>{current ? current.subject : 'One thing at a time.'}</p><h3>{current?.title ?? 'Ready when you are'}</h3><div className={styles.timer}>{String(Math.floor(seconds/60)).padStart(2,'0')}<span>:</span>{String(seconds%60).padStart(2,'0')}</div>{current ? <div className={styles.focusActions}>{stopping ? <><button onClick={()=>finish('Completed')}>Finished</button><button onClick={()=>finish('Partially completed')}>Continue later</button><button onClick={()=>finish('Planned')}>Stopped for now</button></> : <><button onClick={()=>started ? pause() : start(active!)}>{started ? <Pause size={14}/> : <Play size={14}/>} {started ? 'Pause' : 'Resume'}</button><button onClick={()=>{pause();setStopping(true);}}>Stop</button></>}</div> : <p className={styles.description}>Choose Focus on a study block to begin.</p>}<small>Actual work is tracked separately from your plan.</small></> : <p className={styles.description}>Time tracking is off. You can still plan your day and complete your work.</p>}</section>}
</aside></div>
    </main></div>;
}
