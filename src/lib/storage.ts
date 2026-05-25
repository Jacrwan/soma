import { Subject, TimeBlock, TimerSession, CanvasAssignment, CanvasAnnouncement, CanvasModule, CanvasCourse, Todo, GoogleCalendarEvent, ChatSession } from '../types';

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
};

const KEYS = {
  subjects: 'soma_subjects',
  timeBlocks: 'soma_blocks',
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
  todos: 'soma_todos',
  googleToken: 'soma_google_token',
  googleClientId: 'soma_google_client_id',
  googleEvents: 'soma_google_events',
  googleCacheTimestamp: 'soma_google_cache_timestamp',
  chatSessions: 'soma_chat_sessions',
  activeSessionId: 'soma_active_session_id',
  canvasCourseNames: 'soma_canvas_course_names',
};

const DEFAULT_SUBJECTS: Subject[] = [];

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

function get<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function set(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const storage = {
  getSubjects: (): Subject[] => get(KEYS.subjects, DEFAULT_SUBJECTS),
  setSubjects: (v: Subject[]) => set(KEYS.subjects, v),

  getTimeBlocks: (): TimeBlock[] => get(KEYS.timeBlocks, []),
  setTimeBlocks: (v: TimeBlock[]) => set(KEYS.timeBlocks, v),

  getTimerSessions: (): TimerSession[] => get(KEYS.timerSessions, []),
  setTimerSessions: (v: TimerSession[]) => set(KEYS.timerSessions, v),

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

  getAnthropicKey: (): string => get(KEYS.anthropicKey, ''),
  setAnthropicKey: (v: string) => set(KEYS.anthropicKey, v),

  getTodos: (): Todo[] => {
    const todos = get<Todo[]>(KEYS.todos, []);
    if (!todos.some(t => !t.date)) return todos;
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const migrated = todos.map(t => t.date ? t : { ...t, date: todayKey });
    set(KEYS.todos, migrated);
    return migrated;
  },
  setTodos: (v: Todo[]) => set(KEYS.todos, v),

  getGoogleToken: (): string => get(KEYS.googleToken, ''),
  setGoogleToken: (v: string) => set(KEYS.googleToken, v),

  getGoogleClientId: (): string => get(KEYS.googleClientId, ''),
  setGoogleClientId: (v: string) => set(KEYS.googleClientId, v),

  getCachedGoogleEvents: (): GoogleCalendarEvent[] => get(KEYS.googleEvents, []),
  setCachedGoogleEvents: (v: GoogleCalendarEvent[]) => set(KEYS.googleEvents, v),

  getGoogleCacheTimestamp: (): number | null => get<number | null>(KEYS.googleCacheTimestamp, null),
  setGoogleCacheTimestamp: (v: number) => set(KEYS.googleCacheTimestamp, v),

  getChatSessions: (): ChatSession[] => get(KEYS.chatSessions, []),
  setChatSessions: (v: ChatSession[]) => set(KEYS.chatSessions, v),

  getActiveSessionId: (): string => get(KEYS.activeSessionId, ''),
  setActiveSessionId: (v: string) => set(KEYS.activeSessionId, v),

  getCanvasCourseNames: (): string[] => get(KEYS.canvasCourseNames, []),
  setCanvasCourseNames: (v: string[]) => set(KEYS.canvasCourseNames, v),

  getSomaSettings: (): SomaSettings => {
    const rawStr = localStorage.getItem('soma_settings');
    if (!rawStr) return DEFAULT_SETTINGS;
    try {
      const raw = JSON.parse(rawStr) as Record<string, unknown>;
      // Migrate: old flat availability → personalHours
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
        localStorage.setItem('soma_settings', JSON.stringify(migrated));
        return migrated;
      }
      return { ...DEFAULT_SETTINGS, ...raw } as SomaSettings;
    } catch {
      return DEFAULT_SETTINGS;
    }
  },
  setSomaSettings: (v: SomaSettings) => set('soma_settings', v),
};
