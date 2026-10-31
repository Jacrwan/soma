/**
 * Widget ideas (widget_requests_migration.sql): a student suggests a dashboard
 * widget and the owner decides whether to build it. Students read only their
 * own ideas; the owner reads them all and sets the status. Who the owner is
 * lives in the database (is_soma_owner), and its policies enforce it; the app
 * only asks so it knows whether to show the review list.
 *
 * The client is loaded on first use: the dashboard imports this, and its
 * standalone preview must not pull in the backend (dashboard-v2.spec.ts).
 */

export type WidgetRequestStatus = 'new' | 'planned' | 'built' | 'declined';
export type WidgetRequest = {
  id: string;
  title: string;
  details: string;
  status: WidgetRequestStatus;
  ownerNote: string | null;
  createdAt: string;
};

const TABLE = 'widget_requests';
const db = async () => (await import('./supabase')).supabase;
export const TITLE_MAX = 80;
export const DETAILS_MAX = 1000;
export const NOTE_MAX = 500;

/** Thrown when the migration hasn't run, so the dialog can say so plainly. */
export class NotSetUpError extends Error {
  constructor() { super('Widget ideas aren’t set up yet.'); }
}

// PGRST205 is PostgREST's "table not in schema cache": the migration hasn't run.
const isMissing = (e: { code?: string; message?: string }) =>
  e.code === 'PGRST205' || e.code === 'PGRST202' || e.code === '42P01' || e.code === '42883' || /could not find the (table|function)|does not exist|schema cache/i.test(e.message ?? '');

const toRequest = (r: Record<string, unknown>): WidgetRequest => ({
  id: String(r.id),
  title: String(r.title ?? ''),
  details: String(r.details ?? ''),
  status: (['new', 'planned', 'built', 'declined'].includes(String(r.status)) ? r.status : 'new') as WidgetRequestStatus,
  ownerNote: r.owner_note ? String(r.owner_note) : null,
  createdAt: String(r.created_at ?? ''),
});

async function userId(): Promise<string> {
  const { data } = await (await db()).auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Please sign in again.');
  return id;
}

/** Whether this account reviews ideas. Anything but a clear yes is a no. */
export async function isOwner(): Promise<boolean> {
  try {
    const { data, error } = await (await db()).rpc('is_soma_owner');
    return !error && data === true;
  } catch { return false; }
}

/** This student's ideas, newest first. */
export async function listMine(): Promise<WidgetRequest[]> {
  const uid = await userId();
  const { data, error } = await (await db()).from(TABLE).select('id,title,details,status,owner_note,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(50);
  if (error) { if (isMissing(error)) throw new NotSetUpError(); throw new Error('Couldn’t load your ideas. Please retry.'); }
  return ((data ?? []) as Record<string, unknown>[]).map(toRequest);
}

/** Every idea, for the owner, newest first. */
export async function listAll(): Promise<WidgetRequest[]> {
  const { data, error } = await (await db()).from(TABLE).select('id,title,details,status,owner_note,created_at').order('created_at', { ascending: false }).limit(200);
  if (error) { if (isMissing(error)) throw new NotSetUpError(); throw new Error('Couldn’t load widget ideas. Please retry.'); }
  return ((data ?? []) as Record<string, unknown>[]).map(toRequest);
}

export async function submitRequest(title: string, details: string): Promise<WidgetRequest> {
  const uid = await userId();
  const row = { user_id: uid, title: title.trim().slice(0, TITLE_MAX), details: details.trim().slice(0, DETAILS_MAX) };
  const { data, error } = await (await db()).from(TABLE).insert(row).select('id,title,details,status,owner_note,created_at').single();
  if (error) {
    if (isMissing(error)) throw new NotSetUpError();
    // The insert policy allows ten ideas waiting at once.
    if (error.code === '42501') throw new Error('You have ten ideas waiting for review. Send more once some are decided.');
    throw new Error('Couldn’t send your idea. Please retry.');
  }
  return toRequest((data ?? { ...row, id: crypto.randomUUID(), status: 'new', created_at: new Date().toISOString() }) as Record<string, unknown>);
}

/** The owner's decision, with an optional note the student sees. */
export async function decideRequest(id: string, status: WidgetRequestStatus, note: string): Promise<void> {
  const { error } = await (await db()).from(TABLE).update({
    status,
    owner_note: note.trim().slice(0, NOTE_MAX) || null,
    decided_at: status === 'new' ? null : new Date().toISOString(),
  }).eq('id', id);
  if (error) throw new Error('Couldn’t save that decision. Please retry.');
}
