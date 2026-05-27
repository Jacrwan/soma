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
  stopSession: () => void;
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

  const elapsedRef        = useRef(0);
  const activeSessionRef  = useRef<ActiveSession | null>(null);

  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);

  // Recover any in-progress timer from Supabase on app load
  useEffect(() => {
    storage.getActiveTimer().then(row => {
      if (!row) return;
      const subj = storage.getSubjects().find(s => s.id === row.subject_id);
      if (!subj) { void storage.deleteActiveTimer().catch(() => {}); return; }
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

  const openInputModal = useCallback((subject: Subject, initialTask = '') => {
    if (activeSessionRef.current) return;
    setPendingSession({ subject, initialTask });
  }, []);

  const closeInputModal = useCallback(() => setPendingSession(null), []);

  const startSession = useCallback((subject: Subject, task: string, preSeconds: number) => {
    const now = new Date();
    const sessionStartISO = toLocalISO(new Date(now.getTime() - preSeconds * 1000));
    const session: ActiveSession = { subject, task, sessionStartTimeISO: sessionStartISO };
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
    }).catch(() => {});
  }, [start]);

  const pauseSession = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session) return;
    pause();
    const acc = elapsedRef.current;
    void storage.upsertActiveTimer({
      subject_id: session.subject.id,
      subject_name: session.subject.name,
      task_text: session.task || null,
      session_start_time: session.sessionStartTimeISO,
      start_time: toLocalISO(new Date()),
      accumulated_seconds: acc,
      is_paused: true,
    }).catch(() => {});
  }, [pause]);

  const resumeSession = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session) return;
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
    }).catch(() => {});
  }, [resume]);

  const stopSession = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session) return;
    stop();
    setActiveSession(null);
    const endTime = toLocalISO(new Date());
    const durationSeconds = elapsedRef.current;

    const timerSession: TimerSession = {
      id: crypto.randomUUID(),
      subjectId: session.subject.id,
      task: session.task,
      startTime: session.sessionStartTimeISO,
      endTime,
      durationSeconds,
    };
    storage.setTimerSessions([...storage.getTimerSessions(), timerSession]);
    void storage.saveTimerSession(timerSession, session.subject.name).catch(() => {});
    void storage.deleteActiveTimer().catch(() => {});

    const updatedSubjects = storage.getSubjects().map(s =>
      s.id === session.subject.id ? { ...s, totalTimeToday: s.totalTimeToday + durationSeconds } : s,
    );
    storage.setSubjects(updatedSubjects);

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

    window.dispatchEvent(new CustomEvent('soma_timer_stopped'));
  }, [stop]);

  return (
    <TimerContext.Provider value={{
      elapsed, isRunning, isPaused,
      activeSession, pendingSession,
      openInputModal, closeInputModal,
      startSession, pauseSession, resumeSession, stopSession,
    }}>
      {children}
    </TimerContext.Provider>
  );
}
