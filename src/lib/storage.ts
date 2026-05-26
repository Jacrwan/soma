import { supabase } from './supabase';
import { Subject, TimeBlock, TimerSession, CanvasAssignment, CanvasAnnouncement, CanvasModule, CanvasCourse, Todo, GoogleCalendarEvent, ChatSession } from '../types';

const SOMA_TODOS_KEY = 'soma_todos';
const SOMA_BLOCKS_KEY = 'soma_blocks';
const SOMA_SETTINGS_KEY = 'soma_settings';

interface DayAvailability {
  start: string;
  end: string;
  blocked: { start: string; end: string }[];
}

interface WeekSchedule {
  monday: DayAvailability;
  tuesday: DayAvailability;
  wednesday: DayAvailability;
  thursday: DayAvailability;
  friday: DayAvailability;
  saturday: DayAvailability;
  sunday: DayAvailability;
}

export interface SomaSettings {
  schoolHours: WeekSchedule;
  workHours: WeekSchedule;
  personalHours: WeekSchedule;
  schoolHoursEnabled: boolean;
  workHoursEnabled: boolean;
  personalHoursEnabled: boolean;
  studyPrefs: {
    defaultSessionMinutes: number;
    defaultBreakMinutes: number;
    preferredStartTime: string;
  };
  aiPrefs: {
    verbosity: 'concise' | 'detailed';
    defaultOutput: 'schedule' | 'todos';
  };
  aiMemory: {
    enabled: boolean;
  };
  theme: 'dark' | 'light';
}

export interface AIMemoryStore {
  subjectTimeDeltas: Record<string, { totalEstimated: number; totalActual: number; sampleCount: number }>;
  peakHours: Record<number, number>;
  subjectAverageDuration: Record<string, { avg: number; count: number }>;
}

export interface ScheduleBlock {
  id: string;
  user_id?: string;
  date: string;
  subject_id?: string | null;
  subject_name?: string | null;
  task_name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  color?: string | null;
  created_at?: string;
}

const DEFAULT_DAY: DayAvailability = { start: '08:00', end: '22:00', blocked: [] };
const DEFAULT_EMPTY_DAY: DayAvailability = { start: '', end: '', blocked: [] };

function emptyWeek(): WeekSchedule {
  return {
    monday: { ...DEFAULT_EMPTY_DAY },
    tuesday: { ...DEFAULT_EMPTY_DAY },
    wednesday: { ...DEFAULT_EMPTY_DAY },
    thursday: { ...DEFAULT_EMPTY_DAY },
    friday: { ...DEFAULT_EMPTY_DAY },
    saturday: { ...DEFAULT_EMPTY_DAY },
    sunday: { ...DEFAULT_EMPTY_DAY },
  };
}

function defaultPersonalWeek(): WeekSchedule {
  return {
    monday: { ...DEFAULT_DAY },
    tuesday: { ...DEFAULT_DAY },
    wednesday: { ...DEFAULT_DAY },
    thursday: { ...DEFAULT_DAY },
    friday: { ...DEFAULT_DAY },
    saturday: { ...DEFAULT_DAY },
    sunday: { ...DEFAULT_DAY },
  };
}

const DEFAULT_SETTINGS: SomaSettings = {
  schoolHours: emptyWeek(),
  workHours: emptyWeek(),
  personalHours: defaultPersonalWeek(),
  schoolHoursEnabled: true,
  workHoursEnabled: true,
  personalHoursEnabled: true,
  studyPrefs: {
    defaultSessionMinutes: 50,
    defaultBreakMinutes: 10,
    preferredStartTime: '09:00',
  },
  aiPrefs: {
    verbosity: 'concise',
    defaultOutput: 'schedule',
  },
  aiMemory: {
    enabled: true,
  },
  theme: 'dark',
};

// ── localStorage helpers (Canvas cache, tokens, session state) ────────────

const KEYS = {
  subjects: 'soma_subjects',
  timerSessions: 'soma_sessions',
  canvasToken: 'canvas_token',
  canvasBaseUrl: 'canvas_base_url',
  assignmentStatus: 'canvas_assignment_status',
  clearedAssignments: 'canvas_cleared_assignments',
  cachedCourses: 'soma_cached_courses',
  cachedAssignments: 'soma_canvas_cache',
  cachedAnnouncements: 'soma_cached_announcements',
  cachedModules: 'soma_cached_modules',
  cacheTimestamp: 'soma_canvas_cache_timestamp',
  anthropicKey: 'anthropic_api_key',
  googleToken: 'soma_google_token',
  googleClientId: 'soma_google_client_id',
  googleEvents: 'soma_google_events',
  googleCacheTimestamp: 'soma_google_cache_timestamp',
  chatSessions: 'soma_chat_sessions',
  activeSessionId: 'soma_active_session_id',
  canvasCourseNames: 'soma_canvas_course_names',
};

function get<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function set(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function uid(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  return user!.id;
}

// ── Utility ───────────────────────────────────────────────────────────────

export function inferSubjectId(
  text: string,
  subjects: Subject[],
  assignments: CanvasAssignment[],
): string | undefined {
  const lower = text.toLowerCase();
  for (const s of subjects) {
    if (s.name.length > 1 && lower.includes(s.name.toLowerCase())) return s.id;
  }
  for (const a of assignments) {
    if (a.courseName.length > 1 && lower.includes(a.courseName.toLowerCase())) {
      const match = subjects.find(s => s.name.toLowerCase() === a.courseName.toLowerCase());
      if (match) return match.id;
    }
  }
  return undefined;
}

// ── storage object ────────────────────────────────────────────────────────

export const storage = {

  // ── Subjects (localStorage) ──────────────────────────────────────────
  getSubjects: (): Subject[] => get(KEYS.subjects, []),
  setSubjects: (v: Subject[]) => set(KEYS.subjects, v),

  // ── Timer sessions (localStorage) ───────────────────────────────────
  getTimerSessions: (): TimerSession[] => get(KEYS.timerSessions, []),
  setTimerSessions: (v: TimerSession[]) => set(KEYS.timerSessions, v),

  // ── Canvas (localStorage) ────────────────────────────────────────────
  getCanvasToken: (): string => get(KEYS.canvasToken, ''),
  setCanvasToken: (v: string) => set(KEYS.canvasToken, v),

  getCanvasBaseUrl: (): string => get(KEYS.canvasBaseUrl, ''),
  setCanvasBaseUrl: (v: string) => set(KEYS.canvasBaseUrl, v),

  getAssignmentStatus: (): Record<number, string> => get(KEYS.assignmentStatus, {}),
  setAssignmentStatus: (v: Record<number, string>) => set(KEYS.assignmentStatus, v),

  getClearedAssignments: (): Record<number, boolean> => get(KEYS.clearedAssignments, {}),
  setClearedAssignments: (v: Record<number, boolean>) => set(KEYS.clearedAssignments, v),

  getCachedCourses: (): CanvasCourse[] => get(KEYS.cachedCourses, []),
  setCachedCourses: (v: CanvasCourse[]) => set(KEYS.cachedCourses, v),

  getCachedAssignments: (): CanvasAssignment[] => get(KEYS.cachedAssignments, []),
  setCachedAssignments: (v: CanvasAssignment[]) => set(KEYS.cachedAssignments, v),

  getCachedAnnouncements: (): CanvasAnnouncement[] => get(KEYS.cachedAnnouncements, []),
  setCachedAnnouncements: (v: CanvasAnnouncement[]) => set(KEYS.cachedAnnouncements, v),

  getCachedModules: (): CanvasModule[] => get(KEYS.cachedModules, []),
  setCachedModules: (v: CanvasModule[]) => set(KEYS.cachedModules, v),

  getCacheTimestamp: (): number | null => get<number | null>(KEYS.cacheTimestamp, null),
  setCacheTimestamp: (v: number) => set(KEYS.cacheTimestamp, v),

  getCanvasCourseNames: (): string[] => get(KEYS.canvasCourseNames, []),
  setCanvasCourseNames: (v: string[]) => set(KEYS.canvasCourseNames, v),

  // ── Anthropic (localStorage) ─────────────────────────────────────────
  getAnthropicKey: (): string => get(KEYS.anthropicKey, ''),
  setAnthropicKey: (v: string) => set(KEYS.anthropicKey, v),

  // ── Google Calendar (localStorage) ──────────────────────────────────
  getGoogleToken: (): string => get(KEYS.googleToken, ''),
  setGoogleToken: (v: string) => set(KEYS.googleToken, v),

  getGoogleClientId: (): string => get(KEYS.googleClientId, ''),
  setGoogleClientId: (v: string) => set(KEYS.googleClientId, v),

  getCachedGoogleEvents: (): GoogleCalendarEvent[] => get(KEYS.googleEvents, []),
  setCachedGoogleEvents: (v: GoogleCalendarEvent[]) => set(KEYS.googleEvents, v),

  getGoogleCacheTimestamp: (): number | null => get<number | null>(KEYS.googleCacheTimestamp, null),
  setGoogleCacheTimestamp: (v: number) => set(KEYS.googleCacheTimestamp, v),

  // ── AI chat sessions (localStorage) ─────────────────────────────────
  getChatSessions: (): ChatSession[] => get(KEYS.chatSessions, []),
  setChatSessions: (v: ChatSession[]) => set(KEYS.chatSessions, v),

  getActiveSessionId: (): string => get(KEYS.activeSessionId, ''),
  setActiveSessionId: (v: string) => set(KEYS.activeSessionId, v),

  // ── Time blocks (localStorage) ───────────────────────────────────────
  getTimeBlocks: (): TimeBlock[] => get(SOMA_BLOCKS_KEY, []),
  setTimeBlocks: (v: TimeBlock[]) => set(SOMA_BLOCKS_KEY, v),

  // ── Todos sync (localStorage) ────────────────────────────────────────
  getTodos: (): Todo[] => get(SOMA_TODOS_KEY, []),
  setTodos: (v: Todo[]) => set(SOMA_TODOS_KEY, v),

  // ── Settings sync (localStorage) ─────────────────────────────────────
  getSomaSettings(): SomaSettings {
    const rawStr = localStorage.getItem(SOMA_SETTINGS_KEY);
    if (!rawStr) return DEFAULT_SETTINGS;
    try {
      const raw = JSON.parse(rawStr) as Record<string, unknown>;
      if (raw.availability && !raw.personalHours) {
        const migrated: SomaSettings = {
          ...DEFAULT_SETTINGS,
          studyPrefs: (raw.studyPrefs as SomaSettings['studyPrefs']) ?? DEFAULT_SETTINGS.studyPrefs,
          aiPrefs: (raw.aiPrefs as SomaSettings['aiPrefs']) ?? DEFAULT_SETTINGS.aiPrefs,
          aiMemory: (raw.aiMemory as SomaSettings['aiMemory']) ?? DEFAULT_SETTINGS.aiMemory,
          personalHours: raw.availability as WeekSchedule,
          schoolHours: emptyWeek(),
          workHours: emptyWeek(),
        };
        localStorage.setItem(SOMA_SETTINGS_KEY, JSON.stringify(migrated));
        return migrated;
      }
      return { ...DEFAULT_SETTINGS, ...raw } as SomaSettings;
    } catch {
      return DEFAULT_SETTINGS;
    }
  },
  setSomaSettings: (v: SomaSettings) => set(SOMA_SETTINGS_KEY, v),

  // ── Todos (Supabase) ─────────────────────────────────────────────────
  async fetchTodos(date: string): Promise<Todo[]> {
    const id = await uid();
    const { data } = await supabase
      .from('todos')
      .select('*')
      .eq('user_id', id)
      .eq('date', date);
    return (data ?? []).map(r => ({
      id: r.id,
      text: r.text,
      status: r.status ?? 'nothing',
      subjectId: r.subject_id ?? undefined,
      assignmentId: r.assignment_id ?? undefined,
      date: r.date,
      estimatedMinutes: r.estimated_minutes ?? undefined,
    } as Todo));
  },

  async saveTodo(todo: Todo): Promise<void> {
    const id = await uid();
    await supabase.from('todos').upsert({
      id: todo.id,
      user_id: id,
      text: todo.text,
      subject_id: todo.subjectId ?? null,
      assignment_id: todo.assignmentId ?? null,
      estimated_minutes: todo.estimatedMinutes ?? null,
      status: todo.status,
      date: todo.date,
    });
  },

  async deleteTodo(todoId: string): Promise<void> {
    await supabase.from('todos').delete().eq('id', todoId);
  },

  // ── Schedule blocks (Supabase) ───────────────────────────────────────
  async getScheduleBlocks(date: string): Promise<ScheduleBlock[]> {
    const id = await uid();
    const { data } = await supabase
      .from('schedule_blocks')
      .select('*')
      .eq('user_id', id)
      .eq('date', date);
    return data ?? [];
  },

  async saveScheduleBlock(block: Omit<ScheduleBlock, 'user_id' | 'created_at'>): Promise<void> {
    const id = await uid();
    await supabase.from('schedule_blocks').upsert({ ...block, user_id: id });
  },

  async deleteScheduleBlock(blockId: string): Promise<void> {
    await supabase.from('schedule_blocks').delete().eq('id', blockId);
  },

  // ── Elapsed time (Supabase) ──────────────────────────────────────────
  async getElapsed(date: string): Promise<Record<string, number>> {
    const id = await uid();
    const { data } = await supabase
      .from('elapsed_time')
      .select('subject_id, minutes')
      .eq('user_id', id)
      .eq('date', date);
    return Object.fromEntries((data ?? []).map(r => [r.subject_id, r.minutes]));
  },

  async saveElapsed(date: string, subjectId: string, minutes: number): Promise<void> {
    const id = await uid();
    await supabase.from('elapsed_time').upsert(
      { user_id: id, date, subject_id: subjectId, minutes },
      { onConflict: 'user_id,date,subject_id' },
    );
  },

  // ── Settings (Supabase) ──────────────────────────────────────────────
  async getSettings(): Promise<SomaSettings> {
    const id = await uid();
    const { data } = await supabase
      .from('settings')
      .select('data')
      .eq('user_id', id)
      .single();
    if (!data?.data) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(data.data as Partial<SomaSettings>) };
  },

  async saveSettings(settings: SomaSettings): Promise<void> {
    const id = await uid();
    await supabase.from('settings').upsert({ user_id: id, data: settings });
  },

  // ── AI memory (Supabase) ─────────────────────────────────────────────
  async getAIMemory(): Promise<AIMemoryStore | null> {
    const id = await uid();
    const { data } = await supabase
      .from('ai_memory')
      .select('data')
      .eq('user_id', id)
      .single();
    if (!data?.data) return null;
    return data.data as AIMemoryStore;
  },

  async saveAIMemory(memoryData: AIMemoryStore): Promise<void> {
    const id = await uid();
    await supabase.from('ai_memory').upsert({ user_id: id, data: memoryData });
  },
};
