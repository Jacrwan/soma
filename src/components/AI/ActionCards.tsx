import { useState } from 'react';
import { gmailLink, googleCalendarLink, icsFile, mailtoLink, whenLabel, type AgentAction, type RoutineAction } from '../../lib/agentActions';
import { daysLabel, lengthLabel, DAY_OPENS, DAY_CLOSES } from '../../lib/routine';
import { formatClock } from '../../lib/timeFormat';
import styles from './ActionCards.module.css';

/**
 * Emails and calendar events Soma got ready (agentActions.ts). Each opens the
 * student's own mail or calendar with everything filled in; nothing is sent or
 * saved until they do it there.
 */
export default function ActionCards({ actions }: { actions: AgentAction[] }) {
  return (
    <div className={styles.cards} role="group" aria-label="Ready for you to send or add">
      {actions.map((a, i) => a.kind === 'email' ? <EmailCard key={i} a={a} /> : a.kind === 'routine' ? <RoutineCard key={i} a={a} /> : <CalendarCard key={i} a={a} />)}
    </div>
  );
}

function EmailCard({ a }: { a: Extract<AgentAction, { kind: 'email' }> }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(`Subject: ${a.subject}\n\n${a.body}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: the draft is still shown */ }
  }
  return (
    <section className={styles.card} aria-label={`Email draft: ${a.subject}`}>
      <div className={styles.kind}>Email draft · you send it</div>
      <div className={styles.title}>{a.subject}</div>
      <div className={styles.meta}>To: {a.to || 'add the address in your email app'}{a.why ? ` · ${a.why}` : ''}</div>
      {open && <pre className={styles.body}>{a.body}</pre>}
      <div className={styles.actions}>
        <a className={styles.primary} href={gmailLink(a)} target="_blank" rel="noopener noreferrer">Open in Gmail</a>
        <a className={styles.button} href={mailtoLink(a)}>Open in Mail</a>
        <button type="button" className={styles.button} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button>
        <button type="button" className={styles.link} onClick={() => setOpen(v => !v)} aria-expanded={open}>{open ? 'Hide draft' : 'Read draft'}</button>
      </div>
    </section>
  );
}

function CalendarCard({ a }: { a: Extract<AgentAction, { kind: 'calendar' }> }) {
  function download() {
    const url = URL.createObjectURL(new Blob([icsFile(a)], { type: 'text/calendar' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `${a.title.replace(/[^\w -]+/g, '').slice(0, 40) || 'event'}.ics` });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className={styles.card} aria-label={`Calendar event: ${a.title}`}>
      <div className={styles.kind}>Calendar event · you add it</div>
      <div className={styles.title}>{a.title}</div>
      <div className={styles.meta}>{whenLabel(a)}{a.details ? ` · ${a.details.slice(0, 80)}${a.details.length > 80 ? '…' : ''}` : ''}</div>
      <div className={styles.actions}>
        <a className={styles.primary} href={googleCalendarLink(a)} target="_blank" rel="noopener noreferrer">Add to Google Calendar</a>
        <button type="button" className={styles.button} onClick={download}>Download .ics</button>
      </div>
    </section>
  );
}

/**
 * The weekly routine Soma suggested (lib/routine.ts). Unlike the other cards
 * this one saves in Soma: one tap puts it on every day of the plan, and study
 * goes around it. Settings → Study hours changes or clears it later.
 */
export function RoutineCard({ a }: { a: RoutineAction }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  async function save() {
    setState('saving');
    // Loaded on tap: the dashboard's demo mode shows this card and must not reach the database.
    try { const { saveRoutine } = await import('../../lib/routineStore'); await saveRoutine(a.items, a.studyHours); setState('saved'); } catch { setState('failed'); }
  }
  return (
    <section className={styles.card} aria-label="Weekly routine">
      <div className={styles.kind}>Weekly routine · saved in Soma</div>
      <div className={styles.title}>Your week around studying</div>
      <ul className={styles.routineList}>
        {a.items.map(i => (
          <li key={i.id}><strong>{i.title}</strong> · {lengthLabel(i.minutes)} · {daysLabel(i.days)} · {i.start ? `at ${formatClock(i.start)}` : `between ${formatClock(i.after ?? DAY_OPENS)} and ${formatClock(i.before ?? DAY_CLOSES)}`}</li>
        ))}
      </ul>
      {a.studyHours && <div className={styles.meta}>Study hours: {formatClock(a.studyHours.start)}–{formatClock(a.studyHours.end)}</div>}
      {a.why && <div className={styles.meta}>{a.why}</div>}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={state === 'saving' || state === 'saved'} onClick={() => void save()}>
          {state === 'saved' ? 'Saved ✓' : state === 'saving' ? 'Saving…' : 'Save routine'}
        </button>
        {state === 'failed' && <span role="alert" className={styles.meta}>Couldn't save. Try again.</span>}
        {state === 'saved' && <span className={styles.meta}>On your plan every week. Change it in Settings → Study hours.</span>}
      </div>
    </section>
  );
}
