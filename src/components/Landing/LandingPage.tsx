import { useEffect, useRef } from 'react';

const UNIVERSITY_LOGOS = [
  { name: 'Stanford University', src: '/university-logos/stanford.svg', shape: 'mark' },
  { name: 'Cornell University', src: '/university-logos/cornell.svg', shape: 'mark' },
  { name: 'UC Berkeley', src: '/university-logos/uc-berkeley.svg', shape: 'mark' },
  { name: 'UCLA', src: '/university-logos/ucla.svg', shape: 'mark' },
  { name: 'UC San Diego', src: '/university-logos/ucsd.png', shape: 'mark' },
  { name: 'Emory University', src: '/university-logos/emory.svg', shape: 'wide' },
  { name: 'Carnegie Mellon University', src: '/university-logos/carnegie-mellon.png', shape: 'mark' },
  { name: 'Georgia Tech', src: '/university-logos/georgia-tech.svg', shape: 'mark' },
] as const;
const UNIVERSITY_LOGO_COPIES = [0, 1, 2, 3, 4, 5] as const;

const LANDING_CSS = `
.landing-root {
  /* ── Dark theme (default) ── */
  --bg:          #0A0B0F;
  --surface:     #0F1117;
  --surface-2:   #161820;
  --accent:      #5B6AF0;
  --warm:        #F0A05B;
  --text:        #F0EEE8;
  --text-primary: #F0EEE8;
  --text-dim:    #8A8A9E;
  --text-muted:  #5A5A6E;
  --border:      oklch(20% 0.012 265);
  --border-sub:  oklch(14% 0.01 265);

  /* Structural surfaces that vary by theme (referenced below) */
  --nav-bg:          oklch(7% 0.008 265 / 0.88);
  --mockup-sidebar:  oklch(9% 0.01 265);
  --mockup-navdot:   oklch(22% 0.01 265);
  --trust-grad-end:  oklch(8% 0.012 265);
  --logo-card-border: oklch(30% 0.016 265 / 0.78);
  --logo-card-bg-1:  oklch(17% 0.017 265 / 0.94);
  --logo-card-bg-2:  oklch(12.5% 0.014 265 / 0.98);
  --logo-card-inset: oklch(100% 0 0 / 0.06);
  --mockup-shadow:
    0 4px 24px oklch(0% 0 0 / 0.3),
    0 24px 80px oklch(0% 0 0 / 0.45),
    0 0 0 1px oklch(100% 0 0 / 0.04);

  font-family: 'DM Sans', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
  min-height: 100dvh;
}

/* ── Light theme — follows the browser / OS preference ── */
@media (prefers-color-scheme: light) {
  .landing-root {
    --bg:          #FBFAF7;
    --surface:     #FFFFFF;
    --surface-2:   #F1F0EB;
    --accent:      #4B54D4;
    --warm:        #C76E1C;
    --text:        #16171D;
    --text-primary: #16171D;
    --text-dim:    #4A4B5C;
    --text-muted:  #7B7C8C;
    --border:      oklch(90% 0.005 265);
    --border-sub:  oklch(93% 0.004 265);

    --nav-bg:          oklch(99% 0.003 265 / 0.85);
    --mockup-sidebar:  oklch(96% 0.004 265);
    --mockup-navdot:   oklch(85% 0.008 265);
    --trust-grad-end:  oklch(95% 0.006 265);
    --logo-card-border: oklch(86% 0.008 265 / 0.9);
    --logo-card-bg-1:  oklch(100% 0 0 / 0.96);
    --logo-card-bg-2:  oklch(97% 0.004 265 / 0.98);
    --logo-card-inset: oklch(100% 0 0 / 0.9);
    --mockup-shadow:
      0 4px 24px oklch(0% 0 0 / 0.08),
      0 24px 80px oklch(0% 0 0 / 0.12),
      0 0 0 1px oklch(0% 0 0 / 0.05);
  }
}

nav {
  position: fixed;
  inset: 0 0 auto;
  z-index: 100;
  height: 64px;
  padding: 0 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: background 0.35s, border-color 0.35s, backdrop-filter 0.35s;
  border-bottom: 1px solid transparent;
}
nav.scrolled {
  background: var(--nav-bg);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-bottom-color: var(--border-sub);
}

.nav-wordmark {
  font-family: 'Jost', sans-serif;
  font-size: 22px;
  font-weight: 300;
  color: var(--text);
  text-decoration: none;
  letter-spacing: 0.5px;
}

.nav-right { display: flex; align-items: center; gap: 28px; }

.nav-login {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-dim);
  text-decoration: none;
  transition: color 0.15s;
}
.nav-login:hover { color: var(--text); }

.nav-cta {
  font-size: 14px;
  font-weight: 600;
  color: #f0eee8;
  background: var(--accent);
  border: none;
  border-radius: 100px;
  padding: 8px 22px;
  text-decoration: none;
  transition: opacity 0.15s;
  display: inline-block;
}
.nav-cta:hover { opacity: 0.87; }

.hero {
  position: relative;
  min-height: 100svh;
  display: flex;
  align-items: center;
  overflow: hidden;
}

#hero-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.hero-inner {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 1240px;
  margin: 0 auto;
  padding: 120px 56px 80px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  gap: 72px;
}

.hero-text { max-width: 520px; }

.hero-eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 30px;
  opacity: 0;
  transform: translateY(14px);
  animation: fadeUp 0.65s cubic-bezier(0.22, 1, 0.36, 1) 0.1s forwards;
}

.hero-headline {
  font-family: 'Playfair Display', serif;
  line-height: 1.08;
  margin-bottom: 28px;
  letter-spacing: -0.015em;
}

.hero-line-1 {
  display: block;
  font-size: clamp(28px, 4vw, 52px);
  font-weight: 500;
  color: var(--text-muted);
  margin-bottom: 4px;
  opacity: 0;
  transform: translateY(20px);
  animation: fadeUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.22s forwards;
}

.hero-line-2 {
  display: block;
  font-size: clamp(40px, 6vw, 76px);
  font-weight: 700;
  font-style: italic;
  color: var(--text);
  opacity: 0;
  transform: translateY(20px);
  animation: fadeUp 0.75s cubic-bezier(0.22, 1, 0.36, 1) 0.38s forwards;
}

.hero-sub {
  font-size: 17px;
  font-weight: 400;
  color: var(--text-dim);
  line-height: 1.7;
  max-width: 440px;
  margin-bottom: 44px;
  opacity: 0;
  transform: translateY(16px);
  animation: fadeUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.54s forwards;
}

.hero-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  opacity: 0;
  transform: translateY(14px);
  animation: fadeUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.68s forwards;
}

.btn-primary {
  font-size: 15px;
  font-weight: 600;
  color: #f0eee8;
  background: var(--accent);
  border: none;
  border-radius: 9px;
  padding: 13px 28px;
  text-decoration: none;
  display: inline-block;
  transition: opacity 0.15s, transform 0.2s cubic-bezier(0.22,1,0.36,1);
  cursor: pointer;
}
.btn-primary:hover { opacity: 0.89; transform: translateY(-1px); }

.btn-ghost {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-dim);
  background: none;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 12px 26px;
  text-decoration: none;
  display: inline-block;
  transition: border-color 0.15s, color 0.15s;
  cursor: pointer;
}
.btn-ghost:hover { border-color: var(--text-dim); color: var(--text); }

.hero-visual {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  opacity: 0;
  animation: fadeUp 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.44s forwards;
}

.app-mockup {
  width: 100%;
  max-width: 440px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 13px;
  overflow: hidden;
  box-shadow: var(--mockup-shadow);
  animation: bob 4s ease-in-out infinite;
}

@keyframes bob {
  0%, 100% { transform: translateY(0); }
  50%       { transform: translateY(-8px); }
}

.mockup-topbar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-sub);
}
.mockup-dot { width: 8px; height: 8px; border-radius: 50%; }
.mockup-dot:nth-child(1) { background: oklch(58% 0.16 25); }
.mockup-dot:nth-child(2) { background: oklch(70% 0.16 65); }
.mockup-dot:nth-child(3) { background: oklch(58% 0.18 148); }
.mockup-title {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.mockup-body { display: flex; }

.mockup-sidebar {
  width: 44px;
  flex-shrink: 0;
  background: var(--mockup-sidebar);
  border-right: 1px solid var(--border-sub);
  padding: 18px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}
.mockup-nav-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--mockup-navdot);
}
.mockup-nav-dot.on { background: var(--accent); }

.mockup-dayview { flex: 1; position: relative; }

.mockup-date-hdr {
  padding: 10px 14px 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-sub);
}

.mockup-tl { position: relative; }

.mockup-hr {
  display: flex;
  align-items: flex-start;
  height: 36px;
}
.mockup-hr-lbl {
  width: 38px;
  flex-shrink: 0;
  font-size: 8px;
  color: var(--text-muted);
  padding: 3px 8px 0;
  text-align: right;
}
.mockup-hr-line {
  flex: 1;
  height: 1px;
  background: var(--border-sub);
  margin-top: 10px;
}

.mockup-blk {
  position: absolute;
  left: 40px;
  right: 8px;
  border-radius: 5px;
  font-size: 9px;
  font-weight: 600;
  padding: 4px 7px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 1px;
}
.mockup-blk-sub { font-size: 8px; font-weight: 400; opacity: 0.7; }

.blk-calc   { top: 36px;  height: 54px; background: oklch(52% 0.2 265 / 0.18); color: oklch(74% 0.18 265); border: 1px solid oklch(52% 0.2 265 / 0.3); }
.blk-chem   { top: 108px; height: 36px; background: oklch(72% 0.14 50 / 0.14);  color: oklch(78% 0.14 50);  border: 1px solid oklch(72% 0.14 50 / 0.28); }
.blk-eng    { top: 180px; height: 27px; background: oklch(68% 0.12 180 / 0.14); color: oklch(74% 0.12 180); border: 1px solid oklch(68% 0.12 180 / 0.24); }

.mockup-rl {
  position: absolute;
  left: 40px;
  right: 0;
  height: 1.5px;
  background: oklch(60% 0.22 25);
  top: 172px;
  z-index: 4;
}
.mockup-rl::before {
  content: '';
  position: absolute;
  left: -4px; top: -3.5px;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: oklch(60% 0.22 25);
}

.university-trust {
  position: relative;
  padding: 42px 0 0;
  background: linear-gradient(180deg, var(--bg) 0%, var(--trust-grad-end) 100%);
}
.university-trust-inner {
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 56px 18px;
  display: flex;
  justify-content: center;
}
.university-trust-copy {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
}
.university-logo-marquee {
  overflow: hidden;
  padding: 0 0 34px;
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 10%, #000 90%, transparent 100%);
  mask-image: linear-gradient(90deg, transparent 0%, #000 10%, #000 90%, transparent 100%);
}
.university-logo-track {
  display: flex;
  width: max-content;
  animation: universityLogoMarquee 38s linear infinite;
}
.university-logo-set {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 7px;
}
.university-logo-card {
  width: 154px;
  height: 78px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid var(--logo-card-border);
  background: linear-gradient(180deg, var(--logo-card-bg-1), var(--logo-card-bg-2));
  box-shadow: inset 0 1px 0 var(--logo-card-inset), 0 18px 34px oklch(3% 0.008 265 / 0.24);
}
.university-logo-card.is-wide {
  width: 222px;
}
.university-logo-card img {
  display: block;
  max-width: 122px;
  max-height: 62px;
  width: auto;
  height: auto;
  object-fit: contain;
  filter: drop-shadow(0 8px 14px oklch(3% 0.01 265 / 0.28));
}
.university-logo-card.is-wide img {
  max-width: 176px;
  max-height: 42px;
}

.marquee-wrap {
  border-top: 1px solid var(--border-sub);
  border-bottom: 1px solid var(--border-sub);
  padding: 15px 0;
  overflow: hidden;
  background: var(--surface);
}
.marquee-track {
  display: flex;
  width: max-content;
  animation: marquee 32s linear infinite;
}
.marquee-item {
  display: inline-flex;
  align-items: center;
  gap: 24px;
  padding: 0 24px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  white-space: nowrap;
}
.msep {
  width: 3px; height: 3px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.45;
  flex-shrink: 0;
}
@keyframes marquee {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
@keyframes universityLogoMarquee {
  from { transform: translateX(0); }
  to   { transform: translateX(-16.6667%); }
}

#features { padding: 80px 0 40px; }

.feature {
  max-width: 1240px;
  margin: 0 auto;
  padding: 80px 56px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  gap: 80px;
  opacity: 0;
  transform: translateY(32px);
  transition: opacity 0.75s cubic-bezier(0.22, 1, 0.36, 1),
              transform 0.75s cubic-bezier(0.22, 1, 0.36, 1);
}
.feature.vis { opacity: 1; transform: translateY(0); }
.feature:nth-child(even) .feat-text  { order: 2; }
.feature:nth-child(even) .feat-vis   { order: 1; }

.feat-kicker {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 14px;
}
.feat-headline {
  font-family: 'Playfair Display', serif;
  font-size: clamp(26px, 3vw, 42px);
  font-weight: 700;
  line-height: 1.15;
  color: var(--text);
  margin-bottom: 18px;
  letter-spacing: -0.01em;
}
.feat-body {
  font-size: 16px;
  line-height: 1.72;
  color: var(--text-dim);
  max-width: 400px;
}

.feat-vis {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 28px;
  min-height: 260px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow: hidden;
  position: relative;
}

.chat-bar {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 13px;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.chat-messages { display: flex; flex-direction: column; gap: 9px; }
.chat-msg {
  font-size: 13px;
  padding: 8px 12px;
  border-radius: 9px;
  max-width: 82%;
  opacity: 0;
  transform: translateY(7px);
  transition: opacity 0.38s ease, transform 0.38s ease;
}
.chat-msg.show { opacity: 1; transform: translateY(0); }
.chat-msg.user { background: var(--accent); color: #f0eee8; align-self: flex-end; font-weight: 500; }
.chat-msg.ai   { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-dim); align-self: flex-start; }

.chat-card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 12px 14px;
  align-self: flex-start;
  max-width: 90%;
  opacity: 0;
  transform: translateY(7px);
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.chat-card.show { opacity: 1; transform: translateY(0); }

.sched-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-size: 12px;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border-sub);
}
.sched-row:last-child { border-bottom: none; }
.sched-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

.assign-list { display: flex; flex-direction: column; }
.assign-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--border-sub);
  opacity: 0;
  transform: translateX(-10px);
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.assign-item:last-child { border-bottom: none; padding-bottom: 0; }
.assign-item:first-child { padding-top: 0; }
.assign-item.show { opacity: 1; transform: translateX(0); }
.assign-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.assign-info { flex: 1; min-width: 0; }
.assign-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.assign-course { font-size: 11px; color: var(--text-muted); margin-top: 1px; }
.assign-due { font-size: 11px; font-weight: 500; color: var(--text-muted); flex-shrink: 0; }
.assign-due.hot { color: oklch(65% 0.18 25); }

.tl-visual { display: flex; flex-direction: column; gap: 14px; }
.tl-date { font-size: 10px; font-weight: 600; letter-spacing: 0.07em; color: var(--text-muted); text-transform: uppercase; }
.tl-track {
  position: relative;
  height: 42px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.tl-blk {
  position: absolute;
  top: 0; bottom: 0;
  border-radius: 6px;
  display: flex;
  align-items: center;
  padding: 0 9px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}
.tl-redline {
  position: absolute;
  top: 0; bottom: 0;
  width: 2px;
  background: oklch(60% 0.22 25);
  z-index: 3;
  animation: tl-move 5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
.tl-redline::after {
  content: '';
  position: absolute;
  top: -4px; left: -3px;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: oklch(60% 0.22 25);
}
@keyframes tl-move {
  0%   { left: 5%; }
  65%  { left: 82%; }
  100% { left: 5%; }
}
.tl-axis {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-muted);
}
.tl-progress {
  height: 3px;
  background: var(--surface-2);
  border-radius: 2px;
  overflow: hidden;
}
.tl-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  animation: tl-fill 5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
@keyframes tl-fill {
  0%   { width: 5%; }
  65%  { width: 82%; }
  100% { width: 5%; }
}
.tl-stat { font-size: 12px; color: var(--text-dim); }
.tl-stat strong { color: var(--text); font-weight: 600; }

.ins-visual { display: flex; flex-direction: column; gap: 20px; }
.donut-row { display: flex; align-items: center; gap: 22px; }
.donut-wrap { position: relative; width: 76px; height: 76px; flex-shrink: 0; }
.donut-svg { width: 76px; height: 76px; transform: rotate(-90deg); }
.donut-bg { fill: none; stroke: var(--border); stroke-width: 7; }
.donut-arc {
  fill: none;
  stroke: var(--accent);
  stroke-width: 7;
  stroke-linecap: round;
  stroke-dasharray: 154;
  stroke-dashoffset: 154;
  transition: stroke-dashoffset 1.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.donut-arc.animd { stroke-dashoffset: 38; }
.donut-legend { display: flex; flex-direction: column; gap: 7px; }
.leg-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-dim); }
.leg-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

.streak-pill {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 11px 16px;
}
.streak-flame { font-size: 20px; animation: flicker 2.2s ease-in-out infinite; }
@keyframes flicker {
  0%, 100% { transform: scale(1) rotate(-2deg); }
  50%       { transform: scale(1.14) rotate(2deg); }
}
.streak-num { font-size: 20px; font-weight: 700; color: var(--warm); line-height: 1; }
.streak-lbl { font-size: 11px; color: var(--text-muted); }
.streak-aside { margin-left: auto; font-size: 12px; color: var(--text-dim); }

.bar-group { display: flex; flex-direction: column; gap: 9px; }
.bar-row { display: flex; align-items: center; gap: 10px; }
.bar-lbl { font-size: 11px; color: var(--text-dim); width: 62px; flex-shrink: 0; }
.bar-track { flex: 1; height: 4px; background: var(--surface-2); border-radius: 2px; overflow: hidden; }
.bar-fill {
  height: 100%;
  border-radius: 2px;
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.85s cubic-bezier(0.22, 1, 0.36, 1);
}
.bar-row.vis .bar-fill { transform: scaleX(1); }
.bar-val { font-size: 11px; color: var(--text-muted); width: 30px; text-align: right; }

.how-section {
  padding: 100px 56px 80px;
  max-width: 1240px;
  margin: 0 auto;
}
.how-tag {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 56px;
}
.how-steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  position: relative;
}
.how-steps::before {
  content: '';
  position: absolute;
  top: 30px;
  left: calc(100% / 6);
  right: calc(100% / 6);
  height: 1px;
  background: var(--border);
}
.how-step {
  padding-right: 48px;
  opacity: 0;
  transform: translateY(22px);
  transition: opacity 0.65s cubic-bezier(0.22, 1, 0.36, 1),
              transform 0.65s cubic-bezier(0.22, 1, 0.36, 1);
}
.how-step:nth-child(2) { transition-delay: 0.1s; }
.how-step:nth-child(3) { transition-delay: 0.2s; padding-right: 0; }
.how-step.vis { opacity: 1; transform: translateY(0); }
.how-num {
  font-family: 'Playfair Display', serif;
  font-size: 52px;
  font-weight: 700;
  color: var(--border);
  line-height: 1;
  margin-bottom: 26px;
  letter-spacing: -0.02em;
}
.how-title { font-size: 18px; font-weight: 600; color: var(--text); margin-bottom: 10px; }
.how-body  { font-size: 14px; color: var(--text-dim); line-height: 1.65; }
.how-note {
  margin-top: 14px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-muted);
}

/* ── FAQ ── */
.faq-section {
  max-width: 1240px;
  margin: 0 auto;
  padding: 80px 56px 40px;
  opacity: 0;
  transform: translateY(30px);
  transition: opacity 0.75s cubic-bezier(0.22, 1, 0.36, 1),
              transform 0.75s cubic-bezier(0.22, 1, 0.36, 1);
}
.faq-section.vis { opacity: 1; transform: translateY(0); }
.faq-title {
  font-family: 'DM Serif Display', serif;
  font-size: clamp(24px, 3vw, 36px);
  font-weight: 400;
  color: var(--text);
  text-align: center;
  margin-bottom: 48px;
}
.faq-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px 40px;
}
.faq-item {
  padding: 24px 28px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
}
.faq-q {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;
}
.faq-a {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-dim);
}

.cta-wrap {
  padding: 40px 56px 80px;
  max-width: 1240px;
  margin: 0 auto;
  opacity: 0;
  transform: translateY(30px);
  transition: opacity 0.75s cubic-bezier(0.22, 1, 0.36, 1),
              transform 0.75s cubic-bezier(0.22, 1, 0.36, 1);
}
.cta-wrap.vis { opacity: 1; transform: translateY(0); }
.cta-inner {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 88px 56px;
  text-align: center;
  position: relative;
  overflow: hidden;
}
.cta-headline {
  font-family: 'Playfair Display', serif;
  font-size: clamp(30px, 4vw, 54px);
  font-weight: 700;
  color: var(--text);
  margin-bottom: 14px;
  letter-spacing: -0.01em;
  position: relative;
  z-index: 1;
}
.cta-sub {
  font-size: 16px;
  color: var(--text-dim);
  margin-bottom: 44px;
  position: relative;
  z-index: 1;
}
.btn-cta {
  font-size: 16px;
  font-weight: 600;
  color: #f0eee8;
  background: var(--accent);
  border: none;
  border-radius: 10px;
  padding: 16px 40px;
  text-decoration: none;
  cursor: pointer;
  display: inline-block;
  position: relative;
  z-index: 1;
  transition: opacity 0.15s, transform 0.2s cubic-bezier(0.22,1,0.36,1);
}
.btn-cta:hover { opacity: 0.89; transform: translateY(-2px); }

.footer-inner {
  border-top: 1px solid var(--border-sub);
  padding: 44px 56px;
  max-width: 1240px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}
.footer-wordmark {
  font-family: 'Jost', sans-serif;
  font-size: 18px;
  font-weight: 300;
  color: var(--text);
  letter-spacing: 0.5px;
  margin-bottom: 5px;
}
.footer-copy { font-size: 11px; color: var(--text-muted); max-width: 380px; line-height: 1.55; }
.footer-links { display: flex; gap: 28px; }
.footer-links a { font-size: 13px; color: var(--text-muted); text-decoration: none; transition: color 0.14s; }
.footer-links a:hover { color: var(--text); }

@keyframes fadeUp {
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 960px) {
  nav { padding: 0 28px; }
  .hero-inner { grid-template-columns: 1fr; padding: 100px 28px 64px; gap: 0; }
  .hero-visual { display: none; }
  .hero-text { max-width: 100%; }
  .university-trust { padding-top: 28px; }
  .university-trust-inner { justify-content: flex-start; padding: 0 28px 14px; }
  .university-logo-marquee { padding-bottom: 28px; }
  .university-logo-track { animation-duration: 30s; }
  .university-logo-card { width: 126px; height: 66px; }
  .university-logo-card.is-wide { width: 182px; }
  .university-logo-card img { max-width: 98px; max-height: 52px; }
  .university-logo-card.is-wide img { max-width: 142px; max-height: 36px; }
  .marquee-wrap { display: none; }
  .feature { grid-template-columns: 1fr; padding: 56px 28px; gap: 36px; }
  .feature:nth-child(even) .feat-text { order: 0; }
  .feature:nth-child(even) .feat-vis  { order: 0; }
  .how-section { padding: 64px 28px; }
  .how-steps { grid-template-columns: 1fr; gap: 40px; }
  .how-steps::before { display: none; }
  .how-step, .how-step:nth-child(3) { padding-right: 0; }
  .faq-section { padding: 56px 28px 28px; }
  .faq-grid { grid-template-columns: 1fr; gap: 16px; }
  .cta-wrap { padding: 28px 28px 64px; }
  .cta-inner { padding: 56px 28px; }
  .footer-inner { padding: 36px 28px; flex-direction: column; align-items: flex-start; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;

export default function LandingPage() {
  const navRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Soma — Study like you actually mean it.';
    return () => { document.title = prev; };
  }, []);

  useEffect(() => {
    const links: HTMLLinkElement[] = [];
    const p1 = document.createElement('link');
    p1.rel = 'preconnect'; p1.href = 'https://fonts.googleapis.com';
    const p2 = document.createElement('link');
    p2.rel = 'preconnect'; p2.href = 'https://fonts.gstatic.com'; p2.crossOrigin = 'anonymous';
    const font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,700;1,500;1,700&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap';
    [p1, p2, font].forEach(l => { links.push(l); document.head.appendChild(l); });
    return () => links.forEach(l => document.head.removeChild(l));
  }, []);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = LANDING_CSS;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const handler = () => nav.classList.toggle('scrolled', window.scrollY > 40);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    interface Pt { x: number; y: number; vx: number; vy: number; r: number; }
    let pts: Pt[] = [];
    let W = 0, H = 0, raf = 0;
    const N = 65, LINK = 140;

    function resize() {
      const dpr = Math.min(devicePixelRatio, 2);
      W = canvas!.offsetWidth;
      H = canvas!.offsetHeight;
      canvas!.width = W * dpr;
      canvas!.height = H * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function mkPt(): Pt {
      return {
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.4 + 0.5,
      };
    }

    function initPts() { pts = Array.from({ length: N }, mkPt); }

    function draw() {
      ctx!.clearRect(0, 0, W, H);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = 'rgba(96, 94, 136, 0.55)';
        ctx!.fill();
        for (let j = i + 1; j < pts.length; j++) {
          const q = pts[j];
          const dx = p.x - q.x, dy = p.y - q.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < LINK) {
            ctx!.beginPath();
            ctx!.moveTo(p.x, p.y);
            ctx!.lineTo(q.x, q.y);
            const a = ((1 - d / LINK) * 0.32).toFixed(3);
            ctx!.strokeStyle = `rgba(78, 76, 120, ${a})`;
            ctx!.lineWidth = 0.6;
            ctx!.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    }

    const ro = new ResizeObserver(() => { resize(); initPts(); });
    ro.observe(canvas);
    resize(); initPts(); draw();

    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(({ isIntersecting, target }) => {
        if (!isIntersecting) return;
        target.classList.add('vis');

        if (target.hasAttribute('data-chat') || target.querySelector('[data-chat]')) {
          const root = target.hasAttribute('data-chat') ? target : target.querySelector('[data-chat]');
          if (root) {
            root.querySelectorAll<HTMLElement>('.chat-msg, .chat-card').forEach(el => {
              const delay = parseInt(el.dataset.d ?? '0', 10);
              setTimeout(() => el.classList.add('show'), delay);
            });
          }
        }

        if (target.hasAttribute('data-assign') || target.querySelector('[data-assign]')) {
          const root = target.hasAttribute('data-assign') ? target : target.querySelector('[data-assign]');
          if (root) {
            root.querySelectorAll<HTMLElement>('.assign-item').forEach(el => {
              const delay = parseInt(el.dataset.ad ?? '0', 10);
              setTimeout(() => el.classList.add('show'), delay);
            });
          }
        }

        if (target.hasAttribute('data-insights') || target.querySelector('[data-insights]')) {
          const root = target.hasAttribute('data-insights') ? target : target.querySelector('[data-insights]');
          if (root) {
            const arc = root.querySelector('.donut-arc');
            if (arc) arc.classList.add('animd');
            root.querySelectorAll('.bar-row').forEach((r, i) => {
              setTimeout(() => r.classList.add('vis'), i * 100 + 250);
            });
          }
        }

        io.unobserve(target);
      });
    }, { threshold: 0.22 });

    document.querySelectorAll('.feature, .how-step, .faq-section, .cta-wrap, [data-chat], [data-assign], [data-insights]')
      .forEach(el => io.observe(el));

    return () => io.disconnect();
  }, []);

  return (
    <div className="landing-root">
      <nav ref={navRef}>
        <a href="/" className="nav-wordmark">Soma</a>
        <div className="nav-right">
          <a href="/login" className="nav-login">Log in</a>
          <a href="/signup" className="nav-cta">Get started</a>
        </div>
      </nav>

      <section className="hero">
        <canvas ref={canvasRef} id="hero-canvas" />
        <div className="hero-inner">
          <div className="hero-text">
            <p className="hero-eyebrow">AI-powered study planner for students</p>
            <h1 className="hero-headline">
              <span className="hero-line-1">Study like you</span>
              <span className="hero-line-2">actually mean it.</span>
            </h1>
            <p className="hero-sub">Soma connects to Canvas, builds your schedule, and tracks your progress — so you can focus on learning, not planning. Built for high school and college students.</p>
            <div className="hero-actions">
              <a href="/signup" className="btn-primary">Start for free →</a>
              <a href="#features" className="btn-ghost">See it in action</a>
            </div>
          </div>
          <div className="hero-visual">
            <div className="app-mockup">
              <div className="mockup-topbar">
                <div className="mockup-dot" />
                <div className="mockup-dot" />
                <div className="mockup-dot" />
                <span className="mockup-title">Soma — Day View</span>
              </div>
              <div className="mockup-body">
                <div className="mockup-sidebar">
                  <div className="mockup-nav-dot on" />
                  <div className="mockup-nav-dot" />
                  <div className="mockup-nav-dot" />
                  <div className="mockup-nav-dot" />
                  <div className="mockup-nav-dot" />
                </div>
                <div className="mockup-dayview">
                  <div className="mockup-date-hdr">Sunday, May 24</div>
                  <div className="mockup-tl">
                    <div className="mockup-hr"><span className="mockup-hr-lbl">8am</span><div className="mockup-hr-line" /></div>
                    <div className="mockup-hr"><span className="mockup-hr-lbl">9am</span><div className="mockup-hr-line" /></div>
                    <div className="mockup-hr"><span className="mockup-hr-lbl">10am</span><div className="mockup-hr-line" /></div>
                    <div className="mockup-hr"><span className="mockup-hr-lbl">11am</span><div className="mockup-hr-line" /></div>
                    <div className="mockup-hr"><span className="mockup-hr-lbl">12pm</span><div className="mockup-hr-line" /></div>
                    <div className="mockup-hr"><span className="mockup-hr-lbl">1pm</span><div className="mockup-hr-line" /></div>
                    <div className="mockup-hr"><span className="mockup-hr-lbl">2pm</span><div className="mockup-hr-line" /></div>
                    <div className="mockup-hr"><span className="mockup-hr-lbl">3pm</span><div className="mockup-hr-line" /></div>
                    <div className="mockup-blk blk-calc">
                      AP Calculus BC
                      <span className="mockup-blk-sub">9:00 — 10:30 AM</span>
                    </div>
                    <div className="mockup-blk blk-chem">
                      AP Chemistry
                      <span className="mockup-blk-sub">11:00 AM</span>
                    </div>
                    <div className="mockup-blk blk-eng">English Lit</div>
                    <div className="mockup-rl" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="university-trust" aria-label="Trusted by students from universities">
        <div className="university-trust-inner">
          <p className="university-trust-copy">Trusted by students from</p>
        </div>
        <div className="university-logo-marquee">
          <div className="university-logo-track">
            {UNIVERSITY_LOGO_COPIES.map((setIndex) => (
              <div className="university-logo-set" aria-hidden={setIndex > 0} key={setIndex}>
                {UNIVERSITY_LOGOS.map((university) => (
                  <span className={`university-logo-card is-${university.shape}`} key={`${setIndex}-${university.name}`}>
                    <img src={university.src} alt={setIndex === 0 ? `${university.name} logo` : ''} loading="lazy" />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="marquee-wrap">
        <div className="marquee-track">
          <span className="marquee-item">
            Built for AP students<span className="msep" />Canvas-connected<span className="msep" />AI-powered scheduling<span className="msep" />Passive time tracking<span className="msep" />Weekly study insights<span className="msep" />Subject-aware planning<span className="msep" />Streak tracking<span className="msep" />Deadline awareness<span className="msep" />
          </span>
          <span className="marquee-item">
            Built for AP students<span className="msep" />Canvas-connected<span className="msep" />AI-powered scheduling<span className="msep" />Passive time tracking<span className="msep" />Weekly study insights<span className="msep" />Subject-aware planning<span className="msep" />Streak tracking<span className="msep" />Deadline awareness<span className="msep" />
          </span>
        </div>
      </div>

      <div id="features">
        <div className="feature">
          <div className="feat-text">
            <p className="feat-kicker">AI Scheduling</p>
            <h2 className="feat-headline">Plan your study day in seconds with AI</h2>
            <p className="feat-body">Tell Soma what you need to do. It reads your Canvas deadlines, checks your availability, and builds a focused schedule. No back-and-forth, no manual planning.</p>
          </div>
          <div className="feat-vis" data-chat="">
            <div className="chat-bar">
              <span>Ask Soma anything...</span>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 1L8.1 5.9L13 7L8.1 8.1L7 13L5.9 8.1L1 7L5.9 5.9Z" />
              </svg>
            </div>
            <div className="chat-messages">
              <div className="chat-msg user" data-d="0">plan my day</div>
              <div className="chat-msg ai" data-d="420">On it. Here's what fits your schedule today:</div>
              <div className="chat-card" data-d="840">
                <div className="sched-row"><div className="sched-dot" style={{background:'#5B6AF0'}} />9:00 AM — AP Calculus BC, 90 min</div>
                <div className="sched-row"><div className="sched-dot" style={{background:'#F0A05B'}} />11:00 AM — AP Chemistry, 60 min</div>
                <div className="sched-row"><div className="sched-dot" style={{background:'#5BC4AD'}} />1:00 PM — English Lit, 45 min</div>
              </div>
            </div>
          </div>
        </div>

        <div className="feature">
          <div className="feat-text">
            <p className="feat-kicker">Canvas Sync</p>
            <h2 className="feat-headline">Sync every Canvas assignment automatically</h2>
            <p className="feat-body">Soma pulls your assignments, due dates, and announcements directly from Canvas. Your full workload, visible at a glance, with no manual entry.</p>
          </div>
          <div className="feat-vis" data-assign="">
            <div className="assign-list">
              <div className="assign-item" data-ad="0">
                <div className="assign-dot" style={{background:'#5B6AF0'}} />
                <div className="assign-info">
                  <div className="assign-name">Integration by Parts — Problem Set 6</div>
                  <div className="assign-course">AP Calculus BC</div>
                </div>
                <div className="assign-due hot">Due tomorrow</div>
              </div>
              <div className="assign-item" data-ad="140">
                <div className="assign-dot" style={{background:'#F0A05B'}} />
                <div className="assign-info">
                  <div className="assign-name">Thermodynamics Lab Report</div>
                  <div className="assign-course">AP Chemistry</div>
                </div>
                <div className="assign-due">Due in 3 days</div>
              </div>
              <div className="assign-item" data-ad="280">
                <div className="assign-dot" style={{background:'#5BC4AD'}} />
                <div className="assign-info">
                  <div className="assign-name">Great Gatsby Essay — Final Draft</div>
                  <div className="assign-course">AP English Literature</div>
                </div>
                <div className="assign-due">Due Friday</div>
              </div>
              <div className="assign-item" data-ad="420">
                <div className="assign-dot" style={{background:'#C47BD4'}} />
                <div className="assign-info">
                  <div className="assign-name">Cold War DBQ Practice</div>
                  <div className="assign-course">AP US History</div>
                </div>
                <div className="assign-due">Due Monday</div>
              </div>
            </div>
          </div>
        </div>

        <div className="feature">
          <div className="feat-text">
            <p className="feat-kicker">Passive Time Tracking</p>
            <h2 className="feat-headline">Track study time automatically by subject</h2>
            <p className="feat-body">As the clock moves through your scheduled blocks, Soma records what you studied. No timers to start. No logs to fill in later.</p>
          </div>
          <div className="feat-vis">
            <div className="tl-visual">
              <div className="tl-date">Sunday, May 24</div>
              <div className="tl-track">
                <div className="tl-blk" style={{left:'10%',width:'28%',background:'oklch(52% 0.2 265/0.18)',color:'oklch(74% 0.18 265)',border:'1px solid oklch(52% 0.2 265/0.28)'}}>AP Calc</div>
                <div className="tl-blk" style={{left:'40%',width:'20%',background:'oklch(72% 0.14 50/0.15)',color:'oklch(78% 0.14 50)',border:'1px solid oklch(72% 0.14 50/0.28)'}}>Chem</div>
                <div className="tl-blk" style={{left:'63%',width:'18%',background:'oklch(68% 0.12 180/0.14)',color:'oklch(74% 0.12 180)',border:'1px solid oklch(68% 0.12 180/0.24)'}}>English</div>
                <div className="tl-redline" />
              </div>
              <div className="tl-axis">
                <span>8 AM</span><span>10 AM</span><span>12 PM</span><span>2 PM</span><span>4 PM</span>
              </div>
              <div className="tl-progress">
                <div className="tl-fill" />
              </div>
              <div className="tl-stat"><strong>3h 20m</strong> tracked today across 3 subjects</div>
            </div>
          </div>
        </div>

        <div className="feature">
          <div className="feat-text">
            <p className="feat-kicker">Insights</p>
            <h2 className="feat-headline">Study insights and streak tracking</h2>
            <p className="feat-body">Weekly study breakdowns, subject distribution, streak tracking, and AI-powered time estimates — all derived from your actual study behavior.</p>
          </div>
          <div className="feat-vis" data-insights="">
            <div className="ins-visual">
              <div className="donut-row">
                <div className="donut-wrap">
                  <svg className="donut-svg" viewBox="0 0 76 76">
                    <circle className="donut-bg" cx="38" cy="38" r="24.5" />
                    <circle className="donut-arc" cx="38" cy="38" r="24.5" />
                  </svg>
                </div>
                <div className="donut-legend">
                  <div className="leg-row"><div className="leg-dot" style={{background:'#5B6AF0'}} />AP Calculus — 38%</div>
                  <div className="leg-row"><div className="leg-dot" style={{background:'#F0A05B'}} />AP Chemistry — 29%</div>
                  <div className="leg-row"><div className="leg-dot" style={{background:'#5BC4AD'}} />English Lit — 19%</div>
                  <div className="leg-row"><div className="leg-dot" style={{background:'#C47BD4'}} />US History — 14%</div>
                </div>
              </div>
              <div className="streak-pill">
                <span className="streak-flame">🔥</span>
                <div>
                  <div className="streak-num">7</div>
                  <div className="streak-lbl">day streak</div>
                </div>
                <div className="streak-aside">18.4h this week</div>
              </div>
              <div className="bar-group">
                <div className="bar-row"><span className="bar-lbl">AP Calc</span><div className="bar-track"><div className="bar-fill" style={{width:'100%',background:'#5B6AF0',transitionDelay:'0.1s'}} /></div><span className="bar-val">7.0h</span></div>
                <div className="bar-row"><span className="bar-lbl">Chemistry</span><div className="bar-track"><div className="bar-fill" style={{width:'76%',background:'#F0A05B',transitionDelay:'0.2s'}} /></div><span className="bar-val">5.3h</span></div>
                <div className="bar-row"><span className="bar-lbl">English</span><div className="bar-track"><div className="bar-fill" style={{width:'50%',background:'#5BC4AD',transitionDelay:'0.3s'}} /></div><span className="bar-val">3.5h</span></div>
                <div className="bar-row"><span className="bar-lbl">History</span><div className="bar-track"><div className="bar-fill" style={{width:'37%',background:'#C47BD4',transitionDelay:'0.4s'}} /></div><span className="bar-val">2.6h</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="how-section">
        <p className="how-tag">How it works</p>
        <div className="how-steps">
          <div className="how-step">
            <div className="how-num">01</div>
            <div className="how-title">Connect Canvas</div>
            <p className="how-body">Paste your Canvas calendar feed URL. Soma reads your assignments and due dates automatically — nothing to enter by hand.</p>
            <p className="how-note">Soma only reads your calendar feed. No passwords or API tokens required.</p>
          </div>
          <div className="how-step">
            <div className="how-num">02</div>
            <div className="how-title">Ask Soma to plan</div>
            <p className="how-body">One message builds your whole day. Soma knows your deadlines, your free hours, and how long tasks take you based on past sessions.</p>
          </div>
          <div className="how-step">
            <div className="how-num">03</div>
            <div className="how-title">Study. Soma handles the rest.</div>
            <p className="how-body">Open your day view and work. Time is recorded automatically. Insights accumulate. Your study patterns improve week over week.</p>
          </div>
        </div>
      </section>

      <section className="faq-section" id="faq">
        <h2 className="faq-title">Frequently asked questions</h2>
        <div className="faq-grid">
          <div className="faq-item">
            <h3 className="faq-q">Is Soma free?</h3>
            <p className="faq-a">Soma's core features — day view, Canvas sync, calendar, time tracking, and insights — are completely free, forever. AI features (chat, schedule generation, study material creation) come with a free 21-day trial, then $4.99/month.</p>
          </div>
          <div className="faq-item">
            <h3 className="faq-q">Does Soma work with my school's Canvas?</h3>
            <p className="faq-a">Yes — Soma works with any school that uses Canvas LMS. Just paste your Canvas calendar feed URL and your assignments sync automatically.</p>
          </div>
          <div className="faq-item">
            <h3 className="faq-q">Can I use Soma for high school?</h3>
            <p className="faq-a">Absolutely. Soma is built for both high school and college students. It works great for AP classes, honors courses, and any school that uses Canvas.</p>
          </div>
          <div className="faq-item">
            <h3 className="faq-q">What does the AI actually do?</h3>
            <p className="faq-a">Soma's AI reads your deadlines and availability, then builds a study schedule for your day. It can also generate study notes, practice quizzes, slide decks, and essay outlines.</p>
          </div>
          <div className="faq-item">
            <h3 className="faq-q">Do I need a Google account?</h3>
            <p className="faq-a">Google Drive is optional — it's used to save AI-generated study materials as Google Docs and Slides. You can use Soma's core features (scheduling, tracking, Canvas sync) without it.</p>
          </div>
          <div className="faq-item">
            <h3 className="faq-q">Is my data private?</h3>
            <p className="faq-a">Yes. Soma only reads your Canvas calendar feed (no passwords required). Your study data is stored securely and never shared with third parties.</p>
          </div>
          <div className="faq-item">
            <h3 className="faq-q">Is this safe to use?</h3>
            <p className="faq-a">Your Canvas calendar feed is read-only. It can only view assignment names and due dates. It can't access your grades, files, or account. Your feed URL stays in your browser and is never stored on our servers. If you ever need to, you can regenerate your feed URL in Canvas settings and reconnect in Soma.</p>
          </div>
        </div>
      </section>

      <div className="cta-wrap">
        <div className="cta-inner">
          <h2 className="cta-headline">Ready to actually get things done?</h2>
          <p className="cta-sub">Join students who study smarter with Soma.</p>
          <a href="/signup" className="btn-cta">Get started free</a>
        </div>
      </div>

      <footer>
        <div className="footer-inner">
          <div>
            <div className="footer-wordmark">Soma</div>
            <p className="footer-copy">© 2026 Soma. Not affiliated with Canvas, Instructure, Google, or any school.</p>
          </div>
          <div className="footer-links">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/billing">Billing</a>
            <a href="/refund">Refunds</a>
            <a href="/ai-disclaimer">AI Disclaimer</a>
            <a href="/contact">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
