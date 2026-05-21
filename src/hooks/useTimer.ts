import { useState, useRef, useCallback } from 'react';

export function useTimer() {
  const [elapsed, setElapsed] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wallStartRef = useRef<number>(0);    // Date.now() when the current run segment began
  const accumulatedRef = useRef<number>(0);  // seconds locked in before the current segment

  const clearTick = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const startTick = () => {
    intervalRef.current = setInterval(() => {
      setElapsed(accumulatedRef.current + Math.floor((Date.now() - wallStartRef.current) / 1000));
    }, 1000);
  };

  const start = useCallback((initialSeconds = 0) => {
    accumulatedRef.current = initialSeconds;
    wallStartRef.current = Date.now();
    setElapsed(initialSeconds);
    setIsRunning(true);
    setIsPaused(false);
    startTick();
  }, []);

  const pause = useCallback(() => {
    // Snapshot elapsed into accumulated so resume can add on top of it
    accumulatedRef.current += Math.floor((Date.now() - wallStartRef.current) / 1000);
    clearTick();
    setIsRunning(false);
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    wallStartRef.current = Date.now();
    setIsRunning(true);
    setIsPaused(false);
    startTick();
  }, []);

  const stop = useCallback(() => {
    clearTick();
    setIsRunning(false);
    setIsPaused(false);
  }, []);

  return { elapsed, isRunning, isPaused, start, pause, resume, stop };
}
