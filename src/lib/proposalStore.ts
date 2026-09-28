import { useSyncExternalStore } from 'react';
import type { PlanBlock } from '../components/DashboardV2/PlanEditor';
import { localDate } from '../components/DashboardV2/liveData';

/**
 * Soma's proposals waiting for Accept, shared by the dashboard and the AI page
 * so a proposal made in one shows up, and can be accepted, in the other. Block
 * days are offsets from today, so the list is dropped when the date changes.
 * It lives for the session only, like the dashboard chat.
 */
type State = { userId: string; day: string; items: PlanBlock[] };
let state: State = { userId: '', day: '', items: [] };
const listeners = new Set<() => void>();

function current(userId: string): State {
  const today = localDate(new Date());
  if (state.userId !== userId || state.day !== today) state = { userId, day: today, items: [] };
  return state;
}

export function getProposals(userId: string): PlanBlock[] {
  return current(userId).items;
}

export function updateProposals(userId: string, fn: (items: PlanBlock[]) => PlanBlock[]) {
  const s = current(userId);
  state = { ...s, items: fn(s.items) };
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// What happened to proposals that have left the list, so a chat that showed a
// proposal can say it was accepted even when it was accepted somewhere else.
const resolutions = new Map<string | number, 'accepted' | 'dismissed'>();
export function resolveProposal(userId: string, id: string | number, how: 'accepted' | 'dismissed') {
  resolutions.set(id, how);
  updateProposals(userId, items => items.filter(p => p.id !== id));
}
export function resolutionOf(id: string | number) {
  return resolutions.get(id);
}

export function useProposals(userId: string): PlanBlock[] {
  return useSyncExternalStore(subscribe, () => getProposals(userId));
}
