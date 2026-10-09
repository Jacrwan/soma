import { changeMemory, activeEntries, emptyMemory, MemoryError, memoryAdmin, memoryEnabled, memoryStore, parseMemoryAction, type MemoryStore } from './_memory';
import { isRateLimited } from './_rateLimit';
import { notesStore, cleanNote, type NotesStore } from './_notes';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };
export function createMemoryHandler(deps: { enabled?: () => boolean; authenticate?: (token: string) => Promise<string>; store?: MemoryStore; notes?: NotesStore; limited?: (req: unknown) => boolean } = {}) {
  return async (req: any, res: any) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET','POST'].includes(req.method)) return res.status(405).json({error:'method_not_allowed'});
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return res.status(401).json({error:'auth_required'});
    try {
      const authenticate = deps.authenticate ?? (async (value: string) => {
        const {data:{user},error} = await memoryAdmin().auth.getUser(value);
        if (error || !user) throw new MemoryError('auth_required', 401);
        return user.id;
      });
      const userId = await authenticate(token);
      if (!(deps.enabled ?? memoryEnabled)()) throw new MemoryError('memory_unavailable');
      if ((deps.limited ?? (r => isRateLimited(r, 'memory', {max:60})))(req)) throw new MemoryError('rate_limit', 429);
      const store = deps.store ?? memoryStore(memoryAdmin());
      // Notes never take the facts down with them: before their table exists,
      // or if it fails, the list is empty and the rest of memory still works.
      const notes = deps.notes ?? (() => { try { return notesStore(memoryAdmin()); } catch { return null; } })();
      const listNotes = async () => { try { return notes ? await notes.list(userId) : []; } catch { return []; } };
      // Notes on past conversations: edited or deleted by the student here (_notes.ts).
      const body = req.body as Record<string, unknown> | undefined;
      if (req.method === 'POST' && (body?.action === 'edit_note' || body?.action === 'forget_note')) {
        if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id) || Object.keys(body).some(k => !['action', 'id', 'title', 'note'].includes(k))) throw new MemoryError('invalid_note', 400);
        if (!notes) throw new MemoryError('memory_unavailable');
        const done = body.action === 'forget_note' ? await notes.remove(userId, body.id) : await (async () => { const n = cleanNote(body.title, body.note); return notes.edit(userId, body.id as string, n.title, n.note); })();
        if (!done) throw new MemoryError('note_not_found', 404);
      }
      const state = req.method === 'GET' || body?.action === 'edit_note' || body?.action === 'forget_note' ? await store.read(userId) ?? emptyMemory() : await changeMemory(store, userId, parseMemoryAction(req.body));
      // Clearing memory clears the notes too.
      if (req.method === 'POST' && body?.action === 'clear') await notes?.clear(userId).catch(() => console.error(JSON.stringify({ event: 'notes_not_cleared' })));
      return res.status(200).json({...state, entries:activeEntries(state), notes:await listNotes()});
    } catch (error) {
      const known = error instanceof MemoryError;
      return res.status(known ? error.status : 503).json({error:known ? error.code : 'memory_unavailable'});
    }
  };
}
export default createMemoryHandler();
