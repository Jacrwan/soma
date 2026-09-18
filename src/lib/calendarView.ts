/**
 * Calendar view modes and the rules for moving between them.
 *
 * These are pure date functions on purpose: the switching rule has twelve
 * cases and is far easier to trust when it can be tested without a browser.
 */

export type CalendarView = 'month' | 'week' | 'threeDay';

/** How many day columns a view shows. Month is a grid, not a range. */
export function rangeLength(view: CalendarView): number {
  return view === 'week' ? 7 : view === 'threeDay' ? 3 : 0;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function getSundayOfWeek(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function getFirstOfMonth(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * A week that sits entirely inside one month returns to that month; a week
 * straddling two returns to whichever month the user came from.
 */
export function getMonthToRestoreFromWeek(rangeStart: Date, originMonth: Date, length = 7): Date {
  const end = addDays(rangeStart, length - 1);
  if (isSameMonth(rangeStart, end)) return getFirstOfMonth(rangeStart);
  return originMonth;
}

export interface ViewAnchors {
  /** First of the month shown in month view. */
  month: Date;
  /** First day column shown in week / three-day view. */
  rangeStart: Date;
  /** The month the user was last in, used when a week straddles two months. */
  originMonth: Date;
}

/** Is today on screen in the view the user is currently looking at? */
export function isTodayVisible(view: CalendarView, anchors: ViewAnchors, today: Date): boolean {
  const t = startOfDay(today);
  if (view === 'month') return isSameMonth(anchors.month, t);
  const start = startOfDay(anchors.rangeStart);
  const end = addDays(start, rangeLength(view) - 1);
  return t >= start && t <= end;
}

/**
 * Where the calendar should land when switching views.
 *
 * The rule: if today is visible in the view being left, the new view anchors on
 * today. Otherwise it keeps the range the user was already looking at. The
 * three-day view starts on today rather than centring it.
 */
export function nextAnchors(
  target: CalendarView,
  from: CalendarView,
  anchors: ViewAnchors,
  today: Date,
): ViewAnchors {
  const t = startOfDay(today);
  const onToday = isTodayVisible(from, anchors, today);

  // The day the new view should be built around when today is not in play.
  const fallback = from === 'month' ? getFirstOfMonth(anchors.month) : startOfDay(anchors.rangeStart);
  const base = onToday ? t : fallback;

  // Leaving month view records where to come back to.
  const originMonth = from === 'month' ? getFirstOfMonth(anchors.month) : anchors.originMonth;

  if (target === 'month') {
    const month = onToday
      ? getFirstOfMonth(t)
      : from === 'month'
        ? getFirstOfMonth(anchors.month)
        : getMonthToRestoreFromWeek(anchors.rangeStart, anchors.originMonth, rangeLength(from));
    return { month, rangeStart: anchors.rangeStart, originMonth };
  }

  // Week view snaps to a Sunday; the three-day view starts on its base day.
  const rangeStart = target === 'week' ? getSundayOfWeek(base) : startOfDay(base);
  return { month: anchors.month, rangeStart, originMonth };
}
