import { useEffect, useRef } from 'react';
import { BossTheme, BossTier } from '../../lib/bosses';
import {
  creatureForBoss, drawCreatureFitted, drawScholarFitted, CREATURE_COLOR, ScholarPose,
} from './sprites';

// The fight arena: the Scholar (player) on the left attacks the boss on the
// right. Each `attackNonce` bump plays an attack — pencil slash or laptop blast —
// flinging particles into the boss, which shakes and flashes.

const LW = 460, LH = 300;

interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number; blast?: boolean; }

interface BossArenaProps {
  theme: BossTheme;
  tier: BossTier;
  pct: number;
  slain?: boolean;
  aura?: string;
  attackNonce: number;
}

export default function BossArena({ theme, tier, pct, slain = false, aura = '', attackNonce }: BossArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const creature = creatureForBoss(theme, tier);
  const color = CREATURE_COLOR[creature];

  const st = useRef({
    t: 0, pose: 'idle' as ScholarPose, poseT: 1, toggle: false,
    particles: [] as Particle[], bossShake: 0, bossHit: 0, deathDone: false,
  });
  const slainRef = useRef(slain);
  const pctRef = useRef(pct);
  const auraRef = useRef(aura);
  slainRef.current = slain; pctRef.current = pct; auraRef.current = aura;

  // Boss anchor (right) and scholar hand origin (left).
  const bossX = LW * 0.66, bossY = LH * 0.46;
  const handX = LW * 0.34, handY = LH * 0.52;

  function spawnAttack() {
    const s = st.current;
    s.toggle = !s.toggle;
    s.pose = s.toggle ? 'slash' : 'blast';
    s.poseT = 0;
    const burst = s.pose === 'blast';
    setTimeout(() => {
      const n = burst ? 16 : 12;
      for (let i = 0; i < n; i++) {
        const a = Math.atan2(bossY - handY, bossX - handX) + (Math.random() - 0.5) * 0.5;
        const spd = burst ? 6 + Math.random() * 4 : 4 + Math.random() * 3;
        s.particles.push({
          x: handX, y: handY, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 1, life: 1,
          color: burst ? (i % 3 ? '#378ADD' : '#B5D4F4') : (i % 2 ? '#FAC775' : '#EF9F27'),
          size: 3 + Math.random() * 4, blast: burst,
        });
      }
      s.bossShake = 14; s.bossHit = 8;
    }, 150);
  }

  useEffect(() => { if (attackNonce > 0 && !slainRef.current) spawnAttack(); }, [attackNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = LW * dpr; canvas.height = LH * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    let raf = 0;

    function frame() {
      if (!ctx) return;
      const s = st.current;
      s.t += 0.03;
      s.poseT = Math.min(s.poseT + 0.045, 1);
      if (s.poseT >= 1 && s.pose !== 'idle') { s.pose = 'idle'; s.poseT = 1; }
      if (s.bossShake > 0) s.bossShake *= 0.8;
      if (s.bossHit > 0) s.bossHit--;
      ctx.clearRect(0, 0, LW, LH);

      // floor glow
      const fl = ctx.createRadialGradient(LW / 2, LH - 20, 10, LW / 2, LH - 20, LW * 0.6);
      fl.addColorStop(0, color + '22'); fl.addColorStop(1, color + '00');
      ctx.fillStyle = fl; ctx.fillRect(0, 0, LW, LH);

      // boss
      if (!slainRef.current) {
        if (auraRef.current) {
          ctx.save(); ctx.strokeStyle = auraRef.current; ctx.globalAlpha = 0.45; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(bossX, bossY, 92, s.t * 0.5, s.t * 0.5 + Math.PI * 1.4); ctx.stroke(); ctx.restore();
        }
        drawCreatureFitted(ctx, creature, bossX, bossY, 210, s.t, s.bossShake, s.bossHit, false);
      } else {
        if (!s.deathDone) {
          s.deathDone = true;
          for (let i = 0; i < 44; i++) {
            const a = Math.random() * Math.PI * 2, spd = 2 + Math.random() * 5;
            s.particles.push({ x: bossX, y: bossY, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life: 1, color: i % 2 ? color : '#FAC775', size: 3 + Math.random() * 6 });
          }
        }
        ctx.globalAlpha = 0.12 + Math.sin(s.t * 3) * 0.05;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(bossX, bossY, 60 + Math.sin(s.t * 3) * 10, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }

      // scholar
      drawScholarFitted(ctx, handX - 8, LH * 0.58, 232, s.t, s.pose, s.poseT);

      // particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        ctx.globalAlpha = Math.max(0, p.life) * 0.9;
        if (p.blast) {
          ctx.strokeStyle = p.color; ctx.lineWidth = p.size * p.life;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3); ctx.stroke();
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.size * p.life), 0, Math.PI * 2); ctx.fill();
        }
        p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= 0.026;
        if (p.life <= 0) s.particles.splice(i, 1);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    function onVis() {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!raf) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); };
  }, [creature, color]); // eslint-disable-line react-hooks/exhaustive-deps

  // reset death burst flag when boss changes / revives
  useEffect(() => { if (!slain) st.current.deathDone = false; }, [slain]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', maxWidth: LW, aspectRatio: `${LW} / ${LH}`, display: 'block', margin: '0 auto' }}
      aria-label="boss fight"
    />
  );
}
