/**
 * The dashboard as widgets: which ones a student shows, in what order, at
 * which preset size. Saved in their settings (`dashboardLayout`), so it
 * follows them to every device. What comes back from storage is checked
 * here: unknown widgets and sizes are dropped, never trusted.
 */

export type WidgetId = 'plan' | 'calendar' | 'focus' | 'ask' | 'dump' | 'due' | 'next' | 'stats';
export type WidgetSize = 'small' | 'wide' | 'tall' | 'large' | 'xl' | 'full';
export type WidgetPlacement = { id: WidgetId; size: WidgetSize };
export type DashboardLayout = WidgetPlacement[];

/** Columns × rows on the desktop grid (3 columns). */
export const SIZES: Record<WidgetSize, { cols: number; rows: number; label: string }> = {
  small: { cols: 1, rows: 1, label: 'Small' },
  wide: { cols: 2, rows: 1, label: 'Wide' },
  tall: { cols: 1, rows: 2, label: 'Tall' },
  large: { cols: 2, rows: 2, label: 'Large' },
  xl: { cols: 2, rows: 3, label: 'Extra large' },
  full: { cols: 3, rows: 2, label: 'Full width' },
};

export type WidgetInfo = { id: WidgetId; name: string; description: string; sizes: WidgetSize[]; size: WidgetSize };

/** Every widget, in the order the "Add widgets" tray lists them. */
export const WIDGETS: WidgetInfo[] = [
  { id: 'plan', name: 'Today’s plan', description: 'Your schedule for the day, with the week strip and subject progress.', sizes: ['large', 'xl', 'full'], size: 'xl' },
  { id: 'calendar', name: 'This week', description: 'A small calendar of the seven days on screen. Pick a day to open it.', sizes: ['wide', 'large', 'full'], size: 'large' },
  { id: 'focus', name: 'Focus timer', description: 'Start, pause and stop focus on a block.', sizes: ['small', 'tall'], size: 'small' },
  { id: 'ask', name: 'Ask Soma', description: 'Tell Soma what you need to do; it suggests a plan for you to accept.', sizes: ['tall', 'large'], size: 'tall' },
  { id: 'dump', name: 'Brain dump', description: 'Jot everything down, then press + to put it on your plan.', sizes: ['small', 'tall', 'wide'], size: 'small' },
  { id: 'next', name: 'Up next', description: 'Your next block today, with a button to start focus.', sizes: ['small', 'wide'], size: 'small' },
  { id: 'due', name: 'Due soon', description: 'Canvas work due in the days on screen, with Plan it.', sizes: ['small', 'tall', 'wide'], size: 'small' },
  { id: 'stats', name: 'Study this week', description: 'Minutes of focus each day for the last seven days.', sizes: ['small', 'wide'], size: 'small' },
];

export const widgetInfo = (id: WidgetId) => WIDGETS.find(w => w.id === id)!;

/** What a new student sees: the dashboard as it was, plus Up next and Due soon. */
export const DEFAULT_LAYOUT: DashboardLayout = [
  { id: 'plan', size: 'xl' },
  { id: 'ask', size: 'tall' },
  { id: 'focus', size: 'small' },
  { id: 'dump', size: 'small' },
  { id: 'next', size: 'small' },
  { id: 'due', size: 'small' },
];

/** A stored layout, cleaned: known widgets once each, at a size that widget offers. Anything else is the default. */
export function readLayout(stored: unknown): DashboardLayout {
  if (!Array.isArray(stored)) return DEFAULT_LAYOUT;
  const seen = new Set<string>();
  const layout: DashboardLayout = [];
  for (const entry of stored.slice(0, WIDGETS.length * 2)) {
    const id = (entry as { id?: unknown })?.id, size = (entry as { size?: unknown })?.size;
    const info = WIDGETS.find(w => w.id === id);
    if (!info || seen.has(info.id)) continue;
    seen.add(info.id);
    layout.push({ id: info.id, size: info.sizes.includes(size as WidgetSize) ? size as WidgetSize : info.size });
  }
  return layout;
}

export const sameLayout = (a: DashboardLayout, b: DashboardLayout) =>
  a.length === b.length && a.every((w, i) => w.id === b[i].id && w.size === b[i].size);
