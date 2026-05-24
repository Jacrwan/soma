import { storage } from './storage';
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

function blockDurationMinutes(startTime: string, endTime: string): number {
  return Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60_000);
}

function last7DayKeys(): string[] {
  const keys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    keys.push(dateKey(d));
  }
  return keys;
}

export function getWeeklyStudyTime(): { day: string; minutes: number }[] {
  const blocks = storage.getTimeBlocks();
  const days = last7DayKeys();
  const minutesByDay = new Map(days.map(d => [d, 0]));

  for (const block of blocks) {
    const key = blockDateKey(block.startTime);
    if (minutesByDay.has(key)) {
      minutesByDay.set(key, minutesByDay.get(key)! + blockDurationMinutes(block.startTime, block.endTime));
    }
  }

  const result = days.map(day => ({ day, minutes: Math.round(minutesByDay.get(day)!) }));
  console.log('[insights] getWeeklyStudyTime:', result);
  return result;
}

export function getSubjectBreakdown(): { subjectName: string; minutes: number }[] {
  const blocks = storage.getTimeBlocks();
  const subjects = storage.getSubjects();
  const subjectMap = new Map<string, Subject>(subjects.map(s => [s.id, s]));
  const days = new Set(last7DayKeys());
  const minutesById = new Map<string, number>();

  for (const block of blocks) {
    if (!days.has(blockDateKey(block.startTime))) continue;
    const prev = minutesById.get(block.subjectId) ?? 0;
    minutesById.set(block.subjectId, prev + blockDurationMinutes(block.startTime, block.endTime));
  }

  const result = [...minutesById.entries()]
    .map(([id, minutes]) => ({
      subjectName: subjectMap.get(id)?.name ?? 'Unknown',
      minutes: Math.round(minutes),
    }))
    .sort((a, b) => b.minutes - a.minutes);

  console.log('[insights] getSubjectBreakdown:', result);
  return result;
}

export function getEstimatedVsActual(): { text: string; estimated: number; actual: number }[] {
  const todos = storage.getTodos();
  const sessions = storage.getTimerSessions();

  const result = todos
    .filter(t => t.estimatedMinutes != null && t.estimatedMinutes > 0)
    .map(t => {
      const actual = Math.floor(
        sessions
          .filter(s => s.task === t.text && s.subjectId === t.subjectId)
          .reduce((sum, s) => sum + s.durationSeconds, 0) / 60
      );
      return { text: t.text, estimated: t.estimatedMinutes!, actual };
    })
    .filter(row => row.actual > 0);

  console.log('[insights] getEstimatedVsActual:', result);
  return result;
}

export function getStudyStreak(): number {
  const blocks = storage.getTimeBlocks();
  const daysWithBlocks = new Set(blocks.map(b => blockDateKey(b.startTime)));

  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; ; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (daysWithBlocks.has(dateKey(d))) {
      streak++;
    } else {
      break;
    }
  }

  console.log('[insights] getStudyStreak:', streak);
  return streak;
}
