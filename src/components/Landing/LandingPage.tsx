import { useEffect, useRef, useState } from 'react';

const BRIEF_SCRIPT = [
  { kind: 'lead', text: 'You have two assignments due today that need attention.' },
  { kind: 'bullet', text: 'Finish the Chemistry 210 lab report by Tuesday' },
  { kind: 'bullet', text: 'Start the Statistics 200 problem set, due Thursday' },
  { kind: 'bullet', text: "Begin the English 102 essay draft, due Friday" },
] as const;

const BRIEF_COURSES = [
  { name: 'Biology 101', color: '#ef4444', time: '0m' },
  { name: 'Chemistry 210', color: '#22c55e', time: '45m' },
  { name: 'Statistics 200', color: '#a855f7', time: '1h 10m' },
] as const;

const UNIVERSITY_LOGOS = [
  { name: 'Stanford University', src: '/university-logos/stanford.svg', shape: 'mark' },
  { name: 'Cornell University', src: '/university-logos/cornell.svg', shape: 'mark' },
  { name: 'UC Berkeley', src: '/university-logos/uc-berkeley.svg', shape: 'mark' },
  { name: 'UCLA', src: '/university-logos/ucla.svg', shape: 'mark' },
  { name: 'UC San Diego', src: '/university-logos/ucsd.png', shape: 'mark' },
  { name: 'Emory University', src: '/university-logos/emory.svg', shape: 'wide' },
  { name: 'UC Irvine', src: '/university-logos/uc-irvine.png', shape: 'mark' },
  { name: 'UC Davis', src: '/university-logos/uc-davis.svg', shape: 'mark' },
  { name: 'Carnegie Mellon University', src: '/university-logos/carnegie-mellon.png', shape: 'mark' },
  { name: 'Georgia Tech', src: '/university-logos/georgia-tech.svg', shape: 'mark' },
] as const;
const UNIVERSITY_LOGO_COPIES = [0, 1, 2, 3, 4, 5] as const;

const LANDING_CSS = `
.landing-root {
  --blue-50:  #eff6ff;
  --blue-100: #dbeafe;
  --blue-200: #bfdbfe;
  --blue-600: #2563eb;
  --blue-700: #1d4ed8;
  --blue-800: #1e40af;
  --blue-950: #172554;

  --slate-50:  #f8fafc;
  --slate-100: #f1f5f9;
  --slate-200: #e2e8f0;
  --slate-300: #cbd5e1;
  --slate-400: #94a3b8;
  --slate-500: #64748b;
  --slate-600: #475569;
  --slate-700: #334155;
  --slate-900: #0f172a;

  --s1: #2563eb; --s1-bg: #eff6ff; --s1-br: #bfdbfe; --s1-tx: #1d4ed8;
  --s2: #f59e0b; --s2-bg: #fffbeb; --s2-br: #fde68a; --s2-tx: #b45309;
  --s3: #14b8a6; --s3-bg: #f0fdfa; --s3-br: #99f6e4; --s3-tx: #0f766e;
  --s4: #8b5cf6; --s4-bg: #f5f3ff; --s4-br: #ddd6fe; --s4-tx: #6d28d9;

  font-family: 'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--slate-50);
  color: var(--slate-900);
  line-height: 1.55;
  letter-spacing: -0.011em;
  -webkit-font-smoothing: antialiased;
  min-height: 100dvh;
  overflow-x: hidden;
}

.landing-root *, .landing-root *::before, .landing-root *::after { box-sizing: border-box; }

/* ─────────────  Nav  ───────────── */
.ln-nav {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  width: calc(100% - 48px);
  max-width: 1160px;
  height: 60px;
  padding: 0 10px 0 18px;
  background: #fff;
  border: 1px solid var(--slate-200);
  border-radius: 999px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 26px rgba(15, 23, 42, 0.07);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.ln-brand { display: flex; align-items: center; gap: 9px; text-decoration: none; flex-shrink: 0; }
.ln-word { font-family: 'Jost', sans-serif; font-size: 18px; font-weight: 600; color: var(--slate-900); letter-spacing: 0.15em; }

.ln-nav-links { display: flex; align-items: center; gap: 4px; }
.ln-nav-links a {
  font-size: 14.5px; font-weight: 500;
  color: var(--slate-600);
  text-decoration: none;
  padding: 8px 13px;
  border-radius: 8px;
  transition: color 0.15s, background 0.15s;
}
.ln-nav-links a:hover { color: var(--slate-900); background: var(--slate-100); }

.ln-nav-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.ln-login {
  font-size: 14.5px; font-weight: 500;
  color: var(--slate-600);
  text-decoration: none;
  padding: 8px 14px;
  border-radius: 8px;
  transition: color 0.15s, background 0.15s;
}
.ln-login:hover { color: var(--slate-900); background: var(--slate-100); }

.ln-btn {
  display: inline-block;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #fff;
  background: var(--blue-800);
  border: none;
  border-radius: 8px;
  padding: 11px 22px;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s;
}
.ln-btn:hover { background: var(--blue-950); }
.ln-btn.sm { font-size: 14.5px; padding: 9px 18px; border-radius: 999px; }
.ln-btn.lg { font-size: 17px; padding: 15px 34px; }

.ln-btn-quiet {
  display: inline-block;
  font-family: inherit;
  font-size: 15px;
  font-weight: 500;
  color: var(--slate-700);
  background: #fff;
  border: 1px solid var(--slate-300);
  border-radius: 8px;
  padding: 10px 21px;
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.ln-btn-quiet:hover { background: var(--slate-50); border-color: var(--slate-400); }

/* ─────────────  Hero  ───────────── */
.ln-hero {
  background: var(--slate-50);
  border-bottom: 1px solid var(--slate-200);
  padding: 152px 32px 0;
  overflow: hidden;
}

.ln-hero-inner { max-width: 880px; margin: 0 auto; text-align: center; }

.ln-hero h1 {
  font-size: clamp(38px, 5.5vw, 72px);
  font-weight: 600;
  line-height: 1.04;
  letter-spacing: -0.04em;
  color: var(--slate-900);
  margin: 0 0 22px;
}

.ln-hero-sub {
  font-size: clamp(16.5px, 1.5vw, 20px);
  font-weight: 400;
  line-height: 1.6;
  color: var(--slate-600);
  max-width: 620px;
  margin: 0 auto 32px;
}

.ln-hero-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.ln-hero-note { font-size: 14px; color: var(--slate-500); margin: 0 0 56px; }

/* App mockup */
.ln-shot {
  max-width: 1000px;
  margin: 0 auto;
  background: #fff;
  border: 1px solid var(--slate-200);
  border-radius: 14px 14px 0 0;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05), 0 22px 54px rgba(15, 23, 42, 0.09);
  overflow: hidden;
  text-align: left;
}

.ln-shot-bar {
  display: flex; align-items: center; gap: 7px;
  padding: 11px 15px;
  border-bottom: 1px solid var(--slate-200);
  background: var(--slate-50);
}
.ln-dot { width: 9px; height: 9px; border-radius: 50%; }
.ln-dot:nth-child(1) { background: #f87171; }
.ln-dot:nth-child(2) { background: #fbbf24; }
.ln-dot:nth-child(3) { background: #34d399; }
.ln-shot-title { margin-left: 10px; font-size: 12px; font-weight: 600; color: var(--slate-400); }

.ln-shot-body { display: flex; min-height: 330px; }

.ln-side {
  width: 168px; flex-shrink: 0;
  border-right: 1px solid var(--slate-200);
  background: var(--slate-50);
  padding: 14px 10px;
  display: flex; flex-direction: column; gap: 2px;
}
.ln-side-item {
  display: flex; align-items: center; gap: 9px;
  font-size: 13px; font-weight: 500;
  color: var(--slate-500);
  padding: 8px 10px;
  border-radius: 7px;
}
.ln-side-item.on { background: var(--blue-100); color: var(--blue-800); font-weight: 600; }
.ln-side-ic { width: 14px; height: 14px; border-radius: 4px; background: var(--slate-300); flex-shrink: 0; }
.ln-side-item.on .ln-side-ic { background: var(--blue-600); }

.ln-main { flex: 1; min-width: 0; display: flex; }

.ln-day { flex: 1; min-width: 0; }
.ln-day-hdr {
  padding: 13px 16px;
  border-bottom: 1px solid var(--slate-200);
  font-size: 13.5px; font-weight: 600; color: var(--slate-900);
}
.ln-tl { position: relative; padding-bottom: 8px; }
.ln-row { display: flex; align-items: flex-start; height: 34px; }
.ln-row-lbl {
  width: 52px; flex-shrink: 0;
  font-size: 10.5px; font-weight: 500; color: var(--slate-400);
  padding: 2px 9px 0 0; text-align: right;
}
.ln-row-line { flex: 1; height: 1px; background: var(--slate-200); margin-top: 8px; }

.ln-blk {
  position: absolute;
  left: 56px; right: 14px;
  border-radius: 7px;
  padding: 7px 10px;
  font-size: 12px; font-weight: 600;
  display: flex; flex-direction: column; gap: 2px;
  overflow: hidden;
}
.ln-blk span { font-size: 11px; font-weight: 500; opacity: 0.78; }
.ln-blk.b1 { background: var(--s1-bg); border: 1px solid var(--s1-br); color: var(--s1-tx); top: 34px; height: 60px; }
.ln-blk.b2 { background: var(--s2-bg); border: 1px solid var(--s2-br); color: var(--s2-tx); top: 102px; height: 44px; }
.ln-blk.b3 { background: var(--s3-bg); border: 1px solid var(--s3-br); color: var(--s3-tx); top: 180px; height: 44px; }
.ln-blk.b4 { background: var(--s4-bg); border: 1px solid var(--s4-br); color: var(--s4-tx); top: 248px; height: 44px; }

.ln-now { position: absolute; left: 56px; right: 0; height: 1.5px; background: #dc2626; top: 164px; z-index: 4; }
.ln-now::before {
  content: ''; position: absolute; left: -4px; top: -3.5px;
  width: 8px; height: 8px; border-radius: 50%; background: #dc2626;
}

.ln-next {
  width: 220px; flex-shrink: 0;
  border-left: 1px solid var(--slate-200);
  padding: 14px;
}
.ln-next-t { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--slate-400); margin-bottom: 12px; }
.ln-next-card {
  border: 1px solid var(--slate-200);
  border-radius: 9px;
  padding: 11px;
  margin-bottom: 9px;
  background: #fff;
}
.ln-next-name { font-size: 12.5px; font-weight: 600; color: var(--slate-900); margin-bottom: 3px; line-height: 1.35; }
.ln-next-meta { font-size: 11.5px; color: var(--slate-500); display: flex; align-items: center; gap: 6px; }
.ln-pill {
  display: inline-block;
  font-size: 10.5px; font-weight: 600;
  padding: 2px 7px; border-radius: 999px;
}
.ln-pill.hot { background: #fef2f2; color: #b91c1c; }
.ln-pill.warm { background: var(--s2-bg); color: var(--s2-tx); }

/* ─────────────  Sections  ───────────── */
.ln-sec { max-width: 1160px; margin: 0 auto; padding: 88px 24px; }

.ln-eyebrow {
  font-size: 12px; font-weight: 700;
  letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--blue-700);
  margin: 0 0 14px;
}
.ln-h2 {
  font-size: clamp(28px, 3.4vw, 44px);
  font-weight: 600;
  line-height: 1.12;
  letter-spacing: -0.032em;
  color: var(--slate-900);
  margin: 0 0 16px;
}
.ln-lead {
  font-size: 17.5px;
  line-height: 1.62;
  color: var(--slate-600);
  margin: 0;
}
.ln-center { text-align: center; }
.ln-center .ln-lead { max-width: 620px; margin: 0 auto; }

/* Trust strip */
.ln-trust { padding: 54px 0 48px; background: #fff; border-bottom: 1px solid var(--slate-200); }
.ln-trust-t {
  text-align: center;
  font-size: 13px; font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--slate-400);
  margin: 0 0 34px;
}
.ln-marquee {
  overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
}
.ln-track { display: flex; width: max-content; animation: lnScroll 46s linear infinite; }
.ln-set { display: flex; align-items: center; gap: 28px; padding: 0 14px; }
/* Fixed-width slots: logos vary wildly in aspect ratio, so an equal gap alone
   still reads as uneven. A uniform slot makes the pitch identical. */
.ln-logo {
  flex: 0 0 auto;
  width: 152px;
  height: 56px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ln-logo img {
  display: block;
  max-width: 116px; max-height: 52px;
  width: auto; height: auto;
  object-fit: contain;
}
.ln-logo.is-wide img { max-width: 132px; max-height: 40px; }
@keyframes lnScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-16.6667%); }
}

/* Problem block */
.ln-problem { background: #fff; border-top: 1px solid var(--slate-200); border-bottom: 1px solid var(--slate-200); }

/* Steps */
.ln-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; margin-top: 48px; }
.ln-step {
  background: #fff;
  border: 1px solid var(--slate-200);
  border-radius: 16px;
  overflow: hidden;
  display: flex; flex-direction: column;
}
.ln-step-vis {
  height: 178px;
  padding: 22px;
  display: flex; align-items: center; justify-content: center;
  border-bottom: 1px solid var(--slate-200);
  background: var(--slate-50);
}
.ln-step-body { padding: 22px 24px 26px; flex: 1; }
.ln-step-hd { display: flex; align-items: center; gap: 14px; margin-bottom: 10px; }
.ln-step-n {
  width: 28px; height: 28px; flex-shrink: 0;
  border-radius: 50%;
  background: var(--blue-800);
  color: #fff;
  font-size: 13px; font-weight: 700;
  display: grid; place-items: center;
  box-shadow: 0 0 0 4px var(--blue-100);
}
.ln-step-t { font-size: 17.5px; font-weight: 600; letter-spacing: -0.025em; color: var(--slate-900); margin: 0; }
.ln-step-b { font-size: 15px; line-height: 1.6; color: var(--slate-600); margin: 0; }
.ln-step-note {
  font-size: 13px; line-height: 1.5; color: var(--slate-500);
  margin: 14px 0 0; padding-top: 13px;
  border-top: 1px solid var(--slate-100);
}

/* Small in-step product previews */
.ln-mini {
  width: 100%;
  background: #fff;
  border: 1px solid var(--slate-200);
  border-radius: 11px;
  padding: 13px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05), 0 8px 20px rgba(15, 23, 42, 0.06);
}
.ln-mini-field {
  display: flex; align-items: center; gap: 8px;
  font-size: 11.5px; color: var(--slate-500);
  background: var(--slate-50);
  border: 1px solid var(--slate-200);
  border-radius: 7px;
  padding: 9px 11px;
  white-space: nowrap; overflow: hidden;
}
.ln-mini-field b { color: var(--slate-700); font-weight: 600; }
.ln-mini-ok {
  display: flex; align-items: center; gap: 8px;
  font-size: 12.5px; font-weight: 600; color: #15803d;
  margin-top: 12px;
}
.ln-mini-ok i {
  width: 17px; height: 17px; flex-shrink: 0;
  border-radius: 50%; background: #dcfce7; color: #15803d;
  display: grid; place-items: center;
  font-size: 10px; font-style: normal; font-weight: 700;
}
.ln-mini-bubble {
  align-self: flex-end;
  background: var(--blue-800); color: #fff;
  font-size: 12px; font-weight: 500;
  padding: 7px 12px; border-radius: 9px;
  width: fit-content; margin: 0 0 11px auto;
}
.ln-mini-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 11.5px; color: var(--slate-600);
  padding: 6px 0;
  border-top: 1px solid var(--slate-100);
}
.ln-mini-row i { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.ln-mini-seg { display: flex; gap: 3px; height: 28px; margin-bottom: 12px; }
.ln-mini-seg span { border-radius: 5px; }
.ln-mini-stat { font-size: 12.5px; color: var(--slate-500); display: flex; align-items: center; justify-content: space-between; }
.ln-mini-stat strong { color: var(--slate-900); font-weight: 700; font-size: 14px; }
.ln-mini-tag {
  font-size: 11px; font-weight: 600;
  color: var(--blue-800); background: var(--blue-50);
  border: 1px solid var(--blue-200);
  border-radius: 999px; padding: 3px 9px;
}

/* Features */
.ln-feat {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  gap: 64px;
  padding: 56px 0;
}
.ln-feat + .ln-feat { border-top: 1px solid var(--slate-200); }
.ln-feat:nth-child(even) .ln-feat-text { order: 2; }
.ln-feat:nth-child(even) .ln-feat-vis { order: 1; }
.ln-feat-t {
  font-size: clamp(22px, 2.3vw, 30px);
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.2;
  color: var(--slate-900);
  margin: 0 0 12px;
}
.ln-feat-b { font-size: 16px; line-height: 1.65; color: var(--slate-600); max-width: 420px; margin: 0; }

.ln-feat-vis {
  background: #fff;
  border: 1px solid var(--slate-200);
  border-radius: 14px;
  padding: 24px;
  min-height: 250px;
  display: flex; flex-direction: column; justify-content: center;
}

/* Chat visual */
.ln-chat-bar {
  background: var(--slate-50);
  border: 1px solid var(--slate-200);
  border-radius: 8px;
  padding: 9px 13px;
  font-size: 12.5px;
  color: var(--slate-400);
  margin-bottom: 16px;
}
.ln-chat { display: flex; flex-direction: column; gap: 9px; }
.ln-msg {
  font-size: 13.5px;
  padding: 9px 13px;
  border-radius: 10px;
  max-width: 82%;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.35s ease, transform 0.35s ease;
}
.ln-msg.show { opacity: 1; transform: translateY(0); }
.ln-msg.me { background: var(--blue-800); color: #fff; align-self: flex-end; font-weight: 500; }
.ln-msg.bot { background: var(--slate-100); color: var(--slate-700); align-self: flex-start; }
.ln-card {
  background: #fff;
  border: 1px solid var(--slate-200);
  border-radius: 10px;
  padding: 12px 14px;
  align-self: flex-start;
  width: 92%;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.35s ease, transform 0.35s ease;
}
.ln-card.show { opacity: 1; transform: translateY(0); }
.ln-sched {
  display: flex; align-items: center; gap: 9px;
  padding: 6px 0;
  font-size: 12.5px; color: var(--slate-600);
  border-bottom: 1px solid var(--slate-100);
}
.ln-sched:last-child { border-bottom: none; }
.ln-sdot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

/* Assignment visual */
.ln-assigns { display: flex; flex-direction: column; }
.ln-assign {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--slate-100);
  opacity: 0;
  transform: translateX(-8px);
  transition: opacity 0.35s ease, transform 0.35s ease;
}
.ln-assign:first-child { padding-top: 0; }
.ln-assign:last-child { border-bottom: none; padding-bottom: 0; }
.ln-assign.show { opacity: 1; transform: translateX(0); }
.ln-adot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ln-ainfo { flex: 1; min-width: 0; }
.ln-aname {
  font-size: 13.5px; font-weight: 500; color: var(--slate-900);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ln-acourse { font-size: 12px; color: var(--slate-500); margin-top: 2px; }
.ln-adue { font-size: 12px; font-weight: 500; color: var(--slate-500); flex-shrink: 0; }
.ln-adue.hot { color: #b91c1c; }

/* Timeline visual */
.ln-tlv { display: flex; flex-direction: column; gap: 14px; }
.ln-tlv-date { font-size: 12px; font-weight: 600; color: var(--slate-500); }
.ln-tlv-track {
  position: relative; height: 44px;
  background: var(--slate-50);
  border: 1px solid var(--slate-200);
  border-radius: 8px;
  overflow: hidden;
}
.ln-tlv-blk {
  position: absolute; top: 4px; bottom: 4px;
  border-radius: 6px;
  display: flex; align-items: center;
  padding: 0 9px;
  font-size: 11px; font-weight: 600;
  white-space: nowrap;
}
.ln-tlv-axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--slate-400); }
.ln-tlv-bar { height: 4px; background: var(--slate-200); border-radius: 2px; overflow: hidden; }
.ln-tlv-fill { height: 100%; width: 68%; background: var(--blue-600); border-radius: 2px; }
.ln-tlv-stat { font-size: 13.5px; color: var(--slate-600); }
.ln-tlv-stat strong { color: var(--slate-900); font-weight: 600; }

/* Insights visual */
.ln-ins { display: flex; flex-direction: column; gap: 18px; }
.ln-donut-row { display: flex; align-items: center; gap: 22px; }
.ln-donut { width: 80px; height: 80px; flex-shrink: 0; transform: rotate(-90deg); }
.ln-donut-bg { fill: none; stroke: var(--slate-200); stroke-width: 8; }
.ln-donut-arc {
  fill: none; stroke: var(--blue-600); stroke-width: 8; stroke-linecap: round;
  stroke-dasharray: 154; stroke-dashoffset: 154;
  transition: stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1);
}
.ln-donut-arc.on { stroke-dashoffset: 40; }
.ln-legend { display: flex; flex-direction: column; gap: 7px; }
.ln-leg { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--slate-600); }
.ln-leg i { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

.ln-streak {
  display: flex; align-items: center; gap: 14px;
  background: var(--slate-50);
  border: 1px solid var(--slate-200);
  border-radius: 10px;
  padding: 13px 16px;
}
.ln-streak-n { font-size: 22px; font-weight: 700; color: var(--blue-800); line-height: 1; }
.ln-streak-l { font-size: 12px; color: var(--slate-500); margin-top: 2px; }
.ln-streak-a { margin-left: auto; font-size: 13px; color: var(--slate-600); }

.ln-bars { display: flex; flex-direction: column; gap: 9px; }
.ln-bar { display: flex; align-items: center; gap: 11px; }
.ln-bar-l { font-size: 12px; color: var(--slate-600); width: 66px; flex-shrink: 0; }
.ln-bar-t { flex: 1; height: 5px; background: var(--slate-100); border-radius: 3px; overflow: hidden; }
.ln-bar-f {
  height: 100%; border-radius: 3px;
  transform: scaleX(0); transform-origin: left;
  transition: transform 0.8s cubic-bezier(0.22, 1, 0.36, 1);
}
.ln-bar.on .ln-bar-f { transform: scaleX(1); }
.ln-bar-v { font-size: 12px; color: var(--slate-500); width: 32px; text-align: right; }

/* FAQ */
.ln-faq { background: #fff; border-top: 1px solid var(--slate-200); }
.ln-faq-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 44px; }
.ln-faq-item {
  background: var(--slate-50);
  border: 1px solid var(--slate-200);
  border-radius: 12px;
  padding: 22px 24px;
}
.ln-faq-q { font-size: 15.5px; font-weight: 600; letter-spacing: -0.015em; color: var(--slate-900); margin: 0 0 7px; }
.ln-faq-a { font-size: 14.5px; line-height: 1.6; color: var(--slate-600); margin: 0; }

/* CTA */
.ln-cta-wrap { max-width: 1160px; margin: 0 auto; padding: 80px 24px 0; }
.ln-cta {
  display: grid;
  grid-template-columns: 0.92fr 1.08fr;
  align-items: center;
  gap: 36px;
  background: linear-gradient(135deg, #172554 0%, #1e40af 52%, #2563eb 100%);
  border-radius: 18px;
  padding: 38px 40px 38px 44px;
  overflow: hidden;
}
.ln-cta h2 {
  font-size: clamp(24px, 2.6vw, 33px);
  font-weight: 600;
  letter-spacing: -0.035em;
  line-height: 1.16;
  color: #fff;
  margin: 0 0 14px;
}
.ln-cta-lead {
  font-size: 15.5px;
  line-height: 1.62;
  color: #c7dcff;
  max-width: 400px;
  margin: 0 0 26px;
}
.ln-cta-btn {
  display: inline-block;
  font-family: inherit;
  font-size: 15.5px; font-weight: 700;
  color: var(--blue-800);
  background: #fff;
  border: none; border-radius: 999px;
  padding: 13px 28px;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s;
}
.ln-cta-btn:hover { background: var(--blue-50); }

/* Daily-brief app preview inside the CTA */
.ln-cta-vis { position: relative; }
.ln-brief-app {
  width: 100%;
  background: #fff;
  border-radius: 13px;
  box-shadow: 0 10px 40px rgba(2, 10, 30, 0.28);
  padding: 16px 18px 16px;
}
.ln-brief-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.ln-brief-day { font-size: 17px; font-weight: 700; letter-spacing: -0.03em; color: var(--slate-900); }
.ln-brief-date { font-size: 12.5px; color: var(--slate-600); margin-top: 2px; }
.ln-brief-add {
  flex-shrink: 0;
  border: 1px solid var(--slate-200); border-radius: 8px;
  padding: 6px 12px;
  font-size: 11.5px; font-weight: 600; color: var(--slate-700);
  white-space: nowrap;
}
.ln-brief-hd {
  display: flex; align-items: center; justify-content: space-between;
  border: 1.5px solid #4f6ef7;
  border-radius: 8px;
  padding: 8px 11px;
  margin-bottom: 11px;
  font-size: 10.5px; font-weight: 700;
  letter-spacing: 0.09em;
  color: var(--slate-700);
  background: #fff;
}
.ln-brief-gen { font-size: 9.5px; font-weight: 600; letter-spacing: 0.03em; color: var(--blue-700); }
.ln-brief {
  background: #FBF7EC;
  border: 1px solid #EDE3C9;
  border-radius: 10px;
  padding: 13px 14px 7px;
  margin: 13px 0 2px;
}
.ln-brief-lead { font-size: 12px; line-height: 1.55; color: var(--slate-700); margin: 0 0 10px; }
.ln-brief-item {
  position: relative;
  font-size: 12px; line-height: 1.55;
  color: var(--slate-600);
  padding-left: 13px;
  margin: 0 0 8px;
}
.ln-brief-item::before { content: '•'; position: absolute; left: 0; color: var(--slate-400); }
/* Untyped text stays in the layout so the card never changes height mid-animation. */
.ln-brief-ghost { visibility: hidden; }
.ln-brief-lead.is-pending::before,
.ln-brief-item.is-pending::before { visibility: hidden; }
.ln-brief-cursor {
  display: inline-block;
  width: 2px; height: 0.95em;
  background: var(--blue-700);
  margin-left: 1px; margin-right: -3px;
  vertical-align: -2px;
  animation: lnBlink 1s step-end infinite;
}
@keyframes lnBlink { 50% { opacity: 0; } }
.ln-brief-course {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 0;
  border-top: 1px solid var(--slate-100);
  font-size: 12px; font-weight: 600; color: var(--slate-900);
}
.ln-brief-course i { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ln-brief-course em { margin-left: auto; font-style: normal; font-weight: 500; font-size: 11.5px; color: var(--slate-400); }
.ln-brief-course b {
  border: 1px solid var(--slate-200); border-radius: 7px;
  padding: 4px 9px;
  font-size: 10.5px; font-weight: 600; color: var(--slate-600);
}

/* Footer */
.ln-foot { border-top: 1px solid var(--slate-200); background: #fff; margin-top: 84px; }
.ln-foot-in {
  max-width: 1160px; margin: 0 auto;
  padding: 56px 24px 46px;
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr 1fr;
  gap: 40px;
}
.ln-foot-brand { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.ln-foot-word { font-family: 'Jost', sans-serif; font-size: 18px; font-weight: 600; letter-spacing: 0.15em; color: var(--slate-900); }
.ln-foot-copy { font-size: 13.5px; color: var(--slate-500); max-width: 330px; line-height: 1.6; margin: 0 0 14px; }
.ln-foot-mail { font-size: 13.5px; color: var(--slate-500); }
.ln-foot-mail a { color: var(--blue-700); text-decoration: none; }
.ln-foot-mail a:hover { text-decoration: underline; }
.ln-foot-ct { font-size: 14.5px; font-weight: 700; color: var(--slate-900); margin: 0 0 15px; }
.ln-foot-col a {
  display: block;
  font-size: 14px; color: var(--slate-500);
  text-decoration: none;
  margin-bottom: 11px;
  transition: color 0.15s;
}
.ln-foot-col a:hover { color: var(--slate-900); }
.ln-foot-bottom {
  border-top: 1px solid var(--slate-200);
}
.ln-foot-bottom p {
  max-width: 1160px; margin: 0 auto;
  padding: 20px 24px;
  font-size: 13px; color: var(--slate-400);
}

/* ─────────────  Responsive  ───────────── */
@media (max-width: 980px) {
  .ln-nav-links { display: none; }
  .ln-hero { padding: 120px 18px 0; }
  .ln-set { gap: 20px; padding: 0 10px; }
  .ln-logo { width: 116px; height: 46px; }
  .ln-logo img { max-width: 88px; max-height: 42px; }
  .ln-logo.is-wide img { max-width: 112px; max-height: 28px; }
  .ln-shot-body { min-height: 0; }
  .ln-side, .ln-next { display: none; }
  .ln-sec { padding: 60px 20px; }
  .ln-steps { grid-template-columns: 1fr; gap: 14px; margin-top: 34px; }
  .ln-feat { grid-template-columns: 1fr; gap: 30px; padding: 40px 0; }
  .ln-feat:nth-child(even) .ln-feat-text { order: 0; }
  .ln-feat:nth-child(even) .ln-feat-vis { order: 0; }
  .ln-feat-b { max-width: 100%; }
  .ln-faq-grid { grid-template-columns: 1fr; margin-top: 30px; }
  .ln-cta-wrap { padding: 60px 20px 0; }
  .ln-cta { grid-template-columns: 1fr; gap: 34px; padding: 40px 24px 0; }
  .ln-cta-lead { max-width: 100%; }
  .ln-brief-app { width: 100%; }
  .ln-foot { margin-top: 60px; }
  .ln-foot-in { grid-template-columns: 1fr 1fr; gap: 32px; padding: 40px 20px 32px; }
  .ln-foot-copy { max-width: 100%; }
}

@media (max-width: 560px) {
  .ln-login { display: none; }
  .ln-hero-actions { flex-direction: column; align-items: stretch; }
  .ln-hero-actions .ln-btn, .ln-hero-actions .ln-btn-quiet { text-align: center; }
}

@media (prefers-reduced-motion: reduce) {
  .landing-root *, .landing-root *::before, .landing-root *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;

const BRIEF_TOTAL = BRIEF_SCRIPT.reduce((n, l) => n + l.text.length, 0);

function DailyBrief() {
  const ref = useRef<HTMLDivElement>(null);
  const [chars, setChars] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setChars(BRIEF_TOTAL);
      return;
    }

    const TYPE_MS = (BRIEF_TOTAL / 150) * 1000;
    const HOLD_MS = 3500;
    const CYCLE_MS = TYPE_MS + HOLD_MS;

    let raf = 0;
    let start = 0;
    const step = (now: number) => {
      if (!start) start = now;
      const t = (now - start) % CYCLE_MS;
      setChars(t < TYPE_MS ? Math.round((t / TYPE_MS) * BRIEF_TOTAL) : BRIEF_TOTAL);
      raf = requestAnimationFrame(step);
    };

    // Loop while on screen; restart from the top whenever it scrolls back into view.
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (!raf) { start = 0; raf = requestAnimationFrame(step); }
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }, { threshold: 0.35 });

    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  let budget = chars;
  const lines = BRIEF_SCRIPT.map(line => {
    const shown = Math.max(0, Math.min(line.text.length, budget));
    budget -= line.text.length;
    return { ...line, shown };
  });
  const done = chars >= BRIEF_TOTAL;
  const typingIndex = lines.findIndex(l => l.shown > 0 && l.shown < l.text.length);

  return (
    <div className="ln-brief-app" ref={ref}>
      <div className="ln-brief-top">
        <div>
          <div className="ln-brief-day">Saturday</div>
          <div className="ln-brief-date">September 19</div>
        </div>
        <span className="ln-brief-add">+ Add Task</span>
      </div>

      <div className="ln-brief">
        <div className="ln-brief-hd">
          DAILY BRIEF
          <span className="ln-brief-gen">{done ? 'Updated just now' : 'Generating…'}</span>
        </div>
        {lines.map((line, i) => {
          const base = line.kind === 'lead' ? 'ln-brief-lead' : 'ln-brief-item';
          return (
            <p className={line.shown === 0 ? `${base} is-pending` : base} key={i}>
              {line.text.slice(0, line.shown)}
              {i === typingIndex && <i className="ln-brief-cursor" />}
              <span className="ln-brief-ghost">{line.text.slice(line.shown)}</span>
            </p>
          );
        })}
      </div>

      {BRIEF_COURSES.map(c => (
        <div className="ln-brief-course" key={c.name}>
          <i style={{ background: c.color }} />{c.name}<em>{c.time}</em><b>Add task</b>
        </div>
      ))}
    </div>
  );
}

export default function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Soma | Study planner for Canvas students';
    return () => { document.title = prev; };
  }, []);

  // The landing page is light-only; force it regardless of the app's saved theme.
  useEffect(() => {
    const html = document.documentElement;
    const prevTheme = html.dataset.theme;
    const prevBg = html.style.background;
    html.dataset.theme = 'light';
    html.style.background = '#f8fafc';
    return () => {
      if (prevTheme) html.dataset.theme = prevTheme;
      else delete html.dataset.theme;
      html.style.background = prevBg;
    };
  }, []);

  useEffect(() => {
    const links: HTMLLinkElement[] = [];
    const p1 = document.createElement('link');
    p1.rel = 'preconnect'; p1.href = 'https://fonts.googleapis.com';
    const p2 = document.createElement('link');
    p2.rel = 'preconnect'; p2.href = 'https://fonts.gstatic.com'; p2.crossOrigin = 'anonymous';
    const font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap';
    [p1, p2, font].forEach(l => { links.push(l); document.head.appendChild(l); });
    return () => links.forEach(l => document.head.removeChild(l));
  }, []);

  // Reveal the in-product demo visuals when they scroll into view.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const io = new IntersectionObserver((entries) => {
      entries.forEach(({ isIntersecting, target }) => {
        if (!isIntersecting) return;

        target.querySelectorAll<HTMLElement>('.ln-msg, .ln-card, .ln-assign').forEach(el => {
          setTimeout(() => el.classList.add('show'), Number(el.dataset.d ?? 0));
        });
        target.querySelector('.ln-donut-arc')?.classList.add('on');
        target.querySelectorAll('.ln-bar').forEach((bar, i) => {
          setTimeout(() => bar.classList.add('on'), i * 100 + 200);
        });

        io.unobserve(target);
      });
    }, { threshold: 0.3 });

    root.querySelectorAll('.ln-feat-vis').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="landing-root" ref={rootRef}>
      <style>{LANDING_CSS}</style>

      <nav className="ln-nav">
        <a href="/" className="ln-brand">
          <img src="/favicon.png" width="28" height="28" alt="" style={{ borderRadius: 6, flexShrink: 0 }} />
          <span className="ln-word">Soma</span>
        </a>
        <div className="ln-nav-links">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#faq">FAQ</a>
        </div>
        <div className="ln-nav-right">
          <a href="/login" className="ln-login">Log in</a>
          <a href="/signup" className="ln-btn sm">Get started</a>
        </div>
      </nav>

      <header className="ln-hero">
        <div className="ln-hero-inner">
          <h1>Stay on top of every assignment</h1>
          <p className="ln-hero-sub">
            Soma connects to Canvas, builds your study schedule, and tracks your time,
            so you always know what to work on next.
          </p>
          <div className="ln-hero-actions">
            <a href="/signup" className="ln-btn lg">Get started for free</a>
            <a href="#how" className="ln-btn-quiet">See how it works</a>
          </div>
          <p className="ln-hero-note">Free to use. No credit card required.</p>

          <div className="ln-shot">
            <div className="ln-shot-bar">
              <span className="ln-dot" /><span className="ln-dot" /><span className="ln-dot" />
              <span className="ln-shot-title">Soma</span>
            </div>
            <div className="ln-shot-body">
              <aside className="ln-side">
                <div className="ln-side-item on"><span className="ln-side-ic" />Today</div>
                <div className="ln-side-item"><span className="ln-side-ic" />Calendar</div>
                <div className="ln-side-item"><span className="ln-side-ic" />Canvas</div>
                <div className="ln-side-item"><span className="ln-side-ic" />Grades</div>
                <div className="ln-side-item"><span className="ln-side-ic" />Insights</div>
              </aside>
              <div className="ln-main">
                <div className="ln-day">
                  <div className="ln-day-hdr">Monday, September 15</div>
                  <div className="ln-tl">
                    {['8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM'].map(h => (
                      <div className="ln-row" key={h}>
                        <span className="ln-row-lbl">{h}</span>
                        <span className="ln-row-line" />
                      </div>
                    ))}
                    <div className="ln-blk b1">AP Calculus BC<span>9:00 - 10:30 AM · Problem set 6</span></div>
                    <div className="ln-blk b2">AP Chemistry<span>11:00 - 11:45 AM · Lab report</span></div>
                    <div className="ln-blk b3">English Literature<span>1:15 - 2:00 PM · Essay draft</span></div>
                    <div className="ln-blk b4">AP US History<span>3:00 - 3:45 PM · DBQ practice</span></div>
                    <div className="ln-now" />
                  </div>
                </div>
                <aside className="ln-next">
                  <div className="ln-next-t">Due soon</div>
                  <div className="ln-next-card">
                    <div className="ln-next-name">Integration by Parts: Problem Set 6</div>
                    <div className="ln-next-meta">AP Calculus <span className="ln-pill hot">Tomorrow</span></div>
                  </div>
                  <div className="ln-next-card">
                    <div className="ln-next-name">Thermodynamics Lab Report</div>
                    <div className="ln-next-meta">AP Chemistry <span className="ln-pill warm">3 days</span></div>
                  </div>
                  <div className="ln-next-card">
                    <div className="ln-next-name">Gatsby Essay: Final Draft</div>
                    <div className="ln-next-meta">English Lit <span className="ln-pill warm">Friday</span></div>
                  </div>
                </aside>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="ln-trust" aria-label="Universities Soma students attend">
        <p className="ln-trust-t">Used by students at</p>
        <div className="ln-marquee">
          <div className="ln-track">
            {UNIVERSITY_LOGO_COPIES.map(setIndex => (
              <div className="ln-set" aria-hidden={setIndex > 0} key={setIndex}>
                {UNIVERSITY_LOGOS.map(u => (
                  <span className={`ln-logo is-${u.shape}`} key={`${setIndex}-${u.name}`}>
                    <img src={u.src} alt={setIndex === 0 ? `${u.name} logo` : ''} loading="lazy" />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ln-problem">
        <div className="ln-sec ln-center">
          <h2 className="ln-h2">Planning the week takes longer than the work</h2>
          <p className="ln-lead">
            Your assignments are in Canvas. Your schedule is in your head. So every week you
            rebuild the same plan from scratch, and still miss things. Soma does that part for you.
          </p>
        </div>
      </section>

      <section id="how">
        <div className="ln-sec">
          <p className="ln-eyebrow">How it works</p>
          <h2 className="ln-h2">Set up once. Takes about two minutes.</h2>
          <div className="ln-steps">
            <div className="ln-step">
              <div className="ln-step-vis">
                <div className="ln-mini">
                  <div className="ln-mini-field"><b>canvas</b>.school.edu/feeds/calendars/…</div>
                  <div className="ln-mini-ok"><i>✓</i>42 assignments imported</div>
                </div>
              </div>
              <div className="ln-step-body">
                <div className="ln-step-hd">
                  <span className="ln-step-n">1</span>
                  <h3 className="ln-step-t">Connect Canvas</h3>
                </div>
                <p className="ln-step-b">
                  Paste your Canvas calendar feed URL. Your assignments and due dates import
                  automatically, with nothing to type in by hand.
                </p>
                <p className="ln-step-note">Read-only. No password or API token needed.</p>
              </div>
            </div>

            <div className="ln-step">
              <div className="ln-step-vis">
                <div className="ln-mini">
                  <div className="ln-mini-bubble">Plan my day</div>
                  <div className="ln-mini-row"><i style={{ background: '#2563eb' }} />9:00 AM · AP Calculus BC</div>
                  <div className="ln-mini-row"><i style={{ background: '#f59e0b' }} />11:00 AM · AP Chemistry</div>
                  <div className="ln-mini-row"><i style={{ background: '#14b8a6' }} />1:15 PM · English Lit</div>
                </div>
              </div>
              <div className="ln-step-body">
                <div className="ln-step-hd">
                  <span className="ln-step-n">2</span>
                  <h3 className="ln-step-t">Ask Soma to plan</h3>
                </div>
                <p className="ln-step-b">
                  One message builds the whole day. Soma knows your deadlines, your free hours,
                  and how long tasks usually take you.
                </p>
                <p className="ln-step-note">Adjust any block by dragging it.</p>
              </div>
            </div>

            <div className="ln-step">
              <div className="ln-step-vis">
                <div className="ln-mini">
                  <div className="ln-mini-seg">
                    <span style={{ width: '42%', background: '#2563eb' }} />
                    <span style={{ width: '28%', background: '#f59e0b' }} />
                    <span style={{ width: '20%', background: '#14b8a6' }} />
                    <span style={{ width: '10%', background: '#e2e8f0' }} />
                  </div>
                  <div className="ln-mini-stat">
                    <span><strong>3h 20m</strong> today</span>
                    <span className="ln-mini-tag">7 day streak</span>
                  </div>
                </div>
              </div>
              <div className="ln-step-body">
                <div className="ln-step-hd">
                  <span className="ln-step-n">3</span>
                  <h3 className="ln-step-t">Study while Soma tracks it</h3>
                </div>
                <p className="ln-step-b">
                  Open your day view and work. Time is recorded as you go, so your weekly
                  insights build up without any extra effort.
                </p>
                <p className="ln-step-note">No timers to start or stop.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" style={{ background: '#fff', borderTop: '1px solid #e2e8f0' }}>
        <div className="ln-sec">
          <p className="ln-eyebrow">Features</p>
          <h2 className="ln-h2">Everything your semester needs, in one place</h2>

          <div className="ln-feat">
            <div className="ln-feat-text">
              <h3 className="ln-feat-t">Build a study schedule in seconds</h3>
              <p className="ln-feat-b">
                Tell Soma what you need to get done. It reads your Canvas deadlines, checks
                your free hours, and lays out a realistic plan for the day.
              </p>
            </div>
            <div className="ln-feat-vis">
              <div className="ln-chat-bar">Ask Soma anything…</div>
              <div className="ln-chat">
                <div className="ln-msg me" data-d="0">Plan my day</div>
                <div className="ln-msg bot" data-d="400">Here's what fits your schedule today:</div>
                <div className="ln-card" data-d="800">
                  <div className="ln-sched"><i className="ln-sdot" style={{ background: '#2563eb' }} />9:00 AM · AP Calculus BC · 90 min</div>
                  <div className="ln-sched"><i className="ln-sdot" style={{ background: '#f59e0b' }} />11:00 AM · AP Chemistry · 45 min</div>
                  <div className="ln-sched"><i className="ln-sdot" style={{ background: '#14b8a6' }} />1:15 PM · English Lit · 45 min</div>
                </div>
              </div>
            </div>
          </div>

          <div className="ln-feat">
            <div className="ln-feat-text">
              <h3 className="ln-feat-t">Every Canvas assignment, synced</h3>
              <p className="ln-feat-b">
                Soma pulls your assignments and due dates straight from Canvas. Your whole
                workload in one list, always current, with no manual entry.
              </p>
            </div>
            <div className="ln-feat-vis">
              <div className="ln-assigns">
                {[
                  { c: '#2563eb', n: 'Integration by Parts: Problem Set 6', s: 'AP Calculus BC', d: 'Due tomorrow', hot: true },
                  { c: '#f59e0b', n: 'Thermodynamics Lab Report', s: 'AP Chemistry', d: 'Due in 3 days', hot: false },
                  { c: '#14b8a6', n: 'Great Gatsby Essay: Final Draft', s: 'AP English Literature', d: 'Due Friday', hot: false },
                  { c: '#8b5cf6', n: 'Cold War DBQ Practice', s: 'AP US History', d: 'Due Monday', hot: false },
                ].map((a, i) => (
                  <div className="ln-assign" data-d={i * 130} key={a.n}>
                    <i className="ln-adot" style={{ background: a.c }} />
                    <div className="ln-ainfo">
                      <div className="ln-aname">{a.n}</div>
                      <div className="ln-acourse">{a.s}</div>
                    </div>
                    <div className={`ln-adue${a.hot ? ' hot' : ''}`}>{a.d}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="ln-feat">
            <div className="ln-feat-text">
              <h3 className="ln-feat-t">Study time tracked automatically</h3>
              <p className="ln-feat-b">
                As the day moves through your scheduled blocks, Soma records what you studied.
                No timers to start, no logs to fill in afterwards.
              </p>
            </div>
            <div className="ln-feat-vis">
              <div className="ln-tlv">
                <div className="ln-tlv-date">Monday, September 15</div>
                <div className="ln-tlv-track">
                  <div className="ln-tlv-blk" style={{ left: '8%', width: '28%', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8' }}>AP Calc</div>
                  <div className="ln-tlv-blk" style={{ left: '39%', width: '19%', background: '#fffbeb', border: '1px solid #fde68a', color: '#b45309' }}>Chem</div>
                  <div className="ln-tlv-blk" style={{ left: '61%', width: '18%', background: '#f0fdfa', border: '1px solid #99f6e4', color: '#0f766e' }}>English</div>
                </div>
                <div className="ln-tlv-axis">
                  <span>8 AM</span><span>10 AM</span><span>12 PM</span><span>2 PM</span><span>4 PM</span>
                </div>
                <div className="ln-tlv-bar"><div className="ln-tlv-fill" /></div>
                <div className="ln-tlv-stat"><strong>3h 20m</strong> tracked today across 3 subjects</div>
              </div>
            </div>
          </div>

          <div className="ln-feat">
            <div className="ln-feat-text">
              <h3 className="ln-feat-t">See where your time actually goes</h3>
              <p className="ln-feat-b">
                Weekly breakdowns by subject, streaks, and time estimates that get more
                accurate the longer you use it, all from your real study sessions.
              </p>
            </div>
            <div className="ln-feat-vis">
              <div className="ln-ins">
                <div className="ln-donut-row">
                  <svg className="ln-donut" viewBox="0 0 80 80">
                    <circle className="ln-donut-bg" cx="40" cy="40" r="24.5" />
                    <circle className="ln-donut-arc" cx="40" cy="40" r="24.5" />
                  </svg>
                  <div className="ln-legend">
                    <div className="ln-leg"><i style={{ background: '#2563eb' }} />AP Calculus · 38%</div>
                    <div className="ln-leg"><i style={{ background: '#f59e0b' }} />AP Chemistry · 29%</div>
                    <div className="ln-leg"><i style={{ background: '#14b8a6' }} />English Lit · 19%</div>
                    <div className="ln-leg"><i style={{ background: '#8b5cf6' }} />US History · 14%</div>
                  </div>
                </div>
                <div className="ln-streak">
                  <div>
                    <div className="ln-streak-n">7</div>
                    <div className="ln-streak-l">day streak</div>
                  </div>
                  <div className="ln-streak-a">18.4h this week</div>
                </div>
                <div className="ln-bars">
                  {[
                    { l: 'AP Calc', w: '100%', c: '#2563eb', v: '7.0h' },
                    { l: 'Chemistry', w: '76%', c: '#f59e0b', v: '5.3h' },
                    { l: 'English', w: '50%', c: '#14b8a6', v: '3.5h' },
                    { l: 'History', w: '37%', c: '#8b5cf6', v: '2.6h' },
                  ].map(b => (
                    <div className="ln-bar" key={b.l}>
                      <span className="ln-bar-l">{b.l}</span>
                      <div className="ln-bar-t"><div className="ln-bar-f" style={{ width: b.w, background: b.c }} /></div>
                      <span className="ln-bar-v">{b.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="ln-faq" id="faq">
        <div className="ln-sec">
          <p className="ln-eyebrow">FAQ</p>
          <h2 className="ln-h2">Questions students ask</h2>
          <div className="ln-faq-grid">
            {[
              ['Is Soma free?', "The core features (day view, Canvas sync, calendar, time tracking, and insights) are free forever. AI features (chat, schedule generation, study materials) have a 21-day free trial, then $4.99/month."],
              ["Does it work with my school's Canvas?", 'Yes. Soma works with any school that uses Canvas LMS. Paste your Canvas calendar feed URL and your assignments sync automatically.'],
              ['Can I use it in high school?', 'Yes. Soma is built for both high school and college, including AP classes, honors courses, and anything else running on Canvas.'],
              ['What does the AI actually do?', 'It reads your deadlines and free hours, then builds a study schedule for your day. It can also generate study notes, practice quizzes, slide decks, and essay outlines.'],
              ['Do I need a Google account?', 'Only if you want it. Google Drive is optional and is used to save AI-generated study materials as Docs and Slides. Scheduling, tracking, and Canvas sync all work without it.'],
              ['Is my data private?', 'Yes. Soma reads your Canvas calendar feed and nothing else. Your study data is stored securely and never shared with third parties.'],
              ['Is connecting Canvas safe?', "Your calendar feed is read-only. It can see assignment names and due dates, and nothing else. It can't reach your grades, files, or account, and you can regenerate the feed URL in Canvas at any time."],
            ].map(([q, a]) => (
              <div className="ln-faq-item" key={q}>
                <h3 className="ln-faq-q">{q}</h3>
                <p className="ln-faq-a">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="ln-cta-wrap">
        <div className="ln-cta">
          <div>
            <h2>Spend less time planning.<br />Start using Soma today.</h2>
            <p className="ln-cta-lead">
              Soma pulls every Canvas assignment into one place, plans your day, and writes
              you a brief each morning, so you never have to wonder what's due next.
            </p>
            <a href="/signup" className="ln-cta-btn">Get Started For Free</a>
          </div>

          <div className="ln-cta-vis">
            <DailyBrief />
          </div>
        </div>
      </div>

      <footer className="ln-foot">
        <div className="ln-foot-in">
          <div>
            <div className="ln-foot-brand">
              <img src="/favicon.png" width="24" height="24" alt="" style={{ borderRadius: 5, flexShrink: 0 }} />
              <span className="ln-foot-word">Soma</span>
            </div>
            <p className="ln-foot-copy">
              Soma turns your Canvas deadlines into a plan for the day, tracks the time you
              actually study, and keeps every course in one place.
            </p>
          </div>

          <div className="ln-foot-col">
            <p className="ln-foot-ct">Product</p>
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="/pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </div>

          <div className="ln-foot-col">
            <p className="ln-foot-ct">Legal</p>
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms &amp; Conditions</a>
            <a href="/billing">Billing</a>
            <a href="/refund">Refunds</a>
          </div>

          <div className="ln-foot-col">
            <p className="ln-foot-ct">Company</p>
            <a href="/contact">Contact Us</a>
            <a href="/ai-disclaimer">AI Disclaimer</a>
            <a href="/data-deletion">Data Deletion</a>
            <a href="/login">Log in</a>
          </div>
        </div>
        <div className="ln-foot-bottom">
          <p>© 2026 Soma. Not affiliated with Canvas, Instructure, Google, or any school.</p>
        </div>
      </footer>
    </div>
  );
}
