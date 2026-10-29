import { useEffect, useRef, useState } from 'react';
import { MONTHLY_PRICE, SEMESTER_PRICE, TRIAL_DAYS } from '../../lib/pricing';

const BRIEF_SCRIPT = [
  { kind: 'lead', text: "Here's what I'd do with the four hours you have free today." },
  { kind: 'bullet', text: 'Finish the Chemistry 210 lab report, due Tuesday' },
  { kind: 'bullet', text: 'Start the Statistics 200 problem set, due Thursday' },
  { kind: 'bullet', text: 'Block an hour for the English 102 essay, due Friday' },
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
  { name: 'UC Irvine', src: '/university-logos/uc-irvine-wordmark.svg', shape: 'wide' },
  { name: 'UC Davis', src: '/university-logos/uc-davis-wordmark.svg', shape: 'wide' },
  { name: 'Carnegie Mellon University', src: '/university-logos/carnegie-mellon.png', shape: 'mark' },
  { name: 'Georgia Tech', src: '/university-logos/georgia-tech.svg', shape: 'mark' },
  { name: 'Rutgers University', src: '/university-logos/rutgers-wordmark.svg', shape: 'wide' },
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
.ln-word { font-size: 19px; font-weight: 700; color: var(--slate-900); letter-spacing: -0.03em; }

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
/* A commitment read in from Google Calendar: neutral, never a study colour. */
.ln-blk.ext {
  background: var(--slate-100); border: 1px dashed var(--slate-300); color: var(--slate-600);
  top: 153px; height: 25px;
  flex-direction: row; align-items: center; gap: 6px;
  padding: 0 10px; font-size: 11.5px;
}

.ln-now { position: absolute; left: 56px; right: 0; height: 1.5px; background: #dc2626; top: 234px; z-index: 4; }
.ln-now::before {
  content: ''; position: absolute; left: -4px; top: -3.5px;
  width: 8px; height: 8px; border-radius: 50%; background: #dc2626;
}


/* Dashboard right rail: Ask Soma + the focus timer */
.ln-rail {
  width: 228px; flex-shrink: 0;
  border-left: 1px solid var(--slate-200);
  padding: 14px;
  display: flex; flex-direction: column; gap: 14px;
}
.ln-rail-t {
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--slate-400);
  margin-bottom: 9px;
}
.ln-ask-msg {
  font-size: 11.5px; line-height: 1.45;
  border-radius: 9px; padding: 8px 10px; margin-bottom: 7px;
}
.ln-ask-msg.me { background: var(--blue-800); color: #fff; margin-left: 28px; }
.ln-ask-msg.bot { background: var(--slate-100); color: var(--slate-700); }
.ln-prop {
  border: 1px dashed var(--blue-200);
  background: var(--blue-50);
  border-radius: 9px; padding: 9px 10px;
}
.ln-prop-blk { font-size: 11.5px; font-weight: 600; color: var(--slate-900); }
.ln-prop-blk span { display: block; font-size: 11px; font-weight: 500; color: var(--slate-500); margin-top: 1px; }
.ln-prop-acts { display: flex; gap: 6px; margin-top: 9px; }
.ln-prop-acts span {
  font-size: 10.5px; font-weight: 600;
  padding: 4px 10px; border-radius: 999px;
}
.ln-prop-acts span:first-child { background: var(--blue-800); color: #fff; }
.ln-prop-acts span:last-child { background: #fff; color: var(--slate-500); border: 1px solid var(--slate-200); }

.ln-focus-box {
  border-top: 1px solid var(--slate-200);
  padding-top: 13px;
  margin-top: auto;
}
.ln-focus-sub { font-size: 11px; color: var(--slate-500); }
.ln-focus-name { font-size: 12.5px; font-weight: 600; color: var(--slate-900); margin: 2px 0 7px; }
.ln-focus-time {
  font-size: 27px; font-weight: 600; letter-spacing: -0.03em;
  color: var(--slate-900); font-variant-numeric: tabular-nums;
}
.ln-focus-acts { display: flex; gap: 6px; margin-top: 9px; }
.ln-focus-acts span {
  font-size: 10.5px; font-weight: 600;
  padding: 4px 11px; border-radius: 7px;
  background: #fff; border: 1px solid var(--slate-200); color: var(--slate-600);
}

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

.ln-intro { max-width: 680px; }
.ln-intro .ln-lead { max-width: 620px; }

/* One place: every source wired into one list */
.ln-together { background: #fff; border-bottom: 1px solid var(--slate-200); }
.ln-tg {
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) 110px minmax(0, 1.08fr);
  align-items: center;
  margin-top: 52px;
}
.ln-srcs { display: flex; flex-direction: column; gap: 10px; }
.ln-src {
  height: 62px;
  display: flex; align-items: center; gap: 13px;
  padding: 0 15px;
  background: var(--slate-50);
  border: 1px solid var(--slate-200);
  border-radius: 11px;
}
.ln-src-ic {
  width: 32px; height: 32px; flex-shrink: 0;
  border-radius: 9px;
  display: grid; place-items: center;
}
.ln-src-ic svg { width: 16px; height: 16px; }
.ln-src-n { font-size: 14px; font-weight: 600; color: var(--slate-900); letter-spacing: -0.015em; }
.ln-src-d { font-size: 12.5px; line-height: 1.4; color: var(--slate-500); margin-top: 1px; }

.ln-wires svg { display: block; width: 100%; height: 422px; overflow: visible; }
.ln-wire {
  fill: none; stroke: var(--slate-300); stroke-width: 1.5;
  stroke-dasharray: 160; stroke-dashoffset: 160;
  transition: stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1);
}
.ln-tg.on .ln-wire { stroke-dashoffset: 0; }
.ln-wire-end { fill: var(--blue-600); }

.ln-one {
  background: #fff;
  border: 1px solid var(--slate-200);
  border-radius: 16px;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05), 0 22px 54px rgba(15, 23, 42, 0.09);
  padding: 18px 20px 8px;
}
.ln-one-hd {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--slate-200);
}
.ln-one-t { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; color: var(--slate-900); }
.ln-one-s { font-size: 12px; font-weight: 500; color: var(--slate-400); }
.ln-one-row {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--slate-100);
}
.ln-one-row:last-child { border-bottom: none; }
.ln-one-row > i { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ln-one-info { flex: 1; min-width: 0; }
.ln-one-name {
  font-size: 13.5px; font-weight: 500; color: var(--slate-900);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ln-one-meta { font-size: 12px; color: var(--slate-500); margin-top: 2px; }
.ln-one-meta b { font-weight: 600; color: var(--slate-600); }
.ln-one-due { font-size: 12px; font-weight: 500; color: var(--slate-500); flex-shrink: 0; }
.ln-one-due.hot { color: #b91c1c; }

/* Adapts: a day that reworks itself when a due date moves */
.ln-adapt-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 64px;
  align-items: center;
  margin-top: 52px;
}
.ln-ad-demo {
  background: #fff;
  border: 1px solid var(--slate-200);
  border-radius: 16px;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05), 0 22px 54px rgba(15, 23, 42, 0.09);
  padding: 18px 18px 16px;
}
.ln-ad-hd {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  font-size: 14px; font-weight: 600; color: var(--slate-900);
  margin-bottom: 12px;
}
.ln-ad-hd span:last-child { font-size: 12px; font-weight: 500; color: var(--slate-400); }
.ln-ad-toast {
  display: flex; align-items: flex-start; gap: 10px;
  font-size: 12.5px; line-height: 1.45; color: var(--slate-700);
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
  opacity: 0;
  transform: translateY(-6px);
  transition: opacity 0.4s ease, transform 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}
.ln-ad-toast b {
  display: block;
  font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: #b45309;
  margin-bottom: 1px;
}
.ln-ad-toast i {
  width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px;
  border-radius: 50%; background: #fde68a; color: #92400e;
  display: grid; place-items: center;
  font-size: 11px; font-style: normal; font-weight: 800;
}
.ln-ad-demo.p1 .ln-ad-toast, .ln-ad-demo.p2 .ln-ad-toast { opacity: 1; transform: none; }

.ln-ad-tl { position: relative; height: 290px; }
.ln-ad-row { display: flex; align-items: flex-start; height: 32px; }
.ln-ad-blk {
  position: absolute;
  left: 56px; right: 4px;
  height: 44px;
  border-radius: 7px;
  padding: 6px 10px;
  font-size: 12px; font-weight: 600;
  display: flex; flex-direction: column; gap: 1px;
  overflow: hidden;
  transition: transform 0.9s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.3s ease;
}
.ln-ad-blk span { font-size: 11px; font-weight: 500; opacity: 0.78; }
.ln-ad-blk.ch { background: var(--s2-bg); border: 1px solid var(--s2-br); color: var(--s2-tx); top: 40px; }
.ln-ad-blk.en { background: var(--s3-bg); border: 1px solid var(--s3-br); color: var(--s3-tx); top: 136px; z-index: 1; }
.ln-ad-blk.st { background: var(--s4-bg); border: 1px solid var(--s4-br); color: var(--s4-tx); top: 232px; z-index: 2; }
.ln-ad-blk.ext {
  background: var(--slate-100); border: 1px dashed var(--slate-300); color: var(--slate-600);
  top: 200px; height: 28px;
  flex-direction: row; align-items: center; gap: 6px;
  padding: 0 10px; font-size: 11.5px;
}
.ln-ad-demo.p1 .ln-ad-blk.st { box-shadow: 0 0 0 3px #fde68a; }
.ln-ad-demo.p2 .ln-ad-blk.st { transform: translateY(-96px); }
.ln-ad-demo.p2 .ln-ad-blk.en { transform: translateY(96px); }

.ln-ad-prop {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px dashed var(--blue-200);
  background: var(--blue-50);
  border-radius: 10px;
  font-size: 12.5px; line-height: 1.45; color: var(--slate-700);
  opacity: 0;
  transition: opacity 0.4s ease 0.5s;
}
.ln-ad-prop .ln-prop-acts { margin-top: 0; flex-shrink: 0; }
.ln-ad-demo.p2 .ln-ad-prop { opacity: 1; }

.ln-ad-list { display: flex; flex-direction: column; }
.ln-ad-item { padding: 18px 0; border-top: 1px solid var(--slate-200); }
.ln-ad-item:first-child { border-top: none; padding-top: 0; }
.ln-ad-item h3 { font-size: 17px; font-weight: 600; letter-spacing: -0.022em; color: var(--slate-900); margin: 0 0 5px; }
.ln-ad-item p { font-size: 15px; line-height: 1.6; color: var(--slate-600); margin: 0; max-width: 460px; }

/* Morning brief, Plan it and Grades visuals */
.ln-vis-hd {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  margin-bottom: 14px;
}
.ln-vis-t { font-size: 14.5px; font-weight: 700; letter-spacing: -0.02em; color: var(--slate-900); }
.ln-vis-s { font-size: 12px; color: var(--slate-500); }
.ln-bf-g {
  font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
  color: var(--slate-400);
  margin: 12px 0 2px;
}
.ln-bf-g:first-of-type { margin-top: 0; }
.ln-vis-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid var(--slate-100);
  font-size: 12.5px; color: var(--slate-500);
}
.ln-vis-foot strong { color: var(--slate-900); font-weight: 600; }
.ln-vis-btn {
  font-size: 11.5px; font-weight: 600;
  color: #fff; background: var(--blue-800);
  border-radius: 999px; padding: 5px 12px;
  flex-shrink: 0;
}
.ln-assign .ln-done {
  width: 17px; height: 17px; flex-shrink: 0;
  border-radius: 50%;
  display: grid; place-items: center;
  font-size: 10px; font-style: normal; font-weight: 700;
  border: 1.5px solid var(--slate-300); color: transparent;
}
.ln-assign .ln-done.on { background: #dcfce7; border-color: #86efac; color: #15803d; }
.ln-grade-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.ln-grade-big { font-size: 40px; font-weight: 700; letter-spacing: -0.04em; line-height: 1; color: var(--slate-900); text-align: right; }
.ln-grade-big span { display: block; font-size: 13px; font-weight: 500; letter-spacing: 0; color: var(--slate-500); margin-top: 6px; }
.ln-bars.wide .ln-bar-l { width: 112px; }
.ln-bars.wide .ln-bar-v { width: 52px; }

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
.ln-foot-word { font-size: 17px; font-weight: 700; letter-spacing: -0.03em; color: var(--slate-900); }
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
  .ln-side, .ln-rail { display: none; }
  .ln-sec { padding: 60px 20px; }
  .ln-steps { grid-template-columns: 1fr; gap: 14px; margin-top: 34px; }
  .ln-tg { grid-template-columns: 1fr; gap: 28px; margin-top: 34px; }
  .ln-wires { display: none; }
  .ln-srcs { display: grid; grid-template-columns: 1fr 1fr; }
  .ln-src { height: auto; padding: 12px 14px; align-items: flex-start; }
  .ln-adapt-grid { grid-template-columns: 1fr; gap: 36px; margin-top: 34px; }
  .ln-ad-item p { max-width: 100%; }
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
  .ln-srcs { grid-template-columns: 1fr; }
  .ln-ad-prop { flex-direction: column; align-items: flex-start; }
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

function AskSomaPanel() {
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
        <span className="ln-brief-add">Edit plan</span>
      </div>

      <div className="ln-brief">
        <div className="ln-brief-hd">
          ASK SOMA
          <span className="ln-brief-gen">{done ? 'Awaiting your approval' : 'Thinking…'}</span>
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
          <i style={{ background: c.color }} />{c.name}<em>{c.time}</em><b>today</b>
        </div>
      ))}
    </div>
  );
}

const ICON_PATHS = {
  list: 'M3 4h10M3 8h10M3 12h6',
  doc: 'M4 1.5h5.5L12.5 4.5v10h-8.5zM9.5 1.5v3h3M6.5 8h4M6.5 11h4',
  link: 'M6.5 9.5l3-3M5 7.5L3.8 8.7a2.3 2.3 0 003.2 3.3L8.3 10.8M11 8.5l1.2-1.2A2.3 2.3 0 009 4L7.7 5.2',
  table: 'M2 3h12v10H2zM2 6.5h12M2 10h12M6.5 3v10',
  cal: 'M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3',
  check: 'M2.5 8.5l3.5 3.5 7.5-8',
} as const;

// Where a student's semester actually lives. The store extension reads Canvas
// only, so Gradescope comes in by paste or spreadsheet, never "synced".
const SOURCES = [
  { name: 'Canvas', desc: 'Assignments, due dates, grades and announcements', icon: 'list', color: '#2563eb', bg: '#eff6ff' },
  { name: 'Your syllabi', desc: 'Exam dates and grading weights, read from the PDF', icon: 'doc', color: '#b45309', bg: '#fffbeb' },
  { name: 'Course websites', desc: 'Paste the schedule page and Soma finds the deadlines', icon: 'link', color: '#0f766e', bg: '#f0fdfa' },
  { name: 'Gradescope scores', desc: 'Paste the table or import a spreadsheet', icon: 'table', color: '#6d28d9', bg: '#f5f3ff' },
  { name: 'Google Calendar', desc: 'Lectures, shifts and office hours, read-only', icon: 'cal', color: '#475569', bg: '#f1f5f9' },
  { name: 'Your own to-dos', desc: 'Anything else, typed in or said out loud', icon: 'check', color: '#15803d', bg: '#f0fdf4' },
] as const;

const SOURCE_ROW = 62;
const SOURCE_GAP = 10;
const WIRES_H = SOURCES.length * SOURCE_ROW + (SOURCES.length - 1) * SOURCE_GAP;

const ONE_LIST = [
  { c: '#8b5cf6', n: 'Problem set 5', course: 'Statistics 200', src: 'Canvas', d: 'Due Wed', hot: true },
  { c: '#f59e0b', n: 'Midterm 2', course: 'Chemistry 210', src: 'from the syllabus', d: 'Thu', hot: false },
  { c: '#14b8a6', n: 'Project 3 checkpoint', course: 'Intro to CS', src: 'course website', d: 'Thu', hot: false },
  { c: '#2563eb', n: 'Lab 4 scored 18 / 20', course: 'Physics 151', src: 'Gradescope', d: '90.00%', hot: false },
  { c: '#94a3b8', n: 'Office hours', course: 'Statistics 200', src: 'Google Calendar', d: 'Fri 2 PM', hot: false },
  { c: '#22c55e', n: 'Email advisor about spring classes', course: 'To-do', src: 'added by you', d: 'Fri', hot: false },
] as const;

function SourceIcon({ path, color }: { path: string; color: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

// 0: the plan as made. 1: Canvas moves a due date. 2: Soma suggests the swap.
function AdaptDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase(2);
      return;
    }

    let timers: number[] = [];
    const stop = () => { timers.forEach(clearTimeout); timers = []; };
    const run = () => {
      timers = [];
      setPhase(0);
      timers.push(window.setTimeout(() => setPhase(1), 1600));
      timers.push(window.setTimeout(() => setPhase(2), 3400));
      timers.push(window.setTimeout(run, 9000));
    };

    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (!timers.length) run();
      } else {
        stop();
        setPhase(0);
      }
    }, { threshold: 0.35 });

    io.observe(el);
    return () => { io.disconnect(); stop(); };
  }, []);

  const moved = phase === 2;

  return (
    <div className={`ln-ad-demo p${phase}`} ref={ref}>
      <div className="ln-ad-hd"><span>Tuesday, October 13</span><span>Today's plan</span></div>

      <div className="ln-ad-toast">
        <i>!</i>
        <div><b>What changed</b>Statistics 200 · Problem set 5 is now due tomorrow, not Friday</div>
      </div>

      <div className="ln-ad-tl">
        {['9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM'].map(h => (
          <div className="ln-ad-row" key={h}>
            <span className="ln-row-lbl">{h}</span>
            <span className="ln-row-line" />
          </div>
        ))}
        <div className="ln-ad-blk ch">Chemistry 210<span>10:00 - 11:30 AM · Lab report</span></div>
        <div className="ln-ad-blk en">English 102<span>{moved ? '4:00 - 5:15 PM' : '1:00 - 2:15 PM'} · Essay draft</span></div>
        <div className="ln-ad-blk ext">Lecture<span>3:00 - 4:00 PM · Google Calendar</span></div>
        <div className="ln-ad-blk st">Statistics 200<span>{moved ? '1:00 - 2:15 PM' : '4:00 - 5:15 PM'} · Problem set 5</span></div>
      </div>

      <div className="ln-ad-prop">
        <span>Problem set 5 moves up. The essay goes after lecture.</span>
        <div className="ln-prop-acts"><span>Accept</span><span>Dismiss</span></div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Study Planner for Canvas Students | Soma';
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
        if (target.classList.contains('ln-tg')) target.classList.add('on');
        target.querySelector('.ln-donut-arc')?.classList.add('on');
        target.querySelectorAll('.ln-bar').forEach((bar, i) => {
          setTimeout(() => bar.classList.add('on'), i * 100 + 200);
        });

        io.unobserve(target);
      });
    }, { threshold: 0.3 });

    root.querySelectorAll('.ln-feat-vis, .ln-tg').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="landing-root" ref={rootRef}>
      <style>{LANDING_CSS}</style>

      <nav className="ln-nav">
        <a href="/" className="ln-brand">
          <span className="ln-word">soma</span>
        </a>
        <div className="ln-nav-links">
          <a href="#together">One place</a>
          <a href="#adapts">Adapts to you</a>
          <a href="#features">Features</a>
          <a href="/pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </div>
        <div className="ln-nav-right">
          <a href="/login" className="ln-login">Log in</a>
          <a href="/signup" className="ln-btn sm">Get started</a>
        </div>
      </nav>

      <header className="ln-hero">
        <div className="ln-hero-inner">
          <h1>Your whole semester, in one plan</h1>
          <p className="ln-hero-sub">
            Soma brings Canvas, your syllabi, course websites, grades and calendar into one
            place, then builds a study plan that adapts as your week changes.
          </p>
          <div className="ln-hero-actions">
            <a href="/signup" className="ln-btn lg">Get started for free</a>
            <a href="#how" className="ln-btn-quiet">See how it works</a>
          </div>
          <p className="ln-hero-note">Free to use. No credit card required.</p>

          <div className="ln-shot">
            <div className="ln-shot-bar">
              <span className="ln-dot" /><span className="ln-dot" /><span className="ln-dot" />
              <span className="ln-shot-title">soma</span>
            </div>
            <div className="ln-shot-body">
              <aside className="ln-side">
                <div className="ln-side-item on"><span className="ln-side-ic" />Dashboard</div>
                <div className="ln-side-item"><span className="ln-side-ic" />Deadlines</div>
                <div className="ln-side-item"><span className="ln-side-ic" />Grades</div>
                <div className="ln-side-item"><span className="ln-side-ic" />Documents</div>
                <div className="ln-side-item"><span className="ln-side-ic" />Calendar</div>
                <div className="ln-side-item"><span className="ln-side-ic" />AI</div>
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
                    <div className="ln-blk ext">Office hours<span>12:30 - 1:00 PM · Google Calendar</span></div>
                    <div className="ln-blk b3">English Literature<span>1:15 - 2:00 PM · Essay draft</span></div>
                    <div className="ln-blk b4">AP US History<span>3:00 - 3:45 PM · DBQ practice</span></div>
                    <div className="ln-now" />
                  </div>
                </div>
                <aside className="ln-rail">
                  <div>
                    <div className="ln-rail-t">Ask Soma</div>
                    <div className="ln-ask-msg me">Move chem to after office hours</div>
                    <div className="ln-ask-msg bot">Moved it to 1:00. Here's the change:</div>
                    <div className="ln-prop">
                      <div className="ln-prop-blk">Lab report<span>AP Chemistry · 1:00 - 1:45 PM</span></div>
                      <div className="ln-prop-acts"><span>Accept</span><span>Dismiss</span></div>
                    </div>
                  </div>
                  <div className="ln-focus-box">
                    <div className="ln-rail-t">Focus</div>
                    <div className="ln-focus-sub">AP Calculus BC</div>
                    <div className="ln-focus-name">Problem set 6</div>
                    <div className="ln-focus-time">24:08</div>
                    <div className="ln-focus-acts"><span>Pause</span><span>Stop</span></div>
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

      <section className="ln-together" id="together">
        <div className="ln-sec">
          <div className="ln-intro">
            <h2 className="ln-h2">Every class, wherever it lives</h2>
            <p className="ln-lead">
              Canvas has part of it. The exam dates are in a syllabus PDF, one class runs its own
              website, and the scores are on Gradescope. Soma pulls all of it into one list, so
              you stop checking six places to find out what's due.
            </p>
          </div>

          <div className="ln-tg">
            <div className="ln-srcs">
              {SOURCES.map(s => (
                <div className="ln-src" key={s.name}>
                  <span className="ln-src-ic" style={{ background: s.bg }}>
                    <SourceIcon path={ICON_PATHS[s.icon]} color={s.color} />
                  </span>
                  <div>
                    <div className="ln-src-n">{s.name}</div>
                    <div className="ln-src-d">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="ln-wires" aria-hidden="true">
              <svg viewBox={`0 0 110 ${WIRES_H}`} preserveAspectRatio="none">
                {SOURCES.map((s, i) => {
                  const y = SOURCE_ROW / 2 + i * (SOURCE_ROW + SOURCE_GAP);
                  const mid = WIRES_H / 2;
                  return (
                    <path
                      key={s.name}
                      className="ln-wire"
                      d={`M0 ${y} C55 ${y}, 55 ${mid}, 110 ${mid}`}
                      style={{ transitionDelay: `${i * 90}ms` }}
                    />
                  );
                })}
                <circle className="ln-wire-end" cx="108" cy={WIRES_H / 2} r="4" />
              </svg>
            </div>

            <div className="ln-one">
              <div className="ln-one-hd">
                <span className="ln-one-t">This week</span>
                <span className="ln-one-s">One list in Soma</span>
              </div>
              {ONE_LIST.map(r => (
                <div className="ln-one-row" key={r.n}>
                  <i style={{ background: r.c }} />
                  <div className="ln-one-info">
                    <div className="ln-one-name">{r.n}</div>
                    <div className="ln-one-meta">{r.course} · <b>{r.src}</b></div>
                  </div>
                  <div className={`ln-one-due${r.hot ? ' hot' : ''}`}>{r.d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="adapts">
        <div className="ln-sec">
          <div className="ln-intro">
            <h2 className="ln-h2">A plan that adapts to you</h2>
            <p className="ln-lead">
              Soma doesn't hand you a schedule and walk away. It plans around your real week,
              learns how long things take you, and reworks the day when something changes.
              Nothing moves until you accept it.
            </p>
          </div>

          <div className="ln-adapt-grid">
            <AdaptDemo />
            <div className="ln-ad-list">
              <div className="ln-ad-item">
                <h3>Notices when things change</h3>
                <p>A due date moves, new work shows up, a grade posts. Soma sees it on the next Canvas sync and puts it in front of you.</p>
              </div>
              <div className="ln-ad-item">
                <h3>Learns your pace</h3>
                <p>Time estimates come from the sessions you log. If lab reports take you two hours, they get two hours.</p>
              </div>
              <div className="ln-ad-item">
                <h3>Works around your week</h3>
                <p>Lectures, shifts and office hours stay put, and times you choose stay where you put them. Study fills the gaps.</p>
              </div>
              <div className="ln-ad-item">
                <h3>Knows what counts more</h3>
                <p>A midterm worth 30% gets more room than a quiz worth 2%, even when the quiz is due first.</p>
              </div>
              <div className="ln-ad-item">
                <h3>Picks up what slipped</h3>
                <p>Blocks you didn't get to yesterday show up in this morning's brief, ready to fit back in.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how" style={{ background: '#fff', borderTop: '1px solid #e2e8f0' }}>
        <div className="ln-sec">
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
                  Add the Soma for Canvas extension and open Canvas once. Assignments, due dates
                  and grades come in on their own and stay in sync. Add syllabi and course sites
                  whenever you like.
                </p>
                <p className="ln-step-note">Read-only. It never sees your Canvas password.</p>
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
                  One message builds the whole day around your classes and deadlines. A big
                  assignment gets split into sittings that finish before it's due.
                </p>
                <p className="ln-step-note">Every change arrives as a proposal you accept or dismiss.</p>
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
                  <h3 className="ln-step-t">Focus, and the plan learns</h3>
                </div>
                <p className="ln-step-b">
                  Hit Focus on a block and Soma times it against that course. Every session
                  brings the next plan closer to how you actually work.
                </p>
                <p className="ln-step-note">Forgot to start it? Add the time afterwards.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" style={{ borderTop: '1px solid #e2e8f0' }}>
        <div className="ln-sec">
          <h2 className="ln-h2">Built for the whole semester</h2>

          <div className="ln-feat">
            <div className="ln-feat-text">
              <h3 className="ln-feat-t">A brief every morning</h3>
              <p className="ln-feat-b">
                Open Soma and the top of the day says what's due today and tomorrow, what changed
                overnight, and what you didn't get to yesterday. One tap on Plan my day turns it
                into a schedule.
              </p>
            </div>
            <div className="ln-feat-vis">
              <div className="ln-vis-hd">
                <span className="ln-vis-t">Wednesday, October 14</span>
                <span className="ln-vis-s">Morning brief</span>
              </div>
              <div className="ln-assigns">
                <div className="ln-bf-g">Due today</div>
                <div className="ln-assign" data-d="0">
                  <i className="ln-adot" style={{ background: '#8b5cf6' }} />
                  <div className="ln-ainfo"><div className="ln-aname">Problem set 5</div><div className="ln-acourse">Statistics 200</div></div>
                  <div className="ln-adue hot">11:59 PM</div>
                </div>
                <div className="ln-bf-g">What changed</div>
                <div className="ln-assign" data-d="130">
                  <i className="ln-adot" style={{ background: '#f59e0b' }} />
                  <div className="ln-ainfo"><div className="ln-aname">Lab 3 graded: 46 / 50</div><div className="ln-acourse">Chemistry 210</div></div>
                  <div className="ln-adue">Last night</div>
                </div>
                <div className="ln-bf-g">Left from yesterday</div>
                <div className="ln-assign" data-d="260">
                  <i className="ln-adot" style={{ background: '#14b8a6' }} />
                  <div className="ln-ainfo"><div className="ln-aname">Essay draft</div><div className="ln-acourse">English 102</div></div>
                  <div className="ln-adue">1h 15m</div>
                </div>
              </div>
              <div className="ln-vis-foot">
                <span>3 things need you today</span>
                <span className="ln-vis-btn">Plan my day</span>
              </div>
            </div>
          </div>

          <div className="ln-feat">
            <div className="ln-feat-text">
              <h3 className="ln-feat-t">Big assignments, broken into sittings</h3>
              <p className="ln-feat-b">
                Press Plan it on anything due. Soma guesses how long it'll take from your past work
                in that class, splits it into sittings, and finds open time for each one before the
                due date.
              </p>
            </div>
            <div className="ln-feat-vis">
              <div className="ln-vis-hd">
                <span className="ln-vis-t">Essay 2: Final draft</span>
                <span className="ln-vis-s">English 102 · Due Fri</span>
              </div>
              <div className="ln-assigns">
                {[
                  { n: 'Essay 2 · 1 of 3', s: 'Tue, 4:00 PM · 50 min', done: true },
                  { n: 'Essay 2 · 2 of 3', s: 'Wed, 7:00 PM · 50 min', done: false },
                  { n: 'Essay 2 · 3 of 3', s: 'Thu, 3:00 PM · 50 min', done: false },
                ].map((r, i) => (
                  <div className="ln-assign" data-d={i * 130} key={r.n}>
                    <i className={`ln-done${r.done ? ' on' : ''}`}>✓</i>
                    <div className="ln-ainfo"><div className="ln-aname">{r.n}</div><div className="ln-acourse">{r.s}</div></div>
                  </div>
                ))}
              </div>
              <div className="ln-vis-foot">
                <span><strong>1 of 3</strong> sittings done · 50 min logged</span>
                <span>About 2h 30m in all</span>
              </div>
            </div>
          </div>

          <div className="ln-feat">
            <div className="ln-feat-text">
              <h3 className="ln-feat-t">Your real grade in every class</h3>
              <p className="ln-feat-b">
                Soma reads the grading section of your syllabus and weighs every score the way it
                says: Canvas grades, Gradescope scores you paste in, and anything you type yourself.
                One honest number per course.
              </p>
            </div>
            <div className="ln-feat-vis">
              <div className="ln-grade-top">
                <div>
                  <div className="ln-vis-t">Chemistry 210</div>
                  <div className="ln-vis-s">Weighted the way the syllabus says</div>
                </div>
                <div className="ln-grade-big">B+<span>88.73%</span></div>
              </div>
              <div className="ln-bars wide">
                {[
                  { l: 'Homework · 20%', w: '95%', c: '#f59e0b', v: '95.00%' },
                  { l: 'Labs · 25%', w: '91.2%', c: '#f59e0b', v: '91.20%' },
                  { l: 'Midterms · 30%', w: '82.5%', c: '#f59e0b', v: '82.50%' },
                  { l: 'Final · 25%', w: '0%', c: '#f59e0b', v: 'Not yet' },
                ].map(b => (
                  <div className="ln-bar" key={b.l}>
                    <span className="ln-bar-l">{b.l}</span>
                    <div className="ln-bar-t"><div className="ln-bar-f" style={{ width: b.w, background: b.c }} /></div>
                    <span className="ln-bar-v">{b.v}</span>
                  </div>
                ))}
              </div>
              <div className="ln-vis-foot">
                <span>75% of the grade so far</span>
                <span>2 scores from Gradescope</span>
              </div>
            </div>
          </div>

          <div className="ln-feat">
            <div className="ln-feat-text">
              <h3 className="ln-feat-t">A focus timer that keeps your real hours</h3>
              <p className="ln-feat-b">
                Start a block and the timer runs against that subject, surviving a reload or a
                closed tab. Logged a session wrong, or studied without starting it? Correct the
                minutes or add them by hand.
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
          <h2 className="ln-h2">Questions students ask</h2>
          <div className="ln-faq-grid">
            {[
              ['Is Soma free?', `The core features (your dashboard, Canvas sync, calendar, the focus timer, documents, and insights) are free forever. The AI features have a ${TRIAL_DAYS}-day free trial, then ${MONTHLY_PRICE} a month or ${SEMESTER_PRICE} every 4 months. Signing up takes no card; starting the trial does.`],
              ["Does it work with my school's Canvas?", 'Yes. Soma works with any school that uses Canvas LMS. Add the Soma for Canvas extension and your assignments sync automatically.'],
              ['What about Gradescope, or a class that is not on Canvas?', "Paste the course site's schedule page and Soma reads the dated homework, labs, projects and exams off it, then asks which ones to add. For Gradescope or any other gradebook, paste the scores table or import a spreadsheet, and the scores count toward that course's grade."],
              ['How does the plan adapt?', "It plans around your classes and anything on Google Calendar, keeps the times you choose, and estimates how long work takes from the sessions you have logged. When Canvas moves a due date, adds work or posts a grade, Soma notices, and one message reworks the day. Every change is a suggestion you accept."],
              ['Can I use it in high school?', 'Yes. Soma is built for both high school and college, including AP classes, honors courses, and anything else running on Canvas.'],
              ['Will Soma do my homework?', "No. Soma organizes: what to work on, when, for how long, and what is done. It doesn't write answers, notes, summaries or practice questions."],
              ['What does the AI actually do?', "It reads your deadlines, your free hours and what is already on your plan, then builds or rearranges your day. It can add, move, rename and remove blocks, and it remembers lasting facts about how you work. Every change is a proposal you accept or dismiss before anything is saved."],
              ['Do I need a Google account?', 'Only if you want your lectures, shifts and office hours on the plan. Google Calendar access is read-only and optional, and scheduling, the timer and Canvas sync all work without it.'],
              ['Is my study time tracked for me?', "Not silently. You press Focus on a block and Soma times that session against the subject; the timer survives a reload or a closed tab. If you studied without starting it, or left it running overnight, you can add or correct the minutes afterwards."],
              ['Is my data private?', "Soma reads the sources you connect: Canvas through the extension, any Google Calendar you link, and the documents you upload. Nothing else. Your study data is stored securely and never shared with third parties, and deleting your account deletes it."],
              ['Is connecting Canvas safe?', "The extension only reads Canvas in your own browser, with your own sign-in. It never sees your password, never changes anything in Canvas, and you can remove what it synced from Soma's settings at any time."],
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
            <h2>Everything in one place.<br />A plan that keeps up.</h2>
            <p className="ln-cta-lead">
              Canvas, syllabi, course sites, grades and your calendar in one list, and a plan
              built from it that changes when your week does. Set it up in two minutes.
            </p>
            <a href="/signup" className="ln-cta-btn">Get Started For Free</a>
          </div>

          <div className="ln-cta-vis">
            <AskSomaPanel />
          </div>
        </div>
      </div>

      <footer className="ln-foot">
        <div className="ln-foot-in">
          <div>
            <div className="ln-foot-brand">
              <span className="ln-foot-word">soma</span>
            </div>
            <p className="ln-foot-copy">
              Soma brings every class into one place and turns it into a study plan that
              adapts to how you actually work.
            </p>
          </div>

          <div className="ln-foot-col">
            <p className="ln-foot-ct">Product</p>
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="/pricing">Pricing</a>
            <a href="#faq">FAQ</a>
            <a href="/blog">Blog</a>
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
