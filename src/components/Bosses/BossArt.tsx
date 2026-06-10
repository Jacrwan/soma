import { useEffect, useRef } from 'react';
import { BossTheme, BossTier } from '../../lib/bosses';
import { creatureForBoss, drawCreatureFitted, CREATURE_COLOR, CREATURE_SPRITE } from './sprites';
import styles from './Bosses.module.css';

// Canvas portrait of a boss creature. Animated, lightweight; pauses when the
// tab is hidden. Same prop shape as before so every call site keeps working.
interface BossArtProps {
  theme: BossTheme;
  pct: number;
  slain?: boolean;
  size?: number;
  enraged?: boolean;
  aura?: string;
  flash?: boolean;
  tier?: BossTier;
}

export default function BossArt({
  theme, pct, slain = false, size = 200, enraged = false, aura = '', flash = false, tier = 'elite',
}: BossArtProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ pct, slain, enraged, aura, flash });
  propsRef.current = { pct, slain, enraged, aura, flash };
  const creature = creatureForBoss(theme, tier);
  const sprite = CREATURE_SPRITE[creature];
  const phase = useRef(Math.random() * 100);
  const flashRef = useRef(0);

  // Bump a short hit-flash whenever the flash prop flips true.
  useEffect(() => { if (flash) flashRef.current = 6; }, [flash]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr; canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    let raf = 0; let t = phase.current;
    const color = CREATURE_COLOR[creature];

    function frame() {
      if (!ctx) return;
      const p = propsRef.current;
      t += p.enraged ? 0.05 : 0.03;
      ctx.clearRect(0, 0, size, size);
      const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      glow.addColorStop(0, color + '33');
      glow.addColorStop(1, color + '00');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);
      if (p.aura && !p.slain) {
        ctx.save(); ctx.strokeStyle = p.aura; ctx.globalAlpha = 0.5; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.46, t * 0.6, t * 0.6 + Math.PI * 1.5); ctx.stroke();
        ctx.restore();
      }
      if (flashRef.current > 0) flashRef.current--;
      const shake = flashRef.current > 0 ? 6 : 0;
      drawCreatureFitted(ctx, creature, size / 2, size / 2, size * 0.92, t, shake, flashRef.current, p.slain);
      raf = requestAnimationFrame(frame);
    }
    function onVis() {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!raf) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); };
  }, [creature, size]);

  // Real splash art: show a head-biased crop with a gentle float.
  if (sprite) {
    return (
      <span className={styles.spriteThumb} style={{ width: size, height: size }}>
        <img
          src={sprite} alt="boss" loading="lazy"
          style={{ filter: slain ? 'grayscale(0.5)' : undefined, opacity: slain ? 0.4 : 1 }}
        />
      </span>
    );
  }

  return <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }} aria-label="boss" />;
}
