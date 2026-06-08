// Boss system — turns real Canvas deadlines into game bosses you defeat with
// focus time. Fully local (localStorage), no AI, no backend. Same persistence
// pattern as flashcards.ts / quizzes.ts.
//
// A boss's *spec* (name, hp, tier, theme, phases) is derived deterministically
// from its Canvas assignment, so it never needs to be stored. Only the mutable
// *progress* (damage dealt, days fought, slain status) is persisted, keyed by
// the assignment id.

import { CanvasAssignment } from '../types';

export type BossTheme =
  | 'math' | 'chemistry' | 'biology' | 'history'
  | 'english' | 'physics' | 'cs' | 'language' | 'general';

export type BossTier = 'minion' | 'elite' | 'archboss';

export type BossOutcome = 'flawless' | 'clutch' | 'reclaimed' | 'cleared';

export interface BossPhase {
  title: string;
  hp: number;
}

export interface BossSpec {
  id: number;            // Canvas assignment id
  name: string;          // roster name, e.g. "The Catalyst"
  assignmentName: string;
  course: string;
  theme: BossTheme;
  tier: BossTier;
  hp: number;            // total, in focus minutes
  dueAt: string;
  htmlUrl: string;
  phases: BossPhase[];   // archboss only, else []
}

export interface BossProgress {
  damage: number;            // focus minutes dealt (already multiplier-adjusted)
  foughtDays: string[];      // distinct 'YYYY-MM-DD' the boss was struck
  status: 'active' | 'slain';
  outcome?: BossOutcome;
  slainAt?: string;          // ISO
}

export interface Boss extends BossSpec {
  progress: BossProgress;
  hpRemaining: number;
  pct: number;               // hpRemaining / hp, 0..1
  overdue: boolean;          // due date passed and still active
  daysUntilDue: number;      // can be negative
}

export interface StrikeResult {
  damage: number;            // adjusted damage applied this strike
  rawMinutes: number;
  earlyMultiplier: number;
  spacingMultiplier: number;
  slain: boolean;
  outcome?: BossOutcome;
  hpRemaining: number;
}

// ── Persistence ────────────────────────────────────────────────────────────

const KEY = 'soma_boss_progress';
export const BOSSES_EVENT = 'soma_bosses_updated';

type ProgressMap = Record<string, BossProgress>;

function loadProgressMap(): ProgressMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persist(map: ProgressMap): void {
  localStorage.setItem(KEY, JSON.stringify(map));
  window.dispatchEvent(new Event(BOSSES_EVENT));
}

function blankProgress(): BossProgress {
  return { damage: 0, foughtDays: [], status: 'active' };
}

// ── Classification (no AI — keyword heuristics) ──────────────────────────────

const THEME_KEYWORDS: [BossTheme, RegExp][] = [
  ['math',       /\b(math|algebra|calculus|geometry|trig|statistic|precalc|number theory)\b/i],
  ['chemistry',  /\b(chem|chemistry|organic|biochem)\b/i],
  ['biology',    /\b(bio|biology|anatomy|physiology|genetics|ecology)\b/i],
  ['physics',    /\b(physics|mechanics|kinematics|thermodynamic|electromagnet)\b/i],
  ['cs',         /\b(computer|cs|programming|coding|software|data structure|algorithm)\b/i],
  ['history',    /\b(history|hist|civics|government|economics|geography|social studies)\b/i],
  ['english',    /\b(english|literature|writing|composition|rhetoric|language arts|lang arts)\b/i],
  ['language',   /\b(spanish|french|german|latin|chinese|japanese|mandarin|italian|korean)\b/i],
];

const THEME_NAME: Record<BossTheme, string> = {
  math: 'The Theorem',
  chemistry: 'The Catalyst',
  biology: 'The Organism',
  history: 'The Chronicle',
  english: 'The Manuscript',
  physics: 'The Constant',
  cs: 'The Stack',
  language: 'The Babel',
  general: 'The Deadline',
};

function themeFor(course: string, name: string): BossTheme {
  const hay = `${course} ${name}`;
  for (const [theme, re] of THEME_KEYWORDS) {
    if (re.test(hay)) return theme;
  }
  return 'general';
}

function round30(n: number): number {
  return Math.max(30, Math.round(n / 30) * 30);
}

function classify(name: string): { tier: BossTier; hp: number } {
  const n = name.toLowerCase();

  // Arch-boss: finals and cumulative exams.
  if (/\b(final|cumulative|capstone)\b/.test(n)) {
    return { tier: 'archboss', hp: /cumulative/.test(n) ? 600 : 540 };
  }

  // Elite: midterms, exams, essays, projects, labs, problem sets.
  if (/\b(midterm|exam|test|essay|paper|project|research)\b/.test(n)) {
    const big = /\b(essay|paper|project|research|midterm)\b/.test(n);
    return { tier: 'elite', hp: round30(big ? 300 : 240) };
  }
  if (/\b(lab|problem set|pset|assignment)\b/.test(n)) {
    return { tier: 'elite', hp: round30(150) };
  }

  // Minion: quizzes, readings, homework, discussions.
  if (/\b(quiz)\b/.test(n)) return { tier: 'minion', hp: 60 };
  if (/\b(read|reading|chapter)\b/.test(n)) return { tier: 'minion', hp: 45 };
  if (/\b(discussion|post|response|journal)\b/.test(n)) return { tier: 'minion', hp: 30 };

  // Default: a standard homework-sized minion.
  return { tier: 'minion', hp: 60 };
}

function phasesFor(tier: BossTier, hp: number): BossPhase[] {
  if (tier !== 'archboss') return [];
  const each = round30(hp / 3);
  return [
    { title: 'Review the units', hp: each },
    { title: 'Drill the hard parts', hp: each },
    { title: 'Master and mock-test', hp: hp - each * 2 },
  ];
}

export function specForAssignment(a: CanvasAssignment): BossSpec {
  const theme = themeFor(a.courseName, a.name);
  const { tier, hp } = classify(a.name);
  return {
    id: a.id,
    name: THEME_NAME[theme],
    assignmentName: a.name,
    course: a.courseName,
    theme,
    tier,
    hp,
    dueAt: a.dueAt,
    htmlUrl: a.htmlUrl,
    phases: phasesFor(tier, hp),
  };
}

// ── Damage model (game math lives here, deterministic) ───────────────────────

function localDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysUntil(dueAt: string, now = new Date()): number {
  const due = new Date(dueAt).getTime();
  // Round so "due in 3 days" and "overdue 1d" read intuitively in both directions.
  return Math.round((due - now.getTime()) / 86_400_000);
}

/** Reward starting early. Cramming the day before deals weak "panic damage". */
export function earlyMultiplier(daysLeft: number): number {
  if (daysLeft > 5) return 1.5;
  if (daysLeft >= 2) return 1.2;
  return 1.0; // last 48h or overdue: full base, no bonus
}

/** Reward distributed practice: more separate study days = harder hits. */
export function spacingMultiplier(distinctDays: number): number {
  return Math.min(1.5, 1 + 0.1 * Math.max(0, distinctDays - 1));
}

// ── Public read API ──────────────────────────────────────────────────────────

const STALE_AFTER_DAYS = 21; // drop bosses long past due unless still being fought

function toBoss(spec: BossSpec, progress: BossProgress, now: Date): Boss {
  const hpRemaining = Math.max(0, spec.hp - progress.damage);
  const dLeft = daysUntil(spec.dueAt, now);
  return {
    ...spec,
    progress,
    hpRemaining,
    pct: spec.hp > 0 ? hpRemaining / spec.hp : 0,
    overdue: dLeft < 0 && progress.status === 'active',
    daysUntilDue: dLeft,
  };
}

/** All bosses derived from the given assignments, merged with saved progress. */
export function getBosses(assignments: CanvasAssignment[], now = new Date()): Boss[] {
  const map = loadProgressMap();
  const out: Boss[] = [];
  for (const a of assignments) {
    if (!a.dueAt) continue;
    const dLeft = daysUntil(a.dueAt, now);
    const prog = map[String(a.id)] ?? blankProgress();
    // Skip very old, untouched, never-engaged bosses to avoid a huge backlog.
    if (dLeft < -STALE_AFTER_DAYS && prog.status !== 'slain' && prog.damage === 0) continue;
    out.push(toBoss(specForAssignment(a), prog, now));
  }
  return out;
}

export function getActiveBosses(assignments: CanvasAssignment[], now = new Date()): Boss[] {
  return getBosses(assignments, now)
    .filter(b => b.progress.status === 'active')
    .sort((a, b) => {
      // Urgency: soonest due first, then most health (biggest threat).
      const ad = new Date(a.dueAt).getTime();
      const bd = new Date(b.dueAt).getTime();
      if (ad !== bd) return ad - bd;
      return b.hpRemaining - a.hpRemaining;
    });
}

export function getSlainBosses(assignments: CanvasAssignment[], now = new Date()): Boss[] {
  return getBosses(assignments, now)
    .filter(b => b.progress.status === 'slain')
    .sort((a, b) => new Date(b.progress.slainAt || 0).getTime() - new Date(a.progress.slainAt || 0).getTime());
}

// ── Mutations ────────────────────────────────────────────────────────────────

function decideOutcome(spec: BossSpec, now: Date): BossOutcome {
  const dLeft = daysUntil(spec.dueAt, now);
  if (dLeft < 0) return 'reclaimed';
  if (dLeft >= 2) return 'flawless';
  return 'clutch';
}

/** Apply a focus session to a boss. Returns the computed result. */
export function strikeBoss(boss: Boss, minutes: number, now = new Date()): StrikeResult {
  const map = loadProgressMap();
  const key = String(boss.id);
  const prog: BossProgress = map[key] ? { ...map[key] } : blankProgress();

  const today = localDayKey(now);
  const foughtDays = prog.foughtDays.includes(today)
    ? prog.foughtDays
    : [...prog.foughtDays, today];

  const early = earlyMultiplier(daysUntil(boss.dueAt, now));
  const spacing = spacingMultiplier(foughtDays.length);
  const damage = Math.max(1, Math.round(minutes * early * spacing));

  const newDamage = prog.damage + damage;
  const hpRemaining = Math.max(0, boss.hp - newDamage);
  const slain = hpRemaining <= 0;

  const updated: BossProgress = {
    damage: newDamage,
    foughtDays,
    status: slain ? 'slain' : 'active',
    outcome: slain ? decideOutcome(boss, now) : prog.outcome,
    slainAt: slain ? now.toISOString() : prog.slainAt,
  };
  map[key] = updated;
  persist(map);

  return {
    damage,
    rawMinutes: minutes,
    earlyMultiplier: early,
    spacingMultiplier: spacing,
    slain,
    outcome: updated.outcome,
    hpRemaining,
  };
}

/** Mark a boss as defeated by hand (Canvas iCal cannot detect submissions). */
export function markSlain(boss: Boss, now = new Date()): void {
  const map = loadProgressMap();
  const key = String(boss.id);
  const prev = map[key] ?? blankProgress();
  map[key] = {
    ...prev,
    damage: boss.hp,
    status: 'slain',
    outcome: 'cleared',
    slainAt: now.toISOString(),
  };
  persist(map);
}

/** Send a slain boss back to active (undo). */
export function reviveBoss(bossId: number): void {
  const map = loadProgressMap();
  const key = String(bossId);
  const prev = map[key];
  if (!prev) return;
  map[key] = { ...prev, status: 'active', outcome: undefined, slainAt: undefined };
  persist(map);
}

/** Forget a boss's progress entirely. */
export function resetBoss(bossId: number): void {
  const map = loadProgressMap();
  delete map[String(bossId)];
  persist(map);
}

export function clearAllBossProgress(): void {
  persist({});
}

// ── Player stats / rank ──────────────────────────────────────────────────────

export interface BossStats {
  slain: number;
  flawless: number;
  active: number;
  rank: string;
  nextRankAt: number | null;
}

const RANKS: [number, string][] = [
  [0, 'Novice'],
  [3, 'Fighter'],
  [8, 'Slayer'],
  [16, 'Boss Hunter'],
  [30, 'Legend'],
];

export function bossStats(bosses: Boss[]): BossStats {
  const slainBosses = bosses.filter(b => b.progress.status === 'slain');
  const slain = slainBosses.length;
  const flawless = slainBosses.filter(b => b.progress.outcome === 'flawless').length;
  const active = bosses.filter(b => b.progress.status === 'active').length;

  let rank = RANKS[0][1];
  let nextRankAt: number | null = null;
  for (let i = 0; i < RANKS.length; i++) {
    if (slain >= RANKS[i][0]) {
      rank = RANKS[i][1];
      nextRankAt = i + 1 < RANKS.length ? RANKS[i + 1][0] : null;
    }
  }
  return { slain, flawless, active, rank, nextRankAt };
}

// ── Static banter (no AI) ────────────────────────────────────────────────────

export type BanterTrigger =
  | 'spawn' | 'half' | 'near_death'
  | 'slain_early' | 'slain_clutch' | 'reclaimed' | 'cleared'
  | 'enraged';

const BANTER: Record<BanterTrigger, string[]> = {
  spawn: [
    'I have your deadline. Come take it back.',
    'Another challenger. Let us see your focus.',
    'I grow stronger the longer you wait.',
  ],
  half: [
    'Halfway. Do not slow down now.',
    'You are wearing me down. Keep going.',
    'Impressive. But I am not finished.',
  ],
  near_death: [
    'One more session ends this.',
    'I am breaking. Finish it.',
    'So close. Do not stop here.',
  ],
  slain_early: [
    'Defeated, and days to spare. Truly prepared.',
    'You came early and ready. Respect.',
    'Flawless. The deadline never stood a chance.',
  ],
  slain_clutch: [
    'Down to the wire, but you held on.',
    'Just in time. That counts.',
    'A clutch finish. Breathe now.',
  ],
  reclaimed: [
    'Late, but the work still counts. Well reclaimed.',
    'You came back for me. That matters.',
    'Past due, yet conquered. Onward.',
  ],
  cleared: [
    'Marked done. On to the next.',
    'Cleared by your hand. Good.',
    'Logged as defeated.',
  ],
  enraged: [
    'The deadline is near and I am strong. Engage me now.',
    'Time is short. Stop waiting.',
    'I am enraged. Strike before it is too late.',
  ],
};

export function banterFor(boss: Boss, trigger: BanterTrigger): string {
  const lines = BANTER[trigger];
  return lines[Math.abs(boss.id) % lines.length];
}

// ── Cosmetic helpers ─────────────────────────────────────────────────────────

export const TIER_LABEL: Record<BossTier, string> = {
  minion: 'Minion',
  elite: 'Elite',
  archboss: 'Arch-Boss',
};

export const THEME_COLOR: Record<BossTheme, { base: string; glow: string }> = {
  math:      { base: '#6366f1', glow: '#c7d2fe' },
  chemistry: { base: '#10b981', glow: '#6ee7b7' },
  biology:   { base: '#f43f5e', glow: '#fda4af' },
  history:   { base: '#d97706', glow: '#fcd34d' },
  english:   { base: '#8b5cf6', glow: '#ddd6fe' },
  physics:   { base: '#06b6d4', glow: '#a5f3fc' },
  cs:        { base: '#14b8a6', glow: '#99f6e4' },
  language:  { base: '#eab308', glow: '#fde68a' },
  general:   { base: '#64748b', glow: '#cbd5e1' },
};

export function outcomeLabel(outcome?: BossOutcome): string {
  switch (outcome) {
    case 'flawless':  return 'Flawless';
    case 'clutch':    return 'Clutch kill';
    case 'reclaimed': return 'Reclaimed';
    case 'cleared':   return 'Cleared';
    default:          return 'Defeated';
  }
}
