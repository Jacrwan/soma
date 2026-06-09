// Boss system — turns real Canvas deadlines into game bosses you defeat with
// focus time. No AI, free for everyone.
//
// State lives in localStorage (instant) and is mirrored to the user's Supabase
// settings blob (durable, cross-device). A boss's *spec* (name, hp, tier, theme,
// phases) is derived from its Canvas assignment; only mutable *progress* is
// stored, keyed by a stable fingerprint so re-syncs never reset a boss.

import { CanvasAssignment, Subject } from '../types';
import { storage } from './storage';

export type BossTheme =
  | 'math' | 'chemistry' | 'biology' | 'history'
  | 'english' | 'physics' | 'cs' | 'language' | 'general';

export type BossTier = 'minion' | 'elite' | 'archboss';
export type BossOutcome = 'flawless' | 'clutch' | 'reclaimed' | 'cleared';
export type DamageSource = 'fight' | 'study' | 'knowledge';

export interface BossPhase { title: string; hp: number; }

export interface BossSpec {
  id: number;            // Canvas assignment id (for React keys + Canvas link)
  key: string;           // stable fingerprint (progress is keyed on this)
  name: string;
  assignmentName: string;
  course: string;
  theme: BossTheme;
  tier: BossTier;
  hp: number;
  dueAt: string;
  htmlUrl: string;
  subjectId?: string;    // matched Soma subject, if any
  phases: BossPhase[];
}

export interface BossProgress {
  damage: number;
  foughtDays: string[];
  status: 'active' | 'slain' | 'retired';
  outcome?: BossOutcome;
  slainAt?: string;
  themeOverride?: BossTheme;
  hpOverride?: number;
}

export interface Boss extends BossSpec {
  progress: BossProgress;
  hpRemaining: number;
  pct: number;
  overdue: boolean;
  daysUntilDue: number;
  sessionsToClear: number;
}

export interface StrikeResult {
  damage: number;
  rawMinutes: number;
  earlyMultiplier: number;
  spacingMultiplier: number;
  slain: boolean;
  outcome?: BossOutcome;
  hpRemaining: number;
  stardustEarned: number;
}

// ── Full persisted state ─────────────────────────────────────────────────────

interface BossState {
  progress: Record<string, BossProgress>;
  creditedSessions: string[];
  stardust: number;
  streak: number;
  lastStrikeDay?: string;
  cosmetics: { unlocked: string[]; activeAura: string };
  onboarded: boolean;
  celebratedMilestones: number[];
}

const KEY = 'soma_boss_state';
const LEGACY_KEY = 'soma_boss_progress';
export const BOSSES_EVENT = 'soma_bosses_updated';
export const FOCUS_LOGGED_EVENT = 'soma_focus_logged';
const SESSION_MINUTES = 25; // for "sessions to clear" estimate

function defaultState(): BossState {
  return {
    progress: {},
    creditedSessions: [],
    stardust: 0,
    streak: 0,
    cosmetics: { unlocked: ['default'], activeAura: 'default' },
    onboarded: false,
    celebratedMilestones: [],
  };
}

let cache: BossState | null = null;

function load(): BossState {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      cache = { ...defaultState(), ...JSON.parse(raw) };
      return cache!;
    }
  } catch { /* ignore */ }
  // Migrate legacy progress-only blob.
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const prog = JSON.parse(legacy);
      cache = { ...defaultState(), progress: prog && typeof prog === 'object' ? prog : {} };
      save();
      return cache!;
    }
  } catch { /* ignore */ }
  cache = defaultState();
  return cache!;
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
function save(): void {
  if (!cache) return;
  localStorage.setItem(KEY, JSON.stringify(cache));
  window.dispatchEvent(new Event(BOSSES_EVENT));
  // Debounced background push to the cloud (best effort).
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { void pushCloud(); }, 1500);
}

async function pushCloud(): Promise<void> {
  if (!cache) return;
  try {
    const settings = await storage.getSettings();
    await storage.saveSettings({ ...settings, bossState: cache });
  } catch { /* offline or signed out — local copy is the source of truth */ }
}

/** Merge a cloud copy with local, preferring the most-progressed values. */
export async function syncFromCloud(): Promise<void> {
  let cloud: BossState | undefined;
  try {
    const settings = await storage.getSettings();
    cloud = settings.bossState as BossState | undefined;
  } catch { return; }
  if (!cloud || typeof cloud !== 'object') { void pushCloud(); return; }

  const local = load();
  const merged: BossState = {
    progress: { ...cloud.progress },
    creditedSessions: Array.from(new Set([...(cloud.creditedSessions || []), ...local.creditedSessions])),
    stardust: Math.max(cloud.stardust || 0, local.stardust),
    streak: Math.max(cloud.streak || 0, local.streak),
    lastStrikeDay: [cloud.lastStrikeDay, local.lastStrikeDay].filter(Boolean).sort().pop(),
    cosmetics: {
      unlocked: Array.from(new Set([...(cloud.cosmetics?.unlocked || ['default']), ...local.cosmetics.unlocked])),
      activeAura: local.cosmetics.activeAura || cloud.cosmetics?.activeAura || 'default',
    },
    onboarded: cloud.onboarded || local.onboarded,
    celebratedMilestones: Array.from(new Set([...(cloud.celebratedMilestones || []), ...local.celebratedMilestones])),
  };
  // For each boss, keep the more-progressed record (slain wins, else more damage).
  for (const [k, lp] of Object.entries(local.progress)) {
    const cp = merged.progress[k];
    if (!cp) { merged.progress[k] = lp; continue; }
    const lScore = (lp.status === 'slain' ? 1e9 : 0) + lp.damage;
    const cScore = (cp.status === 'slain' ? 1e9 : 0) + cp.damage;
    merged.progress[k] = lScore >= cScore ? lp : cp;
  }
  cache = merged;
  localStorage.setItem(KEY, JSON.stringify(cache));
  window.dispatchEvent(new Event(BOSSES_EVENT));
  void pushCloud();
}

// ── Identity ─────────────────────────────────────────────────────────────────

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

function fingerprint(a: CanvasAssignment): string {
  const day = a.dueAt ? a.dueAt.slice(0, 10) : '';
  return simpleHash(`${a.courseName}|${a.name}|${day}`);
}

// ── Classification ───────────────────────────────────────────────────────────

const THEME_KEYWORDS: [BossTheme, RegExp][] = [
  ['math',       /\b(math|algebra|calculus|calc|geometry|trig|statistic|stats|precalc|number theory)\b/i],
  ['chemistry',  /\b(chem|chemistry|organic|biochem)\b/i],
  ['biology',    /\b(bio|biology|anatomy|physiology|genetics|ecology|zoology|botany)\b/i],
  ['physics',    /\b(physics|mechanics|kinematics|thermodynamic|electromagnet)\b/i],
  ['cs',         /\b(computer|cs|programming|coding|software|data structure|algorithm|python|java)\b/i],
  ['history',    /\b(history|hist|civics|government|gov|econ|economics|geography|social studies|apush|world history)\b/i],
  ['english',    /\b(english|eng|literature|lit|writing|composition|rhetoric|language arts|lang arts)\b/i],
  ['language',   /\b(spanish|french|german|latin|chinese|japanese|mandarin|italian|korean|esp|fr[ae]nch)\b/i],
];

const THEME_NAME: Record<BossTheme, string> = {
  math: 'The Theorem', chemistry: 'The Catalyst', biology: 'The Organism',
  history: 'The Chronicle', english: 'The Manuscript', physics: 'The Constant',
  cs: 'The Stack', language: 'The Babel', general: 'The Deadline',
};

function themeFor(course: string, name: string): BossTheme {
  const hay = `${course} ${name}`;
  for (const [theme, re] of THEME_KEYWORDS) if (re.test(hay)) return theme;
  return 'general';
}

function round15(n: number): number { return Math.max(15, Math.round(n / 15) * 15); }

// Rescaled lower so bosses are beatable through a week of normal studying.
function classify(name: string): { tier: BossTier; hp: number } {
  const n = name.toLowerCase();
  if (/\b(final|cumulative|capstone)\b/.test(n)) {
    return { tier: 'archboss', hp: /cumulative/.test(n) ? 180 : 150 };
  }
  if (/\b(midterm|exam|test|essay|paper|project|research|portfolio)\b/.test(n)) {
    const big = /\b(essay|paper|project|research|midterm|portfolio)\b/.test(n);
    return { tier: 'elite', hp: round15(big ? 100 : 75) };
  }
  if (/\b(lab|problem set|pset|assignment|worksheet)\b/.test(n)) {
    return { tier: 'elite', hp: round15(50) };
  }
  if (/\b(quiz)\b/.test(n)) return { tier: 'minion', hp: 25 };
  if (/\b(read|reading|chapter|annotat)\b/.test(n)) return { tier: 'minion', hp: 15 };
  if (/\b(discussion|post|response|journal|reflection)\b/.test(n)) return { tier: 'minion', hp: 10 };
  return { tier: 'minion', hp: 25 };
}

function phasesFor(tier: BossTier, hp: number): BossPhase[] {
  if (tier !== 'archboss') return [];
  const each = round15(hp / 3);
  return [
    { title: 'Review the units', hp: each },
    { title: 'Drill the hard parts', hp: each },
    { title: 'Master and mock-test', hp: hp - each * 2 },
  ];
}

function subjectForCourse(courseName: string, courseId: number, subjects: Subject[]): Subject | undefined {
  return subjects.find(s => s.canvasCourseId === courseId)
    ?? subjects.find(s => s.name.toLowerCase() === courseName.toLowerCase());
}

export function specForAssignment(a: CanvasAssignment, subjects: Subject[] = storage.getSubjects()): BossSpec {
  const key = fingerprint(a);
  const prog = load().progress[key];
  const theme = prog?.themeOverride ?? themeFor(a.courseName, a.name);
  const c = classify(a.name);
  const tier = c.tier;
  const hp = prog?.hpOverride ?? c.hp; // user can set their own goal
  const subj = subjectForCourse(a.courseName, a.courseId, subjects);
  return {
    id: a.id, key,
    name: THEME_NAME[theme],
    assignmentName: a.name,
    course: a.courseName,
    theme, tier, hp,
    dueAt: a.dueAt,
    htmlUrl: a.htmlUrl,
    subjectId: subj?.id,
    phases: phasesFor(tier, hp),
  };
}

// ── Damage model ─────────────────────────────────────────────────────────────

function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysUntil(dueAt: string, now = new Date()): number {
  return Math.round((new Date(dueAt).getTime() - now.getTime()) / 86_400_000);
}

export function earlyMultiplier(daysLeft: number): number {
  if (daysLeft > 5) return 1.5;
  if (daysLeft >= 2) return 1.2;
  return 1.0;
}

export function spacingMultiplier(distinctDays: number): number {
  return Math.min(1.5, 1 + 0.1 * Math.max(0, distinctDays - 1));
}

function stardustFor(tier: BossTier, outcome: BossOutcome): number {
  const base = tier === 'archboss' ? 60 : tier === 'elite' ? 25 : 10;
  const bonus = outcome === 'flawless' ? 1.5 : outcome === 'clutch' ? 1.1 : 1;
  return Math.round(base * bonus);
}

function decideOutcome(dueAt: string, now: Date): BossOutcome {
  const d = daysUntil(dueAt, now);
  if (d < 0) return 'reclaimed';
  if (d >= 2) return 'flawless';
  return 'clutch';
}

function bumpStreak(state: BossState, now: Date): void {
  const today = dayKey(now);
  if (state.lastStrikeDay === today) return;
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  state.streak = state.lastStrikeDay === yesterday ? state.streak + 1 : 1;
  state.lastStrikeDay = today;
}

export const BOSS_TOAST_EVENT = 'soma_boss_toast';
export interface BossToastDetail {
  name: string; theme: BossTheme; damage: number; slain: boolean; source: DamageSource;
  milestone?: boolean; message?: string;
}

function emitToast(boss: BossSpec, damage: number, slain: boolean, source: DamageSource): void {
  window.dispatchEvent(new CustomEvent(BOSS_TOAST_EVENT, {
    detail: { name: boss.name, theme: boss.theme, damage, slain, source } as BossToastDetail,
  }));
}

const MILESTONES = [3, 5, 10, 25, 50, 100];

function checkMilestone(state: BossState, theme: BossTheme): void {
  const slainCount = Object.values(state.progress).filter(p => p.status === 'slain').length;
  if (!MILESTONES.includes(slainCount) || state.celebratedMilestones.includes(slainCount)) return;
  const bonus = slainCount * 5;
  state.stardust += bonus;
  state.celebratedMilestones = [...state.celebratedMilestones, slainCount];
  window.dispatchEvent(new CustomEvent(BOSS_TOAST_EVENT, {
    detail: { name: 'Milestone', theme, damage: 0, slain: false, source: 'fight',
      milestone: true, message: `${slainCount} bosses slain. +${bonus} stardust` } as BossToastDetail,
  }));
}

/** Core: add already-computed (multiplier-adjusted) damage to a boss. */
export function applyRawDamage(boss: BossSpec, rawDamage: number, source: DamageSource = 'fight', now = new Date(), silent = false): StrikeResult {
  const state = load();
  const prev = state.progress[boss.key] ?? { damage: 0, foughtDays: [], status: 'active' as const };
  if (prev.status === 'slain') {
    return { damage: 0, rawMinutes: 0, earlyMultiplier: 1, spacingMultiplier: 1, slain: true, outcome: prev.outcome, hpRemaining: 0, stardustEarned: 0 };
  }
  const damage = Math.max(1, Math.round(rawDamage));
  const today = dayKey(now);
  const foughtDays = prev.foughtDays.includes(today) ? prev.foughtDays : [...prev.foughtDays, today];
  const newDamage = prev.damage + damage;
  const hpRemaining = Math.max(0, boss.hp - newDamage);
  const slain = hpRemaining <= 0;
  const outcome = slain ? decideOutcome(boss.dueAt, now) : prev.outcome;

  state.progress[boss.key] = {
    ...prev, damage: newDamage, foughtDays,
    status: slain ? 'slain' : 'active', outcome,
    slainAt: slain ? now.toISOString() : prev.slainAt,
  };
  let stardustEarned = 0;
  if (slain && outcome) { stardustEarned = stardustFor(boss.tier, outcome); state.stardust += stardustEarned; }
  bumpStreak(state, now);
  if (slain) checkMilestone(state, boss.theme);
  save();

  if (!silent && source !== 'fight') emitToast(boss, damage, slain, source);
  return { damage, rawMinutes: 0, earlyMultiplier: 1, spacingMultiplier: 1, slain, outcome, hpRemaining, stardustEarned };
}

/** Apply focus minutes (with early + spacing multipliers) to a boss. */
export function dealDamage(boss: BossSpec, minutes: number, source: DamageSource = 'fight', now = new Date(), silent = false): StrikeResult {
  const state = load();
  const prev = state.progress[boss.key];
  const today = dayKey(now);
  const willHaveDays = prev?.foughtDays.includes(today) ? prev.foughtDays.length : (prev?.foughtDays.length ?? 0) + 1;
  const early = earlyMultiplier(daysUntil(boss.dueAt, now));
  const spacing = spacingMultiplier(willHaveDays);
  const res = applyRawDamage(boss, minutes * early * spacing, source, now, silent);
  return { ...res, rawMinutes: minutes, earlyMultiplier: early, spacingMultiplier: spacing };
}

/** Fight strike. */
export function strikeBoss(boss: Boss, minutes: number, now = new Date()): StrikeResult {
  return dealDamage(boss, minutes, 'fight', now);
}

/** Burst damage when finishing study material (deck/quiz) for a subject. */
export function knowledgeStrike(subjectId: string, assignments: CanvasAssignment[], amount = 20, now = new Date()): Boss | null {
  const subjects = storage.getSubjects();
  const target = getActiveBosses(assignments, now).find(b => b.subjectId === subjectId
    || specForAssignment(assignmentById(assignments, b.id)!, subjects).subjectId === subjectId);
  if (!target) return null;
  dealDamage(target, amount, 'knowledge', now);
  return target;
}

function assignmentById(assignments: CanvasAssignment[], id: number): CanvasAssignment | undefined {
  return assignments.find(a => a.id === id);
}

/** Apply uncredited Day View study sessions as damage to matching bosses.
 *  Pass silent=true for the on-mount backlog so old sessions don't flood toasts. */
export function reconcileStudySessions(assignments: CanvasAssignment[], now = new Date(), silent = false): void {
  const state = load();
  const sessions = storage.getTimerSessions();
  const subjects = storage.getSubjects();
  const credited = new Set(state.creditedSessions);
  let changed = false;

  for (const sess of sessions) {
    if (credited.has(sess.id)) continue;
    const minutes = Math.round((sess.durationSeconds || 0) / 60);
    if (minutes < 1) { credited.add(sess.id); changed = true; continue; }
    const matches = getActiveBosses(assignments, now).filter(b => {
      const spec = specForAssignment(assignmentById(assignments, b.id)!, subjects);
      return spec.subjectId && spec.subjectId === sess.subjectId;
    });
    if (matches.length > 0) {
      dealDamage(matches[0], minutes, 'study', now, silent);
    }
    credited.add(sess.id);
    changed = true;
  }
  if (changed) {
    const fresh = load();
    fresh.creditedSessions = Array.from(credited).slice(-500);
    save();
  }
}

/** Mark a session id as already-credited (used so fight sessions aren't double counted). */
export function markSessionCredited(sessionId: string): void {
  const state = load();
  if (!state.creditedSessions.includes(sessionId)) {
    state.creditedSessions = [...state.creditedSessions, sessionId].slice(-500);
    save();
  }
}

// ── Active fight persistence (keeps the timer running across tab switches) ─────

const ACTIVE_FIGHT_KEY = 'soma_boss_active_fight';
export interface ActiveFight { bossKey: string; startTime: number; committed: number; }

export function getActiveFight(): ActiveFight | null {
  try {
    const raw = localStorage.getItem(ACTIVE_FIGHT_KEY);
    return raw ? JSON.parse(raw) as ActiveFight : null;
  } catch { return null; }
}

export function setActiveFight(f: ActiveFight | null): void {
  if (f) localStorage.setItem(ACTIVE_FIGHT_KEY, JSON.stringify(f));
  else localStorage.removeItem(ACTIVE_FIGHT_KEY);
}

// ── Reads ────────────────────────────────────────────────────────────────────

const STALE_AFTER_DAYS = 21;

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
    sessionsToClear: Math.max(1, Math.ceil(hpRemaining / SESSION_MINUTES)),
  };
}

export function getBosses(assignments: CanvasAssignment[], now = new Date()): Boss[] {
  const state = load();
  const subjects = storage.getSubjects();
  const out: Boss[] = [];
  for (const a of assignments) {
    if (!a.dueAt) continue;
    const dLeft = daysUntil(a.dueAt, now);
    const spec = specForAssignment(a, subjects);
    const prog = state.progress[spec.key] ?? { damage: 0, foughtDays: [], status: 'active' as const };
    if (prog.status === 'retired') continue;
    if (dLeft < -STALE_AFTER_DAYS && prog.status !== 'slain' && prog.damage === 0) continue;
    out.push(toBoss(spec, prog, now));
  }
  return out;
}

export function getActiveBosses(assignments: CanvasAssignment[], now = new Date()): Boss[] {
  return getBosses(assignments, now)
    .filter(b => b.progress.status === 'active')
    .sort((a, b) => {
      const ad = new Date(a.dueAt).getTime(), bd = new Date(b.dueAt).getTime();
      if (ad !== bd) return ad - bd;
      return b.hpRemaining - a.hpRemaining;
    });
}

export function getSlainBosses(assignments: CanvasAssignment[], now = new Date()): Boss[] {
  return getBosses(assignments, now)
    .filter(b => b.progress.status === 'slain')
    .sort((a, b) => new Date(b.progress.slainAt || 0).getTime() - new Date(a.progress.slainAt || 0).getTime());
}

export function mostUrgentBoss(assignments: CanvasAssignment[], now = new Date()): Boss | null {
  return getActiveBosses(assignments, now)[0] ?? null;
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function markSlain(boss: Boss, now = new Date()): void {
  const state = load();
  const prev = state.progress[boss.key] ?? { damage: 0, foughtDays: [], status: 'active' as const };
  const outcome: BossOutcome = 'cleared';
  state.progress[boss.key] = { ...prev, damage: boss.hp, status: 'slain', outcome, slainAt: now.toISOString() };
  state.stardust += stardustFor(boss.tier, outcome);
  bumpStreak(state, now);
  checkMilestone(state, boss.theme);
  save();
}

/** Retire every overdue, still-active boss in one go (clear submitted ghosts). */
export function clearOverdue(assignments: CanvasAssignment[], now = new Date()): number {
  const overdue = getActiveBosses(assignments, now).filter(b => b.overdue);
  if (overdue.length === 0) return 0;
  const state = load();
  for (const b of overdue) {
    const prev = state.progress[b.key] ?? { damage: 0, foughtDays: [], status: 'active' as const };
    state.progress[b.key] = { ...prev, status: 'retired' };
  }
  save();
  return overdue.length;
}

export function reviveBoss(boss: Boss): void {
  const state = load();
  const prev = state.progress[boss.key];
  if (!prev) return;
  state.progress[boss.key] = { ...prev, status: 'active', outcome: undefined, slainAt: undefined };
  save();
}

export function resetBoss(boss: Boss): void {
  const state = load();
  delete state.progress[boss.key];
  save();
}

export function retireBoss(boss: Boss): void {
  const state = load();
  const prev = state.progress[boss.key] ?? { damage: 0, foughtDays: [], status: 'active' as const };
  state.progress[boss.key] = { ...prev, status: 'retired' };
  save();
}

export function setThemeOverride(boss: Boss, theme: BossTheme): void {
  const state = load();
  const prev = state.progress[boss.key] ?? { damage: 0, foughtDays: [], status: 'active' as const };
  state.progress[boss.key] = { ...prev, themeOverride: theme };
  save();
}

/** Let the user set their own study-minute goal (HP) for a boss. */
export function setHpOverride(boss: Boss, minutes: number): void {
  const state = load();
  const prev = state.progress[boss.key] ?? { damage: 0, foughtDays: [], status: 'active' as const };
  const hp = Math.max(5, Math.min(600, Math.round(minutes / 5) * 5));
  state.progress[boss.key] = { ...prev, hpOverride: hp };
  save();
}

// ── Onboarding / cosmetics ───────────────────────────────────────────────────

export function isOnboarded(): boolean { return load().onboarded; }
export function setOnboarded(): void { const s = load(); s.onboarded = true; save(); }

export interface Cosmetic { id: string; name: string; cost: number; color: string; }
export const COSMETICS: Cosmetic[] = [
  { id: 'default', name: 'Standard core', cost: 0,    color: '' },
  { id: 'ember',   name: 'Ember aura',    cost: 60,   color: '#f97316' },
  { id: 'frost',   name: 'Frost aura',    cost: 120,  color: '#38bdf8' },
  { id: 'toxic',   name: 'Toxic aura',    cost: 200,  color: '#84cc16' },
  { id: 'void',    name: 'Void aura',     cost: 320,  color: '#a855f7' },
  { id: 'rose',    name: 'Rose aura',     cost: 450,  color: '#fb7185' },
  { id: 'gold',    name: 'Champion gold', cost: 650,  color: '#facc15' },
  { id: 'prism',   name: 'Prismatic',     cost: 1000, color: '#22d3ee' },
];

export function getStardust(): number { return load().stardust; }
export function getActiveAura(): string { return load().cosmetics.activeAura; }
export function getUnlockedCosmetics(): string[] { return load().cosmetics.unlocked; }

export function unlockCosmetic(id: string): boolean {
  const state = load();
  const c = COSMETICS.find(x => x.id === id);
  if (!c || state.cosmetics.unlocked.includes(id) || state.stardust < c.cost) return false;
  state.stardust -= c.cost;
  state.cosmetics.unlocked = [...state.cosmetics.unlocked, id];
  state.cosmetics.activeAura = id;
  save();
  return true;
}

export function selectAura(id: string): void {
  const state = load();
  if (!state.cosmetics.unlocked.includes(id)) return;
  state.cosmetics.activeAura = id;
  save();
}

// ── Stats / rank ─────────────────────────────────────────────────────────────

export interface BossStats {
  slain: number; flawless: number; active: number;
  rank: string; nextRankAt: number | null;
  stardust: number; streak: number;
}

const RANKS: [number, string][] = [
  [0, 'Novice'], [3, 'Fighter'], [8, 'Slayer'], [16, 'Boss Hunter'], [30, 'Legend'],
];

export function bossStats(bosses: Boss[]): BossStats {
  const state = load();
  const slainBosses = bosses.filter(b => b.progress.status === 'slain');
  const slain = slainBosses.length;
  const flawless = slainBosses.filter(b => b.progress.outcome === 'flawless').length;
  const active = bosses.filter(b => b.progress.status === 'active').length;
  let rank = RANKS[0][1]; let nextRankAt: number | null = RANKS[1][0];
  for (let i = 0; i < RANKS.length; i++) {
    if (slain >= RANKS[i][0]) { rank = RANKS[i][1]; nextRankAt = i + 1 < RANKS.length ? RANKS[i + 1][0] : null; }
  }
  return { slain, flawless, active, rank, nextRankAt, stardust: state.stardust, streak: state.streak };
}

// ── Banter (static, varied) ──────────────────────────────────────────────────

export type BanterTrigger =
  | 'spawn' | 'half' | 'near_death'
  | 'slain_early' | 'slain_clutch' | 'reclaimed' | 'cleared' | 'enraged';

const BANTER: Record<BanterTrigger, string[]> = {
  spawn: [
    'I have your deadline. Come take it back.',
    'Another challenger. Let us see your focus.',
    'I grow stronger the longer you wait.',
    'You cannot ignore me forever.',
    'Sit down. Open the book. Begin.',
  ],
  half: [
    'Halfway. Do not slow down now.',
    'You are wearing me down. Keep going.',
    'Impressive, but I am not finished.',
    'My strength fades with every minute you focus.',
  ],
  near_death: [
    'One more session ends this.',
    'I am breaking. Finish it.',
    'So close. Do not stop here.',
    'Strike once more and I fall.',
  ],
  slain_early: [
    'Defeated, and days to spare. Truly prepared.',
    'You came early and ready. Respect.',
    'Flawless. The deadline never stood a chance.',
    'Early and relentless. Well fought.',
  ],
  slain_clutch: [
    'Down to the wire, but you held on.',
    'Just in time. That counts.',
    'A clutch finish. Breathe now.',
    'Cutting it close, but a win is a win.',
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

export function banterFor(boss: Boss, trigger: BanterTrigger, salt = 0): string {
  const lines = BANTER[trigger];
  const dayIdx = Math.floor(Date.now() / 86_400_000);
  return lines[Math.abs(boss.id + salt + dayIdx) % lines.length];
}

// ── Labels / colors ──────────────────────────────────────────────────────────

export const TIER_LABEL: Record<BossTier, string> = {
  minion: 'Minion', elite: 'Elite', archboss: 'Arch-Boss',
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

export const THEME_LABEL: Record<BossTheme, string> = {
  math: 'Math', chemistry: 'Chemistry', biology: 'Biology', history: 'History',
  english: 'English', physics: 'Physics', cs: 'Computer Science', language: 'Language', general: 'General',
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
