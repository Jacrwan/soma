import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { storage } from '../../lib/storage';
import { CanvasAssignment } from '../../types';
import {
  Boss, BossStats, StrikeResult,
  getActiveBosses, getSlainBosses, getBosses, bossStats,
  strikeBoss, markSlain, reviveBoss, resetBoss,
  banterFor, earlyMultiplier, spacingMultiplier, daysUntil,
  TIER_LABEL, outcomeLabel, BOSSES_EVENT,
} from '../../lib/bosses';
import BossArt from './BossArt';
import styles from './Bosses.module.css';

type Tab = 'active' | 'log';

// ── Helpers ──────────────────────────────────────────────────────────────────

function dueLabel(b: Boss): { text: string; urgency: 'safe' | 'soon' | 'urgent' | 'overdue' } {
  const d = b.daysUntilDue;
  if (d < 0) return { text: `Overdue ${Math.abs(d)}d`, urgency: 'overdue' };
  if (d === 0) return { text: 'Due today', urgency: 'urgent' };
  if (d === 1) return { text: 'Due tomorrow', urgency: 'urgent' };
  if (d <= 3) return { text: `Due in ${d} days`, urgency: 'soon' };
  return { text: `Due in ${d} days`, urgency: 'safe' };
}

function fmtClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function distinctDaysWithToday(b: Boss): number {
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return b.progress.foughtDays.includes(key) ? b.progress.foughtDays.length : b.progress.foughtDays.length + 1;
}

function slainAgo(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
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

// ── Boss card (active list) ──────────────────────────────────────────────────

function BossCard({ boss, onFight, onMarkDone }: {
  boss: Boss;
  onFight: (b: Boss) => void;
  onMarkDone: (b: Boss) => void;
}) {
  const due = dueLabel(boss);
  const enraged = boss.daysUntilDue >= 0 && boss.daysUntilDue <= 2 && boss.pct > 0.6;
  return (
    <div className={`${styles.card}${boss.overdue ? ` ${styles.cardOverdue}` : ''}`}>
      <div className={styles.cardArt}>
        <BossArt theme={boss.theme} pct={boss.pct} size={88} enraged={enraged} />
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
          {boss.progress.foughtDays.length > 0 && (
            <span className={styles.comboChip}>{boss.progress.foughtDays.length}-day combo</span>
          )}
        </div>
      </div>
      <div className={styles.cardActions}>
        <button className={styles.fightBtn} onClick={() => onFight(boss)}>Fight</button>
        <button className={styles.doneBtn} onClick={() => onMarkDone(boss)} title="I already finished this">Mark done</button>
      </div>
    </div>
  );
}

// ── Fight view ───────────────────────────────────────────────────────────────

function FightView({ boss, onExit }: { boss: Boss; onExit: () => void }) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds
  const [result, setResult] = useState<StrikeResult | null>(null);
  const [victory, setVictory] = useState<StrikeResult | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const enraged = boss.daysUntilDue >= 0 && boss.daysUntilDue <= 2 && boss.pct > 0.6;
  const early = earlyMultiplier(daysUntil(boss.dueAt));
  const spacing = spacingMultiplier(distinctDaysWithToday(boss));

  const spawnLine = useMemo(
    () => banterFor(boss, enraged ? 'enraged' : boss.pct <= 0.2 ? 'near_death' : boss.pct <= 0.5 ? 'half' : 'spawn'),
    [boss, enraged],
  );

  const stopTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  useEffect(() => () => stopTick(), [stopTick]);

  function start() {
    if (running) return;
    setResult(null);
    setRunning(true);
    const startedAt = Date.now() - elapsed * 1000;
    tickRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
  }

  function applyStrike(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 1) return null;
    const r = strikeBoss(boss, minutes);
    return r;
  }

  function stopAndStrike() {
    stopTick();
    setRunning(false);
    const r = applyStrike(elapsed);
    setElapsed(0);
    if (!r) { setResult(null); return; }
    if (r.slain) setVictory(r);
    else setResult(r);
  }

  function handleExit() {
    // Don't lose accrued focus: auto-strike if a real session was running.
    if (elapsed >= 60) {
      const r = applyStrike(elapsed);
      if (r?.slain) { setVictory(r); stopTick(); setRunning(false); setElapsed(0); return; }
    }
    stopTick();
    onExit();
  }

  if (victory) {
    return (
      <div className={styles.fight}>
        <div className={styles.victory}>
          <BossArt theme={boss.theme} pct={0} slain size={220} />
          <h2 className={styles.victoryTitle}>{boss.name} defeated</h2>
          <span className={`${styles.outcomeBadge} ${styles[`outcome_${victory.outcome}`]}`}>{outcomeLabel(victory.outcome)}</span>
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
        <BossArt theme={boss.theme} pct={boss.pct} size={240} enraged={enraged} />
      </div>

      <div className={styles.fightInfo}>
        <div className={styles.fightTitleRow}>
          <h1 className={styles.fightName}>{boss.name}</h1>
          <span className={`${styles.tierBadge} ${styles[`tier_${boss.tier}`]}`}>{TIER_LABEL[boss.tier]}</span>
        </div>
        <p className={styles.fightAssignment}>{boss.assignmentName}</p>
        <p className={styles.fightCourse}>{boss.course}</p>
        <p className={styles.fightBanter}>"{spawnLine}"</p>

        <div className={styles.fightHp}>
          <HpBar pct={boss.pct} remaining={boss.hpRemaining} total={boss.hp} />
        </div>

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
          <span className={`${styles.multChip}${early >= 1.5 ? ` ${styles.multGood}` : ''}`}>
            Early strike ×{early.toFixed(1)}
          </span>
          <span className={`${styles.multChip}${spacing > 1 ? ` ${styles.multGood}` : ''}`}>
            Combo ×{spacing.toFixed(1)}
          </span>
          <span className={styles.multTotal}>Damage ×{(early * spacing).toFixed(2)}</span>
        </div>

        <div className={styles.timerBox}>
          <span className={`${styles.timerDisplay}${running ? ` ${styles.timerRunning}` : ''}`}>{fmtClock(elapsed)}</span>
          <div className={styles.timerControls}>
            {!running ? (
              <button className={styles.primaryBtn} onClick={start}>
                {elapsed > 0 ? 'Resume focus' : 'Start focus'}
              </button>
            ) : (
              <button className={styles.strikeBtn} onClick={stopAndStrike} disabled={elapsed < 60}>
                {elapsed < 60 ? `Strike in ${60 - elapsed}s` : 'Stop & strike'}
              </button>
            )}
          </div>
          <p className={styles.timerHint}>Focus to attack. Every minute is one hit, boosted by your multipliers.</p>
        </div>

        {result && (
          <div className={styles.strikeResult}>
            <strong>{result.damage} damage dealt</strong> · {result.rawMinutes} min × {(result.earlyMultiplier * result.spacingMultiplier).toFixed(2)}.
            <span className={styles.strikeBanter}> "{banterFor(boss, boss.pct <= 0.2 ? 'near_death' : 'half')}"</span>
          </div>
        )}

        <a className={styles.canvasLink} href={boss.htmlUrl} target="_blank" rel="noopener noreferrer">View on Canvas</a>
      </div>
    </div>
  );
}

// ── Log card (defeated) ──────────────────────────────────────────────────────

function LogCard({ boss, onRevive, onReset }: {
  boss: Boss;
  onRevive: (id: number) => void;
  onReset: (id: number) => void;
}) {
  return (
    <div className={styles.logCard}>
      <BossArt theme={boss.theme} pct={0} slain size={64} />
      <div className={styles.logBody}>
        <div className={styles.cardTop}>
          <span className={styles.bossName}>{boss.name}</span>
          <span className={`${styles.outcomeBadge} ${styles[`outcome_${boss.progress.outcome}`]}`}>
            {outcomeLabel(boss.progress.outcome)}
          </span>
        </div>
        <span className={styles.assignmentName} title={boss.assignmentName}>{boss.assignmentName}</span>
        <span className={styles.courseName}>{boss.course} · slain {slainAgo(boss.progress.slainAt)}</span>
      </div>
      <div className={styles.logActions}>
        <button className={styles.ghostBtn} onClick={() => onRevive(boss.id)}>Revive</button>
        <button className={styles.ghostBtn} onClick={() => onReset(boss.id)}>Reset</button>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BossesTab() {
  const assignments = useMemo<CanvasAssignment[]>(() => storage.getCachedAssignments(), []);
  const [tab, setTab] = useState<Tab>('active');
  const [fighting, setFighting] = useState<Boss | null>(null);
  const [, forceTick] = useState(0);

  // Re-derive on any boss change.
  useEffect(() => {
    const refresh = () => forceTick(t => t + 1);
    window.addEventListener(BOSSES_EVENT, refresh);
    return () => window.removeEventListener(BOSSES_EVENT, refresh);
  }, []);

  const active = useMemo(() => getActiveBosses(assignments), [assignments, fighting]); // eslint-disable-line react-hooks/exhaustive-deps
  const slain = useMemo(() => getSlainBosses(assignments), [assignments, fighting]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats: BossStats = useMemo(() => bossStats(getBosses(assignments)), [assignments, fighting, active, slain]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the live fight view in sync with the latest progress.
  const fightingLive = useMemo(() => {
    if (!fighting) return null;
    return getBosses(assignments).find(b => b.id === fighting.id) ?? fighting;
  }, [fighting, assignments]);

  function handleMarkDone(b: Boss) {
    if (confirm(`Mark "${b.assignmentName}" as done? It moves to your Hall of Defeated.`)) {
      markSlain(b);
    }
  }

  if (fightingLive) {
    return (
      <div className={styles.container}>
        <FightView boss={fightingLive} onExit={() => setFighting(null)} />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Bosses</h1>
        <p className={styles.subtitle}>Every deadline is a boss. Focus time is your weapon. Beat them before they land.</p>
      </header>

      {/* Rank + stats */}
      <div className={styles.statsRow}>
        <div className={styles.rankCard}>
          <span className={styles.rankLabel}>Rank</span>
          <span className={styles.rankName}>{stats.rank}</span>
          {stats.nextRankAt != null && (
            <span className={styles.rankNext}>{stats.nextRankAt - stats.slain} more to rank up</span>
          )}
        </div>
        <div className={styles.statChip}><span className={styles.statNum}>{stats.active}</span><span className={styles.statLbl}>active</span></div>
        <div className={styles.statChip}><span className={styles.statNum}>{stats.slain}</span><span className={styles.statLbl}>slain</span></div>
        <div className={styles.statChip}><span className={styles.statNum}>{stats.flawless}</span><span className={styles.statLbl}>flawless</span></div>
      </div>

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
            <p className={styles.emptyText}>
              Connect Canvas in Settings and your upcoming deadlines will appear here as bosses to defeat.
            </p>
          </div>
        ) : (
          <div className={styles.cardList}>
            {active.map(b => (
              <BossCard key={b.id} boss={b} onFight={setFighting} onMarkDone={handleMarkDone} />
            ))}
          </div>
        )
      ) : (
        slain.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Nothing defeated yet</p>
            <p className={styles.emptyText}>Take down a boss and it earns a permanent place in your hall.</p>
          </div>
        ) : (
          <div className={styles.logGrid}>
            {slain.map(b => (
              <LogCard key={b.id} boss={b} onRevive={reviveBoss} onReset={resetBoss} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
