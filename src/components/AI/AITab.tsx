import { useState, useRef, useEffect, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { useNavigate } from 'react-router-dom';
import { storage } from '../../lib/storage';
import { formatDateTime, useTimeFormat } from '../../lib/timeFormat';
import { aiErrorMessage } from '../../lib/aiResponse';
import { dateAt } from '../DashboardV2/liveData';
import type { PlanBlock } from '../DashboardV2/PlanEditor';
import { askSoma, applyProposal, applyAll, dismissProposal } from '../../lib/assistant';
import { useProposals, getProposals, resolutionOf } from '../../lib/proposalStore';
import { listDocuments } from '../../lib/documents';
import { formatClockRange } from '../../lib/timeFormat';
import { useSubscription, hasAIAccess } from '../../lib/subscription';
import { ChatMessage, ChatSession } from '../../types';
import { SkeletonBlock, SkeletonPage } from '../UI/Skeleton';
import TrialSetupModal from '../Trial/TrialSetupModal';
import styles from './AITab.module.css';
import { MONTHLY_PRICE, SEMESTER_PRICE, TRIAL_DAYS } from '../../lib/pricing';
import AiBudgetMeter from '../UI/AiBudgetMeter';
import { useAiBudget, budgetUsedUp } from '../../lib/aiBudget';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
  // eslint-disable-next-line no-var
  var SpeechRecognition: any;
}

function SessionListSkeleton() {
  return (
    <div style={{ padding: '6px 0' }}>
      {[148, 112, 164].map((w, i) => (
        <div key={i} style={{ padding: '7px 16px' }}>
          <SkeletonBlock width={w} height={13} />
        </div>
      ))}
    </div>
  );
}

// ── Date/session helpers ────────────────────────────────────────────────────

function fmtSessionTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return formatDateTime(d);
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getTodayKey(): string {
  const now = new Date();
  const effective = now.getHours() < 5
    ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
    : now;
  const y = effective.getFullYear();
  const m = String(effective.getMonth() + 1).padStart(2, '0');
  const d = String(effective.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function makeSessionTitle(dateKey: string): string {
  const [y, mo, d] = dateKey.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function migrateLegacy(sessions: ChatSession[]): ChatSession[] {
  const raw = localStorage.getItem('soma_chat_history');
  if (!raw) return sessions;
  try {
    const messages: ChatMessage[] = JSON.parse(raw);
    if (!messages.length) { localStorage.removeItem('soma_chat_history'); return sessions; }
    const todayKey = getTodayKey();
    if (sessions.some(s => s.date === todayKey && s.messages.length > 0)) return sessions;
    const migrated: ChatSession = {
      id: crypto.randomUUID(),
      date: todayKey,
      title: makeSessionTitle(todayKey),
      messages,
      createdAt: new Date().toISOString(),
    };
    localStorage.removeItem('soma_chat_history');
    return [migrated, ...sessions.filter(s => s.date !== todayKey)];
  } catch { return sessions; }
}

// ── Message formatting ──────────────────────────────────────────────────────

function stripTags(content: string) {
  return content
    .replace(/<schedule>[\s\S]*?<\/(?:schedule|todos)>/g, '')
    .replace(/<todos>[\s\S]*?<\/(?:todos|schedule)>/g, '')
    .replace(/<createDoc\b[\s\S]*?<\/createDoc>/g, '')
    .replace(/<createSlides\b[\s\S]*?<\/createSlides>/g, '')
    .replace(/<soma-action>[\s\S]*?<\/soma-action>/g, '')
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
    .replace(/<[a-zA-Z][a-zA-Z0-9]*[^>]+name="soma-action"[^>]*>[\s\S]*?<\/[a-zA-Z][a-zA-Z0-9]*>/g, '')
    .replace(/<raw>[\s\S]*?<\/raw>/g, '')
    .replace(/<artifact[^>]*>[\s\S]*?<\/artifact>/g, '')
    .trim();
}

function formatMessage(content: string): string {
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>');
  // Split on paragraph breaks (2+ newlines), wrap each in <p>, convert remaining \n to <br>
  const html = escaped
    .split(/\n{2,}/)
    .map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['strong', 'p', 'br'], ALLOWED_ATTR: [] });
}

// ── Sub-components ──────────────────────────────────────────────────────────

/** Soma's proposals from one reply, each with Accept and Dismiss — the same
 *  proposals the dashboard shows in the plan, and accepting either place works. */
function ProposalCard({
  proposals, pending, status, busy, onAccept, onDismiss, onAcceptAll,
}: {
  proposals: PlanBlock[];
  pending: Set<string | number>;
  status: (p: PlanBlock) => 'pending' | 'accepted' | 'dismissed' | 'expired';
  busy: boolean;
  onAccept: (p: PlanBlock) => void;
  onDismiss: (p: PlanBlock) => void;
  onAcceptAll: () => void;
}) {
  const open = proposals.filter(p => pending.has(p.id));
  const when = (p: PlanBlock) => {
    const d = dateAt(new Date(), p.day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    if (p.changeKind === 'remove') return `Delete · ${d}`;
    if (p.changeKind === 'complete') return 'Mark done';
    return `${p.time ? formatClockRange(p.time) : 'Any time'} · ${d}`;
  };
  return (
    <div className={styles.card} role="group" aria-label="Soma's proposals">
      <div className={styles.cardBody}>
        {proposals.map(p => {
          const state = status(p);
          return (
            <div key={p.id} className={styles.proposalRow}>
              <div className={styles.proposalText}>
                <span className={styles.proposalTitle}>{p.title}</span>
                <span className={styles.proposalMeta}>{p.subject} · {when(p)}{p.note ? ` · ${p.note}` : ''}</span>
              </div>
              {state === 'pending' ? (
                <span className={styles.proposalActions}>
                  <button className={styles.proposalAccept} disabled={busy} onClick={() => onAccept(p)} aria-label={`Accept: ${p.title}`}>Accept</button>
                  <button className={styles.proposalDismiss} disabled={busy} onClick={() => onDismiss(p)} aria-label={`Dismiss: ${p.title}`}>Dismiss</button>
                </span>
              ) : (
                <span className={styles.proposalState}>{state === 'accepted' ? 'Added' : state === 'dismissed' ? 'Dismissed' : 'No longer pending'}</span>
              )}
            </div>
          );
        })}
      </div>
      {open.length > 1 && (
        <div className={styles.cardActions}>
          <button className={`${styles.cardBtn} ${styles.cardBtnAccent}`} disabled={busy} onClick={onAcceptAll}>Accept all ({open.length})</button>
        </div>
      )}
    </div>
  );
}

interface SessionRowProps {
  session: ChatSession;
  isActive: boolean;
  isConfirming: boolean;
  onSelect: () => void;
  onDeleteClick: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function SessionRow({ session, isActive, isConfirming, onSelect, onDeleteClick, onConfirm, onCancel }: SessionRowProps) {
  if (isConfirming) {
    return (
      <div className={styles.sessionRowConfirm}>
        <span className={styles.sessionConfirmText}>Delete?</span>
        <button className={styles.sessionConfirmYes} onClick={e => { e.stopPropagation(); onConfirm(); }}>Delete</button>
        <button className={styles.sessionConfirmNo} onClick={e => { e.stopPropagation(); onCancel(); }}>Cancel</button>
      </div>
    );
  }

  const firstUserMsg = session.messages.find(m => m.role === 'user');
  const displayTitle = firstUserMsg
    ? firstUserMsg.content.replace(/\n/g, ' ').slice(0, 50)
    : 'New chat';

  return (
    <div
      className={`${styles.sessionRow}${isActive ? ` ${styles.sessionRowActive}` : ''}`}
      onClick={onSelect}
    >
      <div className={styles.sessionInfo}>
        <span className={styles.sessionTitle}>{displayTitle}</span>
        <span className={styles.sessionTimestamp}>{fmtSessionTimestamp(session.createdAt)}</span>
      </div>
      <button
        className={styles.sessionDeleteBtn}
        title="Delete chat"
        onClick={e => { e.stopPropagation(); onDeleteClick(); }}
      >×</button>
    </div>
  );
}

function ThinkingIndicator() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = elapsed % 60;
  const mins = Math.floor(elapsed / 60);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  return (
    <div className={`${styles.messageRow} ${styles.assistantRow}`}>
      <div className={`${styles.bubble} ${styles.assistantBubble} ${styles.thinkingBubble}`}>
        <span className={styles.thinkingDots}>
          <span className={styles.thinkingDot} />
          <span className={styles.thinkingDot} />
          <span className={styles.thinkingDot} />
        </span>
        <span className={styles.thinkingTimer}>{timeStr}</span>
      </div>
    </div>
  );
}

// ── Locked screen ───────────────────────────────────────────────────────────

function AILockedScreen({ status }: { status: string }) {
  const navigate = useNavigate();

  const starIcon = (
    <svg className={styles.lockedIcon} width="28" height="28" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1L8.1 5.9L13 7L8.1 8.1L7 13L5.9 8.1L1 7L5.9 5.9Z"/>
    </svg>
  );

  // Trial over (including the old extended trials) — pay to continue
  if (status === 'trial_expired' || status === 'trial_extension_expired') {
    return (
      <div className={styles.lockedLayout}>
        <div className={styles.lockedCard}>
          {starIcon}
          <h2 className={styles.lockedTitle}>Your free trial has ended</h2>
          <p className={styles.lockedDesc}>
            Subscribe to Soma Premium to keep using the AI features.
          </p>
          <button className={styles.lockedBtn} onClick={() => navigate('/pricing')}>
            Subscribe — {MONTHLY_PRICE}/mo
          </button>
          <p className={styles.lockedMeta}>Or {SEMESTER_PRICE} every 4 months · Cancel anytime</p>
        </div>
      </div>
    );
  }

  // Free user — show trial setup modal (plan selection + card upfront)
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      {showModal && (
        <TrialSetupModal
          onComplete={() => navigate(0 as any)}
          onSkip={() => setShowModal(false)}
        />
      )}
      <div className={styles.lockedLayout}>
        <div className={styles.lockedCard}>
          {starIcon}
          <h2 className={styles.lockedTitle}>AI planning is included with Soma Premium</h2>
          <p className={styles.lockedDesc}>
            Get AI-powered scheduling, todo generation, and study planning.
            Start your <strong>{TRIAL_DAYS}-day free trial</strong> — no charge until the trial ends.
          </p>
          <button className={styles.lockedBtn} onClick={() => setShowModal(true)}>
            Start free trial
          </button>
          <p className={styles.lockedMeta}>{MONTHLY_PRICE}/mo after trial · Cancel anytime</p>
        </div>
      </div>
    </>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function AITab() {
  useTimeFormat(); // re-render when the 12h/24h preference changes
  const subscription = useSubscription();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const [activeSessionId, setActiveSessionId] = useState<string>(storage.getActiveSessionId);

  const [currentSubjectKey, setCurrentSubjectKey] = useState<string>('general');

  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(false);
  // This month's Soma: shown under the input; used up, asking pauses.
  const budget = useAiBudget();
  const paused = budgetUsedUp(budget);
  const [historyError,setHistoryError]=useState('');
  const [proposalError,setProposalError]=useState('');
  const [accepting,setAccepting]=useState(false);
  // Proposals are shared with the dashboard, keyed by the signed-in account.
  const [userId,setUserId]=useState('');
  const pendingProposals=useProposals(userId);
  const chatSaves=useRef(new Map<string,Promise<void>>());
  const chatOwner=useRef<string|null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceTriggered, setVoiceTriggered] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // getCanvasIcalUrl() below is read fresh on every render, but the value it
  // reads is populated asynchronously by loadTokens(). If this tab renders
  // before that resolves, the "Connect Canvas" banner can get stuck showing
  // for an account that's actually connected, since nothing here re-renders
  // once the real value lands. This forces one re-render when it does.
  const [, forceCanvasStatusRecheck] = useState(0);
  useEffect(() => {
    let cancelled = false;
    storage.whenTokensLoaded().then(() => {
      if (!cancelled) forceCanvasStatusRecheck(n => n + 1);
    });
    return () => { cancelled = true; };
  }, []);

  // Populate the documents cache on mount so the system prompt has content
  // even if the user never visits the Documents page this session.
  useEffect(() => {
    void listDocuments().catch(() => {});
  }, []);

  const messages = useMemo(
    () => sessions.find(s => s.id === activeSessionId)?.messages ?? [],
    [sessions, activeSessionId],
  );

  const sortedSessions = useMemo(
    () => [...sessions]
      .filter(s => s.messages.length > 0 || s.id === activeSessionId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [sessions, activeSessionId],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadSessions() {
      try {
        chatOwner.current=await storage.getUserId();
        if(!cancelled)setUserId(chatOwner.current);
        let remote = await storage.fetchChatSessions();

        // One-time migration: if Supabase is empty, push any localStorage sessions up
        if (remote.length === 0) {
          let local = storage.getChatSessions();
          local = migrateLegacy(local);
          if (local.length > 0) {
            await storage.migrateChatSessions(local);
            localStorage.removeItem('soma_chat_sessions');
            localStorage.removeItem('soma_chat_history');
            remote = await storage.fetchChatSessions();
          }
        }

        if (cancelled) return;

        if (remote.length === 0) {
          const todayKey = getTodayKey();
          const fresh: ChatSession = {
            id: crypto.randomUUID(),
            date: todayKey,
            title: makeSessionTitle(todayKey),
            messages: [],
            createdAt: new Date().toISOString(),
          };
          await storage.upsertChatSession(fresh,chatOwner.current??undefined);
          remote = [fresh];
        }

        setSessions(remote);

        const savedId = storage.getActiveSessionId();
        if (savedId && remote.some(s => s.id === savedId)) {
          setActiveSessionId(savedId);
          const s = remote.find(x => x.id === savedId);
          if (s?.subjectKey) setCurrentSubjectKey(s.subjectKey);
        } else {
          const todayKey = getTodayKey();
          const today = remote.find(s => s.date === todayKey) ?? remote[0];
          const fallbackId = today?.id ?? '';
          setActiveSessionId(fallbackId);
          storage.setActiveSessionId(fallbackId);
          if (today?.subjectKey) setCurrentSubjectKey(today.subjectKey);
        }
      } catch (err) {
        console.error('[AITab] failed to load sessions from Supabase:', err);
        if (!cancelled) setHistoryError('Chat history could not load. Reload the page to retry before sending a message.');
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    }
    loadSessions();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (voiceTriggered && input.trim() && !loading) {
      send();
    }
  }, [voiceTriggered]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  function updateSession(id: string, fn: (s: ChatSession) => ChatSession) {
    setSessions(prev => {
      const next = prev.map(s => s.id !== id ? s : fn(s));
      const updated = next.find(s => s.id === id);
      if (updated) {
        const owner=chatOwner.current;
        const queued=(chatSaves.current.get(id)??Promise.resolve()).catch(()=>{}).then(()=>{if(!owner)throw new Error('auth_required');return storage.upsertChatSession(updated,owner);});
        chatSaves.current.set(id,queued);
        void queued.then(()=>setHistoryError('')).catch(()=>setHistoryError('Chat history could not be saved. Keep this page open and try again.'));
      }
      return next;
    });
  }

  function selectSession(id: string) {
    setActiveSessionId(id);
    storage.setActiveSessionId(id);
    setDeleteConfirmId(null);
    setInput('');
    const s = sessions.find(x => x.id === id);
    if (s?.subjectKey) setCurrentSubjectKey(s.subjectKey);
  }

  function newChat() {
    const todayKey = getTodayKey();
    const session: ChatSession = {
      id: crypto.randomUUID(),
      date: todayKey,
      title: makeSessionTitle(todayKey),
      messages: [],
      createdAt: new Date().toISOString(),
      subjectKey: currentSubjectKey,
    };
    setSessions(prev => [session, ...prev]);
    void storage.upsertChatSession(session).catch(err => console.error('[AITab] newChat upsert:', err));
    setActiveSessionId(session.id);
    storage.setActiveSessionId(session.id);
    setInput('');
  }

  function deleteSession(id: string) {
    void storage.deleteChatSession(id).catch(err => console.error('[AITab] deleteSession:', err));
    const next = sessions.filter(s => s.id !== id);
    if (id === activeSessionId) {
      if (next.length > 0) {
        const sorted = [...next].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setActiveSessionId(sorted[0].id);
        storage.setActiveSessionId(sorted[0].id);
      } else {
        const todayKey = getTodayKey();
        const fresh: ChatSession = {
          id: crypto.randomUUID(),
          date: todayKey,
          title: makeSessionTitle(todayKey),
          messages: [],
          createdAt: new Date().toISOString(),
        };
        void storage.upsertChatSession(fresh).catch(err => console.error('[AITab] deleteSession fresh:', err));
        storage.setActiveSessionId(fresh.id);
        setSessions([fresh]);
        setActiveSessionId(fresh.id);
        setDeleteConfirmId(null);
        return;
      }
    }
    setSessions(next);
    setDeleteConfirmId(null);
  }

  function stopSpeaking() {
    window.speechSynthesis.cancel();
  }

  function speakText(text: string) {
    stopSpeaking();
    const clean = text
      .replace(/<[^>]+>/g, '')
      .replace(/\*\*/g, '')
      .replace(/^[-•]\s*/gm, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .trim();
    if (!clean) return;
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  }

  function toggleVoice() {
    if (voiceActive) {
      recognitionRef.current?.stop();
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    stopSpeaking();
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognitionRef.current = recognition;

    let finalTranscript = '';

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += t;
        } else {
          interim = t;
        }
      }
      setInput(finalTranscript + interim);
    };

    recognition.onend = () => {
      setVoiceActive(false);
      recognitionRef.current = null;
      if (finalTranscript.trim()) {
        setVoiceTriggered(true);
      }
    };

    recognition.onerror = () => {
      setVoiceActive(false);
      recognitionRef.current = null;
    };

    setVoiceActive(true);
    recognition.start();
  }

  async function send() {
    if (paused) return;
    const text = input.trim();
    if (!text || loading || !activeSessionId) return;

    const isVoice = voiceTriggered;
    setVoiceTriggered(false);
    stopSpeaking();

    const session = sessions.find(s => s.id === activeSessionId);
    if (!session) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, at: new Date().toISOString() };
    const messagesWithUser = [...session.messages, userMsg];

    setInput('');
    setLoading(true);
    updateSession(activeSessionId, s => ({ ...s, messages: messagesWithUser }));

    try {
      const requestUserId=await storage.getUserId();
      // What the model said before (its JSON answers) rather than what was shown,
      // so it sees its own earlier proposals. Older chats only have the shown text.
      const history=session.messages
        .map(m=>({role:m.role,content:m.modelContent ?? stripTags(m.content),...(m.at ? {at:m.at} : {})}))
        .filter(m=>m.content.trim());
      const result=await askSoma({userId:requestUserId,origin:dateAt(new Date(),0),text,history,voice:isVoice,conversationId:activeSessionId ?? undefined});
      await storage.assertUser(requestUserId);
      const made=getProposals(requestUserId).filter(p=>result.proposedIds.includes(p.id));
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(), role: 'assistant', content: result.display,
        modelContent: result.history[result.history.length-1].content, at: result.history[result.history.length-1].at,
        ...(made.length ? { proposals: made } : {}),
      };
      updateSession(activeSessionId, s => ({ ...s, messages: [...s.messages, assistantMsg] }));
      if (isVoice) speakText(result.display);
    } catch (err: unknown) {
      const content = aiErrorMessage(err);
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(), role: 'assistant',
        content,
      };
      updateSession(activeSessionId, s => ({ ...s, messages: [...s.messages, errorMsg] }));
    } finally {
      setLoading(false);
    }
  }

  function markProposals(msgId: string, ids: (string | number)[]) {
    updateSession(activeSessionId, s => ({
      ...s,
      messages: s.messages.map(m => {
        if (m.id !== msgId) return m;
        const status = { ...m.proposalStatus };
        for (const id of ids) { const how = resolutionOf(id); if (how) status[String(id)] = how; }
        return { ...m, proposalStatus: status };
      }),
    }));
  }

  async function acceptProposal(msgId: string, proposal: PlanBlock) {
    if (accepting) return;
    setAccepting(true); setProposalError('');
    try {
      // The dashboard may have edited it since; accept what is pending now.
      const current = pendingProposals.find(p => p.id === proposal.id) ?? proposal;
      await applyProposal(userId, dateAt(new Date(), 0), { ...current, state: 'Planned' });
    } catch (error) { setProposalError(`${proposal.title}: ${aiErrorMessage(error)}`); }
    finally { markProposals(msgId, [proposal.id]); setAccepting(false); }
  }

  async function acceptAllProposals(msgId: string, ids: (string | number)[]) {
    if (accepting) return;
    setAccepting(true); setProposalError('');
    try {
      const failed = await applyAll(userId, dateAt(new Date(), 0), ids);
      if (failed.length) setProposalError(`${failed.length === ids.length ? 'Nothing was saved:' : 'The rest were saved, but not'} ${failed.map(f => `"${f.title}" (${f.reason.replace(/\.$/, '')})`).join(', ')}.`);
    } finally { markProposals(msgId, ids); setAccepting(false); }
  }

  function dismiss(msgId: string, proposal: PlanBlock) {
    dismissProposal(userId, proposal.id);
    markProposals(msgId, [proposal.id]);
  }

  if (subscription.status === 'loading') {
    return (
      <SkeletonPage label="Loading Soma…"><div className={styles.layout}>
        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <SkeletonBlock width={60} height={13} />
          </div>
          <SessionListSkeleton />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '32px 40px', gap: 20 }}>
          <div style={{ alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SkeletonBlock width={260} height={14} borderRadius={10} />
            <SkeletonBlock width={180} height={14} borderRadius={10} />
          </div>
          <div style={{ alignSelf: 'flex-end', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SkeletonBlock width={200} height={14} borderRadius={10} />
          </div>
          <div style={{ alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SkeletonBlock width={300} height={14} borderRadius={10} />
            <SkeletonBlock width={220} height={14} borderRadius={10} />
            <SkeletonBlock width={160} height={14} borderRadius={10} />
          </div>
        </div>
      </div></SkeletonPage>
    );
  }

  if (!hasAIAccess(subscription.status)) {
    return <AILockedScreen status={subscription.status} />;
  }

  return (
    <div className={styles.layout}>
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <button className={styles.newChatBtnFull} onClick={newChat}>+ New Chat</button>
        </div>

        <div className={styles.sessionList}>
          {sessionsLoading ? <SessionListSkeleton /> : sortedSessions.map(session => (
            <SessionRow
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              isConfirming={deleteConfirmId === session.id}
              onSelect={() => selectSession(session.id)}
              onDeleteClick={() => setDeleteConfirmId(session.id)}
              onConfirm={() => deleteSession(session.id)}
              onCancel={() => setDeleteConfirmId(null)}
            />
          ))}
          {!sessionsLoading && sortedSessions.every(s => s.messages.length === 0) && (
            <p className={styles.sessionEmptyHint}>No chats yet</p>
          )}
        </div>
      </div>

      {/* ── Chat area ───────────────────────────────────────────────────── */}
      <div className={styles.chatArea}>
        <div className={styles.messageList}>
          {messages.length === 0 && (() => {
            const canvasConnected = Boolean(storage.getCanvasIcalUrl());
            const chips = canvasConnected
              ? ['Plan my week', "What's due soon?", 'Help me focus today']
              : ['Plan my day', 'What should I study first?'];
            return (
              <div className={styles.emptyState}>
                <div className={styles.emptyHint}>Start by describing what you need to accomplish today.</div>
                {!canvasConnected && (
                  <div className={styles.canvasBanner}>
                    Connect Canvas to let Soma see your assignments.{' '}
                    <a href="/canvas" className={styles.canvasBannerLink}>Connect</a>
                  </div>
                )}
                <div className={styles.suggestions}>
                  {chips.map(s => (
                    <button key={s} className={styles.suggestionBtn} onClick={() => setInput(s)}>{s}</button>
                  ))}
                </div>
              </div>
            );
          })()}
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`${styles.messageRow} ${msg.role === 'user' ? styles.userRow : styles.assistantRow}`}
            >
              <div
                className={`${styles.bubble} ${msg.role === 'user' ? styles.userBubble : styles.assistantBubble}`}
                dangerouslySetInnerHTML={{ __html: formatMessage(stripTags(msg.content)) }}
              />
              {msg.role === 'assistant' && msg.proposals?.length ? (() => {
                const live = new Map(pendingProposals.map(p => [p.id, p]));
                const shown = msg.proposals.map(p => live.get(p.id) ?? p);
                return (
                  <ProposalCard
                    proposals={shown}
                    pending={new Set(live.keys())}
                    status={p => live.has(p.id) ? 'pending' : resolutionOf(p.id) ?? msg.proposalStatus?.[String(p.id)] ?? 'expired'}
                    busy={accepting}
                    onAccept={p => void acceptProposal(msg.id, p)}
                    onDismiss={p => dismiss(msg.id, p)}
                    onAcceptAll={() => void acceptAllProposals(msg.id, shown.filter(p => live.has(p.id)).map(p => p.id))}
                  />
                );
              })() : null}
            </div>
          ))}
          {loading && <ThinkingIndicator />}
          <div ref={messagesEndRef} />
        </div>

        <div className={styles.inputAreaWrapper}>
          {historyError && <p role="alert">{historyError}</p>}
          {proposalError && <p role="alert">{proposalError}</p>}
          <div className={styles.inputRow}>
            <textarea
              ref={textareaRef}
              className={styles.textInput}
              placeholder="Message Soma…"
              value={input}
              disabled={loading}
              rows={1}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button
              className={`${styles.micBtn}${voiceActive ? ` ${styles.micBtnActive}` : ''}`}
              onClick={toggleVoice}
              disabled={loading}
              title={voiceActive ? 'Stop listening' : 'Voice input'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="1" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <line x1="12" y1="17" x2="12" y2="23" />
              </svg>
            </button>
            <button
              className={styles.sendBtn}
              onClick={send}
              disabled={loading || !input.trim() || paused}
            >Send</button>
          </div>
          <AiBudgetMeter budget={budget} returnPath="/ai" />
        </div>
      </div>
    </div>
  );
}
