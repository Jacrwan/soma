import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { storage } from '../../lib/storage';
import { CanvasAssignment, TimerSession } from '../../types';
import {
  Boss, BossStats, StrikeResult, BossTheme, BossTier,
  getActiveBosses, getSlainBosses, getBosses, bossStats,
  applyRawDamage, markSlain, reviveBoss, resetBoss, retireBoss, setThemeOverride, setHpOverride, clearOverdue,
  reconcileStudySessions, syncFromCloud, markSessionCredited,
  banterFor, earlyMultiplier, spacingMultiplier, daysUntil,
  isOnboarded, setOnboarded,
  COSMETICS, getStardust, getActiveAura, getUnlockedCosmetics, unlockCosmetic, selectAura,
  getActiveFight, setActiveFight,
  TIER_LABEL, THEME_LABEL, outcomeLabel, BOSSES_EVENT, FOCUS_LOGGED_EVENT,
} from '../../lib/bosses';
import BossArt from './BossArt';
import BossArena, { ArenaAttack } from './BossArena';
import styles from './Bosses.module.css';

// Active-fight tuning.
const CHARGE_SECONDS = 3.2;   // focus seconds to earn one charge
const MAX_CHARGES = 5;
const SLASH_COST = 1, SLASH_BASE = 2;
const BLAST_COST = 3, BLAST_BASE = 9;
const COMBO_DECAY_MS = 2800;
const COMBO_MAX = 2;
const AUTO_IDLE_MS = 1600;    // at full charge, auto-slash after this idle

type Tab = 'active' | 'log';

const ALL_THEMES: BossTheme[] = ['math','chemistry','biology','physics','cs','history','english','language','general'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function dueLabel(b: Boss): { text: string; urgency: 'safe' | 'soon' | 'urgent' | 'reclaim' } {
  const d = b.daysUntilDue;
  if (d < 0) return { text: `Reclaim · ${Math.abs(d)}d past`, urgency: 'reclaim' };
  if (d === 0) return { text: 'Due today', urgency: 'urgent' };
  if (d === 1) return { text: 'Due tomorrow', urgency: 'urgent' };
  if (d <= 3) return { text: `Due in ${d} days`, urgency: 'soon' };
  return { text: `Due in ${d} days`, urgency: 'safe' };
}

function fmtClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60), s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function distinctDaysWithToday(b: Boss): number {
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return b.progress.foughtDays.includes(key) ? b.progress.foughtDays.length : b.progress.foughtDays.length + 1;
}

function slainAgo(iso?: string): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ── HP bar ───────────────────────────────────────────────────────────────────

function HpBar({ pct, remaining, total }: { pct: number; remaining: number; total: number }) {
  const tone = pct > 0.55 ? styles.hpHigh : pct > 0.2 ? styles.hpMid : styles.hpLow;
  return (
    <div className={styles.hpWrap}>
      <div className={styles.hpTrack}>
        <div className={`${styles.hpFill} ${tone}`} style={{ width: `${Math.max(2, pct * 100)}%` }} />
      </div>
      <span className={styles.hpText}>{remaining} / {total} min</span>
    </div>
  );
}

// ── Active boss card ─────────────────────────────────────────────────────────

function BossCard({ boss, aura, onFight, onMarkDone, onRetire, onRetheme, onSetHp }: {
  boss: Boss; aura: string;
  onFight: (b: Boss) => void;
  onMarkDone: (b: Boss) => void;
  onRetire: (b: Boss) => void;
  onRetheme: (b: Boss, t: BossTheme) => void;
  onSetHp: (b: Boss, minutes: number) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [hpInput, setHpInput] = useState(String(boss.hp));
  const due = dueLabel(boss);
  const enraged = boss.daysUntilDue >= 0 && boss.daysUntilDue <= 2 && boss.pct > 0.6;
  return (
    <div className={`${styles.card}${boss.overdue ? ` ${styles.cardReclaim}` : ''}`}>
      <div className={styles.cardArt}>
        <BossArt theme={boss.theme} tier={boss.tier} pct={boss.pct} size={88} enraged={enraged} aura={aura} />
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardTop}>
          <span className={styles.bossName}>{boss.name}</span>
          <span className={`${styles.tierBadge} ${styles[`tier_${boss.tier}`]}`}>{TIER_LABEL[boss.tier]}</span>
        </div>
        <span className={styles.assignmentName} title={boss.assignmentName}>{boss.assignmentName}</span>
        <span className={styles.courseName}>{boss.course}</span>
        <HpBar pct={boss.pct} remaining={boss.hpRemaining} total={boss.hp} />
        <div className={styles.cardMeta}>
          <span className={`${styles.dueChip} ${styles[`due_${due.urgency}`]}`}>{due.text}</span>
          <span className={styles.clearChip}>{boss.sessionsToClear} session{boss.sessionsToClear === 1 ? '' : 's'} to clear</span>
          {boss.progress.foughtDays.length > 0 && (
            <span className={styles.comboChip}>{boss.progress.foughtDays.length}-day combo</span>
          )}
        </div>
        {menu && (
          <div className={styles.cardMenu}>
            <label className={styles.menuTheme}>
              Goal
              <input
                className={styles.hpInput}
                type="number" min={5} max={600} step={5}
                value={hpInput}
                onChange={e => setHpInput(e.target.value)}
                onBlur={() => { const v = Number(hpInput); if (v >= 5) onSetHp(boss, v); }}
                onKeyDown={e => { if (e.key === 'Enter') { const v = Number(hpInput); if (v >= 5) onSetHp(boss, v); (e.target as HTMLInputElement).blur(); } }}
              />
              min
            </label>
            <label className={styles.menuTheme}>
              Theme
              <select value={boss.theme} onChange={e => onRetheme(boss, e.target.value as BossTheme)}>
                {ALL_THEMES.map(t => <option key={t} value={t}>{THEME_LABEL[t]}</option>)}
              </select>
            </label>
            <button className={styles.menuBtn} onClick={() => onMarkDone(boss)}>Mark done</button>
            <button className={styles.menuBtn} onClick={() => onRetire(boss)}>Retire</button>
          </div>
        )}
      </div>
      <div className={styles.cardActions}>
        <button className={styles.fightBtn} onClick={() => onFight(boss)}>Fight</button>
        <button className={styles.moreBtn} onClick={() => setMenu(m => !m)} aria-label="More">⋯</button>
      </div>
    </div>
  );
}

// ── Fight view ───────────────────────────────────────────────────────────────

interface Popup { id: number; amount: number; }

function FightView({ boss, aura, onExit }: { boss: Boss; aura: string; onExit: () => void }) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [lastResult, setLastResult] = useState<StrikeResult | null>(null);
  const [victory, setVictory] = useState<StrikeResult | null>(null);
  const [attack, setAttack] = useState<ArenaAttack>({ nonce: 0, type: 'slash' });
  const [charges, setCharges] = useState(0);
  const [combo, setCombo] = useState(1);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);
  const multRef = useRef<number>(1);
  const chargesRef = useRef(0);
  const chargeAccumRef = useRef(0);
  const comboRef = useRef(1);
  const lastAttackRef = useRef(0);
  const nonceRef = useRef(0);
  const bossRef = useRef(boss);
  bossRef.current = boss;
  const popupId = useRef(0);
  const endedRef = useRef(false);

  const enraged = boss.daysUntilDue >= 0 && boss.daysUntilDue <= 2 && boss.pct > 0.6;
  const early = earlyMultiplier(daysUntil(boss.dueAt));
  const spacing = spacingMultiplier(distinctDaysWithToday(boss));

  const spawnLine = useMemo(
    () => banterFor(boss, enraged ? 'enraged' : boss.pct <= 0.2 ? 'near_death' : boss.pct <= 0.5 ? 'half' : 'spawn'),
    [boss.id], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const stopTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  function popDamage(amount: number) {
    const id = popupId.current++;
    setPopups(p => [...p, { id, amount }]);
    setTimeout(() => setPopups(p => p.filter(x => x.id !== id)), 1000);
  }

  // Record the fight's focus time as a real study session so it always shows up
  // in Insights (study time + streak). Uses the matched subject when one exists,
  // otherwise falls back to the boss's course so the minutes still count.
  function recordStudyTime(totalSec: number) {
    if (totalSec < 60) return;
    const subj = boss.subjectId ? storage.getSubjects().find(s => s.id === boss.subjectId) : undefined;
    const subjectId = subj?.id ?? `boss:${boss.course}`.slice(0, 80);
    const subjectName = subj?.name ?? boss.course;
    const session: TimerSession = {
      id: crypto.randomUUID(), subjectId,
      task: `Boss: ${boss.assignmentName}`.slice(0, 80),
      startTime: new Date(Date.now() - totalSec * 1000).toISOString(),
      endTime: new Date().toISOString(), durationSeconds: totalSec,
    };
    storage.setTimerSessions([...storage.getTimerSessions(), session]);
    markSessionCredited(session.id);
    void storage.saveTimerSession(session, subjectName).catch(() => {});
  }

  // An attack spends charges for damage. Manual attacks build combo; the
  // auto-attack (when you let charge max out) does not, so active play is faster.
  function doAttack(type: 'slash' | 'blast', auto = false) {
    if (endedRef.current) return;
    const cost = type === 'blast' ? BLAST_COST : SLASH_COST;
    if (chargesRef.current < cost) return;
    chargesRef.current -= cost; setCharges(chargesRef.current);
    if (!auto) comboRef.current = Math.min(COMBO_MAX, comboRef.current + (type === 'blast' ? 0.25 : 0.12));
    lastAttackRef.current = Date.now(); setCombo(Math.round(comboRef.current * 100) / 100);
    const base = type === 'blast' ? BLAST_BASE : SLASH_BASE;
    const dmg = Math.max(1, Math.round(base * comboRef.current * multRef.current));
    const r = applyRawDamage(bossRef.current, dmg, 'fight');
    setLastResult(r);
    nonceRef.current++; setAttack({ nonce: nonceRef.current, type });
    popDamage(dmg);
    if (r.slain) {
      endedRef.current = true;
      stopTick(); setRunning(false); setActiveFight(null);
      recordStudyTime(Math.floor((Date.now() - startRef.current) / 1000));
      setVictory(r);
    }
  }
  const doAttackRef = useRef(doAttack);
  doAttackRef.current = doAttack;

  const tick = useCallback(() => {
    const now = Date.now();
    setElapsed(Math.floor((now - startRef.current) / 1000));
    // accrue charges
    chargeAccumRef.current += 0.25 / CHARGE_SECONDS;
    while (chargeAccumRef.current >= 1 && chargesRef.current < MAX_CHARGES) {
      chargeAccumRef.current -= 1; chargesRef.current += 1; setCharges(chargesRef.current);
    }
    if (chargesRef.current >= MAX_CHARGES) chargeAccumRef.current = 0;
    // combo decay
    if (comboRef.current > 1 && now - lastAttackRef.current > COMBO_DECAY_MS) {
      comboRef.current = 1; setCombo(1);
    }
    // auto-attack when charge is maxed and idle
    if (chargesRef.current >= MAX_CHARGES && now - lastAttackRef.current > AUTO_IDLE_MS) {
      doAttackRef.current('slash', true);
    }
  }, []);

  function beginTick() {
    multRef.current = earlyMultiplier(daysUntil(bossRef.current.dueAt)) * spacingMultiplier(distinctDaysWithToday(bossRef.current));
    tickRef.current = setInterval(tick, 250);
  }

  function start() {
    if (running) return;
    setRunning(true);
    startRef.current = Date.now() - elapsed * 1000;
    lastAttackRef.current = Date.now();
    setActiveFight({ bossKey: bossRef.current.key, startTime: startRef.current, committed: 0 });
    beginTick();
  }

  function pause() {
    stopTick(); setRunning(false); setActiveFight(null);
  }

  function stopAndBank() {
    stopTick(); setRunning(false); setActiveFight(null);
    recordStudyTime(elapsed);
    setElapsed(0); chargesRef.current = 0; setCharges(0); chargeAccumRef.current = 0;
    comboRef.current = 1; setCombo(1);
  }

  // Resume an in-progress fight after switching tabs. The timer keeps counting;
  // charges start fresh (you build them by being present and focusing).
  useEffect(() => {
    const af = getActiveFight();
    if (af && af.bossKey === bossRef.current.key) {
      startRef.current = af.startTime;
      lastAttackRef.current = Date.now();
      setElapsed(Math.floor((Date.now() - af.startTime) / 1000));
      setRunning(true);
      beginTick();
    }
    return () => stopTick();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleExit() {
    stopTick();
    if (running) setActiveFight({ bossKey: bossRef.current.key, startTime: startRef.current, committed: 0 });
    if (elapsed >= 60) recordStudyTime(elapsed);
    onExit();
  }

  const canSlash = charges >= SLASH_COST;
  const canBlast = charges >= BLAST_COST;

  if (victory) {
    return (
      <div className={styles.fight}>
        <div className={styles.victory}>
          <BossArt theme={boss.theme} tier={boss.tier} pct={0} slain size={220} aura={aura} />
          <h2 className={styles.victoryTitle}>{boss.name} defeated</h2>
          <span className={`${styles.outcomeBadge} ${styles[`outcome_${victory.outcome}`]}`}>{outcomeLabel(victory.outcome)}</span>
          {victory.stardustEarned > 0 && <span className={styles.stardustEarned}>+{victory.stardustEarned} stardust</span>}
          <p className={styles.victoryBanter}>
            "{banterFor(boss, victory.outcome === 'flawless' ? 'slain_early' : victory.outcome === 'reclaimed' ? 'reclaimed' : 'slain_clutch')}"
          </p>
          <p className={styles.victorySub}>{boss.assignmentName} · {boss.course}</p>
          <button className={styles.primaryBtn} onClick={onExit}>Back to bosses</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.fight}>
      <button className={styles.backLink} onClick={handleExit}>← Bosses</button>

      <div className={styles.fightStage}>
        <BossArena theme={boss.theme} tier={boss.tier} pct={boss.pct} aura={aura} attack={attack} />
        {popups.map(p => <span key={p.id} className={styles.dmgPopup}>-{p.amount}</span>)}
      </div>

      <div className={styles.fightInfo}>
        <div className={styles.fightTitleRow}>
          <h1 className={styles.fightName}>{boss.name}</h1>
          <span className={`${styles.tierBadge} ${styles[`tier_${boss.tier}`]}`}>{TIER_LABEL[boss.tier]}</span>
        </div>
        <p className={styles.fightAssignment}>{boss.assignmentName}</p>
        <p className={styles.fightCourse}>{boss.course}</p>
        <p className={styles.fightBanter}>"{spawnLine}"</p>

        <div className={styles.fightHp}><HpBar pct={boss.pct} remaining={boss.hpRemaining} total={boss.hp} /></div>

        {boss.phases.length > 0 && (
          <div className={styles.phases}>
            {boss.phases.map((p, i) => {
              const start = boss.phases.slice(0, i).reduce((s, x) => s + x.hp, 0);
              const cleared = boss.progress.damage >= start + p.hp;
              const partial = !cleared && boss.progress.damage > start;
              return (
                <div key={i} className={`${styles.phase}${cleared ? ` ${styles.phaseDone}` : partial ? ` ${styles.phaseActive}` : ''}`}>
                  <span className={styles.phaseDot} />
                  <span className={styles.phaseTitle}>{p.title}</span>
                  <span className={styles.phaseHp}>{p.hp}m</span>
                </div>
              );
            })}
          </div>
        )}

        <div className={styles.multipliers}>
          <span className={`${styles.multChip}${early >= 1.5 ? ` ${styles.multGood}` : ''}`}>Early ×{early.toFixed(1)}</span>
          <span className={`${styles.multChip}${spacing > 1 ? ` ${styles.multGood}` : ''}`}>Spacing ×{spacing.toFixed(1)}</span>
          <span className={`${styles.multChip}${combo > 1 ? ` ${styles.multGood}` : ''}`}>Combo ×{combo.toFixed(2)}</span>
        </div>

        <div className={styles.timerBox}>
          <span className={`${styles.timerDisplay}${running ? ` ${styles.timerRunning}` : ''}`}>{fmtClock(elapsed)}</span>

          {/* charge meter */}
          <div className={styles.chargeRow}>
            <span className={styles.chargeLabel}>Charge</span>
            <div className={styles.chargePips}>
              {Array.from({ length: MAX_CHARGES }).map((_, i) => (
                <span key={i} className={`${styles.chargePip}${i < charges ? ` ${styles.chargePipFull}` : ''}`} />
              ))}
            </div>
          </div>

          {/* active attacks */}
          <div className={styles.attackRow}>
            <button className={styles.attackSlash} onClick={() => doAttack('slash')} disabled={!canSlash}>
              <span className={styles.attackName}>Pencil Slash</span>
              <span className={styles.attackCost}>{SLASH_COST}⚡</span>
            </button>
            <button className={styles.attackBlast} onClick={() => doAttack('blast')} disabled={!canBlast}>
              <span className={styles.attackName}>Laptop Blast</span>
              <span className={styles.attackCost}>{BLAST_COST}⚡</span>
            </button>
          </div>

          <div className={styles.timerControls}>
            {!running ? (
              <button className={styles.primaryBtn} onClick={start}>{elapsed > 0 ? 'Resume focus' : 'Start focus'}</button>
            ) : (
              <button className={styles.pauseBtn} onClick={pause}>Pause</button>
            )}
            {elapsed > 0 && !running && <button className={styles.secondaryBtn} onClick={stopAndBank}>Bank &amp; reset</button>}
          </div>
          <p className={styles.timerHint}>Focus to charge up, then spend charges on attacks. Chain attacks for a bigger combo. Let charge max out and the Scholar auto-strikes.</p>
        </div>

        {lastResult && !victory && (
          <div className={styles.strikeResult}>
            <strong>{boss.progress.damage} total damage</strong> dealt so far · last hit {lastResult.damage}.
          </div>
        )}

        <a className={styles.canvasLink} href={boss.htmlUrl} target="_blank" rel="noopener noreferrer">View on Canvas</a>
      </div>
    </div>
  );
}

// ── Log card ─────────────────────────────────────────────────────────────────

function LogCard({ boss, aura, onRevive, onReset }: {
  boss: Boss; aura: string; onRevive: (b: Boss) => void; onReset: (b: Boss) => void;
}) {
  return (
    <div className={styles.logCard}>
      <BossArt theme={boss.theme} tier={boss.tier} pct={0} slain size={64} aura={aura} />
      <div className={styles.logBody}>
        <div className={styles.cardTop}>
          <span className={styles.bossName}>{boss.name}</span>
          <span className={`${styles.outcomeBadge} ${styles[`outcome_${boss.progress.outcome}`]}`}>{outcomeLabel(boss.progress.outcome)}</span>
        </div>
        <span className={styles.assignmentName} title={boss.assignmentName}>{boss.assignmentName}</span>
        <span className={styles.courseName}>{boss.course} · slain {slainAgo(boss.progress.slainAt)}</span>
      </div>
      <div className={styles.logActions}>
        <button className={styles.ghostBtn} onClick={() => onRevive(boss)}>Revive</button>
        <button className={styles.ghostBtn} onClick={() => onReset(boss)}>Reset</button>
      </div>
    </div>
  );
}

// ── Cosmetics shop ───────────────────────────────────────────────────────────

function CosmeticsBar({ stardust, active, unlocked, onPick, onBuy }: {
  stardust: number; active: string; unlocked: string[];
  onPick: (id: string) => void; onBuy: (id: string) => void;
}) {
  return (
    <div className={styles.cosmetics}>
      <span className={styles.cosmeticsLabel}>Auras</span>
      <div className={styles.cosmeticsRow}>
        {COSMETICS.map(c => {
          const owned = unlocked.includes(c.id);
          const isActive = active === c.id;
          return (
            <button
              key={c.id}
              className={`${styles.auraChip}${isActive ? ` ${styles.auraActive}` : ''}${!owned ? ` ${styles.auraLocked}` : ''}`}
              onClick={() => owned ? onPick(c.id) : onBuy(c.id)}
              disabled={!owned && stardust < c.cost}
              title={owned ? c.name : `${c.name} · ${c.cost} stardust`}
            >
              <span className={styles.auraSwatch} style={{ background: c.color || 'var(--text-muted)' }} />
              {owned ? c.name : `${c.cost}✦`}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BossesTab() {
  const assignments = useMemo<CanvasAssignment[]>(() => storage.getCachedAssignments(), []);
  const [tab, setTab] = useState<Tab>('active');
  const [fighting, setFighting] = useState<Boss | null>(null);
  const [showOnboard, setShowOnboard] = useState(!isOnboarded());
  const [showShop, setShowShop] = useState(false);
  const [tierFilter, setTierFilter] = useState<'all' | BossTier>('all');
  const [sortBy, setSortBy] = useState<'urgency' | 'health'>('urgency');
  const [tickN, setTickN] = useState(0);
  const refresh = useCallback(() => setTickN(t => t + 1), []);

  // Sync from cloud + apply any pending study time on mount (silent: no toasts).
  useEffect(() => {
    void syncFromCloud().then(() => { reconcileStudySessions(assignments, new Date(), true); refresh(); });
    reconcileStudySessions(assignments, new Date(), true);
    // Resume a fight that was running when the user switched tabs.
    const af = getActiveFight();
    if (af) {
      const b = getBosses(assignments).find(x => x.key === af.bossKey && x.progress.status === 'active');
      if (b) setFighting(b);
      else setActiveFight(null);
    }
  }, [assignments, refresh]);

  // React to boss changes (BossToaster credits study time app-wide).
  useEffect(() => {
    window.addEventListener(BOSSES_EVENT, refresh);
    window.addEventListener(FOCUS_LOGGED_EVENT, refresh);
    return () => {
      window.removeEventListener(BOSSES_EVENT, refresh);
      window.removeEventListener(FOCUS_LOGGED_EVENT, refresh);
    };
  }, [refresh]);

  const active = useMemo(() => getActiveBosses(assignments), [assignments, tickN]); // eslint-disable-line react-hooks/exhaustive-deps
  const slain = useMemo(() => getSlainBosses(assignments), [assignments, tickN]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats: BossStats = useMemo(() => bossStats(getBosses(assignments)), [assignments, tickN]); // eslint-disable-line react-hooks/exhaustive-deps
  const aura = COSMETICS.find(c => c.id === getActiveAura())?.color || '';

  const fightingLive = useMemo(() => {
    if (!fighting) return null;
    return getBosses(assignments).find(b => b.key === fighting.key) ?? fighting;
  }, [fighting, assignments, tickN]);

  function handleMarkDone(b: Boss) {
    if (confirm(`Mark "${b.assignmentName}" as done? It moves to your Hall of Defeated.`)) markSlain(b);
  }
  function handleRetire(b: Boss) {
    if (confirm(`Retire "${b.assignmentName}"? It leaves your board. You can bring it back by re-syncing Canvas.`)) retireBoss(b);
  }
  function dismissOnboard() { setOnboarded(); setShowOnboard(false); }

  if (fightingLive) {
    return (
      <div className={styles.container}>
        <FightView boss={fightingLive} aura={aura} onExit={() => { setFighting(null); refresh(); }} />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Bosses</h1>
        <p className={styles.subtitle}>Every deadline is a boss. Focus time is your weapon. Beat them before they land.</p>
      </header>

      {showOnboard && (
        <div className={styles.onboard}>
          <div className={styles.onboardArt}><BossArt theme="chemistry" pct={0.6} size={84} /></div>
          <div className={styles.onboardBody}>
            <strong className={styles.onboardTitle}>How bosses work</strong>
            <ul className={styles.onboardList}>
              <li>Each Canvas deadline is a boss. Its health is the study minutes it takes to beat.</li>
              <li>Hit <b>Fight</b> and focus. Every minute deals damage, live. Studying that subject anywhere in Soma damages it too.</li>
              <li>Start early and study across days for bonus damage. Cramming hits weakest.</li>
            </ul>
            <button className={styles.primaryBtn} onClick={dismissOnboard}>Got it</button>
          </div>
        </div>
      )}

      {/* Rank + stats */}
      <div className={styles.statsRow}>
        <div className={styles.rankCard}>
          <span className={styles.rankLabel}>Rank</span>
          <span className={styles.rankName}>{stats.rank}</span>
          {stats.nextRankAt != null && <span className={styles.rankNext}>{stats.nextRankAt - stats.slain} more to rank up</span>}
        </div>
        <div className={styles.statChip}><span className={styles.statNum}>{stats.active}</span><span className={styles.statLbl}>active</span></div>
        <div className={styles.statChip}><span className={styles.statNum}>{stats.slain}</span><span className={styles.statLbl}>slain</span></div>
        <div className={styles.statChip}><span className={styles.statNum}>{stats.streak}</span><span className={styles.statLbl}>day streak</span></div>
        <button className={`${styles.statChip} ${styles.stardustChip}`} onClick={() => setShowShop(s => !s)} title="Spend stardust on auras">
          <span className={styles.statNum}>{stats.stardust}✦</span><span className={styles.statLbl}>stardust</span>
        </button>
      </div>

      {showShop && (
        <CosmeticsBar
          stardust={getStardust()} active={getActiveAura()} unlocked={getUnlockedCosmetics()}
          onPick={id => { selectAura(id); refresh(); }}
          onBuy={id => { if (unlockCosmetic(id)) refresh(); }}
        />
      )}

      {/* Tabs */}
      <div className={styles.tabs}>
        <button className={`${styles.tabBtn}${tab === 'active' ? ` ${styles.tabActive}` : ''}`} onClick={() => setTab('active')}>
          Active <span className={styles.tabCount}>{active.length}</span>
        </button>
        <button className={`${styles.tabBtn}${tab === 'log' ? ` ${styles.tabActive}` : ''}`} onClick={() => setTab('log')}>
          Hall of Defeated <span className={styles.tabCount}>{slain.length}</span>
        </button>
      </div>

      {tab === 'active' ? (
        active.length === 0 ? (
          <div className={styles.empty}>
            <BossArt theme="general" pct={1} size={120} />
            <p className={styles.emptyTitle}>No bosses on the board</p>
            <p className={styles.emptyText}>Connect Canvas in Settings and your upcoming deadlines appear here as bosses to defeat.</p>
          </div>
        ) : (() => {
          const filtered = active.filter(b => tierFilter === 'all' || b.tier === tierFilter);
          const overdueCount = active.filter(b => b.overdue).length;
          const renderCard = (b: Boss) => (
            <BossCard key={b.key} boss={b} aura={aura}
              onFight={setFighting} onMarkDone={handleMarkDone} onRetire={handleRetire}
              onRetheme={(bb, t) => { setThemeOverride(bb, t); refresh(); }}
              onSetHp={(bb, m) => { setHpOverride(bb, m); refresh(); }} />
          );
          const bands = [
            { key: 'week', label: 'This week', items: filtered.filter(b => !b.overdue && b.daysUntilDue <= 7) },
            { key: 'reclaim', label: 'Past due', items: filtered.filter(b => b.overdue) },
            { key: 'later', label: 'Later', items: filtered.filter(b => !b.overdue && b.daysUntilDue > 7) },
          ].filter(band => band.items.length > 0);
          const flat = [...filtered].sort((a, b) => b.hpRemaining - a.hpRemaining);
          return (
            <>
              <div className={styles.controls}>
                <label className={styles.controlGroup}>Show
                  <select value={tierFilter} onChange={e => setTierFilter(e.target.value as 'all' | BossTier)}>
                    <option value="all">All tiers</option>
                    <option value="minion">Minions</option>
                    <option value="elite">Elites</option>
                    <option value="archboss">Arch-Bosses</option>
                  </select>
                </label>
                <label className={styles.controlGroup}>Sort
                  <select value={sortBy} onChange={e => setSortBy(e.target.value as 'urgency' | 'health')}>
                    <option value="urgency">By urgency</option>
                    <option value="health">By health</option>
                  </select>
                </label>
                {overdueCount > 0 && (
                  <button className={styles.clearGhostBtn} onClick={() => {
                    if (confirm(`Retire all ${overdueCount} past-due boss${overdueCount === 1 ? '' : 'es'}? Use this to clear ones you already submitted.`)) {
                      clearOverdue(assignments); refresh();
                    }
                  }}>Clear {overdueCount} past-due</button>
                )}
              </div>
              {filtered.length === 0 ? (
                <p className={styles.filterEmpty}>No {tierFilter === 'all' ? '' : tierFilter} bosses match.</p>
              ) : sortBy === 'health' ? (
                <div className={styles.cardList}>{flat.map(renderCard)}</div>
              ) : (
                bands.map(band => (
                  <div key={band.key} className={styles.band}>
                    <span className={styles.bandLabel}>{band.label} <span className={styles.bandCount}>{band.items.length}</span></span>
                    <div className={styles.cardList}>{band.items.map(renderCard)}</div>
                  </div>
                ))
              )}
            </>
          );
        })()
      ) : (
        slain.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Nothing defeated yet</p>
            <p className={styles.emptyText}>Take down a boss and it earns a permanent place in your hall.</p>
          </div>
        ) : (
          <div className={styles.logGrid}>
            {slain.map(b => <LogCard key={b.key} boss={b} aura={aura} onRevive={reviveBoss} onReset={resetBoss} />)}
          </div>
        )
      )}
    </div>
  );
}
