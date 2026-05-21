import { useState, useRef, useCallback } from 'react';

export function useTimer() {
  const [elapsed, setElapsed] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [startTime, setStartTime] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTick = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const start = useCallback((initialSeconds = 0) => {
    setStartTime(new Date().toISOString());
    setElapsed(initialSeconds);
    setIsRunning(true);
    setIsPaused(false);
    intervalRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
  }, []);

  const pause = useCallback(() => {
    clearTick();
    setIsRunning(false);
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    setIsPaused(false);
    setIsRunning(true);
    intervalRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
  }, []);

  const stop = useCallback(() => {
    clearTick();
    setIsRunning(false);
    setIsPaused(false);
  }, []);

  return { elapsed, isRunning, isPaused, startTime, start, pause, resume, stop };
}
