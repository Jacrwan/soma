import { storage } from './storage';
import { supabase } from './supabase';
import { Subject } from '../types';

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

export async function getPeakHours(): Promise<Record<number, number>> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data, error } = await supabase
        .from('timer_sessions')
        .select('start_time, duration_seconds')
        .eq('user_id', user.id);
      if (!error && data) {
        const byHour: Record<number, number> = {};
        for (const row of data) {
          if (!row.start_time) continue;
          const hour = new Date(row.start_time).getHours();
          byHour[hour] = (byHour[hour] ?? 0) + Math.round(row.duration_seconds / 60);
        }
        return byHour;
      }
    }
  } catch { /* fall through */ }
  // Fallback: localStorage timer sessions
  const byHour: Record<number, number> = {};
  for (const s of storage.getTimerSessions()) {
    const hour = new Date(s.startTime).getHours();
    byHour[hour] = (byHour[hour] ?? 0) + Math.round(s.durationSeconds / 60);
  }
  return byHour;
}

export async function getSubjectPacing(): Promise<Record<string, number>> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data, error } = await supabase
        .from('timer_sessions')
        .select('subject_id, duration_seconds')
        .eq('user_id', user.id);
      if (!error && data) {
        const bySubject: Record<string, { total: number; count: number }> = {};
        for (const row of data) {
          if (!row.subject_id) continue;
          const prev = bySubject[row.subject_id] ?? { total: 0, count: 0 };
          bySubject[row.subject_id] = { total: prev.total + row.duration_seconds, count: prev.count + 1 };
        }
        return Object.fromEntries(
          Object.entries(bySubject).map(([id, { total, count }]) => [id, Math.round(total / count / 60)])
        );
      }
    }
  } catch { /* fall through */ }
  // Fallback: localStorage timer sessions
  const bySubject: Record<string, { total: number; count: number }> = {};
  for (const s of storage.getTimerSessions()) {
    const prev = bySubject[s.subjectId] ?? { total: 0, count: 0 };
    bySubject[s.subjectId] = { total: prev.total + s.durationSeconds, count: prev.count + 1 };
  }
  return Object.fromEntries(
    Object.entries(bySubject).map(([id, { total, count }]) => [id, Math.round(total / count / 60)])
  );
}

export async function getTimeAccuracy(): Promise<Record<string, { avgDeltaMinutes: number; sampleCount: number }>> {
  const todos = storage.getTodos().filter(t => (t.estimatedMinutes ?? 0) > 0);
  if (todos.length === 0) return {};
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data, error } = await supabase
        .from('timer_sessions')
        .select('task_text, subject_id, duration_seconds')
        .eq('user_id', user.id)
        .not('task_text', 'is', null);
      if (!error && data) {
        const byTask = new Map<string, number>();
        for (const row of data) {
          if (!row.task_text) continue;
          const key = `${row.task_text}||${row.subject_id ?? ''}`;
          byTask.set(key, (byTask.get(key) ?? 0) + row.duration_seconds);
        }
        return buildTimeAccuracy(todos, (todo) => {
          const key = `${todo.text}||${todo.subjectId ?? ''}`;
          return Math.floor((byTask.get(key) ?? 0) / 60);
        });
      }
    }
  } catch { /* fall through */ }
  // Fallback: localStorage timer sessions
  const sessions = storage.getTimerSessions();
  return buildTimeAccuracy(todos, (todo) =>
    Math.floor(
      sessions
        .filter(s => s.task === todo.text && s.subjectId === todo.subjectId)
        .reduce((sum, s) => sum + s.durationSeconds, 0) / 60
    )
  );
}

function buildTimeAccuracy(
  todos: ReturnType<typeof storage.getTodos>,
  getActualMinutes: (todo: (typeof todos)[number]) => number,
): Record<string, { avgDeltaMinutes: number; sampleCount: number }> {
  const bySubject: Record<string, { totalDelta: number; count: number }> = {};
  for (const todo of todos) {
    const actual = getActualMinutes(todo);
    if (actual === 0) continue;
    const id = todo.subjectId ?? '';
    const prev = bySubject[id] ?? { totalDelta: 0, count: 0 };
    bySubject[id] = {
      totalDelta: prev.totalDelta + (actual - todo.estimatedMinutes!),
      count: prev.count + 1,
    };
  }
  return Object.fromEntries(
    Object.entries(bySubject).map(([id, { totalDelta, count }]) => [
      id,
      { avgDeltaMinutes: Math.round(totalDelta / count), sampleCount: count },
    ])
  );
}
