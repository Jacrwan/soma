import type { Snapshot } from '../components/DashboardV2/liveData';
import type { PlanBlock } from '../components/DashboardV2/PlanEditor';
import type { SomaSettings } from './storage';
const minuteValue=(s:string)=>{const [h,m]=s.split(':').map(Number);return h*60+m;};
const dateAt=(origin:Date,day:number)=>{const d=new Date(origin);d.setDate(d.getDate()+day);return d;};
const localDate=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export function validateProposal(block:PlanBlock,snapshot:Snapshot,origin:Date,settings:SomaSettings) {
 if(snapshot.calendarError)throw new Error(snapshot.calendarError);
 const [start,end]=block.time.split('–');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start??'') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end??''))throw new Error('Soma returned an invalid time. Ask for another proposal.');
 const from=minuteValue(start),to=minuteValue(end),date=dateAt(origin,block.day);
 if(to<=from || to-from>240)throw new Error('Study proposals must be between 1 minute and 4 hours.');
 if(new Date(`${localDate(date)}T${start}:00`)<new Date())throw new Error('That start time has passed. Ask Soma for a new time.');
 const starts=new Date(`${localDate(date)}T${start}:00`),ends=new Date(`${localDate(date)}T${end}:00`);
 if(snapshot.sessions.some(s=>s.startTime && s.endTime && new Date(s.startTime)<ends && new Date(s.endTime)>starts))throw new Error('That time overlaps a scheduled session. Ask Soma for another time.');
 if(snapshot.blocks.some(b=>b.day===block.day && b.time && minuteValue(b.time.split('–')[0])<to && minuteValue(b.time.split('–')[1])>from))throw new Error('That time overlaps your current plan. Ask Soma for another time.');
 const day=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][date.getDay()] as keyof typeof settings.personalHours;
 const personal=settings.personalHours[day];
 if(settings.personalHoursEnabled && personal.start && personal.end && (from<minuteValue(personal.start)||to>minuteValue(personal.end)))throw new Error('That time is outside your available study hours.');
 const conflicts=(a:string,b:string)=>!!a && !!b && minuteValue(a)<to && minuteValue(b)>from;
 if(settings.personalHoursEnabled && personal.blocked.some(b=>conflicts(b.start,b.end)))throw new Error('That time is blocked in your availability settings.');
 for(const [enabled,hours] of [[settings.schoolHoursEnabled,settings.schoolHours],[settings.workHoursEnabled,settings.workHours]] as const){if(enabled && conflicts(hours[day].start,hours[day].end))throw new Error('That time overlaps school or work hours.');}
}

