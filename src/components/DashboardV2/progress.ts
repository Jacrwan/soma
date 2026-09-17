export type ProgressItem = { minutes: number; actualSeconds?: number; state: string };
export function progressSegments<T extends ProgressItem & {subject: string; color: string}>(items: T[]) {
  const hasSchedule = items.some(item => item.minutes > 0);
  const groups = new Map<string, {subject:string; color:string; planned:number; actual:number; weight:number; credited:number; count:number}>();
  for (const item of items) {
    if (hasSchedule && item.minutes <= 0) continue;
    const group = groups.get(item.subject) ?? {subject:item.subject,color:item.color,planned:0,actual:0,weight:0,credited:0,count:0};
    const actual = Math.max(0, item.actualSeconds ?? 0)/60;
    const weight = hasSchedule ? Math.max(item.minutes, actual) : 1;
    group.planned += Math.max(0,item.minutes);
    group.actual += actual;
    group.weight += weight;
    group.credited += item.state === 'Completed' ? weight : hasSchedule ? actual : 0;
    group.count++;
    groups.set(item.subject,group);
  }
  const total = [...groups.values()].reduce((sum,g)=>sum+g.weight,0);
  return [...groups.values()].map(group=>({...group,total,fill:group.weight ? Math.min(1,group.credited/group.weight) : 0,hasSchedule}));
}
export function overlapGroups<T extends {time: string}>(items: T[]) {
  const minutes = (s: string) => s.split(':').reduce((h,m) => h*60+Number(m),0);
  const sorted = items.filter(b=>b.time).slice().sort((a,b)=>a.time.localeCompare(b.time));
  const groups: {items:T[];start:number;end:number}[] = [];
  for (const item of sorted) {
    const [start,end] = item.time.split('–').map(minutes);
    const last = groups[groups.length-1];
    if (last && start < last.end) { last.items.push(item); last.end=Math.max(last.end,end); }
    else groups.push({items:[item],start,end});
  }
  return groups;
}
export const clockLabel = (n:number) => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
