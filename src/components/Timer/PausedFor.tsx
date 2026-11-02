import { useEffect, useState } from 'react';

function fmtPaused(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = String(secs % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** How long the current pause has lasted. The focus clock is frozen while paused, so this keeps its own tick. */
export default function PausedFor({ since, className }: { since: number; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  // A pause made on another device can carry a clock slightly ahead of this one.
  return <span className={className}>Paused {fmtPaused(Math.max(0, Math.floor((now - since) / 1000)))}</span>;
}
