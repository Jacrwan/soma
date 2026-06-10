import { useEffect, useRef } from 'react';
import { BossTheme, BossTier } from '../../lib/bosses';
import {
  creatureForBoss, drawCreatureFitted, drawScholarFitted, CREATURE_COLOR, CREATURE_SPRITE, ScholarPose,
} from './sprites';
import SpriteBoss from './SpriteBoss';

// Pokémon-style battle arena: the boss sits on a platform in the back-right
// (smaller, farther), the Scholar stands large in the front-left (closer). Each
// `attack` bump plays a pencil slash or laptop blast that flings particles up
// into the boss, which shakes and flashes.

const LW = 460, LH = 300;

interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number; blast?: boolean; }

export interface ArenaAttack { nonce: number; type: 'slash' | 'blast'; }

interface BossArenaProps {
  theme: BossTheme;
  tier: BossTier;
  pct: number;
  slain?: boolean;
  aura?: string;
  attack: ArenaAttack;
}

// Boss platform (back-right) and Scholar platform (front-left).
const bossX = LW * 0.72, bossY = LH * 0.34;
const scholarX = LW * 0.27, scholarY = LH * 0.74;
const handX = LW * 0.40, handY = LH * 0.60;

export default function BossArena({ theme, tier, pct: _pct, slain = false, aura = '', attack }: BossArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const creature = creatureForBoss(theme, tier);
  const color = CREATURE_COLOR[creature];
  const sprite = CREATURE_SPRITE[creature]; // real splash art, if any

  const st = useRef({
    t: 0, pose: 'idle' as ScholarPose, poseT: 1,
    particles: [] as Particle[], bossShake: 0, bossHit: 0, deathDone: false,
  });
  const slainRef = useRef(slain);
  const auraRef = useRef(aura);
  slainRef.current = slain; auraRef.current = aura;

  // Trigger an attack animation when the nonce bumps.
  useEffect(() => {
    if (attack.nonce <= 0 || slainRef.current) return;
    const s = st.current;
    s.pose = attack.type; s.poseT = 0;
    const burst = attack.type === 'blast';
    setTimeout(() => {
      const n = burst ? 18 : 12;
      for (let i = 0; i < n; i++) {
        const a = Math.atan2(bossY - handY, bossX - handX) + (Math.random() - 0.5) * 0.45;
        const spd = burst ? 6.5 + Math.random() * 4 : 4.5 + Math.random() * 3;
        s.particles.push({
          x: handX, y: handY, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life: 1,
          color: burst ? (i % 3 ? '#378ADD' : '#B5D4F4') : (i % 2 ? '#FAC775' : '#EF9F27'),
          size: 3 + Math.random() * 4, blast: burst,
        });
      }
      s.bossShake = burst ? 18 : 13; s.bossHit = 8;
    }, 140);
  }, [attack.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = LW * dpr; canvas.height = LH * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    let raf = 0;

    function platform(cx: number, cy: number, rx: number) {
      if (!ctx) return;
      ctx.save();
      ctx.fillStyle = color + '22';
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, rx * 0.32, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color + '44'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, rx * 0.32, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    function frame() {
      if (!ctx) return;
      const s = st.current;
      s.t += 0.03;
      s.poseT = Math.min(s.poseT + 0.045, 1);
      if (s.poseT >= 1 && s.pose !== 'idle') { s.pose = 'idle'; s.poseT = 1; }
      if (s.bossShake > 0) s.bossShake *= 0.8;
      if (s.bossHit > 0) s.bossHit--;
      ctx.clearRect(0, 0, LW, LH);

      // ambient floor
      const fl = ctx.createLinearGradient(0, 0, 0, LH);
      fl.addColorStop(0, color + '14'); fl.addColorStop(1, color + '00');
      ctx.fillStyle = fl; ctx.fillRect(0, 0, LW, LH);

      // platforms
      platform(bossX, bossY + 64, 86);
      platform(scholarX, scholarY + 78, 104);

      // boss (back-right, smaller) — drawn on canvas only when there is no sprite
      if (!sprite) {
        if (!slainRef.current) {
          if (auraRef.current) {
            ctx.save(); ctx.strokeStyle = auraRef.current; ctx.globalAlpha = 0.45; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.arc(bossX, bossY, 74, s.t * 0.5, s.t * 0.5 + Math.PI * 1.4); ctx.stroke(); ctx.restore();
          }
          drawCreatureFitted(ctx, creature, bossX, bossY, 168, s.t, s.bossShake, s.bossHit, false);
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
          ctx.beginPath(); ctx.arc(bossX, bossY, 48 + Math.sin(s.t * 3) * 8, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // scholar (front-left, larger)
      drawScholarFitted(ctx, scholarX, scholarY, 256, s.t, s.pose, s.poseT);

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
        p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.life -= 0.026;
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

  useEffect(() => { if (!slain) st.current.deathDone = false; }, [slain]);

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: LW, aspectRatio: `${LW} / ${LH}`, margin: '0 auto' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        aria-label="boss fight"
      />
      {sprite && (
        <div style={{ position: 'absolute', left: '47%', right: '2%', top: '3%', bottom: '33%' }}>
          <SpriteBoss src={sprite} nonce={attack.nonce} slain={slain} aura={aura} />
        </div>
      )}
    </div>
  );
}
