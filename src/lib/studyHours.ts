// Kept free of imports so tests can load it without the Supabase client.

/**
 * Adds a session's studied minutes to each clock hour it covered: 1:00–3:30
 * gives 1pm 60, 2pm 60 and 3pm 30. Only the total studied time is stored, not
 * when any pauses happened, so a paused session is spread evenly over its span.
 */
export function addSessionToHours(
  hours: Record<number, number>,
  session: { start_time: string | null; end_time?: string | null; duration_seconds: number },
) {
  const start = session.start_time ? Date.parse(session.start_time) : NaN;
  const studiedMs = (session.duration_seconds ?? 0) * 1000;
  if (!Number.isFinite(start) || studiedMs <= 0) return;
  let end = session.end_time ? Date.parse(session.end_time) : NaN;
  // No end, or one that can't hold the studied time: assume it ran unbroken.
  if (!Number.isFinite(end) || end - start < studiedMs || end - start > 24 * 3_600_000) end = start + studiedMs;
  const studiedShare = studiedMs / (end - start);

  let cursor = start;
  while (cursor < end) {
    const hourStart = new Date(cursor);
    const nextHour = new Date(cursor);
    nextHour.setMinutes(60, 0, 0);
    const sliceEnd = Math.min(+nextHour, end);
    const hour = hourStart.getHours();
    hours[hour] = (hours[hour] ?? 0) + ((sliceEnd - cursor) * studiedShare) / 60_000;
    cursor = sliceEnd;
  }
}
