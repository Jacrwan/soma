import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { type Subject, type TimeBlock, type TimerSession } from '../types';
import { storage } from '../lib/storage';
import { readMirror, writeMirror, clearMirror, elapsedFromMirror } from '../lib/activeTimerMirror';
import type { SubjectColor } from '../types';
import { useTimer } from '../hooks/useTimer';

function toLocalISO(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
}

export interface ActiveSession {
  subject: Subject;
  task: string;
  sessionStartTimeISO: string;
}

interface TimerContextValue {
  elapsed: number;
  isRunning: boolean;
  isPaused: boolean;
  activeSession: ActiveSession | null;
  pendingSession: { subject: Subject; initialTask: string } | null;
  openInputModal: (subject: Subject, initialTask?: string) => void;
  closeInputModal: () => void;
  startSession: (subject: Subject, task: string, preSeconds: number) => void;
  pauseSession: () => void;
  resumeSession: () => void;
  stopSession: () => Promise<boolean>;
  saving: boolean;
  savePending: boolean;
  error: string;
}

const TimerContext = createContext<TimerContextValue | null>(null);

export function useTimerContext() {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error('useTimerContext must be used within TimerProvider');
  return ctx;
}

export function TimerProvider({ children, userId = null }: { children: ReactNode; userId?: string | null }) {
  const { elapsed, isRunning, isPaused, start, pause, resume, stop } = useTimer();
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [pendingSession, setPendingSession] = useState<{ subject: Subject; initialTask: string } | null>(null);

  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const savingRef=useRef(false);
  // Read by the cross-window poll, which must not re-arm whenever it changes.
  const isPausedRef=useRef(false);
  // The session this window has actually seen in the shared record. Only
  // such a session can have been stopped elsewhere; one that never synced
  // is this device's own and must not be discarded.
  const seenSessionRef=useRef<string | null>(null);
  /**
   * Whether two records name the same session. A session's own
   * sessionStartTimeISO is local time with no zone suffix, while the shared
   * row comes back normalised to UTC, so the strings differ for one instant.
   */
  const sameSession = (a?: string | null, b?: string | null) => {
    if (!a || !b) return false;
    const x = new Date(a).getTime(), y = new Date(b).getTime();
    return Number.isFinite(x) && Number.isFinite(y) && x === y;
  };
  const pendingSaveRef=useRef<TimerSession | null>(null);
  const elapsedRef             = useRef(0);
  const activeSessionRef       = useRef<ActiveSession | null>(null);
  const mergedBlockIdRef       = useRef<string | null>(null);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  // Behavior 2: track a recent block to extend on continuation
  const continuationBlockIdRef = useRef<string | null>(null);
  const pauseDurationRef       = useRef<number>(0);
  const userIdRef              = useRef<string | null>(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // Snapshot the running session locally so a reload can restore it without
  // waiting on (or depending on) the network.
  const mirror = useCallback((session: ActiveSession, accumulatedSeconds: number, isPaused: boolean) => {
    writeMirror({
      userId: userIdRef.current,
      subjectId: session.subject.id,
      subjectName: session.subject.name,
      subjectColor: session.subject.color,
      task: session.task,
      sessionStartTimeISO: session.sessionStartTimeISO,
      accumulatedSeconds, isPaused, markedAtMs: Date.now(),
    });
  }, []);

  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);

  // Restore the timer on load: local mirror first so it is back instantly and
  // survives an auth or network hiccup, then Supabase for cross-device pickup.
  useEffect(() => {
    void storage.cleanupTestBlocks('Semester II Graded Assignments').catch(() => {});

    const local = readMirror();
    if (local && !activeSessionRef.current) {
      const session: ActiveSession = {
        subject: { id: local.subjectId, name: local.subjectName, color: local.subjectColor as SubjectColor, totalTimeToday: 0 },
        task: local.task,
        sessionStartTimeISO: local.sessionStartTimeISO,
      };
      activeSessionRef.current = session;
      setActiveSession(session);
      start(elapsedFromMirror(local));
      if (local.isPaused) pause();
    }

    storage.getActiveTimer().then(async row => {
      // A mirror belonging to a different account must never leak into this one.
      const stale = local && local.userId && userIdRef.current && local.userId !== userIdRef.current;
      if (stale) {
        clearMirror();
        stop();
        activeSessionRef.current = null;
        setActiveSession(null);
      }
      if (!row) {
        // Nothing server-side: a mirror with no counterpart is the local
        // record of a session that never synced, so it is left running.
        return;
      }
      seenSessionRef.current = row.session_start_time;
      await storage.loadSubjects().catch(() => {});
      // Fall back to the name stored on the row so an unloadable subject list
      // can no longer strand a running timer.
      const subj = storage.getSubjects().find(s => s.id === row.subject_id)
        ?? { id: row.subject_id, name: row.subject_name ?? 'Focus session', color: '#42a5f5' as SubjectColor, totalTimeToday: 0 };
      const session: ActiveSession = {
        subject: subj,
        task: row.task_text ?? '',
        sessionStartTimeISO: row.session_start_time,
      };
      if (activeSessionRef.current) {
        // Already restored from the mirror — keep its clock, but take the
        // fuller subject record now that subjects have loaded.
        activeSessionRef.current = { ...activeSessionRef.current, subject: subj };
        setActiveSession(prev => prev ? { ...prev, subject: subj } : prev);
        return;
      }
      const startedMs = new Date(row.start_time).getTime();
      const drift = Number.isFinite(startedMs) ? Math.floor((Date.now() - startedMs) / 1000) : 0;
      const resumedElapsed = row.is_paused
        ? row.accumulated_seconds
        : row.accumulated_seconds + Math.max(0, drift);
      activeSessionRef.current = session;
      setActiveSession(session);
      start(resumedElapsed);
      if (row.is_paused) pause();
      mirror(session, resumedElapsed, row.is_paused);
    }).catch(() => {
      if (!activeSessionRef.current && local) {
        setError('Your timer is running on this device but could not be checked against your account.');
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Other windows, and other browsers ──────────────────────────────────
  // active_timer is the shared record of what is running, but it was read once
  // on mount and never again. A second window therefore kept its own idea of
  // the timer: a session started elsewhere only appeared after a reload, and
  // stopping in one window left the others running, each saving its own row
  // for the same sitting when it was eventually stopped.
  //
  // Polling rather than a realtime subscription, because this must also work
  // between two browsers with no shared page context, and a few seconds of lag
  // on a timer that runs for an hour is not worth a new server dependency.
  useEffect(() => {
    let cancelled = false;

    async function sync() {
      if (cancelled || document.hidden) return;
      // Never race this window's own save: stopping writes the session and
      // then deletes the row, and reading in between looks like a stop
      // elsewhere.
      if (savingRef.current || pendingSaveRef.current) return;

      let row: Awaited<ReturnType<typeof storage.getActiveTimer>>;
      try { row = await storage.getActiveTimer(); }
      catch { return; }   // offline or failing: keep showing what we have
      if (cancelled || savingRef.current || pendingSaveRef.current) return;

      const local = activeSessionRef.current;

      if (row) {
        seenSessionRef.current = row.session_start_time;
        const startedMs = new Date(row.start_time).getTime();
        const drift = Number.isFinite(startedMs) ? Math.floor((Date.now() - startedMs) / 1000) : 0;
        const elapsedNow = row.is_paused
          ? row.accumulated_seconds
          : row.accumulated_seconds + Math.max(0, drift);

        if (!local || !sameSession(local.sessionStartTimeISO, row.session_start_time)) {
          await storage.loadSubjects().catch(() => {});
          if (cancelled) return;
          const subj = storage.getSubjects().find(s => s.id === row!.subject_id)
            ?? { id: row!.subject_id, name: row!.subject_name ?? 'Focus session', color: '#42a5f5' as SubjectColor, totalTimeToday: 0 };
          const session: ActiveSession = {
            subject: subj,
            task: row.task_text ?? '',
            sessionStartTimeISO: row.session_start_time,
          };
          activeSessionRef.current = session;
          setActiveSession(session);
          start(elapsedNow);
          if (row.is_paused) pause();
          mirror(session, elapsedNow, row.is_paused);
          return;
        }

        // Same session: follow a pause or resume made in the other window.
        if (row.is_paused !== isPausedRef.current) {
          if (row.is_paused) { pause(); } else { start(elapsedNow); }
          mirror(local, elapsedNow, row.is_paused);
        }
        return;
      }

      // No shared row. Only a session we have actually seen there was stopped
      // elsewhere; one that never synced is this device's own and stays put.
      // Clearing without saving is what stops a second row being written for a
      // sitting the other window already recorded.
      if (local && sameSession(seenSessionRef.current, local.sessionStartTimeISO)) {
        seenSessionRef.current = null;
        clearMirror();
        stop();
        activeSessionRef.current = null;
        setActiveSession(null);
      }
    }

    // Switching to a window syncs it immediately, so the interval only governs
    // the case where two windows are visible at once — side by side on one
    // screen, which is exactly when a stopped timer still ticking is most
    // obviously wrong. Five seconds is one small query per window.
    const id = window.setInterval(() => void sync(), 5_000);
    const onVisible = () => { if (!document.hidden) void sync(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Planned blocks remain unchanged; timer history records actual work separately.

  const openInputModal = useCallback((subject: Subject, initialTask = '') => {
    if (activeSessionRef.current) return;
    setPendingSession({ subject, initialTask });
  }, []);

  const closeInputModal = useCallback(() => setPendingSession(null), []);

  const startSession = useCallback((subject: Subject, task: string, preSeconds: number) => {
    if(activeSessionRef.current || savingRef.current)return;
    setError('');pendingSaveRef.current=null;
    const now = new Date();
    const sessionStartMs = now.getTime() - preSeconds * 1000;
    const sessionStartISO = toLocalISO(new Date(sessionStartMs));

    // Behavior 2: detect continuation — same subject+task, last session ended ≤60s ago
    continuationBlockIdRef.current = null;
    pauseDurationRef.current = 0;
    const recentSessions = storage.getTimerSessions()
      .filter(s => s.subjectId === subject.id && s.task === task);
    if (recentSessions.length > 0) {
      const lastSession = recentSessions.reduce<TimerSession>(
        (best, s) => s.endTime > best.endTime ? s : best,
        recentSessions[0],
      );
      const gapMs = sessionStartMs - new Date(lastSession.endTime).getTime();
      if (gapMs >= 0 && gapMs <= 60_000) {
        const linkedBlock = storage.getTimeBlocks().find(b => b.timerSessionId === lastSession.id);
        if (linkedBlock) {
          continuationBlockIdRef.current = linkedBlock.id;
          pauseDurationRef.current = Math.round(gapMs / 1000);
        }
      }
    }

    const session: ActiveSession = { subject, task, sessionStartTimeISO: sessionStartISO };
    activeSessionRef.current=session;
    setActiveSession(session);
    setPendingSession(null);
    start(preSeconds);
    mirror(session, preSeconds, false);
    void storage.upsertActiveTimer({
      subject_id: subject.id,
      subject_name: subject.name,
      task_text: task || null,
      session_start_time: sessionStartISO,
      start_time: toLocalISO(now),
      accumulated_seconds: preSeconds,
      is_paused: false,
    }).catch(() => setError('Timer is running on this device, but could not sync. Keep this page open and retry saving when you stop.'));
  }, [start, mirror]);

  const pauseSession = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session || savingRef.current) return;
    const acc = pause();
    elapsedRef.current=acc;
    mirror(session, acc, true);
    void storage.upsertActiveTimer({
      subject_id: session.subject.id,
      subject_name: session.subject.name,
      task_text: session.task || null,
      session_start_time: session.sessionStartTimeISO,
      start_time: toLocalISO(new Date()),
      accumulated_seconds: acc,
      is_paused: true,
    }).catch(() => setError('Pause could not sync. Keep this page open until the session is saved.'));
  }, [pause, mirror]);

  const resumeSession = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session || savingRef.current || pendingSaveRef.current) return;
    resume();
    const acc = elapsedRef.current;
    mirror(session, acc, false);
    void storage.upsertActiveTimer({
      subject_id: session.subject.id,
      subject_name: session.subject.name,
      task_text: session.task || null,
      session_start_time: session.sessionStartTimeISO,
      start_time: toLocalISO(new Date()),
      accumulated_seconds: acc,
      is_paused: false,
    }).catch(() => setError('Resume could not sync. Keep this page open until the session is saved.'));
  }, [resume, mirror]);

  const stopSession = useCallback(async (): Promise<boolean> => {
    const session = activeSessionRef.current;
    if (!session || savingRef.current) return false;
    savingRef.current=true;setSaving(true);setError('');
    const durationSeconds = pause();
    elapsedRef.current=durationSeconds;
    mirror(session, durationSeconds, true);
    const endTime = toLocalISO(new Date());

    // Capture continuation state before clearing refs
    const continuationBlockId = continuationBlockIdRef.current;
    const pauseDuration = pauseDurationRef.current;

    // Stable across retries and recovery so an interrupted save cannot duplicate history.
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${session.subject.id}:${new Date(session.sessionStartTimeISO).toISOString()}`)));
    const hex=Array.from(digest.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');
    const timerSession: TimerSession = pendingSaveRef.current ?? {
      id: `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`,
      subjectId: session.subject.id,
      task: session.task,
      startTime: session.sessionStartTimeISO,
      endTime,
      durationSeconds,
      ...(pauseDuration > 0 ? { pauseDurationSeconds: pauseDuration } : {}),
    };
    pendingSaveRef.current=timerSession;
    try {
      await storage.upsertActiveTimer({subject_id:session.subject.id,subject_name:session.subject.name,task_text:session.task,session_start_time:session.sessionStartTimeISO,start_time:toLocalISO(new Date()),accumulated_seconds:timerSession.durationSeconds,is_paused:true});
      await storage.saveTimerSession(timerSession, session.subject.name);
      await storage.deleteActiveTimer();
    } catch {setError('Could not finish saving focus. Your timer is paused; press Stop to retry.');savingRef.current=false;setSaving(false);return false;}
    clearMirror();
    stop();setActiveSession(null);activeSessionRef.current=null;pendingSaveRef.current=null;continuationBlockIdRef.current=null;pauseDurationRef.current=0;
    savingRef.current=false;setSaving(false);
    storage.setTimerSessions([...storage.getTimerSessions().filter(s=>s.id!==timerSession.id), timerSession]);
    // Let the Bosses feature credit this study time as damage.
    window.dispatchEvent(new Event('soma_focus_logged'));

    const updatedSubjects = storage.getSubjects().map(s =>
      s.id === session.subject.id ? { ...s, totalTimeToday: s.totalTimeToday + durationSeconds } : s,
    );
    storage.setSubjects(updatedSubjects);

    // Behavior 2: continuation — extend the existing block instead of creating a new one
    if (continuationBlockId) {
      const allBlocks = storage.getTimeBlocks();
      storage.setTimeBlocks(allBlocks.map(b =>
        b.id === continuationBlockId ? { ...b, endTime } : b,
      ));
      mergedBlockIdRef.current = null;
      window.dispatchEvent(new CustomEvent('soma_timer_stopped', { detail: { mergedBlockId: null, stopTime: endTime } }));
      return true;
    }

    const newBlock: TimeBlock = {
      id: crypto.randomUUID(),
      subjectId: session.subject.id,
      task: session.task,
      startTime: session.sessionStartTimeISO,
      endTime,
      source: 'manual',
      timerSessionId: timerSession.id,
    };
    storage.setTimeBlocks([...storage.getTimeBlocks(), newBlock]);

    const mergedBlockId = mergedBlockIdRef.current;
    mergedBlockIdRef.current = null;
    window.dispatchEvent(new CustomEvent('soma_timer_stopped', { detail: { mergedBlockId, stopTime: endTime } }));
    return true;
  }, [stop,pause,mirror]);

  return (
    <TimerContext.Provider value={{
      elapsed, isRunning, isPaused, saving, error, savePending: !!pendingSaveRef.current,
      activeSession, pendingSession,
      openInputModal, closeInputModal,
      startSession, pauseSession, resumeSession, stopSession,
    }}>
      {children}
    </TimerContext.Provider>
  );
}
