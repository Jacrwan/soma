/**
 * An in-memory stand-in for the Supabase client, covering the subset of the
 * query builder, auth and storage APIs the app uses.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildTables, DEMO_USER, type Tables } from './seed';
import { exitDemo } from './demoMode';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: null | { message: string; code?: string }; count?: number };

const PRIMARY: Record<string, string[]> = {
  settings: ['user_id'],
  active_timer: ['user_id'],
  elapsed_time: ['user_id', 'date', 'subject_id'],
};

export const tables: Tables = buildTables();

class Query implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private payload: Row[] = [];
  private patch: Row = {};
  private conflict: string[] | null = null;
  private columns = '*';
  private returning = false;
  private sort: { col: string; asc: boolean }[] = [];
  private window: [number, number] | null = null;
  private one: 'single' | 'maybe' | null = null;
  constructor(private table: string) {
    tables[table] ??= [];
  }
  select(cols = '*') {
    if (this.op === 'select') this.columns = cols; else { this.returning = true; this.columns = cols; }
    return this;
  }
  insert(v: Row | Row[]) { this.op = 'insert'; this.payload = Array.isArray(v) ? v : [v]; return this; }
  upsert(v: Row | Row[], opts?: { onConflict?: string }) {
    this.op = 'upsert'; this.payload = Array.isArray(v) ? v : [v];
    if (opts?.onConflict) this.conflict = opts.onConflict.split(',').map(s => s.trim());
    return this;
  }
  update(v: Row) { this.op = 'update'; this.patch = v; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c: string, v: unknown) { this.filters.push(r => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push(r => r[c] !== v); return this; }
  gt(c: string, v: never) { this.filters.push(r => (r[c] as never) > v); return this; }
  gte(c: string, v: never) { this.filters.push(r => (r[c] as never) >= v); return this; }
  lt(c: string, v: never) { this.filters.push(r => (r[c] as never) < v); return this; }
  lte(c: string, v: never) { this.filters.push(r => (r[c] as never) <= v); return this; }
  in(c: string, v: unknown[]) { this.filters.push(r => v.includes(r[c])); return this; }
  is(c: string, v: unknown) { this.filters.push(r => (r[c] ?? null) === v); return this; }
  match(o: Row) { for (const [k, v] of Object.entries(o)) this.eq(k, v); return this; }
  filter(c: string, op: string, v: unknown) {
    const f = (this as unknown as Record<string, (c: string, v: unknown) => Query>)[op];
    return typeof f === 'function' ? f.call(this, c, v) : this;
  }
  not() { return this; }
  or() { return this; }
  order(col: string, o?: { ascending?: boolean }) { this.sort.push({ col, asc: o?.ascending !== false }); return this; }
  limit(n: number) { this.window = [0, n - 1]; return this; }
  range(a: number, b: number) { this.window = [a, b]; return this; }
  abortSignal() { return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }

  private keyOf(row: Row): string[] {
    if (this.conflict) return this.conflict;
    if ('id' in row) return ['id'];
    return PRIMARY[this.table] ?? ['id'];
  }
  private withJoins(rows: Row[]): Row[] {
    const joins = [...this.columns.matchAll(/(\w+)\(([^)]*)\)/g)];
    if (!joins.length) return rows.map(r => ({ ...r }));
    return rows.map(r => {
      const out: Row = { ...r };
      for (const [, rel] of joins) {
        const fk = `${rel.replace(/s$/, '')}_id`;
        out[rel] = (tables[rel] ?? []).find(x => x.id === r[fk]) ?? null;
      }
      return out;
    });
  }
  private run(): Result {
    const data = tables[this.table];
    const match = (r: Row) => this.filters.every(f => f(r));
    let rows: Row[] = [];
    if (this.op === 'select') rows = data.filter(match);
    else if (this.op === 'insert') { rows = this.payload.map(p => ({ ...p })); data.push(...rows); }
    else if (this.op === 'upsert') {
      for (const p of this.payload) {
        const key = this.keyOf(p);
        const i = data.findIndex(r => key.every(k => r[k] === p[k]));
        const merged = i >= 0 ? { ...data[i], ...p } : { ...p };
        if (i >= 0) data[i] = merged; else data.push(merged);
        rows.push(merged);
      }
    } else if (this.op === 'update') {
      data.forEach((r, i) => { if (match(r)) { data[i] = { ...r, ...this.patch }; rows.push(data[i]); } });
    } else {
      rows = data.filter(match);
      tables[this.table] = data.filter(r => !match(r));
    }
    if (this.op !== 'select' && !this.returning) return { data: null, error: null };
    for (const s of [...this.sort].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = a[s.col] as never, y = b[s.col] as never;
        if (x === y) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : 1) * (s.asc ? 1 : -1);
      });
    }
    if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1);
    const out = this.withJoins(rows);
    if (this.one) {
      if (out.length === 0) return this.one === 'maybe' ? { data: null, error: null } : { data: null, error: { message: 'No rows', code: 'PGRST116' } };
      return { data: out[0], error: null };
    }
    return { data: out, error: null, count: out.length };
  }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return new Promise<Result>(resolve => setTimeout(() => resolve(this.run()), 20)).then(ok, fail);
  }
}

const user = {
  id: DEMO_USER.id,
  email: DEMO_USER.email,
  created_at: '2025-08-20T15:00:00Z',
  user_metadata: { full_name: DEMO_USER.name, name: DEMO_USER.name },
  app_metadata: {},
  aud: 'authenticated',
};
const session = { access_token: 'demo-token', refresh_token: 'demo', token_type: 'bearer', expires_in: 3600, user };
const ok = <T>(data: T) => Promise.resolve({ data, error: null });

export function createMockSupabase(): SupabaseClient {
  const client = {
    from: (table: string) => new Query(table),
    rpc: () => ok(null),
    channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }),
    removeChannel: () => {},
    auth: {
      getUser: () => ok({ user }),
      getSession: () => ok({ session }),
      onAuthStateChange: (cb: (event: string, s: typeof session) => void) => {
        setTimeout(() => cb('INITIAL_SESSION', session), 0);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => { exitDemo(); return { error: null }; },
      signInWithPassword: () => ok({ user, session }),
      signInWithOAuth: () => ok({}),
      signUp: () => ok({ user, session }),
      updateUser: () => ok({ user }),
      resetPasswordForEmail: () => ok({}),
      refreshSession: () => ok({ session, user }),
    },
    storage: {
      from: () => ({
        upload: () => ok({ path: 'demo' }),
        remove: () => ok([]),
        createSignedUrl: () => ok({ signedUrl: 'about:blank' }),
        download: () => ok(new Blob()),
      }),
    },
  };
  return client as unknown as SupabaseClient;
}
