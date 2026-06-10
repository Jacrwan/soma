// Canvas sprite drawing for the Bosses feature: four animated creatures and the
// Scholar player avatar. Pure 2D-canvas drawing, no React. Each draw function
// works in its own native coordinate space; the *Fitted helpers place and scale
// a sprite anywhere on a target canvas.

import type { BossTheme, BossTier } from '../../lib/bosses';

const W = 480, H = 340;

export type Creature = 'demon' | 'leviathan' | 'golem' | 'void';

type Ctx = CanvasRenderingContext2D;

// ── Bosses ───────────────────────────────────────────────────────────────────

export function drawDemon(ctx: Ctx, t: number, shake: number, hitFlash: number) {
  const cx = W / 2 + Math.sin(t * 0.7) * shake, cy = H / 2 - 30 + Math.cos(t * 0.5) * shake;
  const breath = Math.sin(t * 1.8) * 6;
  if (hitFlash > 0) { ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  ctx.save(); ctx.strokeStyle = '#BA7517'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, cy + 60 + breath);
  ctx.bezierCurveTo(cx + 60 + Math.sin(t) * 20, cy + 90, cx + 80 + Math.cos(t * 0.9) * 15, cy + 40, cx + 50, cy + 20);
  ctx.stroke(); ctx.restore();
  for (const s of [-1, 1]) {
    ctx.save(); ctx.globalAlpha = 0.7; ctx.fillStyle = '#BA7517';
    ctx.beginPath();
    const wx = cx + s * (30 + breath * 0.5);
    ctx.moveTo(wx, cy - 10); ctx.lineTo(wx + s * (80 + breath), cy - 60);
    ctx.lineTo(wx + s * (100 + breath), cy + 10); ctx.lineTo(wx + s * 60, cy + 20);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  ctx.fillStyle = '#E24B4A';
  ctx.beginPath(); ctx.ellipse(cx, cy, 38 + breath * 0.3, 55 + breath * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#993C1D';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(cx + s * 18, cy - 42); ctx.lineTo(cx + s * 30 + s * Math.sin(t) * 3, cy - 80); ctx.lineTo(cx + s * 8, cy - 40); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#E24B4A';
  ctx.beginPath(); ctx.ellipse(cx, cy - 44, 28 + breath * 0.2, 28 + breath * 0.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FAC775';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(cx + s * 9, cy - 50, 7, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#412402';
    ctx.beginPath(); ctx.ellipse(cx + s * 9, cy - 50, 3.5, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FAC775';
  }
  ctx.strokeStyle = '#993C1D'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy - 36, 10, 0.2, Math.PI - 0.2); ctx.stroke();
}

export function drawLeviathan(ctx: Ctx, t: number, shake: number, hitFlash: number) {
  const cx = W / 2 + Math.sin(t * 0.4) * shake, cy = H / 2 + Math.cos(t * 0.3) * shake;
  const wave = Math.sin(t * 1.2);
  if (hitFlash > 0) { ctx.globalAlpha = 0.3; ctx.fillStyle = '#adf'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  for (let i = 0; i < 7; i++) {
    const sx = cx + Math.sin(t * 1.1 + i * 0.7) * 50 - i * 18;
    const sy = cy + Math.cos(t * 0.8 + i * 0.5) * 30 + i * 10;
    const r = 28 - i * 2.5;
    ctx.globalAlpha = 1 - i * 0.1;
    ctx.fillStyle = i % 2 === 0 ? '#378ADD' : '#185FA5';
    ctx.beginPath(); ctx.ellipse(sx, sy, r, r * 0.7, Math.sin(t + i) * 0.3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const hx = cx + Math.sin(t * 1.1) * 50, hy = cy + Math.cos(t * 0.8) * 30;
  ctx.fillStyle = '#185FA5';
  ctx.beginPath(); ctx.ellipse(hx, hy - 20, 36, 28 + wave * 4, wave * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#B5D4F4'; ctx.globalAlpha = 0.7;
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(hx + s * 20, hy - 10);
    ctx.quadraticCurveTo(hx + s * 60, hy - 40 + wave * 10, hx + s * 50, hy + 10);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#E6F1FB';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(hx + s * 12, hy - 24, 8, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#042C53';
    ctx.beginPath(); ctx.ellipse(hx + s * 12, hy - 24, 4, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#E6F1FB';
  }
  ctx.fillStyle = '#E6F1FB';
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(hx + i * 7, hy - 6 + wave * 2); ctx.lineTo(hx + i * 7 + 3, hy + 6 + wave * 2); ctx.lineTo(hx + i * 7 - 3, hy + 6 + wave * 2); ctx.closePath(); ctx.fill();
  }
}

export function drawGolem(ctx: Ctx, t: number, shake: number, hitFlash: number) {
  const cx = W / 2 + shake * Math.sin(t), cy = H / 2 - 20 + shake * Math.cos(t);
  const pulse = Math.sin(t * 2) * 4;
  if (hitFlash > 0) { ctx.globalAlpha = 0.3; ctx.fillStyle = '#ccf'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  for (const s of [-1, 1]) { ctx.fillStyle = '#3C3489'; ctx.fillRect(cx + s * 18 - 12, cy + 60, 24, 40 + Math.sin(t + s) * 6); }
  ctx.fillStyle = '#534AB7';
  ctx.beginPath(); ctx.roundRect(cx - 40, cy - 30 + pulse * 0.3, 80, 90 + pulse, 6); ctx.fill();
  ctx.fillStyle = '#AFA9EC'; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx + 14, cy + 5); ctx.lineTo(cx, cy + 22); ctx.lineTo(cx - 14, cy + 5); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx + 6, cy + 5); ctx.lineTo(cx, cy + 6); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#534AB7';
    const ay = cy + Math.sin(t * 1.3 + s) * 12;
    ctx.beginPath(); ctx.roundRect(cx + s * 40, ay - 10, s * (-1) * 30, 60, 5); ctx.fill();
    ctx.fillStyle = '#3C3489';
    ctx.beginPath(); ctx.roundRect(cx + s * 40 + (s > 0 ? -10 : 10 - 20), ay + 42, 22, 22, 4); ctx.fill();
    ctx.strokeStyle = '#CECBF6'; ctx.lineWidth = 2; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.arc(cx + s * 50, ay + 50, 30 + Math.sin(t * 2 + s) * 5, -Math.PI / 3, Math.PI / 3, s < 0); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#534AB7';
  ctx.beginPath(); ctx.roundRect(cx - 28, cy - 70 + pulse * 0.2, 56, 44, 6); ctx.fill();
  ctx.fillStyle = '#CECBF6'; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.roundRect(cx - 20, cy - 62, 40, 14, 3); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#7F77DD';
  ctx.beginPath(); ctx.roundRect(cx - 16, cy - 60, 6, 10, 2); ctx.fill();
  ctx.beginPath(); ctx.roundRect(cx + 10, cy - 60, 6, 10, 2); ctx.fill();
}

export function drawVoid(ctx: Ctx, t: number, shake: number, hitFlash: number) {
  const cx = W / 2 + Math.sin(t * 0.5) * shake * 1.5, cy = H / 2 - 10 + Math.cos(t * 0.4) * shake * 1.5;
  const pulse = Math.sin(t * 1.5) * 10;
  if (hitFlash > 0) { ctx.globalAlpha = 0.25; ctx.fillStyle = '#888'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  for (let i = 3; i >= 1; i--) {
    ctx.globalAlpha = 0.15 + i * 0.1; ctx.fillStyle = '#444441';
    ctx.beginPath(); ctx.arc(cx, cy, 60 + i * 20 + pulse + Math.sin(t * 0.7 + i) * 8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + t * 0.4, len = 60 + Math.sin(t * 1.2 + i) * 25;
    ctx.strokeStyle = '#444441'; ctx.lineWidth = 3 + Math.sin(t + i) * 1.5; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + Math.cos(angle + 0.5) * len * 0.7, cy + Math.sin(angle + 0.5) * len * 0.7, cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#2C2C2A';
  ctx.beginPath(); ctx.arc(cx, cy, 42 + pulse * 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.8;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30);
  grad.addColorStop(0, '#888780'); grad.addColorStop(1, 'rgba(40,40,40,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#D3D1C7';
  ctx.beginPath(); ctx.ellipse(cx, cy, 14 + Math.sin(t * 2) * 3, 8 + Math.sin(t * 2) * 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2C2C2A';
  ctx.beginPath(); ctx.ellipse(cx + Math.sin(t * 0.8) * 4, cy, 7, 7.5, 0, 0, Math.PI * 2); ctx.fill();
}

const CREATURE_FN: Record<Creature, (ctx: Ctx, t: number, shake: number, hitFlash: number) => void> = {
  demon: drawDemon, leviathan: drawLeviathan, golem: drawGolem, void: drawVoid,
};

export const CREATURE_COLOR: Record<Creature, string> = {
  demon: '#E24B4A', leviathan: '#378ADD', golem: '#7F77DD', void: '#6b6b66',
};

// ── Scholar (player avatar) ──────────────────────────────────────────────────

export type ScholarPose = 'idle' | 'slash' | 'blast' | 'block';

export function drawScholar(ctx: Ctx, t: number, pose: ScholarPose, poseT: number) {
  const cx = 180, cy = 80;
  const bob = pose === 'idle' ? Math.sin(t * 1.5) * 3 : 0;
  ctx.save();
  ctx.translate(cx, cy + bob);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.beginPath(); ctx.ellipse(0, 230, 42, 9, 0, 0, Math.PI * 2); ctx.fill();
  // legs
  ctx.fillStyle = '#444441';
  ctx.beginPath(); ctx.moveTo(-22, 158); ctx.quadraticCurveTo(-24, 190, -20, 210); ctx.lineTo(-6, 210); ctx.quadraticCurveTo(-4, 190, -6, 158); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(6, 158); ctx.quadraticCurveTo(4, 190, 6, 210); ctx.lineTo(20, 210); ctx.quadraticCurveTo(24, 190, 22, 158); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2C2C2A';
  ctx.beginPath(); ctx.ellipse(-13, 216, 14, 7, -0.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(13, 216, 14, 7, 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#444441'; ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.ellipse(-16, 213, 7, 3, -0.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(10, 213, 7, 3, 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  // hoodie
  ctx.fillStyle = '#534AB7';
  ctx.beginPath(); ctx.moveTo(-42, 95); ctx.quadraticCurveTo(-44, 120, -38, 158); ctx.lineTo(38, 158); ctx.quadraticCurveTo(44, 120, 42, 95); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#3C3489';
  ctx.beginPath(); ctx.moveTo(-14, 95); ctx.quadraticCurveTo(0, 108, 14, 95); ctx.lineTo(10, 95); ctx.quadraticCurveTo(0, 104, -10, 95); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.roundRect(-22, 130, 44, 22, 5); ctx.fill();
  ctx.strokeStyle = '#3C3489'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.moveTo(0, 108); ctx.lineTo(0, 130); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#AFA9EC'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 5, 100); ctx.lineTo(s * 9 + s * Math.sin(t * 2) * 2, 128); ctx.stroke(); }
  // left arm + notebook
  const nbAngle = pose === 'block' ? -0.9 : -0.25 + Math.sin(t * 1.5) * 0.04;
  ctx.save(); ctx.translate(-38, 100); ctx.rotate(nbAngle);
  ctx.fillStyle = '#534AB7'; ctx.beginPath(); ctx.roundRect(-9, 0, 18, 52, 6); ctx.fill();
  ctx.fillStyle = '#F5C4B3'; ctx.beginPath(); ctx.ellipse(0, 54, 9, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0F6E56'; ctx.beginPath(); ctx.roundRect(-16, 56, 34, 44, 3); ctx.fill();
  ctx.fillStyle = '#1D9E75'; ctx.beginPath(); ctx.roundRect(-12, 59, 28, 40, 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-8, 67 + i * 9); ctx.lineTo(12, 67 + i * 9); ctx.stroke(); }
  ctx.restore();
  // right arm + pencil (grip in hand, sharp tip up)
  const armA = pose === 'slash' ? -1.1 + poseT * 1.7 : pose === 'blast' ? -0.9 : -0.05 + Math.sin(t * 1.5 + 1) * 0.05;
  ctx.save(); ctx.translate(38, 98); ctx.rotate(armA);
  ctx.fillStyle = '#534AB7'; ctx.beginPath(); ctx.roundRect(-9, 0, 18, 52, 6); ctx.fill();
  ctx.fillStyle = '#FAC775'; ctx.beginPath(); ctx.roundRect(-4, -30, 8, 82, 2); ctx.fill();
  ctx.fillStyle = '#888'; ctx.beginPath(); ctx.roundRect(-4, 46, 8, 4, 0); ctx.fill();
  ctx.fillStyle = '#F4C0D1'; ctx.beginPath(); ctx.roundRect(-4, 50, 8, 14, 2); ctx.fill();
  ctx.fillStyle = '#EF9F27'; ctx.beginPath(); ctx.moveTo(-4, -30); ctx.lineTo(4, -30); ctx.lineTo(0, -46); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2C2C2A'; ctx.beginPath(); ctx.moveTo(-1.8, -38); ctx.lineTo(1.8, -38); ctx.lineTo(0, -46); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#F5C4B3'; ctx.beginPath(); ctx.ellipse(0, 54, 9, 9, 0, 0, Math.PI * 2); ctx.fill();
  if (pose === 'slash' && poseT > 0.3) {
    ctx.globalAlpha = 0.45 * poseT; ctx.strokeStyle = '#FAC775'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(0, -46); ctx.lineTo(0, 52); ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (pose === 'blast') {
    ctx.save(); ctx.translate(14, 60); ctx.rotate(-0.2);
    ctx.fillStyle = '#888780'; ctx.beginPath(); ctx.roundRect(-24, -14, 48, 28, 4); ctx.fill();
    ctx.fillStyle = '#378ADD'; ctx.globalAlpha = 0.5 + Math.sin(t * 6) * 0.5;
    ctx.beginPath(); ctx.roundRect(-20, -11, 40, 20, 2); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#888780'; ctx.beginPath(); ctx.roundRect(-20, 14, 40, 6, 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  // head
  const hx = 0, hy = 52;
  ctx.fillStyle = '#F5C4B3'; ctx.beginPath(); ctx.roundRect(hx - 9, hy + 22, 18, 20, 3); ctx.fill();
  ctx.fillStyle = '#2C2C2A'; ctx.beginPath(); ctx.ellipse(hx, hy - 6, 26, 24, 0, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#F5C4B3'; ctx.beginPath(); ctx.ellipse(hx, hy + 2, 24, 26, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#F5C4B3';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(hx + s * 24, hy + 2, 5, 7, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#2C2C2A';
  ctx.beginPath(); ctx.moveTo(hx - 24, hy - 18); ctx.quadraticCurveTo(hx - 18, hy - 52, hx + 8, hy - 54);
  ctx.quadraticCurveTo(hx + 28, hy - 50, hx + 24, hy - 18); ctx.quadraticCurveTo(hx + 14, hy - 24, hx, hy - 22);
  ctx.quadraticCurveTo(hx - 12, hy - 24, hx - 24, hy - 18); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5F5E5A'; ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.ellipse(hx + 4, hy - 32, 9, 5, -0.4, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = '#2C2C2A'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(hx + s * 5, hy - 6); ctx.quadraticCurveTo(hx + s * 11, hy - 10, hx + s * 17, hy - 7); ctx.stroke(); }
  const blink = Math.abs(Math.sin(t * 0.28)) < 0.035;
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(hx + s * 9, hy + 2, 6.5, blink ? 1 : 6.5, 0, 0, Math.PI * 2); ctx.fill();
    if (!blink) {
      ctx.fillStyle = '#185FA5'; ctx.beginPath(); ctx.ellipse(hx + s * 9 + s, hy + 2, 4, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#042C53'; ctx.beginPath(); ctx.ellipse(hx + s * 9 + s, hy + 2, 2, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(hx + s * 10 + s, hy, 1.3, 1.3, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(180,80,30,0.4)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(hx + 2, hy + 10); ctx.quadraticCurveTo(hx + 6, hy + 14, hx + 2, hy + 16); ctx.stroke();
  ctx.strokeStyle = 'rgba(150,60,20,0.6)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  if (pose === 'slash' && poseT > 0.35) {
    ctx.beginPath(); ctx.moveTo(hx - 7, hy + 21); ctx.quadraticCurveTo(hx, hy + 27, hx + 7, hy + 21); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(hx - 5, hy + 22); ctx.quadraticCurveTo(hx, hy + 26, hx + 5, hy + 22); ctx.stroke();
  }
  ctx.fillStyle = '#F4C0D1'; ctx.globalAlpha = 0.4;
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(hx + s * 17, hy + 8, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ── Fitted helpers (place + scale onto any canvas) ────────────────────────────

export function drawCreatureFitted(
  ctx: Ctx, creature: Creature, cx: number, cy: number, size: number,
  t: number, shake = 0, hitFlash = 0, slain = false,
) {
  const scale = size / 270;
  ctx.save();
  if (slain) ctx.globalAlpha = 0.28;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-240, -150);
  CREATURE_FN[creature](ctx, t, shake, hitFlash);
  ctx.restore();
  ctx.globalAlpha = 1;
}

export function drawScholarFitted(
  ctx: Ctx, cx: number, cy: number, size: number, t: number, pose: ScholarPose, poseT: number,
) {
  const scale = size / 270;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-180, -194);
  drawScholar(ctx, t, pose, poseT);
  ctx.restore();
}

// ── Theme/tier → creature ─────────────────────────────────────────────────────

const THEME_CREATURE: Record<BossTheme, Creature> = {
  chemistry: 'demon', biology: 'demon',
  history: 'leviathan', english: 'leviathan', language: 'leviathan',
  math: 'golem', physics: 'golem', cs: 'golem',
  general: 'golem',
};

export function creatureForBoss(theme: BossTheme, tier: BossTier): Creature {
  if (tier === 'archboss') return 'void';
  return THEME_CREATURE[theme] ?? 'golem';
}

// ── Real splash-art sprites (PNG cutouts) ─────────────────────────────────────
// When a creature has a sprite, the UI renders the rigged image instead of the
// hand-drawn canvas creature. Arch-bosses (the "void" slot) use the paladin; the
// humanities themes (history/english/language) summon the cyber seraph.
export const CREATURE_SPRITE: Partial<Record<Creature, string>> = {
  void: '/boss-sprites/paladin.webp',
  leviathan: '/boss-sprites/seraph.webp',
};

export function spriteForBoss(theme: BossTheme, tier: BossTier): string | undefined {
  return CREATURE_SPRITE[creatureForBoss(theme, tier)];
}
