import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { type Subject, type TimeBlock, type TimerSession } from '../types';
import { storage } from '../lib/storage';
import { useTimer } from '../hooks/useTimer';

function toLocalISO(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
}

function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

  // Merge running timer into a matching scheduled block (runs globally, not per-tab).
  // Case 1: timer started ≤60 min before block — stretch block startTime back.
  // Case 2: timer started mid-block — split: pre-portion becomes missed block, timer attaches to remainder.
  useEffect(() => {
    if (!activeSession) {
      mergedBlockIdRef.current = null;
      return;
    }
    const timerStartMs = new Date(activeSession.sessionStartTimeISO).getTime();
    const now = Date.now();
    const todayStr = toDateStr(new Date());
    const blocks = storage.getTimeBlocks();

    const candidate = blocks.find((b: import('../types').TimeBlock) => {
      if (b.timerSessionId) return false;
      if (b.subjectId !== activeSession.subject.id) return false;
      if (b.task !== activeSession.task) return false;
      const blockStartMs = new Date(b.startTime).getTime();
      const blockEndMs = new Date(b.endTime).getTime();
      if (b.startTime.slice(0, 10) !== todayStr) return false;
      if (now < blockStartMs) return false;
      if (timerStartMs < blockStartMs) {
        if (blockStartMs - timerStartMs > 60 * 60 * 1000) return false;
        return timerStartMs < blockEndMs;
      }
      return timerStartMs < blockEndMs;
    });

    if (!candidate || mergedBlockIdRef.current === candidate.id) return;

    mergedBlockIdRef.current = candidate.id;

    if (timerStartMs < new Date(candidate.startTime).getTime()) {
      // Case 1: early start — stretch block startTime back to timer start
      const timerStartISO = toLocalISO(new Date(timerStartMs));
      storage.setTimeBlocks(blocks.map((b: import('../types').TimeBlock) =>
        b.id === candidate.id ? { ...b, startTime: timerStartISO } : b,
      ));
      window.dispatchEvent(new CustomEvent('soma_merge_applied'));
    } else {
      // Case 2: late start — split block at timer start time
      // The portion before timerStart becomes a separate block (will be detected as missed).
      // The original block's startTime is trimmed to timerStart.
      const timerStartISO = toLocalISO(new Date(timerStartMs));
      const preBlock: TimeBlock = {
        id: crypto.randomUUID(),
        subjectId: candidate.subjectId,
        task: candidate.task ?? '',
        startTime: candidate.startTime,
        endTime: timerStartISO,
        source: candidate.source,
      };
      const updatedBlocks = blocks.map((b: import('../types').TimeBlock) =>
        b.id === candidate.id ? { ...b, startTime: timerStartISO } : b,
      );
      storage.setTimeBlocks([...updatedBlocks, preBlock]);
      window.dispatchEvent(new CustomEvent('soma_merge_applied'));
    }
  }, [activeSession]);

  const openInputModal = useCallback((subject: Subject, initialTask = '') => {
    if (activeSessionRef.current) return;
    setPendingSession({ subject, initialTask });
  }, []);

  const closeInputModal = useCallback(() => setPendingSession(null), []);

  const startSession = useCallback((subject: Subject, task: string, preSeconds: number) => {
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

    // Capture continuation state before clearing refs
    const continuationBlockId = continuationBlockIdRef.current;
    continuationBlockIdRef.current = null;
    const pauseDuration = pauseDurationRef.current;
    pauseDurationRef.current = 0;

    const timerSession: TimerSession = {
      id: crypto.randomUUID(),
      subjectId: session.subject.id,
      task: session.task,
      startTime: session.sessionStartTimeISO,
      endTime,
      durationSeconds,
      ...(pauseDuration > 0 ? { pauseDurationSeconds: pauseDuration } : {}),
    };
    storage.setTimerSessions([...storage.getTimerSessions(), timerSession]);
    void storage.saveTimerSession(timerSession, session.subject.name).catch(() => {});
    void storage.deleteActiveTimer().catch(() => {});
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
      return;
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
