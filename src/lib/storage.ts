import { supabase } from './supabase';
import { Subject, TimeBlock, TimerSession, CanvasAssignment, CanvasCourse, Todo, TodoSession, GoogleCalendarEvent, ChatMessage, ChatSession } from '../types';

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
  theme: 'dark' | 'light';
  canvasIcalUrl?: string;
  googleToken?: string;
  googleRefreshToken?: string;
  googleDocsToken?: string;
  googleDriveToken?: string;
  googleDriveRefreshToken?: string;
  onboardingCompleted?: boolean;
  educationLevel?: string;
  birthYear?: number;
  bossState?: unknown; // Bosses feature state blob (synced as-is)
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
  theme: 'dark',
};

// ── localStorage helpers (Canvas cache, tokens, session state) ────────────

const KEYS = {
  subjects: 'soma_subjects',
  timerSessions: 'soma_sessions',
  assignmentStatus: 'canvas_assignment_status',
  clearedAssignments: 'canvas_cleared_assignments',
  cachedCourses: 'soma_cached_courses',
  cachedAssignments: 'soma_canvas_cache',
  cacheTimestamp: 'soma_canvas_cache_timestamp',
  canvasIcalUrl: 'soma_canvas_ical_url',
  cachedIcalAssignments: 'soma_ical_assignments',
  googleClientId: 'soma_google_client_id',
  googleEvents: 'soma_google_events',
  googleCacheTimestamp: 'soma_google_cache_timestamp',
  chatSessions: 'soma_chat_sessions',
  activeSessionId: 'soma_active_session_id',
  studyFolder: 'soma_study_folder',
};

function get<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function set(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function coursesFromAssignments(assignments: CanvasAssignment[]): CanvasCourse[] {
  const byId = new Map<number, CanvasCourse>();
  for (const assignment of assignments) {
    if (!assignment.courseName) continue;
    byId.set(assignment.courseId, {
      id: assignment.courseId,
      name: assignment.courseName,
      courseCode: assignment.courseName,
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeIcalAssignment(a: CanvasAssignment): CanvasAssignment {
  const bracketMatch = a.name.match(/\s+\[([^\]]+)\]\s*$/);
  if (!bracketMatch) return a;

  const courseName = bracketMatch[1].trim();
  const name = a.name.slice(0, bracketMatch.index).trim();
  if (!courseName || !name) return a;

  return {
    ...a,
    name,
    courseName,
  };
}

function normalizeIcalAssignments(assignments: CanvasAssignment[]): CanvasAssignment[] {
  return assignments.map(normalizeIcalAssignment);
}

async function uid(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  return user!.id;
}

// In-memory token cache — populated by loadTokens() at auth time.
// Never written to localStorage; source of truth is Supabase settings.
let _canvasIcalUrl = '';
let _googleToken = '';
let _googleRefreshToken = '';
let _googleDocsToken = '';
let _googleDriveToken = '';
let _googleDriveRefreshToken = '';

// In-memory caches for Supabase-backed data.
// Populated by loadSubjects() / loadTodos() at auth time.
// getSubjects() / getTodos() read from here synchronously;
// setSubjects() / setTodos() update here and diff-sync to Supabase async.
let _subjects: Subject[] = [];
let _todos: Todo[] = [];

function todoFromRow(r: Record<string, unknown>): Todo {
  return {
    id: r.id as string,
    text: r.text as string,
    status: (r.status as Todo['status']) ?? 'nothing',
    subjectId: (r.subject_id as string | null) ?? undefined,
    assignmentId: (r.assignment_id as number | null) ?? undefined,
    date: r.date as string,
    estimatedMinutes: (r.estimated_minutes as number | null) ?? undefined,
    dueDate: (r.due_date as string | null) ?? undefined,
    notes: (r.notes as string | null) ?? undefined,
    order: (r.order as number | null) ?? undefined,
  };
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

  // ── Subjects (Supabase, write-through cache) ─────────────────────────
  getSubjects(): Subject[] {
    return _subjects;
  },

  setSubjects(next: Subject[]): void {
    const prev = _subjects;
    _subjects = next;
    void (async () => {
      try {
        const id = await uid();
        const prevMap = new Map(prev.map(s => [s.id, s]));
        const nextSet = new Set(next.map(s => s.id));
        for (const s of next) {
          const p = prevMap.get(s.id);
          if (!p || p.name !== s.name || p.color !== s.color || p.archived !== s.archived ||
              p.order !== s.order || p.source !== s.source || p.totalTimeToday !== s.totalTimeToday ||
              p.canvasCourseId !== s.canvasCourseId) {
            await supabase.from('subjects').upsert({
              id: s.id,
              user_id: id,
              name: s.name,
              color: s.color as string,
              source: s.source ?? 'manual',
              archived: s.archived ?? false,
              order: s.order ?? null,
              total_time_today: s.totalTimeToday,
              canvas_course_id: s.canvasCourseId ?? null,
              updated_at: new Date().toISOString(),
            });
          }
        }
        for (const s of prev) {
          if (!nextSet.has(s.id)) {
            await supabase.from('subjects').delete().eq('id', s.id).eq('user_id', id);
          }
        }
      } catch (err) {
        console.error('[storage] setSubjects sync failed:', err);
      }
    })();
  },

  async fetchSubjects(): Promise<Subject[]> {
    const id = await uid();
    const { data } = await supabase
      .from('subjects')
      .select('*')
      .eq('user_id', id)
      .order('order', { ascending: true, nullsFirst: false });
    const subjects: Subject[] = (data ?? []).map(r => ({
      id: r.id as string,
      name: r.name as string,
      color: r.color as Subject['color'],
      source: (r.source as 'manual' | 'canvas') ?? 'manual',
      archived: r.archived ?? false,
      order: (r.order as number | null) ?? undefined,
      totalTimeToday: (r.total_time_today as number) ?? 0,
      canvasCourseId: (r.canvas_course_id as number | null) ?? undefined,
    }));
    _subjects = subjects;
    return subjects;
  },

  async loadSubjects(): Promise<void> {
    try {
      const remote = await storage.fetchSubjects();
      if (remote.length === 0) {
        const local: Subject[] = get(KEYS.subjects, []);
        if (local.length > 0) {
          _subjects = local;
          const id = await uid();
          await supabase.from('subjects').upsert(
            local.map(s => ({
              id: s.id,
              user_id: id,
              name: s.name,
              color: s.color as string,
              source: s.source ?? 'manual',
              archived: s.archived ?? false,
              order: s.order ?? null,
              total_time_today: s.totalTimeToday,
              canvas_course_id: s.canvasCourseId ?? null,
            })),
            { onConflict: 'id' },
          );
          localStorage.removeItem(KEYS.subjects);
        }
      }
    } catch (err) {
      console.error('[storage] loadSubjects failed:', err);
      // Fall back to localStorage if Supabase unavailable
      _subjects = get(KEYS.subjects, []);
    }
  },

  // ── Timer sessions (localStorage) ───────────────────────────────────
  getTimerSessions: (): TimerSession[] => get(KEYS.timerSessions, []),
  setTimerSessions: (v: TimerSession[]) => set(KEYS.timerSessions, v),

  // ── Canvas (localStorage) ────────────────────────────────────────────
  getCanvasIcalUrl: (): string => _canvasIcalUrl,
  setCanvasIcalUrl: (v: string): void => {
    _canvasIcalUrl = v;
    void (async () => {
      try {
        const s = await storage.getSettings();
        await storage.saveSettings({ ...s, canvasIcalUrl: v });
      } catch (err) { console.error('[storage] ical url persist failed:', err); }
    })();
  },

  getCachedIcalAssignments: () => normalizeIcalAssignments(
    get<import('../types').CanvasAssignment[]>(KEYS.cachedIcalAssignments, []),
  ),
  setCachedIcalAssignments: (v: import('../types').CanvasAssignment[]) => {
    const normalized = normalizeIcalAssignments(v);
    set(KEYS.cachedIcalAssignments, normalized);
    set(KEYS.cachedAssignments, normalized);
    set(KEYS.cachedCourses, coursesFromAssignments(normalized));
  },

  getAssignmentStatus: (): Record<number, string> => get(KEYS.assignmentStatus, {}),
  setAssignmentStatus: (v: Record<number, string>) => set(KEYS.assignmentStatus, v),

  getClearedAssignments: (): Record<number, boolean> => get(KEYS.clearedAssignments, {}),
  setClearedAssignments: (v: Record<number, boolean>) => set(KEYS.clearedAssignments, v),

  getCachedCourses: (): CanvasCourse[] => get(KEYS.cachedCourses, []),
  setCachedCourses: (v: CanvasCourse[]) => set(KEYS.cachedCourses, v),

  getCachedAssignments: (): CanvasAssignment[] =>
    normalizeIcalAssignments(get<CanvasAssignment[]>(KEYS.cachedIcalAssignments, [])),
  setCachedAssignments: (v: CanvasAssignment[]) => set(KEYS.cachedAssignments, normalizeIcalAssignments(v)),

  getCacheTimestamp: (): number | null => get<number | null>(KEYS.cacheTimestamp, null),
  setCacheTimestamp: (v: number) => set(KEYS.cacheTimestamp, v),

  // ── Google Calendar (localStorage) ──────────────────────────────────
  getGoogleToken: (): string => _googleToken,
  getGoogleRefreshToken: (): string => _googleRefreshToken,
  setGoogleToken: (v: string, refreshToken?: string): void => {
    _googleToken = v;
    if (refreshToken) _googleRefreshToken = refreshToken;
    void (async () => {
      try {
        const s = await storage.getSettings();
        await storage.saveSettings({
          ...s,
          googleToken: v,
          ...(refreshToken ? { googleRefreshToken: refreshToken } : {}),
        });
      } catch (err) { console.error('[storage] google token persist failed:', err); }
    })();
  },

  // ── Google Docs (legacy — kept for backward compatibility) ───────────
  getGoogleDocsToken: (): string => _googleDocsToken,
  setGoogleDocsToken: (v: string): void => {
    _googleDocsToken = v;
    void (async () => {
      try {
        const s = await storage.getSettings();
        await storage.saveSettings({ ...s, googleDocsToken: v });
      } catch (err) { console.error('[storage] google docs token persist failed:', err); }
    })();
  },

  // ── Google Drive (unified: reads any Drive file + creates Docs) ──────
  getGoogleDriveToken: (): string => _googleDriveToken,
  getGoogleDriveRefreshToken: (): string => _googleDriveRefreshToken,
  setGoogleDriveToken: (v: string, refreshToken?: string): void => {
    _googleDriveToken = v;
    if (refreshToken) _googleDriveRefreshToken = refreshToken;
    void (async () => {
      try {
        const s = await storage.getSettings();
        await storage.saveSettings({
          ...s,
          googleDriveToken: v,
          ...(refreshToken ? { googleDriveRefreshToken: refreshToken } : {}),
        });
      } catch (err) { console.error('[storage] google drive token persist failed:', err); }
    })();
  },

  // Call once after auth resolves. Populates the in-memory token/data caches
  // from Supabase and performs one-time migrations away from localStorage.
  async loadTokens(): Promise<void> {
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('loadTokens timeout')), 5000)
      );
      const s = await Promise.race([storage.getSettings(), timeout]);
      _canvasIcalUrl = s.canvasIcalUrl ?? '';
      _googleToken = s.googleToken ?? '';
      _googleRefreshToken = s.googleRefreshToken ?? '';
      _googleDocsToken = s.googleDocsToken ?? '';
      // Migrate: old Docs-only token carries forward as the Drive token so
      // existing "save to doc" keeps working until the user reconnects Drive.
      _googleDriveToken = s.googleDriveToken ?? s.googleDocsToken ?? '';
      _googleDriveRefreshToken = s.googleDriveRefreshToken ?? '';
      // One-time migration: move plaintext Google token out of localStorage
      const migrateKey = (key: string): string => {
        const raw = localStorage.getItem(key);
        if (!raw) return '';
        localStorage.removeItem(key);
        try { return JSON.parse(raw) as string; } catch { return ''; }
      };
      const lsGoogle = migrateKey('soma_google_token');
      if (lsGoogle && !_googleToken) {
        _googleToken = lsGoogle;
        await storage.saveSettings({ ...s, googleToken: _googleToken });
      }
    } catch (err) {
      console.error('[storage] loadTokens failed:', err);
    }
    // Load subjects before todos (todo migration uses subjects for subjectId inference)
    await storage.loadSubjects().catch(err => console.error('[storage] loadSubjects:', err));
    await storage.loadTodos().catch(err => console.error('[storage] loadTodos:', err));
  },

  getGoogleClientId: (): string => get(KEYS.googleClientId, ''),
  setGoogleClientId: (v: string) => set(KEYS.googleClientId, v),

  getCachedGoogleEvents: (): GoogleCalendarEvent[] => get(KEYS.googleEvents, []),
  setCachedGoogleEvents: (v: GoogleCalendarEvent[]) => set(KEYS.googleEvents, v),

  getGoogleCacheTimestamp: (): number | null => get<number | null>(KEYS.googleCacheTimestamp, null),
  setGoogleCacheTimestamp: (v: number) => set(KEYS.googleCacheTimestamp, v),

  // ── Study folder (localStorage) ─────────────────────────────────────
  getStudyFolder(): { folderId: string; folderName: string } | null {
    return get<{ folderId: string; folderName: string } | null>(KEYS.studyFolder, null);
  },
  setStudyFolder(v: { folderId: string; folderName: string } | null): void {
    if (v === null) localStorage.removeItem(KEYS.studyFolder);
    else set(KEYS.studyFolder, v);
  },

  // ── AI chat sessions localStorage — read-only, used for one-time migration to Supabase ──
  getChatSessions: (): ChatSession[] => get(KEYS.chatSessions, []),

  getActiveSessionId: (): string => get(KEYS.activeSessionId, ''),
  setActiveSessionId: (v: string) => set(KEYS.activeSessionId, v),

  // ── AI chat sessions (Supabase) ──────────────────────────────────────
  async fetchChatSessions(): Promise<ChatSession[]> {
    const userId = await uid();
    const { data, error } = await supabase
      .from('chat_sessions')
      .select('id, date, title, messages, created_at, subject_key')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(r => ({
      id: r.id as string,
      date: r.date as string,
      title: r.title as string,
      messages: (r.messages as ChatMessage[]) ?? [],
      createdAt: r.created_at as string,
      subjectKey: (r.subject_key as string | null) ?? undefined,
    }));
  },

  async upsertChatSession(session: ChatSession): Promise<void> {
    const userId = await uid();
    const payload = {
      id: session.id,
      user_id: userId,
      date: session.date,
      title: session.title,
      messages: session.messages,
      created_at: session.createdAt,
      subject_key: session.subjectKey ?? null,
      updated_at: new Date().toISOString(),
    };
    console.log('[storage] upsertChatSession payload:', payload);
    await supabase.from('chat_sessions').upsert(payload);
  },

  async deleteChatSession(sessionId: string): Promise<void> {
    const userId = await uid();
    await supabase.from('chat_sessions').delete().eq('id', sessionId).eq('user_id', userId);
  },

  async migrateChatSessions(sessions: ChatSession[]): Promise<void> {
    if (sessions.length === 0) return;
    const userId = await uid();
    await supabase.from('chat_sessions').upsert(
      sessions.map(s => ({
        id: s.id,
        user_id: userId,
        date: s.date,
        title: s.title,
        messages: s.messages,
        created_at: s.createdAt,
        subject_key: s.subjectKey ?? null,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'id' },
    );
  },

  // ── Time blocks (localStorage) ───────────────────────────────────────
  getTimeBlocks: (): TimeBlock[] => get(SOMA_BLOCKS_KEY, []),
  setTimeBlocks: (v: TimeBlock[]) => set(SOMA_BLOCKS_KEY, v),

  // ── Todos (Supabase, write-through cache) ────────────────────────────
  getTodos(): Todo[] {
    return _todos;
  },

  setTodos(next: Todo[]): void {
    const prev = _todos;
    _todos = next;
    void (async () => {
      try {
        const prevMap = new Map(prev.map(t => [t.id, t]));
        const nextSet = new Set(next.map(t => t.id));
        for (const t of next) {
          const p = prevMap.get(t.id);
          if (!p || p.text !== t.text || p.status !== t.status || p.subjectId !== t.subjectId ||
              p.dueDate !== t.dueDate || p.notes !== t.notes || p.order !== t.order ||
              p.estimatedMinutes !== t.estimatedMinutes || p.date !== t.date) {
            await storage.saveTodo(t);
          }
        }
        for (const t of prev) {
          if (!nextSet.has(t.id)) {
            await storage.deleteTodo(t.id);
          }
        }
      } catch (err) {
        console.error('[storage] setTodos sync failed:', err);
      }
    })();
  },

  async fetchAllTodos(): Promise<Todo[]> {
    const id = await uid();
    const { data } = await supabase.from('todos').select('*').eq('user_id', id);
    const todos = (data ?? []).map(r => todoFromRow(r as Record<string, unknown>));
    _todos = todos;
    return todos;
  },

  async loadTodos(): Promise<void> {
    try {
      const remote = await storage.fetchAllTodos();
      if (remote.length === 0) {
        const local: Todo[] = get(SOMA_TODOS_KEY, []);
        if (local.length > 0) {
          // Apply legacy migration (done boolean → status, infer subjectId)
          const assignments = storage.getCachedAssignments();
          const migrated = local.map(t => {
            const legacyDone = (t as unknown as { done?: boolean }).done;
            const status: Todo['status'] = t.status ?? (legacyDone ? 'done' : 'nothing');
            const subjectId = t.subjectId ?? inferSubjectId(t.text, _subjects, assignments);
            return { ...t, status, subjectId };
          });
          _todos = migrated;
          await Promise.all(migrated.map(t => storage.saveTodo(t)));
          localStorage.removeItem(SOMA_TODOS_KEY);
        }
      }
    } catch (err) {
      console.error('[storage] loadTodos failed:', err);
      _todos = get(SOMA_TODOS_KEY, []);
    }
  },

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
    return (data ?? []).map(r => todoFromRow(r as Record<string, unknown>));
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
      due_date: todo.dueDate ?? null,
      notes: todo.notes ?? null,
      order: todo.order ?? null,
    });
  },

  async deleteTodo(todoId: string): Promise<void> {
    const id = await uid();
    await supabase.from('todos').delete().eq('id', todoId).eq('user_id', id);
  },

  async saveTodoSession(session: { id?: string; todoId: string; date: string; startTime?: string; endTime?: string }): Promise<string> {
    const userId = await uid();
    const id = session.id ?? crypto.randomUUID();
    await supabase.from('todo_sessions').upsert({
      id,
      todo_id: session.todoId,
      user_id: userId,
      date: session.date,
      start_time: session.startTime ?? null,
      end_time: session.endTime ?? null,
    });
    return id;
  },

  async deleteTodoSession(id: string): Promise<void> {
    const userId = await uid();
    await supabase.from('todo_sessions').delete().eq('id', id).eq('user_id', userId);
  },

  async updateTodoSession(id: string, updates: { startTime?: string; endTime?: string }): Promise<void> {
    const userId = await uid();
    const patch: Record<string, unknown> = {};
    if (updates.startTime !== undefined) patch.start_time = updates.startTime;
    if (updates.endTime !== undefined) patch.end_time = updates.endTime;
    if (Object.keys(patch).length === 0) return;
    await supabase.from('todo_sessions').update(patch).eq('id', id).eq('user_id', userId);
  },

  async fetchTodoSessions(date: string): Promise<TodoSession[]> {
    const userId = await uid();
    const { data } = await supabase
      .from('todo_sessions')
      .select('id, todo_id, date, start_time, end_time, todos(text, subject_id)')
      .eq('user_id', userId)
      .eq('date', date);
    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      todoId: r.todo_id as string,
      date: r.date as string,
      startTime: typeof r.start_time === 'string' ? r.start_time : undefined,
      endTime: typeof r.end_time === 'string' ? r.end_time : undefined,
      todoText: (r.todos as Record<string, unknown> | null)?.text as string | undefined,
      subjectId: (r.todos as Record<string, unknown> | null)?.subject_id as string | undefined,
    }));
  },

  async fetchIncompleteTodos(): Promise<Todo[]> {
    const id = await uid();
    const { data } = await supabase
      .from('todos')
      .select('*')
      .eq('user_id', id)
      .neq('status', 'done');
    return (data ?? []).map(r => todoFromRow(r as Record<string, unknown>));
  },

  // ── Active timer (Supabase) ──────────────────────────────────────────
  async getActiveTimer(): Promise<{
    subject_id: string;
    subject_name: string | null;
    task_text: string | null;
    session_start_time: string;
    start_time: string;
    accumulated_seconds: number;
    is_paused: boolean;
  } | null> {
    const id = await uid();
    const { data } = await supabase
      .from('active_timer')
      .select('subject_id, subject_name, task_text, session_start_time, start_time, accumulated_seconds, is_paused')
      .eq('user_id', id)
      .maybeSingle();
    return data ?? null;
  },

  async upsertActiveTimer(row: {
    subject_id: string;
    subject_name: string | null;
    task_text: string | null;
    session_start_time: string;
    start_time: string;
    accumulated_seconds: number;
    is_paused: boolean;
  }): Promise<void> {
    const id = await uid();
    await supabase.from('active_timer').upsert({
      user_id: id,
      ...row,
      updated_at: new Date().toISOString(),
    });
  },

  async deleteActiveTimer(): Promise<void> {
    const id = await uid();
    await supabase.from('active_timer').delete().eq('user_id', id);
  },

  // ── Timer sessions (Supabase) ────────────────────────────────────────
  async deleteTimerSession(sessionId: string): Promise<void> {
    const id = await uid();
    await supabase.from('timer_sessions').delete().eq('id', sessionId).eq('user_id', id);
  },

  async deleteTimerSessionsByTask(taskText: string, subjectId: string): Promise<void> {
    const id = await uid();
    await supabase
      .from('timer_sessions')
      .delete()
      .eq('user_id', id)
      .eq('task_text', taskText)
      .eq('subject_id', subjectId);
  },

  async deleteTimerSessionsBySubject(subjectId: string): Promise<void> {
    const id = await uid();
    await supabase
      .from('timer_sessions')
      .delete()
      .eq('user_id', id)
      .eq('subject_id', subjectId);
  },

  async saveTimerSession(session: TimerSession, subjectName: string): Promise<void> {
    const id = await uid();
    await supabase.from('timer_sessions').insert({
      id: session.id,
      user_id: id,
      subject_id: session.subjectId,
      subject_name: subjectName,
      task_text: session.task || null,
      start_time: session.startTime,
      end_time: session.endTime,
      duration_seconds: session.durationSeconds,
      date: session.startTime.slice(0, 10),
    });
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

  // ── Clear all local browser data ────────────────────────────────────
  clearLocalData(): void {
    // Canvas cache
    localStorage.removeItem(KEYS.cachedAssignments);
    localStorage.removeItem(KEYS.cachedIcalAssignments);
    localStorage.removeItem(KEYS.cachedCourses);
    localStorage.removeItem(KEYS.cacheTimestamp);
    localStorage.removeItem(KEYS.canvasIcalUrl);
    localStorage.removeItem(KEYS.assignmentStatus);
    localStorage.removeItem(KEYS.clearedAssignments);
    // Remove Canvas-sourced subjects — write-through syncs deletion to Supabase
    const manualOnly = _subjects.filter(s => s.source !== 'canvas');
    storage.setSubjects(manualOnly);
    // Google
    localStorage.removeItem(KEYS.googleEvents);
    localStorage.removeItem(KEYS.googleCacheTimestamp);
    localStorage.removeItem(KEYS.googleClientId);
    // Bosses progress
    localStorage.removeItem('soma_boss_state');
    localStorage.removeItem('soma_boss_progress'); // legacy key
    // Study plan cache
    localStorage.removeItem('soma_canvas_study_plan_preview');
    // Study folder
    localStorage.removeItem(KEYS.studyFolder);
    // App preferences / theme
    localStorage.removeItem(SOMA_SETTINGS_KEY);
    // In-memory token cache
    _canvasIcalUrl = '';
    _googleToken = '';
    _googleDocsToken = '';
    _googleDriveToken = '';
  },

  async cleanupTestBlocks(taskName: string): Promise<void> {
    const allBlocks = storage.getTimeBlocks();
    const toDelete = allBlocks.filter(b => b.task === taskName && b.timerSessionId);
    if (toDelete.length === 0) return;
    storage.setTimeBlocks(allBlocks.filter(b => !(b.task === taskName && b.timerSessionId)));
  },

};
