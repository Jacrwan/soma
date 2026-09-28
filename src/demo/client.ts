/**
 * An in-memory stand-in for the Supabase client, used only by `npm run demo`.
 * It implements the slice of the query builder and auth API the app calls,
 * over tables seeded by ./seed. Nothing is persisted: every reload starts
 * from the same seeded student, which is what a screen recording wants.
 */
import type { SupabaseClient, Session, User } from '@supabase/supabase-js';
import { buildTables, canvasAssignments, demoSettings, DEMO_EMAIL, DEMO_NAME, DEMO_USER_ID, type Tables } from './seed';
import { installDemoApi } from './api';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

const user = {
  id: DEMO_USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: DEMO_EMAIL,
  created_at: '2026-08-18T19:52:00.000Z',
  app_metadata: { provider: 'google' },
  user_metadata: { full_name: DEMO_NAME, name: DEMO_NAME },
} as unknown as User;

const session = {
  access_token: 'demo-access-token',
  refresh_token: 'demo-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600 * 24,
  user,
} as unknown as Session;

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// Conflict targets the app relies on when upserting without an explicit one.
const PRIMARY: Record<string, string[]> = {
  settings: ['user_id'],
  active_timer: ['user_id'],
};

class Query implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private sort: { col: string; asc: boolean; nullsFirst?: boolean }[] = [];
  private from?: number;
  private to?: number;
  private one: 'single' | 'maybe' | null = null;
  private returning = false;
  private columns = '*';

  constructor(
    private db: Tables,
    private table: string,
    private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete',
    private payload?: Row | Row[],
    private conflict?: string[],
  ) {}

  select(columns = '*') { if (this.op !== 'select') this.returning = true; this.columns = columns; return this; }
  eq(col: string, v: unknown) { this.filters.push(r => r[col] === v); return this; }
  neq(col: string, v: unknown) { this.filters.push(r => r[col] !== v); return this; }
  gt(col: string, v: never) { this.filters.push(r => (r[col] as never) > v); return this; }
  gte(col: string, v: never) { this.filters.push(r => (r[col] as never) >= v); return this; }
  lt(col: string, v: never) { this.filters.push(r => (r[col] as never) < v); return this; }
  lte(col: string, v: never) { this.filters.push(r => (r[col] as never) <= v); return this; }
  in(col: string, vs: unknown[]) { this.filters.push(r => vs.includes(r[col])); return this; }
  is(col: string, v: unknown) { this.filters.push(r => (r[col] ?? null) === v); return this; }
  order(col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    this.sort.push({ col, asc: opts.ascending ?? true, nullsFirst: opts.nullsFirst }); return this;
  }
  range(from: number, to: number) { this.from = from; this.to = to; return this; }
  limit(n: number) { this.from = 0; this.to = n - 1; return this; }
  abortSignal() { return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }

  private rows(): Row[] { return (this.db[this.table] ??= []); }
  private matches(r: Row) { return this.filters.every(f => f(r)); }

  private run(): Result {
    const rows = this.rows();
    let out: Row[] = [];
    if (this.op === 'select') {
      out = rows.filter(r => this.matches(r));
    } else if (this.op === 'insert' || this.op === 'upsert') {
      const items = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const keys = this.conflict ?? PRIMARY[this.table] ?? ['id'];
      for (const item of items) {
        const row = clone(item);
        if (this.table !== 'settings' && this.table !== 'active_timer' && row.id === undefined) row.id = crypto.randomUUID();
        const existing = this.op === 'upsert' ? rows.find(r => keys.every(k => r[k] === row[k])) : undefined;
        if (existing) Object.assign(existing, row);
        else rows.push({ created_at: new Date().toISOString(), ...row });
        out.push(existing ?? rows[rows.length - 1]);
      }
    } else if (this.op === 'update') {
      out = rows.filter(r => this.matches(r));
      for (const r of out) Object.assign(r, clone(this.payload));
    } else {
      out = rows.filter(r => this.matches(r));
      this.db[this.table] = rows.filter(r => !out.includes(r));
    }
    if (this.op !== 'select' && !this.returning) return { data: null, error: null };

    for (const s of [...this.sort].reverse()) {
      out = [...out].sort((a, b) => {
        const x = a[s.col], y = b[s.col];
        if (x == null || y == null) return x == y ? 0 : (x == null) === !!s.nullsFirst ? -1 : 1;
        return (x < y ? -1 : x > y ? 1 : 0) * (s.asc ? 1 : -1);
      });
    }
    if (this.from !== undefined) out = out.slice(this.from, (this.to ?? out.length) + 1);
    let data = clone(out);
    // The one embedded select the app uses: todo_sessions → todos(text, subject_id).
    if (/todos\(/.test(this.columns)) {
      const todos = this.db.todos ?? [];
      data = data.map(r => {
        const t = todos.find(x => x.id === r.todo_id);
        return { ...r, todos: t ? { text: t.text, subject_id: t.subject_id } : null };
      });
    }
    if (this.one) {
      if (data.length === 1) return { data: data[0], error: null };
      if (this.one === 'maybe' && data.length === 0) return { data: null, error: null };
      return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
    }
    return { data, error: null, count: data.length };
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return new Promise<Result>(resolve => setTimeout(() => resolve(this.run()), 40)).then(ok, fail);
  }
}

type AuthListener = (event: string, s: Session | null) => void;

export function createDemoClient(): SupabaseClient {
  const db = buildTables();
  prepareLocalStorage();
  installDemoApi(db);
  const listeners = new Set<AuthListener>();
  let signedIn: Session | null = session;
  const ok = <T>(data: T) => Promise.resolve({ data, error: null });

  const client = {
    from(table: string) {
      return {
        select: (cols = '*') => new Query(db, table, 'select').select(cols),
        insert: (payload: Row | Row[]) => new Query(db, table, 'insert', payload),
        upsert: (payload: Row | Row[], opts?: { onConflict?: string }) =>
          new Query(db, table, 'upsert', payload, opts?.onConflict?.split(',').map(s => s.trim())),
        update: (payload: Row) => new Query(db, table, 'update', payload),
        delete: () => new Query(db, table, 'delete'),
      };
    },
    rpc: () => ok(null),
    auth: {
      getUser: () => ok({ user: signedIn?.user ?? null }),
      getSession: () => ok({ session: signedIn }),
      onAuthStateChange(cb: AuthListener) {
        listeners.add(cb);
        setTimeout(() => cb('INITIAL_SESSION', signedIn), 0);
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
      async signOut() {
        // Stay signed in: logging out mid-recording would strand the demo.
        return { error: null };
      },
      async signInWithPassword() {
        signedIn = session;
        listeners.forEach(l => l('SIGNED_IN', session));
        return { data: { user, session }, error: null };
      },
      async signInWithOAuth() {
        signedIn = session;
        listeners.forEach(l => l('SIGNED_IN', session));
        return { data: { provider: 'google', url: null }, error: null };
      },
      signUp: async () => ({ data: { user, session }, error: null }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: { user }, error: null }),
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: 'demo' }, error: null }),
        remove: async () => ({ data: [], error: null }),
        createSignedUrl: async (path: string) => {
          const doc = (db.documents ?? []).find(d => d.storage_path === path);
          const text = `${doc?.file_name ?? 'Document'}\n\n${doc?.extracted_text ?? ''}`;
          return { data: { signedUrl: URL.createObjectURL(new Blob([text], { type: 'text/plain' })) }, error: null };
        },
      }),
    },
  };
  return client as unknown as SupabaseClient;
}

/** Device-local caches the app reads before (or instead of) the database. */
function prepareLocalStorage() {
  try {
    const previous = JSON.parse(localStorage.getItem('soma_settings') ?? '{}') as { theme?: 'light' | 'dark'; timeFormat?: '12h' | '24h' };
    const settings = demoSettings();
    localStorage.setItem('soma_settings', JSON.stringify({ ...settings, theme: previous.theme ?? settings.theme, timeFormat: previous.timeFormat ?? settings.timeFormat }));
    const { assignments, status, cleared } = canvasAssignments();
    const courses = [...new Map(assignments.map(a => [a.courseId, { id: a.courseId, name: a.courseName, courseCode: a.courseName }])).values()];
    localStorage.setItem('soma_ical_assignments', JSON.stringify(assignments));
    localStorage.setItem('soma_canvas_cache', JSON.stringify(assignments));
    localStorage.setItem('soma_cached_courses', JSON.stringify(courses));
    localStorage.setItem('soma_canvas_cache_timestamp', JSON.stringify(Date.now()));
    localStorage.setItem('canvas_assignment_status', JSON.stringify(status));
    localStorage.setItem('canvas_cleared_assignments', JSON.stringify(cleared));
    for (const key of ['soma_blocks', 'soma_sessions', 'soma_google_events', 'soma_google_cache_timestamp', 'soma_active_session_id', 'soma_chat_sessions', 'soma_trial_banner_dismissed']) {
      localStorage.removeItem(key);
    }
  } catch { /* storage blocked: the app still runs from the in-memory tables */ }
}
