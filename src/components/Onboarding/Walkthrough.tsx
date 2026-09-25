import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './Walkthrough.module.css';

/**
 * A short tour of the dashboard, shown once right after onboarding. Each stop
 * points at a real element, found by its data-tour attribute. When a stop's
 * element is missing (an empty plan has no Focus buttons, the dashboard is
 * still loading) the card falls back to the next candidate, then to the centre.
 */
interface Stop {
  title: string;
  body: string;
  find: () => HTMLElement | null;
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel);

function focusButton() {
  const buttons = document.querySelectorAll<HTMLElement>('[data-tour="plan"] button');
  return Array.from(buttons).find(b => b.textContent?.trim() === 'Focus') ?? null;
}

const STOPS: Stop[] = [
  {
    title: 'Today’s plan',
    body: 'Your day as study blocks, with Google Calendar events shown read-only around them. Use Edit plan to add a block.',
    find: () => q('[data-tour="plan"]'),
  },
  {
    title: 'Press Focus to study',
    body: 'Focus on a block starts the timer. The time you actually put in is tracked separately from what you planned.',
    find: () => focusButton() ?? q('[data-tour="plan"]'),
  },
  {
    title: 'Ask Soma',
    body: 'Tell it what’s due and when you’re free. It proposes blocks, and nothing lands on your plan until you approve it.',
    find: () => q('[data-tour="ask"]'),
  },
  {
    title: 'Deadlines',
    body: 'Your Canvas assignments and everything else that’s due, in one list.',
    find: () => q('[data-tour="nav-deadlines"]'),
  },
  {
    title: 'Insights',
    body: 'Once you’ve studied a few days: time by subject, your streak, and the hours you focus best.',
    find: () => q('[data-tour="nav-insights"]'),
  },
];

const PAD = 6;       // spotlight breathing room around the target
const GAP = 14;      // distance between spotlight and card
const CARD_W = 320;
const EDGE = 16;

type Rect = { top: number; left: number; width: number; height: number };

function visible(el: HTMLElement | null): el is HTMLElement {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** The part of el not cut off by the window or a scrolling ancestor. */
function visibleRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  let top = Math.max(r.top, 0);
  let left = Math.max(r.left, 0);
  let bottom = Math.min(r.bottom, window.innerHeight);
  let right = Math.min(r.right, window.innerWidth);
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (getComputedStyle(p).overflowY === 'visible') continue;
    const c = p.getBoundingClientRect();
    top = Math.max(top, c.top);
    left = Math.max(left, c.left);
    bottom = Math.min(bottom, c.bottom);
    right = Math.min(right, c.right);
  }
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Place the card beside the spotlight: right, then left, below, above. */
function placeCard(t: Rect, cardH: number): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - EDGE * 2);
  const clampX = (x: number) => Math.max(EDGE, Math.min(x, vw - w - EDGE));
  const clampY = (y: number) => Math.max(EDGE, Math.min(y, vh - cardH - EDGE));

  if (t.left + t.width + GAP + w + EDGE <= vw) {
    return { width: w, left: t.left + t.width + GAP, top: clampY(t.top) };
  }
  if (t.left - GAP - w >= EDGE) {
    return { width: w, left: t.left - GAP - w, top: clampY(t.top) };
  }
  if (t.top + t.height + GAP + cardH + EDGE <= vh) {
    return { width: w, left: clampX(t.left), top: t.top + t.height + GAP };
  }
  if (t.top - GAP - cardH >= EDGE) {
    return { width: w, left: clampX(t.left), top: t.top - GAP - cardH };
  }
  // Target fills the screen (a tall plan on a phone): pin the card to the bottom.
  return { width: w, left: clampX(t.left), top: vh - cardH - EDGE };
}

export default function Walkthrough({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<Rect | null>(null);
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  const [cardH, setCardH] = useState(180);
  const stop = STOPS[index];
  const last = index === STOPS.length - 1;

  useEffect(() => { navigate('/dashboard'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Find this stop's element, waiting briefly for the dashboard to load, then
  // keep the spotlight on it through scrolls and resizes.
  useEffect(() => {
    let el: HTMLElement | null = null;
    let frame = 0;
    const started = performance.now();

    function measure() {
      if (!visible(el)) { setTarget(null); return; }
      const r = visibleRect(el);
      setTarget({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    }

    function seek() {
      const found = stop.find();
      if (visible(found)) {
        el = found;
        // Only scroll when the element's top is out of view; a plan taller
        // than the screen is already where it should be.
        // On phones the nav is a sideways-scrolling bar, so a tab can also be
        // cut off horizontally.
        const { top, height, width } = el.getBoundingClientRect();
        const clippedSideways = visibleRect(el).width < width - 1;
        if (top < 0 || top > window.innerHeight * 0.7 || clippedSideways) {
          const tall = height > window.innerHeight * 0.7;
          el.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest', behavior: 'smooth' });
        }
        measure();
        return;
      }
      if (performance.now() - started < 4000) frame = requestAnimationFrame(seek);
      else setTarget(null);
    }

    setTarget(null);
    seek();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [index, stop]);

  useLayoutEffect(() => {
    if (cardEl) setCardH(cardEl.offsetHeight);
  }, [cardEl, index, target]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDone();
      else if (e.key === 'ArrowRight') setIndex(i => (i < STOPS.length - 1 ? i + 1 : i));
      else if (e.key === 'ArrowLeft') setIndex(i => Math.max(0, i - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  useEffect(() => { cardEl?.focus(); }, [cardEl, index]);

  const cardStyle: CSSProperties = target
    ? placeCard(target, cardH)
    : { width: Math.min(CARD_W, window.innerWidth - EDGE * 2), left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div className={styles.root}>
      {/* Clicks outside the card are swallowed so the tour can't be half-left. */}
      <div className={`${styles.scrim}${target ? '' : ` ${styles.scrimFull}`}`} />
      {target && <div className={styles.spotlight} style={target} aria-hidden="true" />}

      <div
        ref={setCardEl}
        className={styles.card}
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-title"
        aria-describedby="walkthrough-body"
        tabIndex={-1}
      >
        <p className={styles.count}>{index + 1} of {STOPS.length}</p>
        <h2 id="walkthrough-title" className={styles.title}>{stop.title}</h2>
        <p id="walkthrough-body" className={styles.body}>{stop.body}</p>
        <div className={styles.actions}>
          {last ? <span /> : <button className={styles.skip} onClick={onDone}>Skip tour</button>}
          <div className={styles.nav}>
            {index > 0 && (
              <button className={styles.back} onClick={() => setIndex(i => i - 1)}>Back</button>
            )}
            <button
              className={styles.next}
              onClick={() => (last ? onDone() : setIndex(i => i + 1))}
            >
              {last ? 'Start studying' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
