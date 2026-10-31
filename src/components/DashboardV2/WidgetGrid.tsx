import { useRef, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GripVertical, Lightbulb, Plus, X } from 'lucide-react';
import { COLUMNS, SIZES, WIDGETS, addWidget, boxOf, hideWidget, placeAt, sameLayout, settle, widgetInfo, type Box, type DashboardLayout, type WidgetId, type WidgetSize } from '../../lib/dashboardLayout';
import styles from './DashboardV2.module.css';

/**
 * The live dashboard's widgets on a grid (lib/dashboardLayout.ts). While
 * customizing, a widget can be dragged to any spot, or moved a step at a time
 * with its arrows; it can also be resized or hidden, and hidden ones wait in
 * "Add widgets", which ends with a card for suggesting a new one. The handle along a widget's bottom edge makes it taller or
 * shorter, a row at a time. The widgets themselves can't be used until Done. `panel`
 * (the block editor or Plan it) opens beside Today's plan.
 *
 * On the desktop grid each widget sits at its own column and row. Narrower
 * screens have fewer columns, so there the widgets flow in reading order.
 */

type Props = {
  layout: DashboardLayout;
  customizing: boolean;
  onChange: (layout: DashboardLayout) => void;
  render: (id: WidgetId, size: WidgetSize) => ReactNode;
  panel?: ReactNode;
  /** Opens "Suggest a widget" (WidgetIdeas.tsx), from the last card in Add widgets. */
  onSuggest?: () => void;
};

const sizeClass = (w: number, h: number) => `${styles[`c${w}`]} ${styles[`r${h}`]}`;
const place = (b: Box) => ({ '--x': b.x + 1, '--y': b.y + 1, '--w': b.w, '--h': b.h }) as CSSProperties;

/** Beside the plan, on the side with room; under it when the plan is full width. */
function withPanel(layout: DashboardLayout): Box[] {
  const boxes: Box[] = layout.map(boxOf);
  const plan = boxes.find(b => b.id === 'plan');
  const x = !plan ? 0 : plan.x + plan.w < COLUMNS ? plan.x + plan.w : plan.x > 0 ? plan.x - 1 : 0;
  const y = !plan ? 0 : plan.w === COLUMNS ? plan.y + plan.h : plan.y;
  return settle([...boxes, { id: 'panel', x, y, w: 1, h: 3 }], 'panel');
}

export default function WidgetGrid({ layout, customizing, onChange, render, panel, onSuggest }: Props) {
  const grid = useRef<HTMLDivElement>(null);
  // While dragging: which widget, the layout it started from, and which cell of the widget was grabbed.
  const drag = useRef<{ id: WidgetId; from: DashboardLayout; grab: { x: number; y: number }; at: string } | null>(null);

  // While changing a widget's height: which widget, the layout it started from, and the widget's top edge.
  const sizing = useRef<{ id: WidgetId; from: DashboardLayout; top: number; at: number } | null>(null);

  const metrics = () => {
    const el = grid.current; if (!el) return null;
    const css = getComputedStyle(el);
    const gapX = parseFloat(css.columnGap) || 0, gapY = parseFloat(css.rowGap) || 0;
    return { el, css, gapX, gapY, rowH: parseFloat(css.gridAutoRows) || 1 };
  };
  // The grid's cell under the pointer, or null when the grid isn't the desktop one.
  const cellAt = (e: { clientX: number; clientY: number }, rect = grid.current?.getBoundingClientRect()) => {
    const m = metrics(); if (!m || !rect) return null;
    if (m.css.gridTemplateColumns.split(' ').length !== COLUMNS) return null;
    const colW = (m.el.clientWidth - m.gapX * (COLUMNS - 1)) / COLUMNS;
    return { x: Math.floor((e.clientX - rect.left + m.gapX / 2) / (colW + m.gapX)), y: Math.floor((e.clientY - rect.top + m.gapY / 2) / (m.rowH + m.gapY)) };
  };

  const setRows = (from: DashboardLayout, id: WidgetId, rows: number) => {
    const p = from.find(w => w.id === id)!;
    return placeAt(from, id, p.x, p.y, { rows });
  };
  function startSizing(e: PointerEvent<HTMLButtonElement>, id: WidgetId) {
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const top = e.currentTarget.closest('[data-widget]')!.getBoundingClientRect().top;
    sizing.current = { id, from: layout, top, at: boxOf(layout.find(w => w.id === id)!).h };
  }
  function moveSizing(e: PointerEvent<HTMLButtonElement>) {
    const r = sizing.current, m = metrics(); if (!r || !m) return;
    const [min, max] = widgetInfo(r.id).rows;
    const rows = Math.min(max, Math.max(min, Math.round((e.clientY - r.top + m.gapY) / (m.rowH + m.gapY))));
    if (rows === r.at) return;
    r.at = rows;
    onChange(setRows(r.from, r.id, rows));
  }
  function keySizing(e: KeyboardEvent<HTMLButtonElement>, id: WidgetId, h: number) {
    const by = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!by) return;
    e.preventDefault();
    onChange(setRows(layout, id, h + by));
  }

  function startDrag(e: DragEvent<HTMLDivElement>, id: WidgetId) {
    if (sizing.current) { e.preventDefault(); return; }   // the height handle, not a move
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    const own = cellAt(e, e.currentTarget.getBoundingClientRect()) ?? { x: 0, y: 0 };
    drag.current = { id, from: layout, grab: { x: Math.max(0, own.x), y: Math.max(0, own.y) }, at: '' };
  }
  function dragOver(e: DragEvent<HTMLDivElement>, over?: WidgetId) {
    const d = drag.current; if (!customizing || !d) return;
    e.preventDefault();
    const cell = cellAt(e);
    // Fewer columns than the desktop: the widget takes the spot of the one it's over.
    const target = cell ? { x: cell.x - d.grab.x, y: cell.y - d.grab.y } : (() => { const o = d.from.find(p => p.id === over); return o && over !== d.id ? { x: o.x, y: o.y } : null; })();
    if (!target) return;
    const key = `${target.x},${target.y}`;
    if (key === d.at) return;
    d.at = key;
    onChange(placeAt(d.from, d.id, target.x, target.y));
  }

  const hidden = WIDGETS.filter(w => !layout.some(p => p.id === w.id));
  const boxes = panel && !customizing ? withPanel(layout) : layout.map(boxOf);
  const moves = (id: WidgetId, x: number, y: number) => {
    const next = placeAt(layout, id, x, y);
    return sameLayout(next, layout) ? undefined : () => onChange(next);
  };

  return <>
    <div ref={grid} className={`${styles.widgetGrid}${customizing ? ` ${styles.customizing}` : ''}`} onDragOver={e => dragOver(e)} onDrop={e => e.preventDefault()}>
      {layout.length === 0 && !customizing && <p className={styles.widgetEmpty}>Your dashboard is empty. Press Customize to add widgets.</p>}
      {boxes.map(b => {
        if (b.id === 'panel') return <div key="panel" className={`${styles.widget} ${styles.placed} ${sizeClass(1, 3)}`} style={place(b)} data-widget="panel">{panel}</div>;
        const w = layout.find(p => p.id === b.id)!;
        const info = widgetInfo(w.id);
        const step = (dx: number, dy: number) => moves(w.id, w.x + dx, w.y + dy);
        const arrows: [string, (() => void) | undefined, ReactNode][] = [
          ['left', step(-1, 0), <ArrowLeft size={14}/>], ['up', step(0, -1), <ArrowUp size={14}/>],
          ['down', step(0, 1), <ArrowDown size={14}/>], ['right', step(1, 0), <ArrowRight size={14}/>],
        ];
        return <div key={w.id} data-widget={w.id} className={`${styles.widget} ${styles.placed} ${sizeClass(b.w, b.h)}`} style={place(b)}
          draggable={customizing}
          onDragStart={e => startDrag(e, w.id)}
          onDragOver={e => dragOver(e, w.id)}
          onDragEnd={() => { drag.current = null; }}>
          {customizing && <div className={styles.widgetBar} role="group" aria-label={`${info.name} widget`}>
            <GripVertical size={14} aria-hidden="true" className={styles.widgetGrip}/>
            <strong>{info.name}</strong>
            <select aria-label={`Size of ${info.name}`} value={w.size} disabled={info.sizes.length < 2}
              onChange={e => onChange(placeAt(layout, w.id, w.x, w.y, { size: e.target.value as WidgetSize }))}>
              {info.sizes.map(s => <option key={s} value={s}>{SIZES[s].label}</option>)}
            </select>
            {arrows.map(([way, go, icon]) => <button key={way} type="button" aria-label={`Move ${info.name} ${way}`} title={`Move ${way}`} disabled={!go} onClick={go}>{icon}</button>)}
            <button type="button" aria-label={`Hide ${info.name}`} title="Hide" onClick={() => onChange(hideWidget(layout, w.id))}><X size={14}/></button>
          </div>}
          <div className={styles.widgetBody} inert={customizing || undefined}>{render(w.id, w.size)}</div>
          {customizing && info.rows[0] < info.rows[1] && <button type="button" className={styles.widgetHeight}
            aria-label={`Height of ${info.name}: ${b.h} ${b.h === 1 ? 'row' : 'rows'}. Drag, or press the up and down arrow keys.`} title="Drag to make it taller or shorter"
            onPointerDown={e => startSizing(e, w.id)} onPointerMove={moveSizing} onPointerUp={() => { sizing.current = null; }} onPointerCancel={() => { sizing.current = null; }}
            onKeyDown={e => keySizing(e, w.id, b.h)}><span aria-hidden="true"/></button>}
        </div>;
      })}
    </div>
    {customizing && <section className={styles.widgetTray} aria-labelledby="widget-tray-title">
      <h2 id="widget-tray-title">Add widgets</h2>
      {hidden.length === 0 && <p className={styles.description}>Every widget is on your dashboard.</p>}
      {(hidden.length > 0 || onSuggest) && <ul>
        {hidden.map(info => <li key={info.id}>
          <div><strong>{info.name}</strong><span>{info.description}</span></div>
          <button type="button" aria-label={`Add ${info.name}`} onClick={() => onChange(addWidget(layout, info.id))}><Plus size={14}/> Add</button>
        </li>)}
        {onSuggest && <li className={styles.suggestCard}>
          <div><strong>Missing a widget?</strong><span>Tell us what you’d want on your dashboard. You’ll see whether it gets built.</span></div>
          <button type="button" onClick={onSuggest}><Lightbulb size={14}/> Suggest</button>
        </li>}
      </ul>}
    </section>}
  </>;
}
