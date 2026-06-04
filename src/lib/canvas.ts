import { supabase } from './supabase';
import { CanvasAssignment } from '../types';

async function supabaseToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? '';
}

export async function getIcalAssignments(icalUrl: string): Promise<CanvasAssignment[]> {
  const sbToken = await supabaseToken();
  const res = await fetch('/api/canvas-ical', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sbToken}`,
    },
    body: JSON.stringify({ icalUrl }),
  });

  const raw = await res.text();
  let data: { assignments?: CanvasAssignment[]; error?: string } = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { error: raw || `HTTP ${res.status}` };
  }

  if (!res.ok) {
    const message = data.error || `Calendar feed request failed (${res.status})`;
    throw new Error(message);
  }

  return data.assignments ?? [];
}
