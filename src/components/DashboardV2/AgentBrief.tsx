import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildBrief, briefIsEmpty, briefDismissedToday, dismissBriefToday, planMyDayPrompt, type Brief, type BriefItem } from '../../lib/brief';
import { CANVAS_CHANGED } from '../../lib/canvasExtension';
import styles from './AgentBrief.module.css';

/**
 * The morning brief (lib/brief.ts): what's due, what changed overnight and
 * what slipped yesterday, worked out without the AI. "Plan my day" takes it
 * to the AI page, where Soma proposes the day and any emails or events to
 * send or add, each for the student to accept.
 */
export default function AgentBrief() {
  const navigate = useNavigate();
  const [brief, setBrief] = useState<Brief>(() => buildBrief());
  const [hidden, setHidden] = useState(briefDismissedToday);

  useEffect(() => {
    // Tasks and synced work load after the dashboard; the brief follows them.
    const refresh = () => setBrief(buildBrief());
    for (const e of ['soma_todos_changed', 'soma_subjects_changed', CANVAS_CHANGED]) window.addEventListener(e, refresh);
    const t = setTimeout(refresh, 1500);
    return () => { clearTimeout(t); for (const e of ['soma_todos_changed', 'soma_subjects_changed', CANVAS_CHANGED]) window.removeEventListener(e, refresh); };
  }, []);

  if (hidden || briefIsEmpty(brief)) return null;
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const time = (i: BriefItem) => i.source === 'task' ? '' : ` · ${new Date(i.due).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  const line = (i: BriefItem) => `${i.title}${i.course ? ` (${i.course})` : ''}${time(i)}`;
  const CHANGE: Record<string, string> = { new: 'New', due_moved: 'Due date moved', graded: 'Graded', announcement: 'Announcement' };

  return (
    <section className={styles.brief} aria-labelledby="agent-brief">
      <div className={styles.head}>
        <h2 id="agent-brief">{greeting}. Here’s your day.</h2>
        <button type="button" className={styles.close} onClick={() => { dismissBriefToday(); setHidden(true); }} aria-label="Hide today’s brief">Hide</button>
      </div>
      <div className={styles.grid}>
        {brief.today.length > 0 && <div><h3>Due today</h3><ul>{brief.today.map((i, n) => <li key={n}>{line(i)}</li>)}</ul></div>}
        {brief.tomorrow.length > 0 && <div><h3>Due tomorrow</h3><ul>{brief.tomorrow.map((i, n) => <li key={n}>{line(i)}</li>)}</ul></div>}
        {brief.changed.length > 0 && <div><h3>Changed</h3><ul>{brief.changed.map((c, n) => <li key={n}>{CHANGE[c.type] ?? 'Changed'}: {c.name}{c.course ? ` (${c.course})` : ''}</li>)}</ul></div>}
        {brief.slipped.length > 0 && <div><h3>Didn’t happen yesterday</h3><ul>{brief.slipped.map((i, n) => <li key={n}>{line(i)}</li>)}</ul></div>}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => navigate('/ai', { state: { ask: planMyDayPrompt(brief) } })}>Plan my day</button>
        <span className={styles.note}>Soma proposes the day, and any emails or calendar events, for you to accept.</span>
      </div>
    </section>
  );
}
