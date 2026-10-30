import { useRef, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from 'lucide-react';
import { SIZES, WIDGETS, widgetInfo, type DashboardLayout, type WidgetId, type WidgetSize } from '../../lib/dashboardLayout';
import styles from './DashboardV2.module.css';

/**
 * The live dashboard's widgets on a grid (lib/dashboardLayout.ts). While
 * customizing, each widget gets a bar to resize, move or hide it, widgets can
 * be dragged into place, and hidden ones wait in "Add widgets"; the widgets
 * themselves can't be used until Done. `panel` (the block editor or Plan it)
 * sits right after Today's plan, as it sat beside the plan before.
 */

type Props = {
  layout: DashboardLayout;
  customizing: boolean;
  onChange: (layout: DashboardLayout) => void;
  render: (id: WidgetId, size: WidgetSize) => ReactNode;
  panel?: ReactNode;
};

const sizeClass = (size: WidgetSize) => `${styles[`c${SIZES[size].cols}`]} ${styles[`r${SIZES[size].rows}`]}`;

export default function WidgetGrid({ layout, customizing, onChange, render, panel }: Props) {
  const dragging = useRef<WidgetId | null>(null);
  const move = (id: WidgetId, to: number) => {
    const from = layout.findIndex(w => w.id === id);
    if (from < 0 || to < 0 || to >= layout.length || from === to) return;
    const next = [...layout]; const [w] = next.splice(from, 1); next.splice(to, 0, w); onChange(next);
  };
  const hidden = WIDGETS.filter(w => !layout.some(p => p.id === w.id));
  const panelAt = panel && !customizing ? Math.max(0, layout.findIndex(w => w.id === 'plan')) : -1;

  return <>
    <div className={`${styles.widgetGrid}${customizing ? ` ${styles.customizing}` : ''}`}>
      {layout.length === 0 && !customizing && <p className={styles.widgetEmpty}>Your dashboard is empty. Press Customize to add widgets.</p>}
      {panelAt >= 0 && layout[panelAt]?.id !== 'plan' && <div className={`${styles.widget} ${styles.c1} ${styles.r3}`} data-widget="panel">{panel}</div>}
      {layout.map((w, i) => {
        const info = widgetInfo(w.id);
        return [
          <div key={w.id} data-widget={w.id} className={`${styles.widget} ${sizeClass(w.size)}`}
            draggable={customizing}
            onDragStart={e => { dragging.current = w.id; e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={e => { if (!customizing || !dragging.current) return; e.preventDefault(); if (dragging.current !== w.id) move(dragging.current, i); }}
            onDragEnd={() => { dragging.current = null; }}
            onDrop={e => e.preventDefault()}>
            {customizing && <div className={styles.widgetBar} role="group" aria-label={`${info.name} widget`}>
              <GripVertical size={14} aria-hidden="true" className={styles.widgetGrip}/>
              <strong>{info.name}</strong>
              <select aria-label={`Size of ${info.name}`} value={w.size} disabled={info.sizes.length < 2}
                onChange={e => onChange(layout.map(p => p.id === w.id ? { ...p, size: e.target.value as WidgetSize } : p))}>
                {info.sizes.map(s => <option key={s} value={s}>{SIZES[s].label}</option>)}
              </select>
              <button type="button" aria-label={`Move ${info.name} earlier`} title="Move earlier" disabled={i === 0} onClick={() => move(w.id, i - 1)}><ArrowUp size={14}/></button>
              <button type="button" aria-label={`Move ${info.name} later`} title="Move later" disabled={i === layout.length - 1} onClick={() => move(w.id, i + 1)}><ArrowDown size={14}/></button>
              <button type="button" aria-label={`Hide ${info.name}`} title="Hide" onClick={() => onChange(layout.filter(p => p.id !== w.id))}><X size={14}/></button>
            </div>}
            <div className={styles.widgetBody} inert={customizing || undefined}>{render(w.id, w.size)}</div>
          </div>,
          i === panelAt && w.id === 'plan' ? <div key="panel" className={`${styles.widget} ${styles.c1} ${styles.r3}`} data-widget="panel">{panel}</div> : null,
        ];
      })}
    </div>
    {customizing && <section className={styles.widgetTray} aria-labelledby="widget-tray-title">
      <h2 id="widget-tray-title">Add widgets</h2>
      {hidden.length === 0 ? <p className={styles.description}>Every widget is on your dashboard.</p> : <ul>
        {hidden.map(info => <li key={info.id}>
          <div><strong>{info.name}</strong><span>{info.description}</span></div>
          <button type="button" aria-label={`Add ${info.name}`} onClick={() => onChange([...layout, { id: info.id, size: info.size }])}><Plus size={14}/> Add</button>
        </li>)}
      </ul>}
    </section>}
  </>;
}
