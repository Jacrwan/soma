import { useEffect, useRef } from 'react';
import styles from './Bosses.module.css';

// Renders a real splash-art boss from a single PNG/WebP cutout, rigged in code:
// the head/torso stay planted while the cape/lower robe sways like cloth, the
// whole figure breathes and floats, a glow pulses behind it, and it flashes +
// recoils on every hit. No canvas, no fake walking.
interface SpriteBossProps {
  src: string;
  nonce: number;      // bumps on each attack the boss takes
  slain?: boolean;
  aura?: string;
}

export default function SpriteBoss({ src, nonce, slain = false, aura = '' }: SpriteBossProps) {
  const bobRef = useRef<HTMLDivElement>(null);

  // Hit reaction: flash + shake + slight knockback whenever the boss is struck.
  useEffect(() => {
    if (nonce <= 0 || slain || !bobRef.current) return;
    bobRef.current.animate(
      [
        { transform: 'translateX(0) rotate(0)', filter: 'brightness(1)' },
        { transform: 'translateX(-7px) rotate(-1.6deg)', filter: 'brightness(2.4)', offset: 0.14 },
        { transform: 'translateX(6px) rotate(1deg)', filter: 'brightness(1.5)', offset: 0.4 },
        { transform: 'translateX(-3px)', filter: 'brightness(1.1)', offset: 0.7 },
        { transform: 'translateX(0) rotate(0)', filter: 'brightness(1)' },
      ],
      { duration: 360, easing: 'ease-out' },
    );
  }, [nonce, slain]);

  return (
    <div className={`${styles.sbWrap}${slain ? ` ${styles.sbSlain}` : ''}`}>
      {aura && !slain && <div className={styles.sbAura} style={{ borderColor: aura }} />}
      <div className={styles.sbGlow} />
      <div className={styles.sbShadow} />
      <div className={styles.sbFloat}>
        <div className={styles.sbBob} ref={bobRef}>
          <div className={styles.sbBreathe}>
            <div className={styles.sbFigure}>
              <img className={styles.sbLower} src={src} alt="" />
              <img className={styles.sbUpper} src={src} alt="boss" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
