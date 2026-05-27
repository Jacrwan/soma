/// <reference types="node" />

interface RateLimitStore {
  map: Map<string, number[]>;
  windowMs: number;
  max: number;
}

const stores = new Map<string, RateLimitStore>();

function getStore(name: string, windowMs: number, max: number): RateLimitStore {
  if (!stores.has(name)) stores.set(name, { map: new Map(), windowMs, max });
  return stores.get(name)!;
}

export function getIp(req: any): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? 'unknown';
}

export function isRateLimited(
  req: any,
  name: string,
  opts: { windowMs?: number; max?: number } = {},
): boolean {
  const windowMs = opts.windowMs ?? 60_000;
  const max      = opts.max      ?? 20;
  const ip       = getIp(req);
  const store    = getStore(name, windowMs, max);
  const now      = Date.now();
  const hits     = (store.map.get(ip) ?? []).filter(t => now - t < windowMs);
  if (hits.length >= max) return true;
  hits.push(now);
  store.map.set(ip, hits);
  return false;
}
