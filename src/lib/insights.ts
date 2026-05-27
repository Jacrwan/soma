import { storage } from './storage';
import { supabase } from './supabase';
import { Subject } from '../types';

const AI_MEMORY_KEY = 'soma_ai_memory';

interface AIMemoryStore {
  subjectTimeDeltas: Record<string, { totalEstimated: number; totalActual: number; sampleCount: number }>;
  peakHours: Record<number, number>;
  subjectAverageDuration: Record<string, { avg: number; count: number }>;
}

export interface AIMemory {
  subjectTimeDeltas: Record<string, { totalEstimated: number; totalActual: number; sampleCount: number }>;
  peakHours: Record<number, number>;
  subjectAverageDuration: Record<string, number>;
}

function loadAIMemoryStore(): AIMemoryStore {
  const raw = localStorage.getItem(AI_MEMORY_KEY);
  if (!raw) return { subjectTimeDeltas: {}, peakHours: {}, subjectAverageDuration: {} };
  try { return JSON.parse(raw); } catch { return { subjectTimeDeltas: {}, peakHours: {}, subjectAverageDuration: {} }; }
}

export function getAIMemory(): AIMemory | null {
  const store = loadAIMemoryStore();
  const hasAny =
    Object.keys(store.subjectTimeDeltas).length > 0 ||
    Object.keys(store.peakHours).length > 0 ||
    Object.keys(store.subjectAverageDuration).length > 0;
  if (!hasAny) return null;
  return {
    subjectTimeDeltas: store.subjectTimeDeltas,
    peakHours: store.peakHours,
    subjectAverageDuration: Object.fromEntries(
      Object.entries(store.subjectAverageDuration).map(([id, { avg }]) => [id, avg])
    ),
  };
}

export function updateAIMemory(session: {
  subjectId: string;
  startHour: number;
  durationMinutes: number;
  estimatedMinutes?: number;
}): void {
  if (!storage.getSomaSettings().aiMemory.enabled) return;
  const store = loadAIMemoryStore();

  // peak hours
  store.peakHours[session.startHour] = (store.peakHours[session.startHour] ?? 0) + session.durationMinutes;

  // subject average duration (rolling)
  const prev = store.subjectAverageDuration[session.subjectId] ?? { avg: 0, count: 0 };
  const newCount = prev.count + 1;
  store.subjectAverageDuration[session.subjectId] = {
    avg: (prev.avg * prev.count + session.durationMinutes) / newCount,
    count: newCount,
  };

  // estimated vs actual delta (only when estimated is provided)
  if (session.estimatedMinutes != null && session.estimatedMinutes > 0) {
    const prevDelta = store.subjectTimeDeltas[session.subjectId] ?? { totalEstimated: 0, totalActual: 0, sampleCount: 0 };
    store.subjectTimeDeltas[session.subjectId] = {
      totalEstimated: prevDelta.totalEstimated + session.estimatedMinutes,
      totalActual: prevDelta.totalActual + session.durationMinutes,
      sampleCount: prevDelta.sampleCount + 1,
    };
  }

  localStorage.setItem(AI_MEMORY_KEY, JSON.stringify(store));
}

export function resetTimeAccuracy(): void {
  const store = loadAIMemoryStore();
  store.subjectTimeDeltas = {};
  localStorage.setItem(AI_MEMORY_KEY, JSON.stringify(store));
}

export function resetPeakHours(): void {
  const store = loadAIMemoryStore();
  store.peakHours = {};
  localStorage.setItem(AI_MEMORY_KEY, JSON.stringify(store));
}

export function resetSubjectPacing(): void {
  const store = loadAIMemoryStore();
  store.subjectAverageDuration = {};
  localStorage.setItem(AI_MEMORY_KEY, JSON.stringify(store));
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function blockDateKey(isoTime: string): string {
  return dateKey(new Date(isoTime));
}


function last7DayKeys(weekOffset = 0): string[] {
  const keys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + weekOffset * 7 - i);
    keys.push(dateKey(d));
  }
  return keys;
}

function computeStreak(daysWithData: Set<string>): number {
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; ; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (daysWithData.has(dateKey(d))) streak++;
    else break;
  }
  return streak;
}

function lsElapsedMinutesForDays(days: string[]): { day: string; minutes: number }[] {
  return days.map(day => {
    const raw = localStorage.getItem(`soma_elapsed_${day}`);
    if (!raw) return { day, minutes: 0 };
    try {
      const data: Record<string, number> = JSON.parse(raw);
      return { day, minutes: Math.round(Object.values(data).reduce((s, m) => s + m, 0)) };
    } catch { return { day, minutes: 0 }; }
  });
}

export async function getWeeklyStudyTime(weekOffset = 0): Promise<{ day: string; minutes: number }[]> {
  const days = last7DayKeys(weekOffset);
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data, error } = await supabase
        .from('timer_sessions')
        .select('date, duration_seconds')
        .eq('user_id', user.id)
        .gte('date', days[0])
        .lte('date', days[days.length - 1]);
      if (!error) {
        const byDay = new Map<string, number>();
        for (const row of data ?? []) {
          byDay.set(row.date, (byDay.get(row.date) ?? 0) + row.duration_seconds);
        }
        return days.map(day => ({ day, minutes: Math.round((byDay.get(day) ?? 0) / 60) }));
      }
    }
  } catch { /* fall through */ }
  return lsElapsedMinutesForDays(days);
}

export async function getSubjectBreakdown(): Promise<{ subjectName: string; minutes: number; color: string }[]> {
  const subjects = storage.getSubjects();
  const subjectMap = new Map<string, Subject>(subjects.map(s => [s.id, s]));
  const days = last7DayKeys();
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data, error } = await supabase
        .from('timer_sessions')
        .select('subject_id, subject_name, duration_seconds')
        .eq('user_id', user.id)
        .gte('date', days[0])
        .lte('date', days[days.length - 1]);
      if (!error) {
        const bySubject = new Map<string, { seconds: number; name: string }>();
        for (const row of data ?? []) {
          const prev = bySubject.get(row.subject_id);
          bySubject.set(row.subject_id, {
            seconds: (prev?.seconds ?? 0) + row.duration_seconds,
            name: prev?.name ?? row.subject_name ?? 'Unknown',
          });
        }
        return [...bySubject.entries()]
          .map(([id, { seconds, name }]) => ({
            subjectName: subjectMap.get(id)?.name ?? name,
            color: subjectMap.get(id)?.color ?? '#91a7ff',
            minutes: Math.round(seconds / 60),
          }))
          .filter(r => r.minutes > 0)
          .sort((a, b) => b.minutes - a.minutes);
      }
    }
  } catch { /* fall through */ }
  // Fallback: soma_elapsed_* keys
  const minutesById = new Map<string, number>();
  for (const day of days) {
    const raw = localStorage.getItem(`soma_elapsed_${day}`);
    if (!raw) continue;
    try {
      const data: Record<string, number> = JSON.parse(raw);
      for (const [id, m] of Object.entries(data)) minutesById.set(id, (minutesById.get(id) ?? 0) + m);
    } catch { /* skip */ }
  }
  return [...minutesById.entries()]
    .map(([id, minutes]) => ({
      subjectName: subjectMap.get(id)?.name ?? 'Unknown',
      color: subjectMap.get(id)?.color ?? '#91a7ff',
      minutes: Math.round(minutes),
    }))
    .sort((a, b) => b.minutes - a.minutes);
}

export async function getEstimatedVsActual(): Promise<{ text: string; estimated: number; actual: number }[]> {
  const todos = storage.getTodos().filter(t => (t.estimatedMinutes ?? 0) > 0);
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data, error } = await supabase
        .from('timer_sessions')
        .select('task_text, subject_id, duration_seconds')
        .eq('user_id', user.id)
        .not('task_text', 'is', null);
      if (!error) {
        const byTask = new Map<string, number>();
        for (const row of data ?? []) {
          if (!row.task_text) continue;
          const key = `${row.task_text}||${row.subject_id ?? ''}`;
          byTask.set(key, (byTask.get(key) ?? 0) + row.duration_seconds);
        }
        return todos
          .map(t => {
            const key = `${t.text}||${t.subjectId ?? ''}`;
            const actual = Math.floor((byTask.get(key) ?? 0) / 60);
            return { text: t.text, estimated: t.estimatedMinutes!, actual };
          })
          .filter(r => r.actual > 0);
      }
    }
  } catch { /* fall through */ }
  // Fallback: localStorage soma_sessions
  const sessions = storage.getTimerSessions();
  return todos
    .map(t => ({
      text: t.text,
      estimated: t.estimatedMinutes!,
      actual: Math.floor(
        sessions
          .filter(s => s.task === t.text && s.subjectId === t.subjectId)
          .reduce((sum, s) => sum + s.durationSeconds, 0) / 60
      ),
    }))
    .filter(r => r.actual > 0);
}

export async function getStudyStreak(): Promise<number> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data, error } = await supabase
        .from('timer_sessions')
        .select('date')
        .eq('user_id', user.id);
      if (!error) return computeStreak(new Set((data ?? []).map(r => r.date as string)));
    }
  } catch { /* fall through */ }
  return computeStreak(new Set(storage.getTimeBlocks().map(b => blockDateKey(b.startTime))));
}

export async function getHeatmapMinutes(year: number, month: number): Promise<Record<number, number>> {
  const pad = (n: number) => String(n).padStart(2, '0');
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDate = `${year}-${pad(month + 1)}-01`;
  const endDate   = `${year}-${pad(month + 1)}-${pad(daysInMonth)}`;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data, error } = await supabase
        .from('timer_sessions')
        .select('date, duration_seconds')
        .eq('user_id', user.id)
        .gte('date', startDate)
        .lte('date', endDate);
      if (!error) {
        const byDay: Record<number, number> = {};
        for (const row of data ?? []) {
          const d = parseInt(row.date.slice(8), 10);
          byDay[d] = (byDay[d] ?? 0) + Math.round(row.duration_seconds / 60);
        }
        return byDay;
      }
    }
  } catch { /* fall through */ }
  // Fallback: soma_elapsed_* keys
  const byDay: Record<number, number> = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const raw = localStorage.getItem(`soma_elapsed_${year}-${pad(month + 1)}-${pad(d)}`);
    if (!raw) continue;
    try {
      const data: Record<string, number> = JSON.parse(raw);
      byDay[d] = Math.round(Object.values(data).reduce((s, m) => s + m, 0));
    } catch { /* skip */ }
  }
  return byDay;
}
