import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageCircle, X, ArrowLeft, Send } from 'lucide-react';
import {
  MESSAGE_MAX, SupportNotSetUpError, isSupportOwner, loadThread, loadThreads, markRead,
  sendAsOwner, sendAsStudent, unreadReplies, type SupportMessage, type SupportThread,
} from '../../lib/support';
import styles from './SupportChat.module.css';

/**
 * Message the developer: a chat bubble on every signed-in page. A student
 * writes to the owner, who gets a Discord ping and replies here; no AI
 * answers. The owner's bubble opens an inbox of every conversation instead.
 * `?support` opens it; the Discord ping links `?support=<student id>`.
 */

const OPEN_POLL_MS = 8_000;
const CLOSED_POLL_MS = 60_000;

const timeOf = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

export default function SupportChat({ userId }: { userId: string }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState(false);
  const [unread, setUnread] = useState(0);
  // The owner's open conversation; a student's is always their own.
  const [thread, setThread] = useState<string | null>(null);
  const [threads, setThreads] = useState<SupportThread[] | null>(null);
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notSetUp, setNotSetUp] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { void isSupportOwner().then(setOwner); }, [userId]);

  // ?support opens the chat; ?support=<id> opens that student's conversation (owner).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has('support')) return;
    setOpen(true);
    const id = params.get('support');
    if (id && /^[0-9a-f-]{36}$/.test(id)) setThread(id);
  }, [location.search]);

  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener('soma_open_support', openIt);
    return () => window.removeEventListener('soma_open_support', openIt);
  }, []);

  const activeThread = owner ? thread : userId;

  const refresh = useCallback(async () => {
    try {
      if (owner && !activeThread) {
        const list = await loadThreads();
        setThreads(list);
        setUnread(list.reduce((n, t) => n + t.unread, 0));
        return;
      }
      if (!activeThread) return;
      // Opened straight from the Discord link: the inbox gives the student's email.
      if (owner) void loadThreads().then(setThreads).catch(() => {});
      const next = await loadThread(activeThread);
      setMessages(next);
      const theirs = next.some(m => !m.readAt && m.sender !== (owner ? 'owner' : 'user'));
      if (theirs) { await markRead(activeThread); if (!owner) setUnread(0); }
      setNotSetUp(false);
    } catch (e) {
      if (e instanceof SupportNotSetUpError) setNotSetUp(true);
    }
  }, [owner, activeThread]);

  // While open: the conversation (or inbox) stays current.
  useEffect(() => {
    if (!open) return;
    void refresh();
    const tick = () => { if (document.visibilityState === 'visible') void refresh(); };
    const id = window.setInterval(tick, OPEN_POLL_MS);
    return () => window.clearInterval(id);
  }, [open, refresh]);

  // While closed: just the unread count, for the badge.
  useEffect(() => {
    if (open) return;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      if (owner) {
        try { setUnread((await loadThreads()).reduce((n, t) => n + t.unread, 0)); } catch { /* not set up */ }
      } else setUnread(await unreadReplies(userId));
    };
    const first = window.setTimeout(check, 3_000);
    const id = window.setInterval(check, CLOSED_POLL_MS);
    return () => { window.clearTimeout(first); window.clearInterval(id); };
  }, [open, owner, userId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length, open]);

  useEffect(() => { if (open && activeThread) inputRef.current?.focus(); }, [open, activeThread]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function send() {
    const text = draft.trim();
    if (!text || sending || !activeThread) return;
    setSending(true);
    setError(null);
    try {
      const sent = owner ? await sendAsOwner(activeThread, text) : await sendAsStudent(text, location.pathname);
      setMessages(m => [...(m ?? []), sent]);
      setDraft('');
    } catch (e) {
      if (e instanceof SupportNotSetUpError) setNotSetUp(true);
      else setError(e instanceof Error ? e.message : 'Couldn’t send. Please try again.');
    } finally {
      setSending(false);
    }
  }

  function openThread(id: string | null) {
    setMessages(null);
    setError(null);
    setDraft('');
    setThread(id);
  }

  const current = owner && thread ? threads?.find(t => t.userId === thread) : null;
  const title = owner ? (thread ? current?.email ?? 'Conversation' : 'Messages') : 'Message the developer';

  return (
    <>
      {open && (
        <section className={styles.panel} role="dialog" aria-label={title}>
          <header className={styles.head}>
            {owner && thread && (
              <button className={styles.iconBtn} onClick={() => openThread(null)} aria-label="All conversations"><ArrowLeft size={16} /></button>
            )}
            <div className={styles.headText}>
              <h2 className={styles.title}>{title}</h2>
              {!owner && <p className={styles.sub}>Found a bug or have an idea? A real person reads every message and replies here.</p>}
            </div>
            <button className={styles.iconBtn} onClick={() => setOpen(false)} aria-label="Close messages"><X size={16} /></button>
          </header>

          {notSetUp ? (
            <p className={styles.empty}>Messaging isn’t set up yet. Please try again later.</p>
          ) : owner && !thread ? (
            <div className={styles.inbox}>
              {threads === null && <p className={styles.empty}>Loading…</p>}
              {threads?.length === 0 && <p className={styles.empty}>No messages yet.</p>}
              <ul className={styles.threadList}>
                {threads?.map(t => (
                  <li key={t.userId}>
                    <button className={styles.threadRow} onClick={() => openThread(t.userId)}>
                      <span className={styles.threadTop}>
                        <span className={styles.threadEmail}>{t.email}</span>
                        <span className={styles.threadTime}>{timeOf(t.lastAt)}</span>
                      </span>
                      <span className={styles.threadSnippet}>
                        {t.lastSender === 'owner' && 'You: '}{t.lastBody}
                      </span>
                      {t.unread > 0 && <span className={styles.threadUnread} aria-label={`${t.unread} unread`}>{t.unread}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <div className={styles.messages} ref={listRef} aria-live="polite">
                {messages === null && <p className={styles.empty}>Loading…</p>}
                {messages?.length === 0 && !owner && (
                  <p className={styles.empty}>Say hi, report a bug, or ask for something. What page you’re on is sent with it.</p>
                )}
                {messages?.map(m => {
                  const mine = m.sender === (owner ? 'owner' : 'user');
                  return (
                    <div key={m.id} className={`${styles.msg} ${mine ? styles.mine : styles.theirs}`}>
                      <p className={styles.bubbleText}>{m.body}</p>
                      <span className={styles.msgTime}>{timeOf(m.createdAt)}</span>
                    </div>
                  );
                })}
                {/* Automatic reply while a student waits: shown here only, never
                    saved, so it doesn't count as unread or reach the owner. */}
                {!owner && !!messages?.length && messages[messages.length - 1].sender === 'user' && (
                  <div className={`${styles.msg} ${styles.theirs}`} data-auto-reply>
                    <p className={styles.bubbleText}>
                      Got it, your message was sent. The developer reads every message and replies within 48 hours. The reply will show up right here.
                    </p>
                    <span className={styles.msgTime}>Automatic reply</span>
                  </div>
                )}
              </div>
              {error && <p role="alert" className={styles.error}>{error}</p>}
              <form className={styles.composer} onSubmit={e => { e.preventDefault(); void send(); }}>
                <textarea
                  ref={inputRef}
                  className={styles.input}
                  value={draft}
                  maxLength={MESSAGE_MAX}
                  rows={2}
                  placeholder={owner ? 'Reply…' : 'Write a message…'}
                  aria-label={owner ? 'Reply' : 'Message'}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
                />
                <button className={styles.send} type="submit" disabled={!draft.trim() || sending} aria-label="Send">
                  <Send size={15} />
                </button>
              </form>
            </>
          )}
        </section>
      )}
      <button
        className={styles.launcher}
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close messages' : unread ? `Messages, ${unread} unread` : owner ? 'Messages' : 'Message the developer'}
        aria-expanded={open}
        title={owner ? 'Messages' : 'Message the developer'}
      >
        {open ? <X size={17} /> : <MessageCircle size={17} />}
        {!open && unread > 0 && <span className={styles.badge}>{unread > 9 ? '9+' : unread}</span>}
      </button>
    </>
  );
}
