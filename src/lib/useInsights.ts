import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getInsightsSnapshot, loadInsights, subscribeInsights } from './insights';

export function useInsights(userId: string | null) {
  const subscribe = useCallback((listener: () => void) =>
    userId ? subscribeInsights(userId, listener) : () => {}, [userId]);
  const snapshot = useSyncExternalStore(subscribe, useCallback(() => getInsightsSnapshot(userId), [userId]));
  useEffect(() => {
    if (userId) void loadInsights(userId);
  }, [userId]);
  return { ...snapshot, retry: () => { if (userId) void loadInsights(userId, true); } };
}
