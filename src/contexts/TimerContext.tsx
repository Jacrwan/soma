import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { type Subject, type TimeBlock, type TimerSession } from '../types';
import { storage } from '../lib/storage';
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

export function TimerProvider({ children }: { children: ReactNode }) {
  const { elapsed, isRunning, isPaused, start, pause, resume, stop } = useTimer();
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [pendingSession, setPendingSession] = useState<{ subject: Subject; initialTask: string } | null>(null);

  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const savingRef=useRef(false);
  const pendingSaveRef=useRef<TimerSession | null>(null);
  const elapsedRef             = useRef(0);
  const activeSessionRef       = useRef<ActiveSession | null>(null);
  const mergedBlockIdRef       = useRef<string | null>(null);
  // Behavior 2: track a recent block to extend on continuation
  const continuationBlockIdRef = useRef<string | null>(null);
  const pauseDurationRef       = useRef<number>(0);

  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);

  // Recover any in-progress timer from Supabase on app load
  useEffect(() => {
    void storage.cleanupTestBlocks('Semester II Graded Assignments').catch(() => {});
    storage.getActiveTimer().then(async row => {
      if (!row) return;
      await storage.loadSubjects();
      if(activeSessionRef.current)return;
      const subj = storage.getSubjects().find(s => s.id === row.subject_id);
      if (!subj) { setError('Could not recover your timer subject. Refresh to retry; your saved timer has been kept.'); return; }
      const resumedElapsed = row.is_paused
        ? row.accumulated_seconds
        : row.accumulated_seconds + Math.floor((Date.now() - new Date(row.start_time).getTime()) / 1000);
      const session: ActiveSession = {
        subject: subj,
        task: row.task_text ?? '',
        sessionStartTimeISO: row.session_start_time,
      };
      setActiveSession(session);
      start(resumedElapsed);
      if (row.is_paused) pause();
    }).catch(() => {});
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
    void storage.upsertActiveTimer({
      subject_id: subject.id,
      subject_name: subject.name,
      task_text: task || null,
      session_start_time: sessionStartISO,
      start_time: toLocalISO(now),
      accumulated_seconds: preSeconds,
      is_paused: false,
    }).catch(() => setError('Timer is running on this device, but could not sync. Keep this page open and retry saving when you stop.'));
  }, [start]);

  const pauseSession = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session || savingRef.current) return;
    const acc = pause();
    elapsedRef.current=acc;
    void storage.upsertActiveTimer({
      subject_id: session.subject.id,
      subject_name: session.subject.name,
      task_text: session.task || null,
      session_start_time: session.sessionStartTimeISO,
      start_time: toLocalISO(new Date()),
      accumulated_seconds: acc,
      is_paused: true,
    }).catch(() => setError('Pause could not sync. Keep this page open until the session is saved.'));
  }, [pause]);

  const resumeSession = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session || savingRef.current || pendingSaveRef.current) return;
    resume();
    const acc = elapsedRef.current;
    void storage.upsertActiveTimer({
      subject_id: session.subject.id,
      subject_name: session.subject.name,
      task_text: session.task || null,
      session_start_time: session.sessionStartTimeISO,
      start_time: toLocalISO(new Date()),
      accumulated_seconds: acc,
      is_paused: false,
    }).catch(() => setError('Resume could not sync. Keep this page open until the session is saved.'));
  }, [resume]);

  const stopSession = useCallback(async (): Promise<boolean> => {
    const session = activeSessionRef.current;
    if (!session || savingRef.current) return false;
    savingRef.current=true;setSaving(true);setError('');
    const durationSeconds = pause();
    elapsedRef.current=durationSeconds;
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
  }, [stop,pause]);

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
