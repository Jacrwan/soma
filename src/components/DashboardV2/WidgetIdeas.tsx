import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  DETAILS_MAX, NOTE_MAX, NotSetUpError, TITLE_MAX, decideRequest, isOwner, listAll, listMine, submitRequest,
  type WidgetRequest, type WidgetRequestStatus,
} from '../../lib/widgetRequests';
import styles from './WidgetIdeas.module.css';

/**
 * Widget ideas (lib/widgetRequests.ts). A student opens "Suggest a widget"
 * from Customize: a name, an optional line on how they'd use it, Send. Their
 * ideas are listed under the form with what was decided. The owner gets a
 * "Widget ideas" button beside Customize, with how many are waiting, and
 * reviews them here: Build it, Not planned, then Mark built once it ships,
 * each with an optional note the student sees.
 */

const STATUS_LABEL: Record<WidgetRequestStatus, string> = {
  new: 'Waiting for review',
  planned: 'Will be built',
  built: 'Built: add it in Customize',
  declined: 'Not planned',
};

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/** Drawn on document.body: the dashboard's own button styles and stacking don't reach it. */
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEscape(onClose);
  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.box} role="dialog" aria-modal="true" aria-labelledby="widget-ideas-title" onClick={e => e.stopPropagation()}>
        <div className={styles.head}>
          <h2 id="widget-ideas-title" className={styles.title}>{title}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close"><X size={16}/></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const errorText = (e: unknown) =>
  e instanceof NotSetUpError ? 'Widget ideas aren’t set up yet. Please try again later.' : e instanceof Error ? e.message : 'Something went wrong. Please retry.';

/** The student's side: the form and their ideas so far. */
export function SuggestWidget({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [mine, setMine] = useState<WidgetRequest[] | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    listMine().then(setMine).catch(e => { setMine([]); if (e instanceof NotSetUpError) setError(errorText(e)); });
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || sending) return;
    setSending(true); setError(''); setSent(false);
    try {
      const idea = await submitRequest(title, details);
      setMine(m => [idea, ...(m ?? [])]);
      setTitle(''); setDetails(''); setSent(true);
      titleRef.current?.focus();
    } catch (err) { setError(errorText(err)); }
    finally { setSending(false); }
  }

  return (
    <Dialog title="Suggest a widget" onClose={onClose}>
      <p className={styles.lead}>Missing something on your dashboard? Describe it. Every idea is read, and you’ll see here whether it gets built.</p>
      <form className={styles.form} onSubmit={send}>
        <label className={styles.label} htmlFor="idea-title">What should it show?</label>
        <input id="idea-title" ref={titleRef} className={styles.input} value={title} maxLength={TITLE_MAX}
          onChange={e => { setTitle(e.target.value); setSent(false); }} placeholder="e.g. A countdown to my next exam"/>
        <label className={styles.label} htmlFor="idea-details">How would you use it? <span className={styles.optional}>Optional</span></label>
        <textarea id="idea-details" className={styles.textarea} value={details} maxLength={DETAILS_MAX} rows={3}
          onChange={e => setDetails(e.target.value)} placeholder="When would you look at it, and what would you do next?"/>
        <div className={styles.formFoot}>
          <span role="status" className={styles.sent}>{sent ? 'Sent. Thanks for the idea.' : ''}</span>
          <button type="submit" className={styles.primary} disabled={!title.trim() || sending}>{sending ? 'Sending…' : 'Send idea'}</button>
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </form>
      {mine && mine.length > 0 && (
        <section className={styles.list} aria-labelledby="my-ideas">
          <h3 id="my-ideas" className={styles.listTitle}>Your ideas</h3>
          <ul>
            {mine.map(r => (
              <li key={r.id} className={styles.item}>
                <div className={styles.itemHead}>
                  <strong>{r.title}</strong>
                  <span className={`${styles.chip} ${styles[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                </div>
                {r.ownerNote && <p className={styles.note}>{r.ownerNote}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  );
}

/** The owner's side: every idea, waiting ones first, with the decisions. */
export function ReviewWidgetIdeas({ onClose, onChange }: { onClose: () => void; onChange?: (waiting: number) => void }) {
  const [ideas, setIdeas] = useState<WidgetRequest[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showDecided, setShowDecided] = useState(false);

  useEffect(() => {
    listAll().then(all => { setIdeas(all); setNotes(Object.fromEntries(all.map(r => [r.id, r.ownerNote ?? '']))); })
      .catch(e => { setIdeas([]); setError(errorText(e)); });
  }, []);

  async function decide(r: WidgetRequest, status: WidgetRequestStatus) {
    setBusy(r.id); setError('');
    try {
      await decideRequest(r.id, status, notes[r.id] ?? '');
      const next = (ideas ?? []).map(x => x.id === r.id ? { ...x, status, ownerNote: (notes[r.id] ?? '').trim() || null } : x);
      setIdeas(next);
      onChange?.(next.filter(x => x.status === 'new').length);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(null); }
  }

  const open = (ideas ?? []).filter(r => r.status === 'new' || r.status === 'planned')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'new' ? -1 : 1));
  const decided = (ideas ?? []).filter(r => r.status === 'built' || r.status === 'declined');
  const waiting = open.filter(r => r.status === 'new').length;

  const row = (r: WidgetRequest) => (
    <li key={r.id} className={styles.item}>
      <div className={styles.itemHead}>
        <strong>{r.title}</strong>
        <span className={`${styles.chip} ${styles[r.status]}`}>{STATUS_LABEL[r.status]}</span>
      </div>
      {r.details && <p className={styles.details}>{r.details}</p>}
      <p className={styles.meta}>Sent {fmtDate(r.createdAt)}</p>
      {(r.status === 'new' || r.status === 'planned') ? <>
        <label className={styles.srOnly} htmlFor={`note-${r.id}`}>Note to the student about {r.title}</label>
        <input id={`note-${r.id}`} className={styles.input} value={notes[r.id] ?? ''} maxLength={NOTE_MAX}
          onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))} placeholder="Note to the student (optional)"/>
        <div className={styles.actions}>
          {r.status === 'new'
            ? <button type="button" className={styles.build} disabled={busy === r.id} onClick={() => void decide(r, 'planned')}>Build it</button>
            : <button type="button" className={styles.build} disabled={busy === r.id} onClick={() => void decide(r, 'built')}>Mark built</button>}
          <button type="button" className={styles.reject} disabled={busy === r.id} onClick={() => void decide(r, 'declined')}>Not planned</button>
        </div>
      </> : <>
        {r.ownerNote && <p className={styles.note}>{r.ownerNote}</p>}
        {r.status === 'declined' && <div className={styles.actions}><button type="button" className={styles.link} disabled={busy === r.id} onClick={() => void decide(r, 'new')}>Reconsider</button></div>}
      </>}
    </li>
  );

  return (
    <Dialog title="Widget ideas" onClose={onClose}>
      <p className={styles.lead}>{ideas === null ? 'Loading…' : waiting ? `${waiting} waiting for your decision.` : 'Nothing waiting for a decision.'} Students see what you decide and any note.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {open.length > 0 && <ul className={styles.list}>{open.map(row)}</ul>}
      {decided.length > 0 && <>
        <button type="button" className={styles.link} aria-expanded={showDecided} onClick={() => setShowDecided(v => !v)}>
          {showDecided ? 'Hide decided ideas' : `${decided.length} decided idea${decided.length === 1 ? '' : 's'}`}
        </button>
        {showDecided && <ul className={styles.list}>{decided.map(row)}</ul>}
      </>}
    </Dialog>
  );
}

/** Owner only: "Widget ideas" beside Customize, with how many are waiting. */
export function WidgetIdeasButton({ className }: { className?: string }) {
  const [owner, setOwner] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    isOwner().then(yes => {
      if (!live || !yes) return;
      setOwner(true);
      listAll().then(all => { if (live) setWaiting(all.filter(r => r.status === 'new').length); }).catch(() => {});
    });
    return () => { live = false; };
  }, []);
  if (!owner) return null;
  return <>
    <button type="button" className={className} onClick={() => setOpen(true)}>
      Widget ideas{waiting > 0 && <span className={styles.badge} aria-label={`${waiting} waiting`}>{waiting}</span>}
    </button>
    {open && <ReviewWidgetIdeas onClose={() => setOpen(false)} onChange={setWaiting}/>}
  </>;
}
