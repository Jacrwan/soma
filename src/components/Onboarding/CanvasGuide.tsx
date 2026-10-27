import { useEffect, useRef, useState, type ReactElement } from 'react';
import styles from './CanvasGuide.module.css';

/**
 * A short, silent walkthrough of setting up Soma for Canvas, drawn in the
 * page rather than shipped as a video: a browser window, a cursor, and the
 * real steps (add it, open Canvas, it lands in Soma, the popup). It plays on
 * its own, and each chapter can be clicked to jump to it. Every scene is
 * remounted when it starts, so its CSS animations replay from the top.
 *
 * `start` is where the student actually is, so a student who has installed
 * the extension starts at "Open Canvas" rather than watching the install.
 */

export type GuideScene = 'install' | 'canvas' | 'soma' | 'popup';

const SCENES: { id: GuideScene; label: string; url: string; caption: string }[] = [
  { id: 'install', label: 'Add it', url: 'chromewebstore.google.com/detail/soma-for-canvas', caption: 'Click Add to Chrome on the Web Store page, then Add extension.' },
  { id: 'canvas', label: 'Canvas', url: 'yourschool.instructure.com', caption: 'Open Canvas and sign in as usual. The extension reads it in your browser.' },
  { id: 'soma', label: 'In Soma', url: 'somastudy.app/deadlines', caption: 'Your assignments, due dates and grades show up in Soma on their own.' },
  { id: 'popup', label: 'Popup', url: 'yourschool.instructure.com', caption: 'Pin the extension. Its popup shows what’s due soon and what changed.' },
];

const SCENE_MS = 5200;
const ICON = '/favicon.png';

const COURSES = [
  { name: 'BIO 101', color: '#66bb6a' },
  { name: 'CS 170', color: '#42a5f5' },
  { name: 'MATH 53', color: '#ffa726' },
  { name: 'ENG 45', color: '#ab47bc' },
];

function Install() {
  return (
    <div className={styles.store}>
      <img className={styles.storeIcon} src={ICON} alt="" />
      <div className={styles.storeText}>
        <span className={styles.storeName}>Soma for Canvas</span>
        <span className={styles.storeMeta}>Productivity · Free</span>
      </div>
      <span className={`${styles.storeBtn} ${styles.pressAt}`}>
        <span className={styles.btnIdle}>Add to Chrome</span>
        <span className={styles.btnDone}>✓ Added</span>
      </span>
      <div className={styles.dialog}>
        <span className={styles.dialogTitle}>Add “Soma for Canvas”?</span>
        <span className={styles.dialogText}>It can read your data on Canvas sites</span>
        <span className={styles.dialogActions}>
          <span className={styles.dialogCancel}>Cancel</span>
          <span className={styles.dialogOk}>Add extension</span>
        </span>
      </div>
      <span className={`${styles.cursor} ${styles.cursorInstall}`} aria-hidden="true" />
    </div>
  );
}

function Canvas() {
  return (
    <div className={styles.lms}>
      <div className={styles.lmsNav}>
        {[0, 1, 2, 3, 4].map(i => <span key={i} className={styles.lmsNavDot} />)}
      </div>
      <div className={styles.lmsMain}>
        <span className={styles.lmsTitle}>Dashboard</span>
        <div className={styles.lmsGrid}>
          {COURSES.map((c, i) => (
            <div key={c.name} className={styles.lmsCard} style={{ animationDelay: `${150 + i * 120}ms` }}>
              <span className={styles.lmsCardTop} style={{ background: c.color }} />
              <span className={styles.lmsCardName}>{c.name}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.scan} aria-hidden="true" />
      <div className={styles.toast}>
        <img src={ICON} alt="" />
        <span>Synced 4 courses, 23 assignments</span>
      </div>
    </div>
  );
}

function Soma() {
  const rows = [
    { name: 'Microscope lab report', course: COURSES[0], when: 'Tomorrow' },
    { name: 'Problem set 6', course: COURSES[1], when: 'Thu' },
    { name: 'Midterm review', course: COURSES[2], when: 'Fri' },
    { name: 'Essay draft', course: COURSES[3], when: 'Mon' },
  ];
  return (
    <div className={styles.soma}>
      <div className={styles.somaSide}>
        <img src={ICON} alt="" />
        {[0, 1, 2, 3].map(i => <span key={i} className={i === 1 ? styles.somaNavOn : styles.somaNav} />)}
      </div>
      <div className={styles.somaMain}>
        <span className={styles.somaTitle}>Everything due</span>
        {rows.map((r, i) => (
          <div key={r.name} className={styles.somaRow} style={{ animationDelay: `${500 + i * 260}ms` }}>
            <span className={styles.somaDot} style={{ background: r.course.color }} />
            <span className={styles.somaName}>{r.name}</span>
            <span className={styles.somaWhen}>{r.when}</span>
          </div>
        ))}
        <div className={styles.somaGrade}>
          <span>BIO 101</span>
          <strong>B+</strong>
        </div>
      </div>
    </div>
  );
}

function Popup() {
  return (
    <div className={styles.lms}>
      <div className={styles.lmsNav}>
        {[0, 1, 2, 3, 4].map(i => <span key={i} className={styles.lmsNavDot} />)}
      </div>
      <div className={styles.lmsMain}>
        <span className={styles.lmsTitle}>Dashboard</span>
        <div className={styles.lmsGrid}>
          {COURSES.map(c => (
            <div key={c.name} className={styles.lmsCardStill}>
              <span className={styles.lmsCardTop} style={{ background: c.color }} />
              <span className={styles.lmsCardName}>{c.name}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.pop}>
        <span className={styles.popHead}><img src={ICON} alt="" />Soma for Canvas</span>
        <span className={styles.popLabel}>Due soon</span>
        <span className={styles.popItem}><b>Microscope lab report</b><i>Tomorrow 11:59 PM</i></span>
        <span className={styles.popItem}><b>Problem set 6</b><i>Thu 5:00 PM</i></span>
        <span className={styles.popLabel}>What changed</span>
        <span className={styles.popItem}><b>Graded: Cell homework</b><i>9 / 10</i></span>
        <span className={styles.popSync}>Sync now</span>
      </div>
      <span className={`${styles.cursor} ${styles.cursorPopup}`} aria-hidden="true" />
    </div>
  );
}

const VIEW: Record<GuideScene, () => ReactElement> = { install: Install, canvas: Canvas, soma: Soma, popup: Popup };

export default function CanvasGuide({ start = 'install' }: { start?: GuideScene }) {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [index, setIndex] = useState(() => Math.max(0, SCENES.findIndex(s => s.id === start)));
  const [playing, setPlaying] = useState(!reduced);
  const [elapsed, setElapsed] = useState(0);
  const [run, setRun] = useState(0); // remounts the scene so its animations replay
  const last = useRef<number | null>(null);

  // Follow the student: when they finish a step for real, the guide moves on.
  useEffect(() => {
    const i = SCENES.findIndex(s => s.id === start);
    if (i >= 0) { setIndex(i); setElapsed(0); setRun(r => r + 1); }
  }, [start]);

  useEffect(() => {
    if (!playing) { last.current = null; return; }
    let frame = 0;
    const tick = (now: number) => {
      const dt = last.current === null ? 0 : now - last.current;
      last.current = now;
      setElapsed(e => {
        const next = e + dt;
        if (next < SCENE_MS) return next;
        setIndex(i => (i + 1) % SCENES.length);
        setRun(r => r + 1);
        return 0;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const go = (i: number) => { setIndex(i); setElapsed(0); setRun(r => r + 1); setPlaying(!reduced); };
  const scene = SCENES[index];
  const View = VIEW[scene.id];

  return (
    <figure className={styles.guide} aria-label="How to set up Soma for Canvas">
      <div key={run} className={`${styles.window} ${reduced ? styles.still : ''} ${playing ? '' : styles.paused}`}>
        <div className={styles.chrome}>
          <span className={styles.lights} aria-hidden="true"><i /><i /><i /></span>
          <span className={styles.url}>{scene.url}</span>
          <span className={styles.tools} aria-hidden="true">
            <span className={`${styles.extIcon} ${scene.id === 'install' ? styles.extArrive : ''}`}>
              <img src={ICON} alt="" />
              {(scene.id === 'canvas' || scene.id === 'popup') && <span className={styles.badge}>3</span>}
            </span>
            <span className={styles.puzzle} />
          </span>
        </div>
        <div className={styles.stage} aria-hidden="true">
          <View />
        </div>
      </div>

      <figcaption className={styles.caption} aria-live="polite">
        <span className={styles.stepNo}>{index + 1}/{SCENES.length}</span> {scene.caption}
      </figcaption>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.play}
          onClick={() => setPlaying(p => !p)}
          aria-label={playing ? 'Pause walkthrough' : 'Play walkthrough'}
        >
          {playing ? <span className={styles.pauseIcon} /> : <span className={styles.playIcon} />}
        </button>
        <ol className={styles.chapters}>
          {SCENES.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className={`${styles.chapter} ${i === index ? styles.chapterOn : ''}`}
                onClick={() => go(i)}
                aria-current={i === index ? 'step' : undefined}
              >
                <span className={styles.track}>
                  <span
                    className={styles.fill}
                    style={{ width: i < index ? '100%' : i === index ? `${(elapsed / SCENE_MS) * 100}%` : '0%' }}
                  />
                </span>
                <span className={styles.chapterLabel}>{s.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}
