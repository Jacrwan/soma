/**
 * The dashboard as widgets: which ones a student shows, where on the grid
 * (column x, row y) and at which preset size. Saved in their settings
 * (`dashboardLayout`), so it follows them to every device. What comes back
 * from storage is checked here: unknown widgets and sizes are dropped, never
 * trusted, and overlaps are pushed apart.
 *
 * Placing works like a phone's home screen: a widget goes where it's put,
 * whatever it lands on moves down out of the way, and then every widget
 * rises into any empty space above it, so the grid never has holes.
 */

export type WidgetId = 'plan' | 'calendar' | 'focus' | 'ask' | 'dump' | 'due' | 'next' | 'stats';
export type WidgetSize = 'small' | 'wide' | 'tall' | 'large' | 'xl' | 'full';
export type WidgetPlacement = { id: WidgetId; size: WidgetSize; x: number; y: number };
export type DashboardLayout = WidgetPlacement[];

/** Columns × rows on the desktop grid. */
export const COLUMNS = 3;
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
  { id: 'plan', size: 'xl', x: 0, y: 0 },
  { id: 'ask', size: 'tall', x: 2, y: 0 },
  { id: 'focus', size: 'small', x: 2, y: 2 },
  { id: 'dump', size: 'small', x: 0, y: 3 },
  { id: 'next', size: 'small', x: 1, y: 3 },
  { id: 'due', size: 'small', x: 2, y: 3 },
];

/** Anything on the grid, widgets and the editor panel alike. */
export type Box = { id: string; x: number; y: number; w: number; h: number };
const hits = (a: Box, b: Box) => a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const byPlace = (a: Box, b: Box) => a.y - b.y || a.x - b.x;

/**
 * Pushes overlapping boxes down, `first` keeping its spot, then lets each box
 * rise as far as it can: the others before `first`, so a box dropped under
 * another stays under it. Returned in reading order (row, then column).
 */
export function settle<T extends Box>(boxes: T[], first?: string): T[] {
  const moved = boxes.find(b => b.id === first);
  const placed: T[] = moved ? [{ ...moved }] : [];
  for (const b of boxes.filter(b => b.id !== first).sort(byPlace)) {
    const c = { ...b };
    while (placed.some(p => hits(c, p))) c.y++;
    placed.push(c);
  }
  // Again until nothing moves: a box that rose can open space for one that already tried.
  for (let rose = true; rose;) {
    rose = false;
    for (const b of [...placed.filter(b => b.id !== first).sort(byPlace), ...placed.filter(b => b.id === first)])
      while (b.y > 0 && !placed.some(p => hits({ ...b, y: b.y - 1 }, p))) { b.y--; rose = true; }
  }
  return placed.sort(byPlace);
}

/** The first spot, top to bottom and left to right, where a w × h box fits. */
export function firstFree(boxes: Box[], w: number, h: number): { x: number; y: number } {
  for (let y = 0; ; y++) for (let x = 0; x + w <= COLUMNS; x++)
    if (!boxes.some(b => hits({ id: '', x, y, w, h }, b))) return { x, y };
}

export const boxOf = (p: WidgetPlacement): Box & WidgetPlacement => ({ ...p, w: SIZES[p.size].cols, h: SIZES[p.size].rows });
const fromBoxes = (boxes: (Box & WidgetPlacement)[]): DashboardLayout => boxes.map(({ id, size, x, y }) => ({ id, size, x, y }));

/**
 * Puts a widget at column x, row y (and at `size`, if given). Dropped on a
 * widget of the same size, the two swap places; moved down onto widgets
 * below it, it goes under them; anything else it lands on moves down.
 */
export function placeAt(layout: DashboardLayout, id: WidgetId, x: number, y: number, size?: WidgetSize): DashboardLayout {
  const was = layout.find(p => p.id === id);
  if (!was) return layout;
  const me = boxOf({ ...was, size: size ?? was.size });
  me.x = Math.min(Math.max(0, x), COLUMNS - me.w); me.y = Math.max(0, y);
  const others = layout.filter(p => p.id !== id).map(boxOf);
  const under = others.filter(b => hits(me, b));
  if (me.size === was.size && under.length === 1 && under[0].w === me.w && under[0].h === me.h) {
    const swap = under[0];
    return fromBoxes(settle([...others.map(b => b === swap ? { ...b, x: was.x, y: was.y } : b), { ...me, x: swap.x, y: swap.y }], id));
  }
  if (me.y > was.y) me.y = Math.max(me.y, ...under.filter(b => b.y >= was.y + boxOf(was).h).map(b => b.y + b.h));
  return fromBoxes(settle([...others, me], id));
}

/** Adds a widget at its default size in the first spot it fits. */
export function addWidget(layout: DashboardLayout, id: WidgetId): DashboardLayout {
  if (layout.some(p => p.id === id)) return layout;
  const size = widgetInfo(id).size;
  return fromBoxes(settle([...layout.map(boxOf), boxOf({ id, size, ...firstFree(layout.map(boxOf), SIZES[size].cols, SIZES[size].rows) })]));
}

/** Takes a widget off; the ones below rise into its space. */
export const hideWidget = (layout: DashboardLayout, id: WidgetId): DashboardLayout =>
  fromBoxes(settle(layout.filter(p => p.id !== id).map(boxOf)));

/**
 * A stored layout, cleaned: known widgets once each, at a size that widget
 * offers, on the grid. A widget without a usable spot (layouts saved before
 * widgets had one) takes the first free spot in list order, which is where
 * the grid used to put it. Anything that isn't a list is the default.
 */
export function readLayout(stored: unknown): DashboardLayout {
  if (!Array.isArray(stored)) return DEFAULT_LAYOUT;
  const seen = new Set<string>();
  const kept: (Box & WidgetPlacement)[] = [], unplaced: WidgetPlacement[] = [];
  for (const entry of stored.slice(0, WIDGETS.length * 2)) {
    const { id, size, x, y } = (entry ?? {}) as { id?: unknown; size?: unknown; x?: unknown; y?: unknown };
    const info = WIDGETS.find(w => w.id === id);
    if (!info || seen.has(info.id)) continue;
    seen.add(info.id);
    const p = { id: info.id, size: info.sizes.includes(size as WidgetSize) ? size as WidgetSize : info.size, x: 0, y: 0 };
    const spot = (n: unknown, max: number) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;
    if (spot(x, COLUMNS - SIZES[p.size].cols) && spot(y, 200)) kept.push(boxOf({ ...p, x: x as number, y: y as number }));
    else unplaced.push(p);
  }
  if (!unplaced.length) return fromBoxes(settle(kept));
  const boxes = settle(kept);
  for (const p of unplaced) boxes.push(boxOf({ ...p, ...firstFree(boxes, SIZES[p.size].cols, SIZES[p.size].rows) }));
  return fromBoxes(settle(boxes));
}

export const sameLayout = (a: DashboardLayout, b: DashboardLayout) =>
  a.length === b.length && a.every((w, i) => w.id === b[i].id && w.size === b[i].size && w.x === b[i].x && w.y === b[i].y);
