import type { Snapshot } from '../components/DashboardV2/liveData';
import type { PlanBlock } from '../components/DashboardV2/PlanEditor';
import type { SomaSettings } from './storage';
const minuteValue=(s:string)=>{const [h,m]=s.split(':').map(Number);return h*60+m;};
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
/**
 * Throws when a proposed block cannot be placed. With allowCommitmentOverlap, a
 * read-only calendar event (e.g. a lecture the student says they'll skip) no
 * longer blocks the proposal; its title is returned instead so the card can
 * show the overlap before the student accepts. Overlaps with the student's own
 * study sessions are always refused. With allowPastStart, the start may be in
 * the past: used when the student accepts a proposal, where the time they spent
 * reading it must not invalidate the block they are deliberately confirming.
 */
export function validateProposal(block:PlanBlock,snapshot:Snapshot,origin:Date,settings:SomaSettings,allowCommitmentOverlap=false,allowPastStart=false):string[] {
 if(snapshot.calendarError)throw new Error(snapshot.calendarError);
 const [start,end]=block.time.split('–');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start??'') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end??''))throw new Error('Soma returned an invalid time. Ask for another proposal.');
 const from=minuteValue(start),to=minuteValue(end),date=dateAt(origin,block.day);
 if(to<=from || to-from>240)throw new Error('Study proposals must be between 1 minute and 4 hours.');
 if(!allowPastStart && new Date(`${localDate(date)}T${start}:00`).getTime()<Date.now()-START_GRACE_MS)throw new Error('That start time has passed. Ask Soma for a new time.');
 const starts=new Date(`${localDate(date)}T${start}:00`),ends=new Date(`${localDate(date)}T${end}:00`);
 if(snapshot.sessions.some(s=>s.startTime && s.endTime && new Date(s.startTime)<ends && new Date(s.endTime)>starts))throw new Error('That time overlaps a scheduled session. Ask Soma for another time.');
 const overlapping=snapshot.blocks.filter(b=>b.day===block.day && b.time && b.id!==block.id && minuteValue(b.time.split('–')[0])<to && minuteValue(b.time.split('–')[1])>from);
 const commitments=overlapping.filter(b=>b.external && !b.manual);
 const own=overlapping.filter(b=>!(b.external && !b.manual));
 if(own.length)throw new Error(`That time overlaps ${own[0].title}. Ask Soma for another time.`);
 if(commitments.length && !allowCommitmentOverlap)throw new Error('That time overlaps your current plan. Ask Soma for another time.');
 const day=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][date.getDay()] as keyof typeof settings.personalHours;
 const personal=settings.personalHours[day];
 if(settings.personalHoursEnabled && personal.start && personal.end && (from<minuteValue(personal.start)||to>minuteValue(personal.end)))throw new Error('That time is outside your available study hours.');
 const conflicts=(a:string,b:string)=>!!a && !!b && minuteValue(a)<to && minuteValue(b)>from;
 if(settings.personalHoursEnabled && personal.blocked.some(b=>conflicts(b.start,b.end)))throw new Error('That time is blocked in your availability settings.');
 for(const [enabled,hours] of [[settings.schoolHoursEnabled,settings.schoolHours],[settings.workHoursEnabled,settings.workHours]] as const){if(enabled && conflicts(hours[day].start,hours[day].end))throw new Error('That time overlaps school or work hours.');}
 return commitments.map(b=>b.title);
}

/**
 * Open time the student could study in, per day, from now onward: availability
 * hours minus calendar events, planned blocks, school/work hours and blocked
 * periods. Given to the model so it picks real slots instead of guessing — it
 * was proposing start times that had already passed.
 */
export function freeTime(snapshot:Snapshot,origin:Date,settings:SomaSettings,now=new Date(),days=7,minMinutes=15):{date:string;free:string[]}[] {
 const hhmm=(m:number)=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
 const out:{date:string;free:string[]}[]=[];
 for(let day=0;day<days;day++){
  const date=dateAt(origin,day);
  const key=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][date.getDay()] as keyof typeof settings.personalHours;
  const personal=settings.personalHours?.[key];
  const custom=!!(settings.personalHoursEnabled && personal?.start && personal?.end);
  let open=custom ? minuteValue(personal.start) : 8*60;
  const close=custom ? minuteValue(personal.end) : 22*60;
  if(localDate(date)===localDate(now)){const n=now.getHours()*60+now.getMinutes();open=Math.max(open,Math.ceil(n/15)*15);}
  const busy:[number,number][]=[];
  for(const b of snapshot.blocks)if(b.day===day && b.time){const [a,z]=b.time.split('–');busy.push([minuteValue(a),minuteValue(z)]);}
  if(settings.personalHoursEnabled)for(const b of personal?.blocked??[])if(b.start && b.end)busy.push([minuteValue(b.start),minuteValue(b.end)]);
  for(const [enabled,hours] of [[settings.schoolHoursEnabled,settings.schoolHours],[settings.workHoursEnabled,settings.workHours]] as const){const h=hours?.[key];if(enabled && h?.start && h?.end)busy.push([minuteValue(h.start),minuteValue(h.end)]);}
  busy.sort((a,b)=>a[0]-b[0]);
  const free:string[]=[];let cursor=open;
  for(const [a,z] of busy){if(z<=cursor)continue;if(a>=close)break;if(a-cursor>=minMinutes)free.push(`${hhmm(cursor)}–${hhmm(Math.min(a,close))}`);cursor=Math.max(cursor,z);}
  if(close-cursor>=minMinutes)free.push(`${hhmm(cursor)}–${hhmm(close)}`);
  out.push({date:localDate(date),free});
 }
 return out;
}
