import type { Snapshot } from '../components/DashboardV2/liveData';
import type { PlanBlock } from '../components/DashboardV2/PlanEditor';
import type { SomaSettings } from './storage';
import { formatClock } from './timeFormat';
import { clockMinutes as minuteValue, clockOf, rangeOf, spanMinutes, windowOf } from './clockRange';
const dateAt=(origin:Date,day:number)=>{const d=new Date(origin);d.setDate(d.getDate()+day);return d;};
const localDate=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
/**
 * How far into the past a proposed start may sit. The prompt hands the model
 * currentTime to the minute and freeTime quantises open slots to 15 minutes, so
 * "start this now" arrives as a time that is already a few seconds or minutes
 * old by the time it is validated. Without this, that request could never be
 * satisfied at all.
 */
const START_GRACE_MS=15*60*1000;
/** The student's piece sizes for splitting work, in minutes (default 30–120). */
export function chunkSizes(settings:SomaSettings):{min:number;max:number}{
 const c=settings.chunks;
 const min=Math.min(240,Math.max(15,Math.round(c?.min ?? 30)));
 return {min,max:Math.min(240,Math.max(min,Math.round(c?.max ?? 120)))};
}
/**
 * Throws when a proposed block cannot be placed. With allowCommitmentOverlap, a
 * read-only calendar event (e.g. a lecture the student says they'll skip) no
 * longer blocks the proposal; its title is returned instead so the card can
 * show the overlap before the student accepts. Overlaps with the student's own
 * study sessions are always refused. With allowPastStart, the start may be in
 * the past: used when the student accepts a proposal, where the time they spent
 * reading it must not invalidate the block they are deliberately confirming.
 * checkStudyHours is off on Accept too: the hours were checked when Soma
 * proposed it, possibly stretched because the student said they'd stay up.
 */
export function validateProposal(block:PlanBlock,snapshot:Snapshot,origin:Date,settings:SomaSettings,allowCommitmentOverlap=false,allowPastStart=false,checkStudyHours=true):string[] {
 if(snapshot.calendarError)throw new Error(snapshot.calendarError);
 const [start,end]=block.time.split('–');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start??'') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end??''))throw new Error('Soma returned an invalid time. Ask for another proposal.');
 // An end before the start runs past midnight: 23:30–01:00 is 90 minutes.
 const span=spanMinutes(start,end),from=minuteValue(start),to=from+span,date=dateAt(origin,block.day);
 if(span<1 || span>240)throw new Error('Study proposals must be between 1 minute and 4 hours.');
 if(!allowPastStart && new Date(`${localDate(date)}T${start}:00`).getTime()<Date.now()-START_GRACE_MS)throw new Error('That start time has passed. Ask Soma for a new time.');
 const starts=new Date(`${localDate(date)}T${start}:00`),ends=new Date(starts.getTime()+span*60000);
 if(snapshot.sessions.some(s=>s.startTime && s.endTime && new Date(s.startTime)<ends && new Date(s.endTime)>starts))throw new Error('That time overlaps a scheduled session. Ask Soma for another time.');
 // Compared across days, so a block running past midnight meets the next morning's.
 const at=block.day*1440,overlapping=snapshot.blocks.filter(b=>{if(!b.time || b.id===block.id)return false;const [f,t]=rangeOf(b.time);return b.day*1440+f<at+to && b.day*1440+t>at+from;});
 const commitments=overlapping.filter(b=>b.external && !b.manual);
 const own=overlapping.filter(b=>!(b.external && !b.manual));
 if(own.length)throw new Error(`That time overlaps ${own[0].title}. Ask Soma for another time.`);
 if(commitments.length && !allowCommitmentOverlap)throw new Error(`That time is during ${commitments[0].title} on your calendar. Ask Soma for another time, or say you're skipping it.`);
 // Inside today's study hours, or in the after-midnight tail of yesterday's.
 const [open,close]=windowOf(settings.studyWindow);
 if(checkStudyHours && !(from>=open && to<=close) && !(from+1440>=open && to+1440<=close))throw new Error(`That time is outside your study hours (${formatClock(settings.studyWindow.start)}–${formatClock(settings.studyWindow.end)}). Change them in Settings.`);
 return commitments.map(b=>b.title);
}

/**
 * Open time the student could study in, per day, from now onward: the study
 * window minus calendar events and planned blocks. Given to the model so it
 * picks real slots instead of guessing — it was proposing start times that had
 * already passed.
 */
export function freeTime(snapshot:Snapshot,origin:Date,settings:SomaSettings,now=new Date(),days=7,minMinutes=15):{date:string;free:string[]}[] {
 // Minutes counted from the first day's midnight, so study hours and blocks
 // that run past midnight carry on into the next day instead of being cut off.
 const base=new Date(origin);base.setHours(0,0,0,0);
 const nowAt=Math.ceil((now.getTime()-base.getTime())/60000/15)*15;
 const busy=snapshot.blocks.filter(b=>b.time).map(b=>{const [f,t]=rangeOf(b.time);return [b.day*1440+f,b.day*1440+t] as [number,number];}).sort((a,b)=>a[0]-b[0]);
 const [open,close]=windowOf(settings.studyWindow);
 const out=Array.from({length:days},(_,day)=>({date:localDate(dateAt(base,day)),free:[] as string[]}));
 // Yesterday's hours may still be running after midnight.
 for(let day=close>1440 ? -1 : 0;day<days;day++){
  let cursor=Math.max(day*1440+open,nowAt);
  const end=day*1440+close;
  const add=(a:number,z:number)=>{if(z-a<minMinutes)return;const slot=out[Math.floor(a/1440)];if(slot)slot.free.push(`${clockOf(a)}–${clockOf(z)}`);};
  // Classes end at :59; free time starts at the next round five minutes.
  for(const [a,z] of busy){if(z<=cursor)continue;if(a>=end)break;add(cursor,Math.min(a,end));cursor=Math.max(cursor,Math.ceil(z/5)*5);}
  if(cursor<end)add(cursor,end);
 }
 return out;
}
