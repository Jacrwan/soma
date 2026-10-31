import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styles from './Walkthrough.module.css';

/**
 * A tour of the whole app, shown once right after sign-up and replayable from
 * Settings → Appearance. It visits each page in sidebar order and points at a
 * real element on it, found by its data-tour attribute (or a widget's
 * data-widget); when several elements share the attribute (the Calendar's
 * header and its filter row) the spotlight covers them all. Each stop says what the part is for and what to do there.
 *
 * Finding a stop's element: the page may still be loading, so the tour keeps
 * looking for a few seconds. If the element hasn't shown by then it spotlights
 * the stop's fallback (usually that page's sidebar item) and keeps looking, so
 * a page that finishes loading late still gets its own spotlight. An optional
 * stop is about a part the student can hide (a dashboard widget, the brief):
 * when it isn't there the tour moves on past it. Anything else with nothing
 * to point at shows its card in the centre.
 */
interface Stop {
  section: string;
  route: string;
  title: string;
  body: string;
  find?: () => HTMLElement | HTMLElement[] | null;
  fallback?: () => HTMLElement | null;
  optional?: boolean;
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
/** Every element matching sel, as one target. */
const all = (sel: string) => {
  const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
  return els.length ? els : null;
};

export const STOPS: Stop[] = [
  {
    section: 'Welcome',
    route: '/dashboard',
    title: 'Welcome to Soma',
    body: 'Here’s a quick look at every page and what to do on it. It takes about two minutes. Use Next, or the arrow keys, and replay it any time from Settings → Appearance.',
  },
  {
    section: 'Dashboard',
    route: '/dashboard',
    title: 'Today’s plan',
    body: 'Your day as study blocks, with your Google Calendar events around them (those stay read-only). The gaps show open time. Tap a day in the strip above to see it, and press Edit plan to add, change or remove a block.',
    find: () => q('[data-tour="plan"]'),
  },
  {
    section: 'Dashboard',
    route: '/dashboard',
    title: 'Press Focus to study',
    body: 'Focus on a block starts the timer. When you stop, the time is logged to that course, and that logged time is what your progress and Insights count. Press the check on a block once the work is done.',
    find: () => q('[data-tour="plan"] button[aria-label^="Start focus"]') ?? q('[data-tour="plan"]'),
  },
  {
    section: 'Dashboard',
    route: '/dashboard',
    title: 'The focus timer',
    body: 'Pause for a break and Resume when you’re back; paused time isn’t counted. Stop & save logs the session. The timer keeps running while you move between pages.',
    find: () => q('[data-widget="focus"]'),
    optional: true,
  },
  {
    section: 'Dashboard',
    route: '/dashboard',
    title: 'Ask Soma',
    body: 'Tell Soma what’s due and when you’re free, by typing or with the mic. It suggests blocks on your plan, and you Accept them one at a time or all at once. Nothing changes until you do.',
    find: () => q('[data-tour="ask"]'),
    optional: true,
  },
  {
    section: 'Dashboard',
    route: '/dashboard',
    title: 'Today’s brief',
    body: 'Each morning: what’s due, what changed overnight and anything that slipped yesterday. Plan my day hands it to Soma to plan. When something slipped, Catch up offers a plan to fit it back in, ready to accept in one tap.',
    find: () => q('section[aria-labelledby="agent-brief"]'),
    optional: true,
  },
  {
    section: 'Dashboard',
    route: '/dashboard',
    title: 'Brain dump',
    body: 'Get everything out of your head: type a line and press Enter. When you’re ready, + puts an item on your plan with a course, a length and a time already filled in.',
    find: () => q('[data-widget="dump"]'),
    optional: true,
  },
  {
    section: 'Dashboard',
    route: '/dashboard',
    title: 'Due soon',
    body: 'Canvas work due in the days on screen. The calendar button beside each one is Plan it: Soma suggests when to work on it, and you add it in one tap.',
    find: () => q('[data-widget="due"]'),
    optional: true,
  },
  {
    section: 'Dashboard',
    route: '/dashboard',
    title: 'Make it yours',
    body: 'Customize lets you drag widgets anywhere, change their size, or hide the ones you don’t use. Press Done to save.',
    find: () => q('[data-tour="customize"]'),
    optional: true,
  },
  {
    section: 'Deadlines',
    route: '/deadlines',
    title: 'Everything that’s due',
    body: 'Canvas assignments, work from course websites and tasks you add, in one list by day. Filter by status or course, and set each item to In progress or Done as you go. Plan it puts one on your plan; exams get Plan review.',
    find: () => q('[data-tour="deadlines"]'),
    fallback: () => q('[data-tour="nav-deadlines"]'),
  },
  {
    section: 'Grades',
    route: '/grades',
    title: 'Grades',
    body: 'Each course with its grade, from Canvas and scores you type in, weighted the way the syllabus says. Open a course to see how it’s graded and add scores. Star the courses you care about and only those stay here.',
    find: () => q('[data-tour="grades"]'),
    fallback: () => q('[data-tour="nav-grades"]'),
  },
  {
    section: 'Documents',
    route: '/documents',
    title: 'Documents',
    body: 'Add syllabi, readings and study guides. Soma reads them when you ask about a course, a syllabus can set up how a course is graded, and a reading guide becomes a reading list you tick off.',
    find: () => q('[data-tour="documents"]'),
    fallback: () => q('[data-tour="nav-documents"]'),
  },
  {
    section: 'Calendar',
    route: '/calendar',
    title: 'Calendar',
    body: 'Your plan, Google Calendar and course deadlines together, by month, week or 3 days. The Google Calendar, Courses and Soma buttons turn each one on or off. Study blocks show the time you actually put in; click one to edit or delete it.',
    find: () => all('[data-tour="calendar"]'),
    fallback: () => q('[data-tour="nav-calendar"]'),
  },
  {
    section: 'AI',
    route: '/ai',
    title: 'The full Soma chat',
    body: 'Ask Soma to plan your week, move things around, or work out what to do first. It knows your deadlines, calendar and documents, and every change it suggests waits for your OK. AI is part of Premium and the free trial.',
    find: () => q('[data-tour="ai"]'),
    fallback: () => q('[data-tour="nav-ai"]'),
  },
  {
    section: 'Insights',
    route: '/insights',
    title: 'Insights',
    body: 'Once you’ve logged a few sessions: time by week and course, your streak, the hours you focus best, and how long things really take compared with what you planned.',
    find: () => q('[aria-label="Insights summary"]'),
    fallback: () => q('[data-tour="nav-insights"]'),
  },
  {
    section: 'Settings',
    route: '/settings',
    title: 'Settings',
    body: 'Connect Canvas and Google Calendar in Integrations. Study hours sets when Soma may plan study, Courses holds your courses and their colours, and Memory shows what Soma remembers about you.',
    find: () => q('[data-tour="settings-nav"]'),
    fallback: () => q('[data-tour="nav-settings"]'),
  },
  {
    section: 'You’re set',
    route: '/dashboard',
    title: 'Ready when you are',
    body: 'Start with today’s plan: press Focus on your first block, or tell Soma what’s due and accept what it suggests.',
  },
];

const PAD = 6;       // spotlight breathing room around the target
const GAP = 14;      // distance between spotlight and card
const CARD_W = 340;
const EDGE = 16;
const FALLBACK_AFTER = 1200; // ms before a missing element gives way to its fallback
const GIVE_UP_AFTER = 4000;  // ms before the tour stops looking

type Rect = { top: number; left: number; width: number; height: number };

type Target = HTMLElement | HTMLElement[];

function visible(el: Target | null | undefined): el is Target {
  if (!el) return false;
  if (Array.isArray(el)) return el.length > 0 && el.every(visible);
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** The box around every element of a target. */
function boundingRect(el: Target): DOMRect {
  if (!Array.isArray(el)) return el.getBoundingClientRect();
  const rs = el.map(e => e.getBoundingClientRect());
  const top = Math.min(...rs.map(r => r.top)), left = Math.min(...rs.map(r => r.left));
  return new DOMRect(left, top, Math.max(...rs.map(r => r.right)) - left, Math.max(...rs.map(r => r.bottom)) - top);
}

/** The part of a target not cut off by the window or a scrolling ancestor. */
function visibleRect(target: Target): Rect {
  const el = Array.isArray(target) ? target[0] : target;
  const r = boundingRect(target);
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
  const { pathname } = useLocation();
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<Rect | null>(null);
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  const [cardH, setCardH] = useState(180);
  // Still looking for this stop's element: the card waits rather than
  // flashing in the centre and then jumping (or vanishing, for a skipped stop).
  const [seeking, setSeeking] = useState(true);
  // Which way the student last moved, so a missing optional stop is passed
  // over in that direction (Back doesn't bounce forward again).
  const direction = useRef<1 | -1>(1);
  const stop = STOPS[index];
  const last = index === STOPS.length - 1;

  function go(step: 1 | -1) {
    direction.current = step;
    setIndex(i => Math.max(0, Math.min(STOPS.length - 1, i + step)));
  }

  function finish() {
    navigate('/dashboard');
    onDone();
  }

  // Each stop lives on a page; go there first.
  useEffect(() => {
    if (pathname !== stop.route) navigate(stop.route);
  }, [stop]); // eslint-disable-line react-hooks/exhaustive-deps

  // Find this stop's element, waiting for its page to load, then keep the
  // spotlight on it through scrolls and resizes.
  useEffect(() => {
    let el: Target | null = null;
    let frame = 0;
    const started = performance.now();

    function measure() {
      if (!visible(el)) { setTarget(null); return; }
      const r = visibleRect(el);
      setTarget({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    }

    function use(found: Target) {
      el = found;
      setSeeking(false);
      // Only scroll when the element's top is out of view; a plan taller
      // than the screen is already where it should be.
      // On phones the nav is a sideways-scrolling bar, so a tab can also be
      // cut off horizontally.
      const { top, height, width } = boundingRect(el);
      const clippedSideways = visibleRect(el).width < width - 1;
      if (top < 0 || top > window.innerHeight * 0.7 || clippedSideways) {
        const tall = height > window.innerHeight * 0.7;
        (Array.isArray(el) ? el[0] : el).scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest', behavior: 'smooth' });
      }
      measure();
    }

    function seek() {
      if (!stop.find) { setTarget(null); setSeeking(false); return; }
      // Wrong page still showing: wait for the navigation above to land.
      const onPage = window.location.pathname === stop.route;
      const found = onPage ? stop.find() : null;
      if (visible(found)) { use(found); return; }
      const waited = performance.now() - started;
      if (onPage && waited > FALLBACK_AFTER && !el) {
        const fb = stop.fallback?.();
        if (visible(fb)) use(fb);
      }
      // Optional parts render with the rest of their page, so they get less time.
      if (waited < (stop.optional ? FALLBACK_AFTER : GIVE_UP_AFTER)) { frame = requestAnimationFrame(seek); return; }
      if (el) return;
      if (stop.optional) {
        setIndex(i => Math.max(0, Math.min(STOPS.length - 1, i + direction.current)));
        return;
      }
      setTarget(null);
      setSeeking(false);
    }

    setTarget(null);
    setSeeking(!!stop.find);
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
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight' && index < STOPS.length - 1) go(1);
      else if (e.key === 'ArrowLeft' && index > 0) go(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!seeking) cardEl?.focus(); }, [cardEl, index, seeking]);

  const cardStyle: CSSProperties = target
    ? placeCard(target, cardH)
    : { width: Math.min(CARD_W, window.innerWidth - EDGE * 2), left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div className={styles.root}>
      {/* Clicks outside the card are swallowed so the tour can't be half-left. */}
      <div className={`${styles.scrim}${target ? '' : ` ${styles.scrimFull}`}`} />
      {target && <div className={styles.spotlight} style={target} aria-hidden="true" />}

      <div
        key={index}
        ref={setCardEl}
        className={`${styles.card}${seeking ? ` ${styles.cardWaiting}` : ''}`}
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-title"
        aria-describedby="walkthrough-body"
        tabIndex={-1}
      >
        <div className={styles.meta}>
          <span className={styles.section}>{stop.section}</span>
          <span className={styles.count}>{index + 1} of {STOPS.length}</span>
        </div>
        <div className={styles.progress} aria-hidden="true">
          <span style={{ width: `${((index + 1) / STOPS.length) * 100}%` }} />
        </div>
        <h2 id="walkthrough-title" className={styles.title}>{stop.title}</h2>
        <p id="walkthrough-body" className={styles.body}>{stop.body}</p>
        <div className={styles.actions}>
          {last ? <span /> : <button className={styles.skip} onClick={finish}>Skip tour</button>}
          <div className={styles.nav}>
            {index > 0 && (
              <button className={styles.back} onClick={() => go(-1)}>Back</button>
            )}
            <button
              className={styles.next}
              onClick={() => (last ? finish() : go(1))}
            >
              {index === 0 ? 'Show me around' : last ? 'Start studying' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
