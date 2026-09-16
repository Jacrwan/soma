import { supabase } from './supabase';

interface StudySession {
  id: string;
  date: string;
  subject_id: string | null;
  subject_name: string | null;
  task_text: string | null;
  start_time: string | null;
  duration_seconds: number;
}
interface InsightSubject { id: string; name: string; color: string; archived: boolean }
interface InsightTodo { id: string; text: string; subject_id: string | null; estimated_minutes: number | null }
export interface InsightsData {
  sessions: StudySession[];
  subjects: InsightSubject[];
  todos: InsightTodo[];
}
interface Snapshot { data: InsightsData | null; loading: boolean; error: string | null }
interface CacheEntry {
  snapshot: Snapshot;
  updatedAt: number;
  day: string;
  version: number;
  pending?: Promise<void>;
  listeners: Set<() => void>;
}
const EMPTY: Snapshot = { data: null, loading: true, error: null };
const cache = new Map<string, CacheEntry>();
const FRESH_MS = 30_000;
const PAGE_SIZE = 1000;

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function entryFor(userId: string): CacheEntry {
  let entry = cache.get(userId);
  if (!entry) {
    entry = { snapshot: EMPTY, updatedAt: 0, day: '', version: 0, listeners: new Set() };
    cache.set(userId, entry);
  }
  return entry;
}
function publish(entry: CacheEntry, snapshot: Snapshot) {
  entry.snapshot = snapshot;
  entry.listeners.forEach(listener => listener());
}
export function getInsightsSnapshot(userId: string | null): Snapshot {
  return userId ? entryFor(userId).snapshot : EMPTY;
}
export function subscribeInsights(userId: string, listener: () => void) {
  const entry = entryFor(userId);
  entry.listeners.add(listener);
  return () => { entry.listeners.delete(listener); };
}

async function fetchRows<Row>(table: string, columns: string, userId: string): Promise<Row[]> {
  const rows: Row[] = [];
  // PostgREST caps responses at 1000 rows. Stable pagination preserves older
  // history used by streaks, peak hours, pacing and estimate accuracy.
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.from(table).select(columns)
      .eq('user_id', userId).order('id')
      .range(offset, offset + PAGE_SIZE - 1)
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export function loadInsights(userId: string, force = false): Promise<void> {
  const entry = entryFor(userId);
  if (entry.pending) return entry.pending;
  if (!force && entry.snapshot.data && Date.now() - entry.updatedAt < FRESH_MS && entry.day === dateKey(new Date())) {
    return Promise.resolve();
  }
  const version = entry.version;
  publish(entry, { ...entry.snapshot, loading: true, error: null });
  const request = Promise.all([
    fetchRows<StudySession>('timer_sessions', 'id,date,subject_id,subject_name,task_text,start_time,duration_seconds', userId),
    fetchRows<InsightSubject>('subjects', 'id,name,color,archived', userId),
    fetchRows<InsightTodo>('todos', 'id,text,subject_id,estimated_minutes', userId),
  ]).then(([sessions, subjects, todos]) => {
    if (entry.version !== version) return;
    entry.updatedAt = Date.now();
    entry.day = dateKey(new Date());
    publish(entry, { data: { sessions, subjects, todos }, loading: false, error: null });
  }).catch(() => {
    if (entry.version !== version) return;
    publish(entry, { ...entry.snapshot, loading: false, error: 'Could not load insights. Please try again.' });
  }).finally(() => {
    if (entry.version === version) entry.pending = undefined;
  });
  entry.pending = request;
  return request;
}

// This listener remains active between route visits so a completed study
// session invalidates cached charts even when Insights is not mounted.
function invalidateInsights() {
  cache.forEach((entry, userId) => {
    entry.updatedAt = 0;
    entry.version++;
    entry.pending = undefined;
    if (entry.listeners.size) void loadInsights(userId, true);
  });
}
if (typeof window !== 'undefined') {
  for (const event of ['soma_insights_changed', 'soma_subjects_changed', 'soma_todos_changed']) {
    window.addEventListener(event, invalidateInsights);
  }
}

export function summarizeInsights(data: InsightsData | null, weekOffset: number, calendarOffset: number, now = new Date()) {
  const sessions = data?.sessions ?? [];
  const subjects = data?.subjects ?? [];
  const todos = data?.todos ?? [];
  const subjectMap = new Map(subjects.map(subject => [subject.id, subject]));
  const dayKeys = (offset: number) => Array.from({ length: 7 }, (_, i) => {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offset * 7 - 6 + i);
    return dateKey(day);
  });
  const currentWeek = new Set(dayKeys(0));
  const month = new Date(now.getFullYear(), now.getMonth() + calendarOffset, 1);
  const monthPrefix = dateKey(month).slice(0, 7);
  const secondsByDay = new Map<string, number>();
  const bySubject = new Map<string, { seconds: number; name: string }>();
  const byTask = new Map<string, number>();
  const heatmapMinutesMap: Record<number, number> = {};
  const peakHoursData: Record<number, number> = {};
  const pacing = new Map<string, { seconds: number; count: number }>();
  const studiedDays = new Set<string>();

  for (const session of sessions) {
    const seconds = session.duration_seconds ?? 0;
    secondsByDay.set(session.date, (secondsByDay.get(session.date) ?? 0) + seconds);
    studiedDays.add(session.date);
    const subjectId = session.subject_id ?? '';
    if (currentWeek.has(session.date)) {
      const prev = bySubject.get(subjectId);
      bySubject.set(subjectId, {
        seconds: (prev?.seconds ?? 0) + seconds,
        name: prev?.name ?? session.subject_name ?? 'Unknown',
      });
    }
    if (session.task_text) {
      const key = JSON.stringify([session.task_text, subjectId]);
      byTask.set(key, (byTask.get(key) ?? 0) + seconds);
    }
    if (session.date.startsWith(monthPrefix)) {
      const day = Number(session.date.slice(8));
      heatmapMinutesMap[day] = (heatmapMinutesMap[day] ?? 0) + Math.round(seconds / 60);
    }
    if (session.start_time) {
      const hour = new Date(session.start_time).getHours();
      peakHoursData[hour] = (peakHoursData[hour] ?? 0) + Math.round(seconds / 60);
    }
    if (session.subject_id) {
      const prev = pacing.get(subjectId);
      pacing.set(subjectId, { seconds: (prev?.seconds ?? 0) + seconds, count: (prev?.count ?? 0) + 1 });
    }
  }
  const weekly = dayKeys(weekOffset).map(day => ({ day, minutes: Math.round((secondsByDay.get(day) ?? 0) / 60) }));
  const breakdown = [...bySubject].map(([id, value]) => ({
    subjectName: subjectMap.get(id)?.name ?? value.name,
    color: subjectMap.get(id)?.color ?? '#91a7ff',
    minutes: Math.round(value.seconds / 60),
  })).filter(item => item.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  const estimated = todos.filter(todo => (todo.estimated_minutes ?? 0) > 0).map(todo => ({
    text: todo.text, estimated: todo.estimated_minutes!,
    actual: Math.floor((byTask.get(JSON.stringify([todo.text, todo.subject_id ?? ''])) ?? 0) / 60),
    subjectId: todo.subject_id ?? '',
  })).filter(item => item.actual > 0);
  const accuracy = new Map<string, { delta: number; count: number }>();
  for (const todo of estimated) {
    const prev = accuracy.get(todo.subjectId);
    accuracy.set(todo.subjectId, { delta: (prev?.delta ?? 0) + todo.actual - todo.estimated, count: (prev?.count ?? 0) + 1 });
  }
  const timeAccuracyData = Object.fromEntries([...accuracy].map(([id, value]) => [id, {
    avgDeltaMinutes: Math.round(value.delta / value.count), sampleCount: value.count,
  }]));
  const subjectPacingData = Object.fromEntries([...pacing].map(([id, value]) => [id, Math.round(value.seconds / value.count / 60)]));
  // Count the run of consecutive studied days ending "today". If today has no
  // session yet, that literally reads as streak=0 even when the user has
  // studied every day up through yesterday and the day isn't over — punishing
  // framing right when someone opens Insights mid-streak. streakAtRisk keeps
  // yesterday's count visible with a "keep it going" framing instead of a
  // hard zero, and only reports a real 0 once yesterday is also unstudied.
  let streak = 0;
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  while (studiedDays.has(dateKey(day))) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  const todayKey = dateKey(now);
  const streakAtRisk = streak === 0 && !studiedDays.has(todayKey);
  let streakDisplay = streak;
  if (streakAtRisk) {
    const yesterday = new Date(now);
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);
    let runEndingYesterday = 0;
    const cursor = new Date(yesterday);
    while (studiedDays.has(dateKey(cursor))) {
      runEndingYesterday++;
      cursor.setDate(cursor.getDate() - 1);
    }
    streakDisplay = runEndingYesterday;
  }
  return {
    weekly, breakdown, estimated, streak: streakDisplay,
    streakAtRisk: streakAtRisk && streakDisplay > 0,
    heatmapMinutesMap, peakHoursData, subjectPacingData, timeAccuracyData, subjects,
  };
}
