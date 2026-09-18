import { changeMemory, activeEntries, emptyMemory, MemoryError, memoryAdmin, memoryEnabled, memoryStore, parseMemoryAction, type MemoryStore } from './_memory';
import { isRateLimited } from './_rateLimit';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };
export function createMemoryHandler(deps: { enabled?: () => boolean; authenticate?: (token: string) => Promise<string>; store?: MemoryStore; limited?: (req: unknown) => boolean } = {}) {
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
      const state = req.method === 'GET' ? await store.read(userId) ?? emptyMemory() : await changeMemory(store, userId, parseMemoryAction(req.body));
      return res.status(200).json({...state, entries:activeEntries(state)});
    } catch (error) {
      const known = error instanceof MemoryError;
      return res.status(known ? error.status : 503).json({error:known ? error.code : 'memory_unavailable'});
    }
  };
}
export default createMemoryHandler();
