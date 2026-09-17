import { supabase } from './supabase';
import { Subject, TimeBlock, TimerSession, CanvasAssignment, CanvasCourse, Todo, TodoSession, GoogleCalendarEvent, ChatMessage, ChatSession } from '../types';

const SOMA_TODOS_KEY = 'soma_todos';
const SOMA_BLOCKS_KEY = 'soma_blocks';
const SOMA_SETTINGS_KEY = 'soma_settings';

// Supabase returns timestamptz as UTC ISO strings, but sometimes without a timezone suffix.
// Without 'Z' or '+HH:MM', new Date() treats the string as LOCAL time — causing wrong positions.
// This ensures strings like "2026-06-27T17:00:00" are always parsed as UTC.
function ensureUtcSuffix(ts: string): string {
  return ts.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(ts) ? ts : ts + 'Z';
}

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
  theme: 'light',
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

// Resolves once loadTokens() has finished (success or failure) at least once.
// Components that read the in-memory token cache synchronously on mount
// (getCanvasIcalUrl, etc.) can race ahead of loadTokens() resolving — this
// lets them re-check after the real value is in, instead of getting stuck
// showing "not connected" for the rest of the session.
let _resolveTokensLoaded: () => void;
const _tokensLoadedPromise = new Promise<void>(resolve => { _resolveTokensLoaded = resolve; });

// Bounds a promise to at most `ms` — if it hangs (no response, not even an
// error) rather than rejecting outright, this still lets callers move on.
// Used so a stalled network call can never block whenTokensLoaded() forever.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

// In-memory caches for Supabase-backed data.
// Populated by loadSubjects() / loadTodos() at auth time.
// getSubjects() / getTodos() read from here synchronously;
// setSubjects() / setTodos() update here and diff-sync to Supabase async.
let _subjects: Subject[] = [];
let canvasSubjectSync: Promise<Subject[]> = Promise.resolve([]);
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
    const { data, error } = await supabase
      .from('subjects')
      .select('*')
      .eq('user_id', id)
      .order('order', { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
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

  // All Canvas entry points use the same awaited, insert-only sync. Serialize
  // calls in this tab so a double-click cannot create duplicate courses.
  syncCanvasSubjects(assignments: CanvasAssignment[]): Promise<Subject[]> {
    const sync = async (): Promise<Subject[]> => {
      const existing = await storage.fetchSubjects();
      const subjects = [...existing];
      const colors: Subject['color'][] = [
        '#ef5350', '#42a5f5', '#66bb6a', '#ab47bc',
        '#ffa726', '#26c6da', '#ec407a', '#8d6e63',
      ];
      for (const assignment of normalizeIcalAssignments(assignments)) {
        const name = assignment.courseName.trim();
        if (!name || subjects.some(s =>
          s.canvasCourseId === assignment.courseId ||
          s.name.trim().toLowerCase() === name.toLowerCase()
        )) continue;
        subjects.push({
          id: crypto.randomUUID(), name,
          color: colors[subjects.length % colors.length],
          totalTimeToday: 0, source: 'canvas', canvasCourseId: assignment.courseId,
        });
      }
      const created = subjects.slice(existing.length);
      if (created.length) {
        const userId = await uid();
        const { error } = await supabase.from('subjects').insert(created.map(s => ({
          id: s.id, user_id: userId, name: s.name, color: s.color,
          source: s.source, canvas_course_id: s.canvasCourseId,
          archived: false, total_time_today: 0,
        })));
        if (error) throw new Error(error.message);
        // Preserve edits made to existing subjects while the save was pending.
        _subjects = [..._subjects, ...created];
        window.dispatchEvent(new Event('soma_subjects_changed'));
      }
      return _subjects;
    };
    canvasSubjectSync = canvasSubjectSync.catch(() => []).then(sync);
    return canvasSubjectSync;
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

  // Call once after auth resolves. Populates the in-memory token/data caches
  // from Supabase and performs one-time migrations away from localStorage.
  async loadTokens(): Promise<void> {
    const fetchWithTimeout = (ms: number) => {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('loadTokens timeout')), ms)
      );
      return Promise.race([storage.getSettings(), timeout]);
    };

    try {
      // A slow/cold Supabase connection can miss a short timeout; retry once
      // with more headroom before giving up. Silently falling back to "no
      // Canvas connected" here previously made a *working* integration look
      // disconnected in the UI for the rest of the session.
      let s: SomaSettings;
      try {
        s = await fetchWithTimeout(6000);
      } catch {
        s = await fetchWithTimeout(10000);
      }
      _canvasIcalUrl = s.canvasIcalUrl ?? '';
      _googleToken = s.googleToken ?? '';
      _googleRefreshToken = s.googleRefreshToken ?? '';
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
      console.error('[storage] loadTokens failed after retry:', err);
    }
    // Load subjects before todos (todo migration uses subjects for subjectId inference).
    // whenTokensLoaded() only resolves after this too — a Documents page that
    // read getSubjects() on mount hit the exact same race as the original
    // Canvas bug (subjects genuinely not loaded yet), because this used to
    // resolve before loadSubjects()/loadTodos() ran at all.
    //
    // Neither call had a timeout before this: a stalled network request (not
    // even an error, just no response) left it awaiting forever, which meant
    // _resolveTokensLoaded() below never ran — every page gated on
    // whenTokensLoaded() (Canvas's "Checking your Canvas connection…",
    // Documents, Settings, AI) would hang indefinitely instead of eventually
    // showing *something*. withTimeout guarantees this function always
    // finishes, whether or not the underlying calls ever do.
    await withTimeout(storage.loadSubjects(), 10_000).catch(err => console.error('[storage] loadSubjects:', err));
    await withTimeout(storage.loadTodos(), 10_000).catch(err => console.error('[storage] loadTodos:', err));
    _resolveTokensLoaded();
  },

  // Resolves once the initial loadTokens() pass has finished (success or
  // failure). Components that read getCanvasIcalUrl()/etc. synchronously on
  // mount can use this to re-check after the real value lands, instead of
  // being stuck with whatever was in memory at their own mount time.
  whenTokensLoaded(): Promise<void> {
    return _tokensLoadedPromise;
  },

  getGoogleClientId: (): string => get(KEYS.googleClientId, ''),
  setGoogleClientId: (v: string) => set(KEYS.googleClientId, v),

  getCachedGoogleEvents: (): GoogleCalendarEvent[] => get(KEYS.googleEvents, []),
  setCachedGoogleEvents: (v: GoogleCalendarEvent[]) => set(KEYS.googleEvents, v),

  getGoogleCacheTimestamp: (): number | null => get<number | null>(KEYS.googleCacheTimestamp, null),
  setGoogleCacheTimestamp: (v: number) => set(KEYS.googleCacheTimestamp, v),

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
    const { data, error } = await supabase.from('todos').select('*').eq('user_id', id);
    if (error) throw error;
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
    const { error } = await supabase.from('todos').upsert({
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
    if (error) throw new Error(error.message);
  },

  async deleteTodo(todoId: string): Promise<void> {
    const id = await uid();
    await supabase.from('todos').delete().eq('id', todoId).eq('user_id', id);
  },

  async saveTodoSession(session: { id?: string; todoId: string; date: string; startTime?: string; endTime?: string }): Promise<string> {
    const userId = await uid();
    const id = session.id ?? crypto.randomUUID();
    // Convert to real UTC — JS parses no-timezone strings as local, .toISOString() gives UTC
    const toUtc = (iso: string) => new Date(iso).toISOString();
    const startUtc = session.startTime ? toUtc(session.startTime) : null;
    const endUtc   = session.endTime   ? toUtc(session.endTime)   : null;
    const sessionData = {
      id,
      todo_id: session.todoId,
      user_id: userId,
      date: session.date,
      start_time: startUtc,
      end_time: endUtc,
    };
    const { error } = await supabase.from('todo_sessions').upsert(sessionData, { onConflict: 'todo_id,date,start_time' });
    if (error) {
      console.error('[sessions] save error:', error);
      throw error;
    }
    return id;
  },

  async deleteTodoSession(id: string): Promise<void> {
    const userId = await uid();
    await supabase.from('todo_sessions').delete().eq('id', id).eq('user_id', userId);
  },

  async updateTodoSession(id: string, updates: { startTime?: string; endTime?: string }): Promise<void> {
    const userId = await uid();
    const toUtc = (iso: string) => new Date(iso).toISOString();
    const patch: Record<string, unknown> = {};
    if (updates.startTime !== undefined) patch.start_time = updates.startTime ? toUtc(updates.startTime) : null;
    if (updates.endTime !== undefined) patch.end_time = updates.endTime ? toUtc(updates.endTime) : null;
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
      startTime: typeof r.start_time === 'string' ? ensureUtcSuffix(r.start_time) : undefined,
      endTime: typeof r.end_time === 'string' ? ensureUtcSuffix(r.end_time) : undefined,
      todoText: (r.todos as Record<string, unknown> | null)?.text as string | undefined,
      subjectId: (r.todos as Record<string, unknown> | null)?.subject_id as string | undefined,
    }));
  },

  async fetchTodoSessionsByTodoId(todoId: string): Promise<TodoSession[]> {
    const userId = await uid();
    const { data } = await supabase
      .from('todo_sessions')
      .select('id, todo_id, date, start_time, end_time, todos(text, subject_id)')
      .eq('user_id', userId)
      .eq('todo_id', todoId)
      .order('start_time', { ascending: true });
    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      todoId: r.todo_id as string,
      date: r.date as string,
      startTime: typeof r.start_time === 'string' ? ensureUtcSuffix(r.start_time) : undefined,
      endTime: typeof r.end_time === 'string' ? ensureUtcSuffix(r.end_time) : undefined,
      todoText: (r.todos as Record<string, unknown> | null)?.text as string | undefined,
      subjectId: (r.todos as Record<string, unknown> | null)?.subject_id as string | undefined,
    }));
  },

  async deleteAllTodoSessions(todoId: string): Promise<void> {
    const userId = await uid();
    await supabase.from('todo_sessions').delete().eq('todo_id', todoId).eq('user_id', userId);
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
    const { error } = await supabase.from('active_timer').upsert({
      user_id: id,
      ...row,
      session_start_time: new Date(row.session_start_time).toISOString(),
      start_time: new Date(row.start_time).toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  },

  async deleteActiveTimer(): Promise<void> {
    const id = await uid();
    const { error } = await supabase.from('active_timer').delete().eq('user_id', id);
    if (error) throw new Error(error.message);
  },

  // ── Timer sessions (Supabase) ────────────────────────────────────────
  async deleteTimerSession(sessionId: string): Promise<void> {
    const id = await uid();
    const { error } = await supabase.from('timer_sessions').delete().eq('id', sessionId).eq('user_id', id);
    if (error) throw new Error(error.message);
    window.dispatchEvent(new Event('soma_insights_changed'));
  },

  async deleteTimerSessionsByTask(taskText: string, subjectId: string): Promise<void> {
    const id = await uid();
    const { error } = await supabase
      .from('timer_sessions')
      .delete()
      .eq('user_id', id)
      .eq('task_text', taskText)
      .eq('subject_id', subjectId);
    if (error) throw new Error(error.message);
    window.dispatchEvent(new Event('soma_insights_changed'));
  },

  async deleteTimerSessionsBySubject(subjectId: string): Promise<void> {
    const id = await uid();
    const { error } = await supabase
      .from('timer_sessions')
      .delete()
      .eq('user_id', id)
      .eq('subject_id', subjectId);
    if (error) throw new Error(error.message);
    window.dispatchEvent(new Event('soma_insights_changed'));
  },

  async saveTimerSession(session: TimerSession, subjectName: string): Promise<void> {
    const id = await uid();
    const { error } = await supabase.from('timer_sessions').upsert({
      id: session.id,
      user_id: id,
      subject_id: session.subjectId,
      subject_name: subjectName,
      task_text: session.task || null,
      start_time: new Date(session.startTime).toISOString(),
      end_time: new Date(session.endTime).toISOString(),
      duration_seconds: session.durationSeconds,
      date: (() => { const d = new Date(session.startTime); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })(),
    });
    if (error) throw new Error(error.message);
    window.dispatchEvent(new Event('soma_insights_changed'));
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
    // App preferences / theme
    localStorage.removeItem(SOMA_SETTINGS_KEY);
    // In-memory token cache
    _canvasIcalUrl = '';
    _googleToken = '';
  },

  async cleanupTestBlocks(taskName: string): Promise<void> {
    const allBlocks = storage.getTimeBlocks();
    const toDelete = allBlocks.filter(b => b.task === taskName && b.timerSessionId);
    if (toDelete.length === 0) return;
    storage.setTimeBlocks(allBlocks.filter(b => !(b.task === taskName && b.timerSessionId)));
  },

};
