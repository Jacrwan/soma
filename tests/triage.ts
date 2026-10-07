import type { Route } from '@playwright/test';

/**
 * Soma's cheap first pass (purpose "triage") sorts each message before the
 * full reply. These tests exercise the full reply, so the first pass routes
 * everything there, documents included. Returns true when it handled the request.
 */
export function triaged(route: Route): boolean {
  let body: { purpose?: string } | null = null;
  try { body = route.request().postDataJSON(); } catch { body = null; }
  if (body?.purpose !== 'triage') return false;
  void route.fulfill({ json: { content: [{ type: 'text', text: '{"route":"plan","docs":true}' }] } });
  return true;
}
