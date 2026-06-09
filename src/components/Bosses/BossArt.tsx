import type { JSX } from 'react';
import { BossTheme, THEME_COLOR } from '../../lib/bosses';
import styles from './Bosses.module.css';

// Parametric SVG boss art. One themed creature per subject with a glowing health
// core (brighter and faster as HP drops), blinking eyes for personality, cracks
// that spread with damage, an optional cosmetic aura, and a shatter on defeat.

interface BossArtProps {
  theme: BossTheme;
  pct: number;
  slain?: boolean;
  size?: number;
  enraged?: boolean;
  aura?: string;   // cosmetic glow colour
  flash?: boolean; // brief hit flash
}

function silhouette(theme: BossTheme): JSX.Element {
  switch (theme) {
    case 'math':
      return (
        <g>
          <polygon points="60,14 92,52 60,106 28,52" />
          <polygon points="60,14 92,52 60,52" opacity="0.65" />
          <polygon points="60,106 28,52 60,52" opacity="0.8" />
          <polygon points="60,52 92,52 60,106" opacity="0.5" />
        </g>
      );
    case 'chemistry':
      return (
        <g>
          <path d="M50 20 h20 v20 l20 46 a30 30 0 0 1 -60 0 l20 -46 z" />
          <circle cx="52" cy="84" r="5" opacity="0.55" />
          <circle cx="70" cy="76" r="4" opacity="0.55" />
          <circle cx="62" cy="92" r="3.5" opacity="0.55" />
        </g>
      );
    case 'biology':
      return (
        <g>
          <circle cx="60" cy="60" r="44" />
          <circle cx="40" cy="48" r="5" opacity="0.5" />
          <circle cx="80" cy="70" r="6" opacity="0.5" />
          <circle cx="50" cy="80" r="4" opacity="0.5" />
        </g>
      );
    case 'history':
      return (
        <g>
          <rect x="36" y="20" width="48" height="74" rx="4" />
          <rect x="28" y="92" width="64" height="10" rx="2" />
          <rect x="30" y="14" width="60" height="9" rx="2" />
          <line x1="50" y1="26" x2="50" y2="90" opacity="0.5" />
          <line x1="70" y1="26" x2="70" y2="90" opacity="0.5" />
        </g>
      );
    case 'english':
      return (
        <g>
          <path d="M60 18 C30 24 28 58 56 60 C84 62 86 92 58 100 C36 106 30 86 46 80"
            fill="none" strokeWidth="13" strokeLinecap="round" />
        </g>
      );
    case 'physics':
      return (
        <g>
          <ellipse cx="60" cy="60" rx="42" ry="16" fill="none" strokeWidth="5" />
          <ellipse cx="60" cy="60" rx="42" ry="16" fill="none" strokeWidth="5" transform="rotate(60 60 60)" />
          <ellipse cx="60" cy="60" rx="42" ry="16" fill="none" strokeWidth="5" transform="rotate(120 60 60)" />
          <circle cx="60" cy="60" r="9" />
        </g>
      );
    case 'cs':
      return (
        <g>
          <rect x="34" y="34" width="52" height="52" rx="6" />
          <path d="M30 40 L22 60 L30 80" fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M90 40 L98 60 L90 80" fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="46" y1="70" x2="74" y2="70" opacity="0.5" />
        </g>
      );
    case 'language':
      return (
        <g>
          <path d="M30 56 a30 26 0 1 1 8 22 l-14 6 6 -14 a26 24 0 0 1 0 -14 z" />
        </g>
      );
    case 'general':
    default:
      return (
        <g>
          <circle cx="60" cy="60" r="42" />
        </g>
      );
  }
}

function cracks(damageFrac: number, color: string): JSX.Element | null {
  const count = Math.min(5, Math.floor(damageFrac * 6));
  if (count <= 0) return null;
  const lines = ['M60 60 L40 30', 'M60 60 L92 40', 'M60 60 L86 86', 'M60 60 L30 78', 'M60 60 L58 100'];
  return (
    <g stroke={color} strokeWidth="1.6" opacity={0.5} className={styles.bossCracks}>
      {lines.slice(0, count).map((d, i) => <path key={i} d={d} fill="none" />)}
    </g>
  );
}

function shards(color: string): JSX.Element {
  const tris = ['40,40 56,46 44,58', '78,42 90,54 74,56', '46,78 60,72 56,90', '72,78 86,72 80,90', '58,52 70,54 62,66'];
  return (
    <g fill={color} className={styles.bossShards}>
      {tris.map((p, i) => <polygon key={i} points={p} opacity={0.8} style={{ ['--i' as string]: i }} />)}
    </g>
  );
}

export default function BossArt({ theme, pct, slain = false, size = 200, enraged = false, aura = '', flash = false }: BossArtProps) {
  const { base, glow } = THEME_COLOR[theme];
  const damageFrac = 1 - Math.max(0, Math.min(1, pct));
  const gid = `bg-${theme}`;
  const coreId = `bc-${theme}`;
  const coreClass = pct < 0.2 ? styles.coreCritical : pct < 0.55 ? styles.coreHurt : styles.coreCalm;

  return (
    <svg
      viewBox="0 0 120 120" width={size} height={size}
      className={`${styles.bossArt}${enraged ? ` ${styles.bossEnraged}` : ''}${slain ? ` ${styles.bossSlain}` : ''}${flash ? ` ${styles.bossFlash}` : ''}`}
      role="img" aria-label="boss"
    >
      <defs>
        <radialGradient id={gid} cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor={glow} stopOpacity="0.35" />
          <stop offset="100%" stopColor={base} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={coreId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="45%" stopColor={glow} stopOpacity="0.9" />
          <stop offset="100%" stopColor={base} stopOpacity="0" />
        </radialGradient>
      </defs>

      {aura && !slain && <circle cx="60" cy="60" r="54" fill="none" stroke={aura} strokeWidth="2" opacity="0.5" className={styles.bossAura} />}
      <circle cx="60" cy="60" r="56" fill={`url(#${gid})`} />

      {!slain && (
        <g className={styles.bossBody}>
          <g fill={base} stroke={base} strokeWidth="0" style={{ opacity: 0.92 }}>
            {silhouette(theme)}
          </g>
          {cracks(damageFrac, glow)}
          <circle cx="60" cy="60" r="13" fill={`url(#${coreId})`} className={`${styles.bossCore} ${coreClass}`} />
          {/* eyes for personality */}
          <g className={styles.bossEyes} fill="#0e0e12">
            <ellipse cx="53" cy="50" rx="2.6" ry="3.4" />
            <ellipse cx="67" cy="50" rx="2.6" ry="3.4" />
          </g>
        </g>
      )}

      {slain && <g style={{ opacity: 0.9 }}>{shards(base)}</g>}
    </svg>
  );
}
