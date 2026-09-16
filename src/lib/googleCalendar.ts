const GCAL_CACHE_MAX_AGE = 86_400_000;

export function getWeekRange(): { timeMin: string; timeMax: string } {
  const now = new Date();
  const past = new Date(now);
  past.setFullYear(now.getFullYear() - 1);
  const future = new Date(now);
  future.setFullYear(now.getFullYear() + 1);
  return { timeMin: past.toISOString(), timeMax: future.toISOString() };
}

export function isCacheStale(timestamp: number | null): boolean {
  if (!timestamp) return true;
  return Date.now() - timestamp > GCAL_CACHE_MAX_AGE;
}
