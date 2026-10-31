import { supabase } from './supabase';
import { storage } from './storage';
import {
  normalizeSnapshot, getLocalSnapshots, setLocalSnapshot, clearLocalSnapshots, removeLocalSnapshot,
  type SourceSnapshot,
} from './canvasDeepSync';

/**
 * The bridge between the Soma for Canvas extension and this tab.
 *
 * The extension never holds a Soma session and never sends anything to Soma's
 * servers itself. It reads Canvas in the student's own browser, keeps the
 * result, and its bridge script on this page posts it here with
 * window.postMessage. This tab saves it under the student's own session
 * (canvas_snapshots, RLS), so it reaches their other devices and the AI.
 *
 * The extension belongs to the browser, not to a Soma account: it hands what
 * it has to any Soma tab, whoever is signed in. So a site only joins an
 * account the student has said yes to. A site is connected when the account
 * already has its row in canvas_snapshots, or when the student taps Connect
 * (connectPendingSites). Anything else waits, unsaved, as pending. Without
 * this, signing up for a second account in the same browser filled it with
 * the first account's Canvas.
 *
 * Messages carry `source` so the two sides ignore everything else posted on
 * the page:
 *   extension → app  { source: 'soma-extension', type: 'present', version }
 *                    { source: 'soma-extension', type: 'canvas_snapshot', snapshot }
 *                    { source: 'soma-extension', type: 'sync_done', results }
 *   app → extension  { source: 'soma-app', type: 'hello' }          ask for what it has
 *                    { source: 'soma-app', type: 'sync_request' }   re-read every site now
 *                    { source: 'soma-app', type: 'snapshot_saved', host, syncedAt }
 *                    { source: 'soma-app', type: 'forget' }         the student removed synced data
 */

export const CANVAS_CHANGED = 'soma_canvas_changed';

/** The extension's Chrome Web Store page. */
export const EXTENSION_STORE_URL = 'https://chromewebstore.google.com/detail/soma-for-canvas/hfiggdemebihcchcinhdmenhdebioanm';
const TABLE = 'canvas_snapshots';

let extensionVersion: string | null = null;
/** Sites this account has said yes to; null until known, or when the table doesn't exist yet (everything is saved, as before). */
let connected: Set<string> | null = null;
let tableMissing = false;
/** What the extension offered that this account hasn't connected, by host. Never saved. */
const pending = new Map<string, SourceSnapshot>();
let bridgeUser: string | null = null;
/** Whether the extension has said hello on this page. */
export const extensionPresent = () => extensionVersion;

const post = (msg: Record<string, unknown>) => window.postMessage({ source: 'soma-app', ...msg }, window.location.origin);

/** The table may not exist yet (canvas_snapshots_migration.sql); that only costs other devices. */
const missingTable = (e: { code?: string; message?: string }) => e.code === '42P01' || e.code === 'PGRST205' || /canvas_snapshots/.test(e.message ?? '');

async function save(userId: string, snapshot: SourceSnapshot) {
  const current = getLocalSnapshots()[snapshot.host];
  if (current && current.syncedAt >= snapshot.syncedAt) {
    post({ type: 'snapshot_saved', host: snapshot.host, syncedAt: current.syncedAt });
    return;
  }
  setLocalSnapshot(snapshot);
  // Canvas courses with work in them become Subjects, the way the feed's do.
  // Not every enrollment: orientation and club "courses" have no assignments.
  // Gradescope and WebAssign work join the Canvas course of the same name instead.
  if (snapshot.kind === 'canvas') {
    const withWork = snapshot.courses.filter(c => snapshot.assignments.some(a => a.courseId === c.id));
    await storage.syncCanvasSubjects(withWork.map(c => ({
      id: 0, name: '', courseId: c.id, courseName: c.name, dueAt: '', htmlUrl: '', status: 'not_started' as const,
    }))).catch(err => console.error('[canvasExtension] subjects:', err));
  }
  const { error } = await supabase.from(TABLE).upsert({
    user_id: userId, host: snapshot.host, payload: snapshot, synced_at: snapshot.syncedAt, updated_at: new Date().toISOString(),
  });
  if (error && !missingTable(error)) console.error('[canvasExtension] save failed:', error.message);
  window.dispatchEvent(new Event(CANVAS_CHANGED));
  post({ type: 'snapshot_saved', host: snapshot.host, syncedAt: snapshot.syncedAt });
}

/** What other devices synced, so this one has it without the extension. */
async function loadRemote(userId: string) {
  const { data, error } = await supabase.from(TABLE).select('host, payload').eq('user_id', userId);
  if (error) {
    if (missingTable(error)) tableMissing = true;
    else console.error('[canvasExtension] load failed:', error.message);
    // Can't tell which sites are this account's: hold everything as pending
    // rather than save someone else's Canvas.
    connected = new Set();
    return;
  }
  connected = new Set((data ?? []).map(r => (r as { host?: unknown }).host).filter((h): h is string => typeof h === 'string'));
  let changed = false;
  const local = getLocalSnapshots();
  for (const row of data ?? []) {
    const s = normalizeSnapshot((row as { payload: unknown }).payload);
    if (s && (!local[s.host] || local[s.host].syncedAt < s.syncedAt)) { setLocalSnapshot(s); changed = true; }
  }
  if (changed) window.dispatchEvent(new Event(CANVAS_CHANGED));
}

/** Start listening for the extension on this page, for one signed-in student. */
export function startCanvasBridge(userId: string): () => void {
  bridgeUser = userId;
  connected = null;
  tableMissing = false;
  pending.clear();
  // Which sites are connected must be known before anything is saved.
  let queue = loadRemote(userId).catch(err => console.error('[canvasExtension]', err));
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const msg = event.data as { source?: unknown; type?: unknown; snapshot?: unknown; version?: unknown };
    if (!msg || msg.source !== 'soma-extension') return;
    if (msg.type === 'present') {
      const first = extensionVersion === null;
      extensionVersion = typeof msg.version === 'string' ? msg.version.slice(0, 20) : 'unknown';
      window.dispatchEvent(new Event(CANVAS_CHANGED));
      // Say hello once, to get the saved snapshots. The extension answers every
      // hello with "present", so answering each of those would never end.
      if (first) post({ type: 'hello' });
      return;
    }
    if (msg.type !== 'canvas_snapshot') return;
    const snapshot = normalizeSnapshot(msg.snapshot);
    if (!snapshot) return;
    // One at a time: two sites syncing at once must not race on the local copy.
    queue = queue.then(() => receive(userId, snapshot)).catch(err => console.error('[canvasExtension]', err));
  };
  window.addEventListener('message', onMessage);
  // The extension's bridge may have loaded before this listener.
  post({ type: 'hello' });
  return () => {
    window.removeEventListener('message', onMessage);
    if (bridgeUser === userId) { bridgeUser = null; connected = null; pending.clear(); }
  };
}

/** Save a site the account has connected; hold any other until the student says yes. */
async function receive(userId: string, snapshot: SourceSnapshot) {
  if (tableMissing || connected?.has(snapshot.host)) return save(userId, snapshot);
  const held = pending.get(snapshot.host);
  if (held && held.syncedAt >= snapshot.syncedAt) return;
  pending.set(snapshot.host, snapshot);
  window.dispatchEvent(new Event(CANVAS_CHANGED));
}

/** Sites the extension has here that this account hasn't connected. */
export function pendingCanvasSites(): { host: string; courses: number; assignments: number }[] {
  return [...pending.values()]
    .map(s => ({ host: s.host, courses: s.courses.length, assignments: s.assignments.length }))
    .sort((a, b) => a.host.localeCompare(b.host));
}

/** The student said yes: save every pending site under this account. */
export async function connectPendingSites(): Promise<void> {
  const userId = bridgeUser;
  if (!userId) return;
  for (const snapshot of [...pending.values()]) {
    connected?.add(snapshot.host);
    pending.delete(snapshot.host);
    await save(userId, snapshot);
  }
  window.dispatchEvent(new Event(CANVAS_CHANGED));
}

/**
 * Take one site off this account, here and on the server. The extension keeps
 * it, since another account in this browser may use it, so it comes back as
 * pending and the student can connect it again.
 */
export async function disconnectCanvasSite(host: string): Promise<void> {
  const userId = await storage.getUserId();
  const { error } = await supabase.from(TABLE).delete().eq('user_id', userId).eq('host', host);
  if (error && !missingTable(error)) throw new Error('Could not disconnect that site. Please retry.');
  const local = getLocalSnapshots()[host];
  removeLocalSnapshot(host);
  connected?.delete(host);
  if (local) pending.set(host, local);
  window.dispatchEvent(new Event(CANVAS_CHANGED));
}

export type SyncResult = { host: string; ok: boolean; error: string | null };

/**
 * Ask the extension to re-read every site now (Settings → Sync now). The new
 * snapshots arrive through the bridge as usual; this resolves with how each
 * site went, or an empty list if the extension didn't answer in time.
 */
export function requestSync(timeoutMs = 120_000): Promise<SyncResult[]> {
  return new Promise(resolve => {
    const done = (results: SyncResult[]) => { window.removeEventListener('message', onMessage); clearTimeout(timer); resolve(results); };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const msg = event.data as { source?: unknown; type?: unknown; results?: unknown };
      if (msg?.source !== 'soma-extension' || msg.type !== 'sync_done') return;
      const results = Array.isArray(msg.results) ? msg.results : [];
      done(results.flatMap(r => r && typeof r === 'object' && typeof (r as SyncResult).host === 'string'
        ? [{ host: (r as SyncResult).host.slice(0, 100), ok: (r as SyncResult).ok === true, error: typeof (r as SyncResult).error === 'string' ? (r as SyncResult).error!.slice(0, 200) : null }]
        : []));
    };
    const timer = setTimeout(() => done([]), timeoutMs);
    window.addEventListener('message', onMessage);
    post({ type: 'sync_request' });
  });
}

/** When each Canvas site was last synced, newest first. */
export function deepSyncStatus(): { host: string; syncedAt: string; courses: number; assignments: number }[] {
  return Object.values(getLocalSnapshots())
    .map(s => ({ host: s.host, syncedAt: s.syncedAt, courses: s.courses.length, assignments: s.assignments.length }))
    .sort((a, b) => b.syncedAt.localeCompare(a.syncedAt));
}

/** Remove everything deep sync saved, here and on the server, and tell the extension. */
export async function forgetDeepSync(): Promise<void> {
  const userId = await storage.getUserId();
  const { error } = await supabase.from(TABLE).delete().eq('user_id', userId);
  if (error && !missingTable(error)) throw new Error('Could not remove synced Canvas data. Please retry.');
  clearLocalSnapshots();
  connected = new Set();
  pending.clear();
  post({ type: 'forget' });
  window.dispatchEvent(new Event(CANVAS_CHANGED));
}
